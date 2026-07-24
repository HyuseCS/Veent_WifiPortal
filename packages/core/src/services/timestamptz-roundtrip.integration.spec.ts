import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';

/**
 * AC1 — round-trip instant correctness for the finance/session timestamptz migration (0052).
 *
 * Two-phase, per the plan: (1) apply the real migration chain UP TO BUT EXCLUDING 0052 so the
 * columns are still bare `timestamp without time zone`; (2) seed pre-migration-convention values
 * via RAW SQL (a bare wall-clock literal — exactly what the pre-migration write paths stored);
 * (3) apply the 0052 DDL verbatim via `client.exec()`; (4) read the columns back (now timestamptz)
 * and assert the corrected REAL instant, per Locked Decision 3's per-column USING map:
 *   - Manila-wall  → USING col AT TIME ZONE 'Asia/Manila'  (14:00 Manila → 06:00Z)
 *   - UTC-wall     → USING col AT TIME ZONE 'UTC'          (14:00 UTC    → 14:00Z)
 * Includes the NULL-column case (settled_at / last_polled_at / access_paused_at) — a NULL cast
 * through AT TIME ZONE must stay NULL, not error or coerce to an epoch default.
 *
 * Also folds in AC6: date_trunc('day', ...) bucketing of the already-correct Manila-wall revenue
 * columns is unchanged across the migration (byte-identical day bucket).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REAL_MIGRATIONS = path.resolve(HERE, '../../../db/drizzle');
const MIGRATION_0052 = path.join(REAL_MIGRATIONS, '0052_pink_maginty.sql');

/** A wall-clock string both conventions share (interpreted differently per column). */
const WALL = '2026-07-21 14:00:00';
const MANILA_INSTANT = '2026-07-21T06:00:00.000Z'; // 14:00 Manila = 06:00 UTC
const UTC_INSTANT = '2026-07-21T14:00:00.000Z'; // 14:00 UTC

/** AC6 fixture: a Manila-wall value near Manila midnight (= 2026-07-20 16:30Z), so the day bucket
 * only comes out right when truncation happens in the Manila session TZ. Isolated by its amount. */
const BUCKET_WALL = '2026-07-21 00:30:00';
const BUCKET_AMOUNT = 555;

let client: PGlite;

/** Build a temp migrations dir whose journal stops BEFORE 0052 (so migrate() applies 0000–0051). */
function migrationsExcluding0052(): string {
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tstz-chain-'));
	fs.cpSync(REAL_MIGRATIONS, tmp, { recursive: true });
	const journalPath = path.join(tmp, 'meta', '_journal.json');
	const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
	journal.entries = journal.entries.filter((e: { tag: string }) => !e.tag.startsWith('0052_'));
	fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2));
	return tmp;
}

beforeAll(async () => {
	client = new PGlite();
	const raw = drizzle(client);
	await migrate(raw, { migrationsFolder: migrationsExcluding0052() });

	// Confirm the pre-condition: columns are still bare timestamp before we seed/migrate.
	const pre = await client.query<{ data_type: string }>(
		`SELECT data_type FROM information_schema.columns WHERE table_name='credit_ledger' AND column_name='created_at'`
	);
	expect(pre.rows[0].data_type).toBe('timestamp without time zone');

	// FK parents.
	await client.exec(
		`INSERT INTO customer_user (id, name, email) VALUES ('u1', 'Alice', 'u1@example.test');`
	);
	await client.exec(`INSERT INTO packages (id, name, type) VALUES (1, 'Tier', 'tier');`);

	// Seed pre-migration bare wall-clock values (RAW SQL — bypasses the now-timestamptz drizzle schema).
	// Manila-wall money columns:
	await client.exec(
		`INSERT INTO credit_ledger (user_id, amount, type, created_at) VALUES ('u1', 100, 'topup', '${WALL}');`
	);
	await client.exec(
		`INSERT INTO points_ledger (user_id, amount, type, created_at) VALUES ('u1', 10, 'earn', '${WALL}');`
	);
	await client.exec(
		`INSERT INTO payment_transactions (id, status, amount, created_at) VALUES ('pt1', 'PAYMENT_SUCCESS', 100, '${WALL}');`
	);
	// payment_checkouts: created_at Manila-wall; settled_at/last_polled_at UTC-wall + a NULL row.
	await client.exec(
		`INSERT INTO payment_checkouts (id, user_id, package_id, reference_id, amount, created_at, settled_at, last_polled_at) VALUES ('co1', 'u1', 1, 'ref1', 100, '${WALL}', '${WALL}', '${WALL}');`
	);
	await client.exec(
		`INSERT INTO payment_checkouts (id, user_id, package_id, reference_id, amount, created_at, settled_at, last_polled_at) VALUES ('co2', 'u1', 1, 'ref2', 100, '${WALL}', NULL, NULL);`
	);
	// network_sessions: all four UTC-wall (expires_at nullable).
	await client.exec(
		`INSERT INTO network_sessions (user_id, status, started_at, bound_at, last_seen_at, expires_at) VALUES ('u1', 'active', '${WALL}', '${WALL}', '${WALL}', '${WALL}');`
	);
	// customer_profile: three UTC-wall, access_paused_at NULL to exercise the NULL cast.
	await client.exec(
		`INSERT INTO customer_profile (user_id, last_free_session_at, access_expires_at, access_paused_at) VALUES ('u1', '${WALL}', '${WALL}', NULL);`
	);

	// AC6 fixture: a Manila-wall value just after Manila midnight. Mid-day values bucket the same
	// under any session TZ, so they can't tell a correct migration from a broken one — 00:30 Manila
	// is 16:30Z the PREVIOUS day, so it only lands in the intended day bucket if the instant is
	// truncated in Manila (which is what prod's session TimeZone supplies).
	await client.exec(
		`INSERT INTO credit_ledger (user_id, amount, type, created_at) VALUES ('u1', ${BUCKET_AMOUNT}, 'topup', '${BUCKET_WALL}');`
	);
	// AC6 pre-migration revenue-bucket snapshot (Manila-wall column, already correct pre-migration).
	const bucketPre = await client.query<{ d: string }>(
		`SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS d FROM credit_ledger WHERE user_id='u1' AND amount=${BUCKET_AMOUNT}`
	);
	(globalThis as Record<string, unknown>).__bucketPre = bucketPre.rows[0].d;

	// Phase 2: apply the 0052 DDL verbatim.
	await client.exec(fs.readFileSync(MIGRATION_0052, 'utf8'));

	// Confirm the migration landed.
	const post = await client.query<{ data_type: string }>(
		`SELECT data_type FROM information_schema.columns WHERE table_name='credit_ledger' AND column_name='created_at'`
	);
	expect(post.rows[0].data_type).toBe('timestamp with time zone');
}, 60_000);

async function instant(table: string, col: string, where = '1=1'): Promise<string | null> {
	const r = await client.query<{ v: Date | null }>(
		`SELECT ${col} AS v FROM ${table} WHERE ${where} LIMIT 1`
	);
	const v = r.rows[0].v;
	return v == null ? null : new Date(v).toISOString();
}

describe('timestamptz migration round-trip (AC1)', () => {
	it('Manila-wall columns cast to the correct instant (14:00 Manila → 06:00Z)', async () => {
		expect(await instant('credit_ledger', 'created_at')).toBe(MANILA_INSTANT);
		expect(await instant('points_ledger', 'created_at')).toBe(MANILA_INSTANT);
		expect(await instant('payment_transactions', 'created_at')).toBe(MANILA_INSTANT);
		expect(await instant('payment_checkouts', 'created_at', "id='co1'")).toBe(MANILA_INSTANT);
	});

	it('UTC-wall columns cast to the correct instant (14:00 UTC → 14:00Z)', async () => {
		expect(await instant('payment_checkouts', 'settled_at', "id='co1'")).toBe(UTC_INSTANT);
		expect(await instant('payment_checkouts', 'last_polled_at', "id='co1'")).toBe(UTC_INSTANT);
		expect(await instant('network_sessions', 'started_at')).toBe(UTC_INSTANT);
		expect(await instant('network_sessions', 'bound_at')).toBe(UTC_INSTANT);
		expect(await instant('network_sessions', 'last_seen_at')).toBe(UTC_INSTANT);
		expect(await instant('network_sessions', 'expires_at')).toBe(UTC_INSTANT);
		expect(await instant('customer_profile', 'last_free_session_at')).toBe(UTC_INSTANT);
		expect(await instant('customer_profile', 'access_expires_at')).toBe(UTC_INSTANT);
	});

	it('NULL columns cast through AT TIME ZONE stay NULL (no error, no epoch default)', async () => {
		expect(await instant('payment_checkouts', 'settled_at', "id='co2'")).toBeNull();
		expect(await instant('payment_checkouts', 'last_polled_at', "id='co2'")).toBeNull();
		expect(await instant('customer_profile', 'access_paused_at')).toBeNull();
	});
});

describe('KPI/revenue bucket unchanged (AC6)', () => {
	it('date_trunc(day) of the Manila-wall revenue column is byte-identical across the migration', async () => {
		// Exercise the PRODUCTION expression verbatim: apps/admin/src/lib/server/queries.ts truncates
		// with a bare `date_trunc('day', created_at)` and relies on the session TimeZone (prod + dev
		// DBs are both `Asia/Manila`, confirmed by the AC7 preflight). Casting `AT TIME ZONE
		// 'Asia/Manila'` inside the test would prove a query prod never runs.
		await client.exec(`SET TIME ZONE 'Asia/Manila';`);
		try {
			const post = await client.query<{ d: string }>(
				`SELECT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS d FROM credit_ledger WHERE user_id='u1' AND amount=${BUCKET_AMOUNT}`
			);
			expect(post.rows[0].d).toBe((globalThis as Record<string, unknown>).__bucketPre);
			expect(post.rows[0].d).toBe('2026-07-21'); // the Manila calendar day the value always meant
		} finally {
			await client.exec(`SET TIME ZONE 'UTC';`);
		}
	});
});
