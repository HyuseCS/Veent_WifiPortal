/**
 * Real-DB concurrency probe for the "many users connecting & buying time at once" edge case.
 *
 * Unlike the unit specs (which mock the db/tx), this hits the RUNNING Postgres so the actual
 * row locks, conditional UPDATEs, and READ COMMITTED isolation are exercised. It seeds its own
 * throwaway rows (all ids prefixed `cctest_`), runs three concurrent scenarios, asserts the
 * invariants, then deletes everything it created.
 *
 * Run:  bun run packages/core/scripts/concurrency-test.ts
 * Needs DATABASE_URL (falls back to the shared local compose DB).
 */
import { createDb } from '@veent/db';
import { customerUser, customerProfile, packages, networkSessions, creditLedger } from '@veent/db/schema';
import { startPaidAccessAndBindDevice, startFreeAccessAndBindDevice } from '@veent/core';
import { createStubNetworkController } from '@veent/core/integrations';
import { eq, like } from 'drizzle-orm';

const DATABASE_URL =
	process.env.DATABASE_URL ?? 'postgres://root:mysecretpassword@localhost:5432/local';

// Bigger pool than prod default (10) so the test driver isn't the bottleneck we're measuring.
const db = createDb(DATABASE_URL, { max: 30 });
const network = createStubNetworkController(() => {}); // silent no-op router

const PREFIX = 'cctest_';
let failures = 0;
function check(name: string, cond: boolean, detail = '') {
	const ok = cond;
	if (!ok) failures++;
	console.log(`${ok ? '✅ PASS' : '❌ FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function mac(i: number) {
	const h = i.toString(16).padStart(2, '0').toUpperCase();
	return `AA:BB:CC:DD:EE:${h}`;
}

async function seedUser(id: string, balance: number) {
	await db.insert(customerUser).values({
		id,
		name: id,
		email: `${id}@cctest.local`,
		emailVerified: true
	});
	await db.insert(customerProfile).values({
		userId: id,
		creditBalance: String(balance)
	});
}

async function balanceOf(userId: string): Promise<number> {
	const [r] = await db
		.select({ b: customerProfile.creditBalance })
		.from(customerProfile)
		.where(eq(customerProfile.userId, userId))
		.limit(1);
	return Number(r?.b ?? NaN);
}

async function cleanup() {
	// Children first (FKs). networkSessions/creditLedger reference users; packages referenced by them.
	await db.delete(networkSessions).where(like(networkSessions.userId, `${PREFIX}%`));
	await db.delete(creditLedger).where(like(creditLedger.userId, `${PREFIX}%`));
	await db.delete(customerProfile).where(like(customerProfile.userId, `${PREFIX}%`));
	await db.delete(customerUser).where(like(customerUser.id, `${PREFIX}%`));
	await db.delete(packages).where(like(packages.name, `${PREFIX}%`));
}

async function main() {
	console.log(`\n🔌 Concurrency probe against ${DATABASE_URL}\n`);
	await cleanup(); // in case a prior run died mid-way

	// One paid tier: costs 20 credits, grants 180 min.
	const COST = 20;
	const [pkg] = await db
		.insert(packages)
		.values({
			name: `${PREFIX}tier`,
			type: 'tier',
			creditCost: COST,
			durationMinutes: 180,
			isActive: true
		})
		.returning({ id: packages.id });

	const buy = (userId: string, i: number) =>
		startPaidAccessAndBindDevice(db, network, {
			userId,
			macAddress: mac(i),
			packageId: pkg.id,
			amount: COST,
			durationMinutes: 180
		});

	// ── Scenario A: ONE user, 10 simultaneous buys, balance only covers 5 ──────────────
	// Invariant: no overspend. Exactly floor(100/20)=5 succeed, balance lands on 0, never < 0.
	{
		const uid = `${PREFIX}solo`;
		await seedUser(uid, 100);
		const N = 10;
		const results = await Promise.allSettled(
			Array.from({ length: N }, (_, i) => buy(uid, i))
		);
		const ok = results.filter((r) => r.status === 'fulfilled' && r.value.ok).length;
		const rejected = results.filter((r) => r.status === 'rejected').length;
		const bal = await balanceOf(uid);
		console.log(`\n── A: same user × ${N} concurrent buys (balance 100, cost ${COST}) ──`);
		console.log(`   succeeded=${ok}  insufficient/declined=${N - ok - rejected}  threw=${rejected}  finalBalance=${bal}`);
		check('A: exactly 5 buys succeed (no overspend)', ok === 5, `got ${ok}`);
		check('A: final balance is exactly 0', bal === 0, `got ${bal}`);
		check('A: balance never went negative', bal >= 0, `got ${bal}`);
		check('A: no transaction threw/deadlocked', rejected === 0, `${rejected} threw`);
	}

	// ── Scenario B: 50 DISTINCT users buy at the same instant ──────────────────────────
	// Invariant: every one succeeds and lands on 0 — throughput/pool/lock-contention sanity.
	{
		const N = 50;
		const ids = Array.from({ length: N }, (_, i) => `${PREFIX}u${i}`);
		await Promise.all(ids.map((id) => seedUser(id, COST))); // exactly one buy's worth each
		const t0 = performance.now();
		const results = await Promise.allSettled(ids.map((id, i) => buy(id, i)));
		const ms = Math.round(performance.now() - t0);
		const ok = results.filter((r) => r.status === 'fulfilled' && r.value.ok).length;
		const rejected = results.filter((r) => r.status === 'rejected').length;
		const balances = await Promise.all(ids.map(balanceOf));
		const allZero = balances.every((b) => b === 0);
		console.log(`\n── B: ${N} distinct users × 1 concurrent buy each ──`);
		console.log(`   succeeded=${ok}/${N}  threw=${rejected}  allBalancesZero=${allZero}  wall=${ms}ms`);
		check('B: all 50 buys succeed', ok === N, `got ${ok}`);
		check('B: every balance lands on 0', allZero);
		check('B: nothing threw/deadlocked', rejected === 0, `${rejected} threw`);
	}

	// ── Scenario C: ONE user, 5 simultaneous FREE-TIME claims ───────────────────────────
	// Free claim is unconditional UPDATE under READ COMMITTED (no FOR UPDATE / no WHERE guard),
	// so this probes whether concurrent claims can ALL pass the eligibility read. A correct
	// cooldown allows exactly 1; >1 means the cooldown is bypassable by racing the requests.
	{
		const uid = `${PREFIX}free`;
		await seedUser(uid, 0);
		const N = 5;
		const results = await Promise.allSettled(
			Array.from({ length: N }, (_, i) => startFreeAccessAndBindDevice(db, network, { userId: uid, macAddress: mac(100 + i) }))
		);
		const eligible = results.filter((r) => r.status === 'fulfilled' && r.value.ok).length;
		console.log(`\n── C: same user × ${N} concurrent free-time claims (12h cooldown) ──`);
		console.log(`   claimsGranted=${eligible}  (expected 1 if cooldown is race-safe)`);
		check(
			'C: at most ONE free claim granted under race',
			eligible === 1,
			eligible > 1
				? `${eligible} granted — cooldown is bypassable by concurrent requests (READ COMMITTED race)`
				: `got ${eligible}`
		);
	}

	await cleanup();
	console.log(`\n${failures === 0 ? '🎉 all invariants held' : `⚠️  ${failures} check(s) failed`}\n`);
	process.exit(failures === 0 ? 0 : 1);
}

main().catch(async (e) => {
	console.error('probe crashed:', e);
	try {
		await cleanup();
	} catch (cleanupErr) {
		console.error('cleanup after crash failed:', cleanupErr);
	}
	process.exit(2);
});
