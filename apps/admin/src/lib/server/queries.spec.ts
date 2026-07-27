import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import {
	type DB,
	customerUser,
	paymentTransactions,
	creditLedger,
	pointsLedger,
	networkSessions
} from '@veent/db';

/**
 * REAL-Postgres integration tests for `listUnifiedTransactions`, run against an in-process PGlite
 * instance so the actual merge SQL executes — including the AC3 anti-join dedupe (a mock cannot
 * exercise a `NOT EXISTS`), the uniform per-source period filter (AC5), and the Maya-only field
 * nullability by kind (AC8). Applies the project's real migration chain, so schema/migration drift
 * is caught too. Scenario names map to the plan's Verification Evidence gates (AC1–AC8).
 *
 * `resolveApCircuitLabel` (the network_health join) is unit-proven separately in packages/core, so
 * here it is mocked to drive the three attribution states deterministically for AC6, while every
 * other query runs for real. `LEDGER_TYPE` and the rest of @veent/core pass through unchanged.
 */
vi.mock('@veent/core', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@veent/core')>();
	return {
		...actual,
		resolveApCircuitLabel: vi.fn(async (_db: unknown, cid: string | null) => {
			if (cid == null) return 'Unattributed';
			if (cid === 'live-1') return 'AP-Pabayo'; // live AP → friendly name (survives rename)
			return cid; // pruned AP → raw circuit-id fallback
		})
	};
});

import { listUnifiedTransactions } from './queries';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(HERE, '../../../../../packages/db/drizzle');

let client: PGlite;
let db: DB;

beforeAll(async () => {
	client = new PGlite();
	const raw = drizzle(client);
	await migrate(raw, { migrationsFolder: MIGRATIONS });
	db = raw as unknown as DB;
}, 60_000);

beforeEach(async () => {
	await client.exec(
		'TRUNCATE "payment_transactions", "credit_ledger", "points_ledger", "network_sessions", "customer_user" RESTART IDENTITY CASCADE;'
	);
});

// ── Seed helpers ─────────────────────────────────────────────────────────────
async function seedUser(id: string, name: string) {
	await db.insert(customerUser).values({ id, name, email: `${id}@example.test` });
}
async function seedMaya(o: {
	id: string;
	userId: string | null;
	amount?: string;
	status?: string;
	createdAt: Date;
	apCircuitId?: string | null;
	apNameSnapshot?: string | null;
	fundSourceType?: string | null;
	receiptNo?: string | null;
	buyerName?: string | null;
	buyerEmail?: string | null;
}) {
	await db.insert(paymentTransactions).values({
		id: o.id,
		userId: o.userId,
		amount: o.amount ?? '100',
		status: o.status ?? 'PAYMENT_SUCCESS',
		createdAt: o.createdAt,
		apCircuitId: o.apCircuitId ?? null,
		apNameSnapshot: o.apNameSnapshot ?? null,
		fundSourceType: o.fundSourceType ?? 'card',
		receiptNo: o.receiptNo ?? 'R-1',
		buyerName: o.buyerName ?? null,
		buyerEmail: o.buyerEmail ?? null
	});
}
async function seedCredit(o: {
	userId: string;
	amount: number;
	type: 'topup' | 'spend';
	createdAt: Date;
	externalTransactionId?: string | null;
	apCircuitId?: string | null;
}) {
	await db.insert(creditLedger).values({
		userId: o.userId,
		amount: o.amount,
		type: o.type,
		createdAt: o.createdAt,
		externalTransactionId: o.externalTransactionId ?? null,
		apCircuitId: o.apCircuitId ?? null
	});
}
async function seedPoints(o: {
	userId: string;
	amount: number;
	type: 'earn' | 'spend';
	createdAt: Date;
	externalTransactionId?: string | null;
	apCircuitId?: string | null;
}) {
	await db.insert(pointsLedger).values({
		userId: o.userId,
		amount: o.amount,
		type: o.type,
		createdAt: o.createdAt,
		externalTransactionId: o.externalTransactionId ?? null,
		apCircuitId: o.apCircuitId ?? null
	});
}
async function seedFreeTime(o: {
	userId: string;
	startedAt: Date;
	apCircuitId?: string | null;
	apNameSnapshot?: string | null;
}) {
	await db.insert(networkSessions).values({
		userId: o.userId,
		packageId: null,
		status: 'active',
		startedAt: o.startedAt,
		apCircuitId: o.apCircuitId ?? null,
		apNameSnapshot: o.apNameSnapshot ?? null
	});
}

const T = (min: number) => new Date(Date.UTC(2026, 6, 21, 10, min, 0));

describe('listUnifiedTransactions — real Postgres merge', () => {
	it('AC1/AC2: returns all activity kinds in one chronological list, each clearly typed', async () => {
		await seedUser('u1', 'Alice');
		await seedMaya({ id: 'pay-1', userId: 'u1', createdAt: T(5), buyerName: 'Alice' });
		// points-earn side effect of pay-1 → badge, NOT a standalone row
		await seedPoints({
			userId: 'u1',
			amount: 12,
			type: 'earn',
			createdAt: T(5),
			externalTransactionId: 'pay-1'
		});
		await seedCredit({ userId: 'u1', amount: 200, type: 'topup', createdAt: T(4) }); // standalone top-up
		await seedCredit({ userId: 'u1', amount: -50, type: 'spend', createdAt: T(3) });
		await seedPoints({ userId: 'u1', amount: -10, type: 'spend', createdAt: T(2) });
		await seedFreeTime({ userId: 'u1', startedAt: T(1) });

		const { rows, total } = await listUnifiedTransactions(db, {});

		// Five standalone rows (points-earn is a badge, never a row).
		expect(total).toBe(5);
		expect(rows).toHaveLength(5);
		const kinds = rows.map((r) => r.kind);
		expect(new Set(kinds)).toEqual(
			new Set(['maya-payment', 'credit-topup', 'credit-spend', 'points-spend', 'free-time'])
		);
		// Chronological, newest first.
		const times = rows.map((r) => new Date(r.createdAt).getTime());
		expect(times).toEqual([...times].sort((a, b) => b - a));
		// AC2: every row carries a non-empty detail label.
		expect(rows.every((r) => r.detail.trim().length > 0)).toBe(true);
		// points-earn is annotated as a badge on the Maya row, not a standalone points row.
		const maya = rows.find((r) => r.kind === 'maya-payment')!;
		expect(maya.pointsEarned).toBe(12);
		expect(rows.some((r) => r.kind === 'points-spend' && r.pointsEarned)).toBe(false);
	});

	it('AC3 (dedupe): a Maya payment + its mirrored credit topup render as exactly ONE row', async () => {
		await seedUser('u1', 'Alice');
		await seedMaya({ id: 'pay-1', userId: 'u1', createdAt: T(5) });
		// Mirrored topup sharing the join key → suppressed by the anti-join.
		await seedCredit({
			userId: 'u1',
			amount: 100,
			type: 'topup',
			createdAt: T(5),
			externalTransactionId: 'pay-1'
		});

		const { rows, total } = await listUnifiedTransactions(db, {});

		const forPayment = rows.filter((r) => r.id === 'pay-1' || r.kind === 'credit-topup');
		expect(total).toBe(1);
		expect(rows).toHaveLength(1);
		expect(forPayment).toHaveLength(1);
		expect(rows[0].kind).toBe('maya-payment');
	});

	it('AC3 (negative-control): a topup whose external id does NOT match a payment is NOT suppressed', async () => {
		// Proves the dedupe discriminates on the join key rather than blanket-hiding all topups —
		// the automated half of the negative-control (the "break the anti-join → 2 rows" half is
		// performed + documented manually during EXECUTE per the plan's negative-control convention).
		await seedUser('u1', 'Alice');
		await seedMaya({ id: 'pay-1', userId: 'u1', createdAt: T(5) });
		await seedCredit({
			userId: 'u1',
			amount: 100,
			type: 'topup',
			createdAt: T(5),
			externalTransactionId: 'pay-1'
		}); // mirror → hidden
		await seedCredit({
			userId: 'u1',
			amount: 300,
			type: 'topup',
			createdAt: T(4),
			externalTransactionId: 'orphan-x'
		}); // no match → shown

		const { rows, total } = await listUnifiedTransactions(db, {});

		expect(total).toBe(2);
		const topups = rows.filter((r) => r.kind === 'credit-topup');
		expect(topups).toHaveLength(1);
		expect(topups[0].amount).toBe('₱300');
	});

	it('AC4: a standalone topup with NULL external_transaction_id still renders as its own row', async () => {
		await seedUser('u1', 'Alice');
		await seedCredit({
			userId: 'u1',
			amount: 250,
			type: 'topup',
			createdAt: T(4),
			externalTransactionId: null
		});

		const { rows, total } = await listUnifiedTransactions(db, {});

		expect(total).toBe(1);
		expect(rows).toHaveLength(1);
		expect(rows[0].kind).toBe('credit-topup');
		expect(rows[0].detail).toBe('Credit top-up');
	});

	it('AC5: the period filter narrows all kinds uniformly, not just Maya', async () => {
		await seedUser('u1', 'Alice');
		const inRange = T(30);
		const outRange = new Date(Date.UTC(2026, 5, 1, 10, 0, 0)); // a month earlier
		// One in-range + one out-of-range row per kind.
		await seedMaya({ id: 'pay-in', userId: 'u1', createdAt: inRange });
		await seedMaya({ id: 'pay-out', userId: 'u1', createdAt: outRange });
		await seedCredit({ userId: 'u1', amount: 100, type: 'topup', createdAt: inRange });
		await seedCredit({ userId: 'u1', amount: 100, type: 'topup', createdAt: outRange });
		await seedCredit({ userId: 'u1', amount: -10, type: 'spend', createdAt: inRange });
		await seedCredit({ userId: 'u1', amount: -10, type: 'spend', createdAt: outRange });
		await seedPoints({ userId: 'u1', amount: -5, type: 'spend', createdAt: inRange });
		await seedPoints({ userId: 'u1', amount: -5, type: 'spend', createdAt: outRange });
		await seedFreeTime({ userId: 'u1', startedAt: inRange });
		await seedFreeTime({ userId: 'u1', startedAt: outRange });

		const { rows, total } = await listUnifiedTransactions(db, {
			from: new Date(Date.UTC(2026, 6, 1)),
			to: new Date(Date.UTC(2026, 6, 31))
		});

		// Exactly the 5 in-range rows survive — no kind ignores the filter.
		expect(total).toBe(5);
		expect(rows).toHaveLength(5);
		expect(new Set(rows.map((r) => r.kind))).toEqual(
			new Set(['maya-payment', 'credit-topup', 'credit-spend', 'points-spend', 'free-time'])
		);
	});

	it('AC6: AP circuit label resolves (friendly / raw-fallback / Unattributed) on the unified row', async () => {
		await seedUser('u1', 'Alice');
		await seedCredit({
			userId: 'u1',
			amount: -10,
			type: 'spend',
			createdAt: T(5),
			apCircuitId: 'live-1'
		});
		await seedPoints({
			userId: 'u1',
			amount: -10,
			type: 'spend',
			createdAt: T(4),
			apCircuitId: 'pruned-2'
		});
		await seedFreeTime({ userId: 'u1', startedAt: T(3), apCircuitId: null });

		const { rows } = await listUnifiedTransactions(db, {});

		expect(rows.find((r) => r.kind === 'credit-spend')!.apCircuitLabel).toBe('AP-Pabayo');
		expect(rows.find((r) => r.kind === 'points-spend')!.apCircuitLabel).toBe('pruned-2');
		expect(rows.find((r) => r.kind === 'free-time')!.apCircuitLabel).toBe('Unattributed');
	});

	it('AC8: Maya-only fields are populated only on maya-payment rows, explicitly null elsewhere', async () => {
		await seedUser('u1', 'Alice');
		await seedMaya({
			id: 'pay-1',
			userId: 'u1',
			createdAt: T(5),
			receiptNo: 'RCPT-9',
			buyerEmail: 'a@x.test',
			buyerName: 'Alice'
		});
		await seedCredit({ userId: 'u1', amount: -10, type: 'spend', createdAt: T(4) });
		await seedFreeTime({ userId: 'u1', startedAt: T(3) });

		const { rows } = await listUnifiedTransactions(db, {});

		const maya = rows.find((r) => r.kind === 'maya-payment')!;
		expect(maya.status).toBe('PAYMENT_SUCCESS');
		expect(maya.statusTone).toBe('online');
		expect(maya.receiptNo).toBe('RCPT-9');
		expect(maya.buyerEmail).toBe('a@x.test');
		expect(maya.fundSourceType).toBe('Card');

		for (const r of rows.filter((r) => r.kind !== 'maya-payment')) {
			expect(r.status).toBeNull();
			expect(r.statusTone).toBeNull();
			expect(r.receiptNo).toBeNull();
			expect(r.buyerEmail).toBeNull();
			expect(r.fundSourceType).toBeNull();
			expect(r.fundSourceMasked).toBeNull();
			expect(r.packageName).toBeNull();
		}
	});
});

/**
 * AC2/AC3 — same-day cross-write-convention windowing (the timestamptz migration's core fix).
 *
 * Pre-migration, money rows (credit_ledger/payment_transactions) stored Manila WALL-CLOCK while
 * session/free-time rows (network_sessions.started_at) stored UTC WALL-CLOCK — the two were skewed
 * ~8h, so a single Manila-day period window could not include both. Now every column is a real
 * timestamptz instant, and period.ts emits real Manila-day boundary instants, so a money row and a
 * session row in the SAME real Manila day window together — and a row in the NEXT Manila day is
 * correctly excluded even though its UTC calendar date is the same.
 *
 * Manila day 2026-07-21 → window [2026-07-20T16:00:00Z, 2026-07-21T15:59:59.999Z] (real instants,
 * −8h from Manila midnight, no DST — matches parsePeriod's math).
 */
describe('listUnifiedTransactions — same-day cross-convention windowing (timestamptz)', () => {
	// Manila-day 2026-07-21 real-instant boundaries (what parsePeriod now produces).
	const from = new Date('2026-07-20T16:00:00.000Z'); // Manila 07-21 00:00
	const to = new Date('2026-07-21T15:59:59.999Z'); // Manila 07-21 23:59:59.999

	it('AC2/AC3: a Maya payment and a free-time session in the same real Manila day both window in', async () => {
		await seedUser('u1', 'Alice');
		// Both late-evening Manila 07-21 (23:30 / 23:45 Manila = 15:30 / 15:45 UTC) — same real day.
		// Pre-migration these two conventions were skewed apart and could not both fall in one window.
		await seedMaya({
			id: 'pay-eve',
			userId: 'u1',
			createdAt: new Date('2026-07-21T15:30:00.000Z')
		});
		await seedFreeTime({ userId: 'u1', startedAt: new Date('2026-07-21T15:45:00.000Z') });

		const { rows, total } = await listUnifiedTransactions(db, { from, to });

		expect(total).toBe(2);
		expect(new Set(rows.map((r) => r.kind))).toEqual(new Set(['maya-payment', 'free-time']));
	});

	it('AC3 boundary: a session just past Manila midnight (next Manila day) is excluded', async () => {
		await seedUser('u1', 'Alice');
		// In-window money row (Manila 07-21 22:00 = 14:00 UTC).
		await seedMaya({ id: 'pay-in', userId: 'u1', createdAt: new Date('2026-07-21T14:00:00.000Z') });
		// Session at Manila 07-22 00:30 (= 16:30 UTC 07-21) — same UTC calendar date, NEXT Manila day.
		await seedFreeTime({ userId: 'u1', startedAt: new Date('2026-07-21T16:30:00.000Z') });

		const { rows, total } = await listUnifiedTransactions(db, { from, to });

		// Only the money row falls inside the Manila-day window; the next-Manila-day session is out.
		expect(total).toBe(1);
		expect(rows[0].kind).toBe('maya-payment');
	});
});

/**
 * AP name-snapshot freeze: a row's stored ap_name_snapshot is shown VERBATIM and wins over live
 * resolution, so a later AP rename never rewrites history. Rows without a snapshot fall back to
 * today's live resolution (the mocked resolveApCircuitLabel: 'live-1' → 'AP-Pabayo', else raw
 * cid, null → 'Unattributed'). The read path is uniform across all 5 sources; proven on the Maya
 * (revenue) source plus a free-time session as a representative non-Maya source.
 */
describe('listUnifiedTransactions — AP name-snapshot freeze', () => {
	beforeEach(async () => {
		await seedUser('u1', 'Alice');
	});

	it('shows the frozen snapshot even when the live AP name (cid live-1) differs — rename does not rewrite history', async () => {
		// cid 'live-1' resolves live to 'AP-Pabayo', but this row was frozen as 'AP-Pabayo (old name)'.
		await seedMaya({
			id: 'm1',
			userId: 'u1',
			createdAt: T(5),
			apCircuitId: 'live-1',
			apNameSnapshot: 'AP-Pabayo (old name)'
		});
		await seedFreeTime({
			userId: 'u1',
			startedAt: T(4),
			apCircuitId: 'live-1',
			apNameSnapshot: 'AP-Pabayo (old name)'
		});
		const { rows } = await listUnifiedTransactions(db, {});
		expect(rows.find((r) => r.kind === 'maya-payment')!.apCircuitLabel).toBe(
			'AP-Pabayo (old name)'
		);
		expect(rows.find((r) => r.kind === 'free-time')!.apCircuitLabel).toBe('AP-Pabayo (old name)');
	});

	it('falls back to live resolution when no snapshot is stored (old rows unchanged)', async () => {
		await seedMaya({ id: 'm2', userId: 'u1', createdAt: T(5), apCircuitId: 'live-1' }); // snapshot null
		const { rows } = await listUnifiedTransactions(db, {});
		expect(rows.find((r) => r.kind === 'maya-payment')!.apCircuitLabel).toBe('AP-Pabayo');
	});

	it('null snapshot + null circuit-id → "Unattributed" (unchanged)', async () => {
		await seedMaya({ id: 'm3', userId: 'u1', createdAt: T(5), apCircuitId: null });
		const { rows } = await listUnifiedTransactions(db, {});
		expect(rows.find((r) => r.kind === 'maya-payment')!.apCircuitLabel).toBe('Unattributed');
	});
});
