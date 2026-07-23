import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { type DB, customerUser, packages, paymentCheckouts } from '@veent/db';
import type { PaymentProvider } from '../integrations/payments';
import { reconcilePendingPayments, reconcileCheckout } from './reconcilePayments';

/**
 * AC4 — reconcilePayments age-boundary correctness against the MIGRATED (timestamptz)
 * payment_checkouts.created_at / last_polled_at columns. Real PGlite, full migration chain incl.
 * 0052, so the age comparisons (`lte`/`gt` on JS-Date bounds vs timestamptz columns) execute for
 * real. The provider returns `pending` for every poll, so nothing is credited — this isolates the
 * SELECT/expire/throttle boundary logic (the only thing the column-type change could affect).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(HERE, '../../../db/drizzle');

/** Poll stub: always "pending" so reconcile selects rows but credits none. */
const pendingProvider = {
	name: 'stub',
	getCheckoutStatus: async () => ({
		externalTransactionId: '',
		referenceId: '',
		status: 'pending' as const,
		amountMinor: 0,
		currency: 'PHP'
	})
} as unknown as PaymentProvider;

let client: PGlite;
let db: DB;

beforeAll(async () => {
	client = new PGlite();
	const raw = drizzle(client);
	await migrate(raw, { migrationsFolder: MIGRATIONS });
	db = raw as unknown as DB;
	await db.insert(customerUser).values({ id: 'u1', name: 'Alice', email: 'u1@example.test' });
	await db.insert(packages).values({ id: 1, name: 'Tier', type: 'tier' });
}, 60_000);

beforeEach(async () => {
	await client.exec('TRUNCATE "payment_checkouts" RESTART IDENTITY CASCADE;');
});

async function seedCheckout(o: {
	id: string;
	createdAt: Date;
	lastPolledAt?: Date | null;
	status?: string;
}) {
	await db.insert(paymentCheckouts).values({
		id: o.id,
		userId: 'u1',
		packageId: 1,
		referenceId: `ref-${o.id}`,
		amount: '100',
		status: o.status ?? 'pending',
		createdAt: o.createdAt,
		lastPolledAt: o.lastPolledAt ?? null
	});
}

const MIN = 60_000;

describe('reconcilePendingPayments age window (AC4)', () => {
	it('selects only in-window rows; skips too-fresh, expires too-old', async () => {
		const now = Date.now();
		await seedCheckout({ id: 'fresh', createdAt: new Date(now - 30_000) }); // < 90s: skipped
		await seedCheckout({ id: 'inwin', createdAt: new Date(now - 5 * MIN) }); // in [maxAge,minAge]
		await seedCheckout({ id: 'old', createdAt: new Date(now - 25 * 60 * MIN) }); // > 24h: aged out

		const res = await reconcilePendingPayments(db, pendingProvider);

		// Only the in-window row is polled; provider pending → nothing credited.
		expect(res.checked).toBe(1);
		expect(res.credited).toBe(0);

		const byId = Object.fromEntries(
			(await db.select().from(paymentCheckouts)).map((r) => [r.id, r.status])
		);
		expect(byId.fresh).toBe('pending'); // untouched
		expect(byId.inwin).toBe('pending'); // polled, still pending
		expect(byId.old).toBe('expired'); // aged-out sweep flipped it
	});
});

describe('reconcileCheckout throttle (AC4)', () => {
	it('claims a checkout polled longer ago than the throttle window', async () => {
		await seedCheckout({
			id: 'stale',
			createdAt: new Date(Date.now() - MIN),
			lastPolledAt: new Date(Date.now() - 10_000)
		});
		const before = (
			await db.select().from(paymentCheckouts).where(eq(paymentCheckouts.id, 'stale'))
		)[0].lastPolledAt!;

		await reconcileCheckout(db, pendingProvider, 'ref-stale'); // default throttle 4s; 10s > 4s → claimed

		const after = (
			await db.select().from(paymentCheckouts).where(eq(paymentCheckouts.id, 'stale'))
		)[0].lastPolledAt!;
		expect(after.getTime()).toBeGreaterThan(before.getTime()); // last_polled_at advanced
	});

	it('does NOT claim a checkout polled inside the throttle window', async () => {
		const recent = new Date(Date.now() - 1_000); // 1s ago, within the 4s throttle
		await seedCheckout({ id: 'hot', createdAt: new Date(Date.now() - MIN), lastPolledAt: recent });

		await reconcileCheckout(db, pendingProvider, 'ref-hot');

		const after = (
			await db.select().from(paymentCheckouts).where(eq(paymentCheckouts.id, 'hot'))
		)[0].lastPolledAt!;
		expect(after.getTime()).toBe(recent.getTime()); // untouched — throttled
	});

	it('claims a never-polled (NULL last_polled_at) checkout', async () => {
		await seedCheckout({ id: 'nil', createdAt: new Date(Date.now() - MIN), lastPolledAt: null });

		await reconcileCheckout(db, pendingProvider, 'ref-nil');

		const after = (
			await db.select().from(paymentCheckouts).where(eq(paymentCheckouts.id, 'nil'))
		)[0].lastPolledAt;
		expect(after).not.toBeNull(); // NULL last_polled_at → claimable → stamped
	});
});
