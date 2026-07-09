/**
 * Seeds the shared database with a realistic, deterministic dataset for debugging
 * the ADMIN dashboard end-to-end. Every admin page lights up: Dashboard KPIs +
 * revenue + active sessions, Networks/Map (all health tones, some mapped), Users
 * (normal/low/blocked/online), Finance (full payment funnel over 90 days), Staff
 * (owner + admins in every lifecycle state).
 *
 *   bun run --filter radius-admin test:seed      # from the repo root
 *   bun run scripts/test-seed                     # from apps/admin
 *
 * Reads DATABASE_URL / BETTER_AUTH_SECRET / ORIGIN from apps/admin/.env (bun
 * auto-loads it).
 *
 * DESTRUCTIVE: drops and re-migrates the schema (clean rebuild) so the dataset is
 * a known-good state every run — deterministic, no faker, reproducible bugs.
 *
 * ponytail: all rows are inserted STRAIGHT to the DB via Drizzle. We deliberately
 * never call startSession()/addCredits()/network.grant() — apps/admin/.env points
 * NETWORK_CONTROLLER at a real MikroTik (10.210.0.1), and a seed must never fire real
 * firewall grants. The trade-off: we hand-maintain row consistency (balances ==
 * ledger sum) instead of leaning on the services. The self-check at the bottom
 * guards that invariant.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { eq, sql } from 'drizzle-orm';
import {
	adminAuthSchema,
	adminIssue,
	adminIssueAssignee,
	adminIssueEvent,
	adminProfile,
	creditLedger,
	customerProfile,
	customerUser,
	networkHealth,
	networkSessions,
	packages,
	paymentTransactions
} from '@veent/db';
import {
	ISSUE_PRIORITY,
	ISSUE_STATUS,
	LEDGER_TYPE,
	SESSION_STATUS,
	STAFF_ROLE,
	STAFF_STATUS
} from '@veent/core';

// ───────────────────────────── config ─────────────────────────────
const STAFF_PASSWORD = 'password123'; // shared dev password for every staff login
const CUSTOMER_COUNT = 20;
const PAYMENT_COUNT = 150;
const PAYMENT_WINDOW_DAYS = 90;

const { DATABASE_URL, BETTER_AUTH_SECRET, ORIGIN } = process.env;
if (!DATABASE_URL) throw new Error('DATABASE_URL is not set (apps/admin/.env)');
if (!BETTER_AUTH_SECRET) throw new Error('BETTER_AUTH_SECRET is not set (apps/admin/.env)');

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.resolve(here, '../../../packages/db/drizzle');

// ───────────────────────────── deterministic RNG ─────────────────────────────
// mulberry32 — tiny seeded PRNG so the dataset is identical every run. No dep.
function mulberry32(seed: number) {
	return function () {
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
const rng = mulberry32(0xc0ffee);
const rand = () => rng();
const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
/** Pick by weight: entries are [value, weight]. */
function weighted<T>(entries: readonly (readonly [T, number])[]): T {
	const total = entries.reduce((s, [, w]) => s + w, 0);
	let r = rand() * total;
	for (const [v, w] of entries) {
		if ((r -= w) < 0) return v;
	}
	return entries[entries.length - 1][0];
}

const now = new Date();
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);
const minutesAhead = (m: number) => new Date(now.getTime() + m * 60_000);
const daysAgoRandom = (maxDays: number) => minutesAgo(randInt(0, maxDays * 24 * 60));

// ───────────────────────────── fixed source data ─────────────────────────────
const FUND_SOURCES = ['card', 'gcash', 'maya-wallet', 'shopeepay', 'qrph'] as const;
const PAYMENT_STATUS = {
	success: 'PAYMENT_SUCCESS',
	failed: 'PAYMENT_FAILED',
	expired: 'PAYMENT_EXPIRED',
	cancelled: 'PAYMENT_CANCELLED'
} as const;

function macFor(i: number): string {
	const tail = i.toString(16).padStart(2, '0').toUpperCase();
	return `AA:BB:CC:00:0${Math.floor(i / 16)}:${tail.slice(-2)}`;
}

// ───────────────────────────── seed data definitions ─────────────────────────────
const SEED_PACKAGES = [
	{ name: 'Free Time', type: 'free', durationMinutes: 15, creditCost: 0, isActive: true },
	{ name: '₱20 — 50 Credits', type: 'bundle', fiatCost: 20, creditsProvided: 50, isActive: true },
	{ name: '₱50 — 150 Credits', type: 'bundle', fiatCost: 50, creditsProvided: 150, isActive: true },
	{ name: '₱100 — 350 Credits', type: 'bundle', fiatCost: 100, creditsProvided: 350, isActive: true },
	{ name: '1 Hour', type: 'tier', creditCost: 20, durationMinutes: 60, isActive: true },
	{ name: '3 Hours', type: 'tier', creditCost: 50, durationMinutes: 180, isActive: true },
	{ name: '1 Day', type: 'tier', creditCost: 150, durationMinutes: 1440, isActive: true }
] satisfies (typeof packages.$inferInsert)[];

// Manila-ish coords; some APs mapped (locator pins), some not. interfaceName binds
// a pin to a router interface so per-AP active-user counts attribute correctly.
const SEED_APS = [
	// Ground Floor + Floor 2 sit ~28 m apart (well within the 500 m default range), so their
	// domes overlap → one cluster. Naming both seeds a real multi-member named cluster, which the
	// map's cluster-assignment dropdown lists and reach-gates against.
	{ name: 'AP — Ground Floor', online: true, uptimePct: '99.80', latencyMs: 12, users: 38, throughputMbps: 84, latitude: '14.554700', longitude: '121.024500', address: 'Ground Floor, Main Bldg', interfaceName: 'ether2-ground', clusterName: 'Main Building' },
	{ name: 'AP — Floor 2', online: true, uptimePct: '99.50', latencyMs: 15, users: 27, throughputMbps: 61, latitude: '14.554900', longitude: '121.024700', address: '2nd Floor', interfaceName: 'wlan2-floor2', clusterName: 'Main Building' },
	{ name: 'AP — Cafe Patio', online: true, uptimePct: '97.10', latencyMs: 48, users: 12, throughputMbps: 22, latitude: '14.555200', longitude: '121.025100', address: 'Cafe Patio', interfaceName: 'wlan3-patio' }, // degraded (latency>=40)
	{ name: 'AP — Rooftop Deck', online: true, uptimePct: '99.90', latencyMs: 9, users: 4, throughputMbps: 95, latitude: null, longitude: null, address: null, interfaceName: 'wlan4-roof' }, // unmapped
	{ name: 'AP — Parking Lobby', online: false, uptimePct: '0.00', latencyMs: null, users: 0, throughputMbps: 0, latitude: '14.554300', longitude: '121.024200', address: 'Basement Parking', interfaceName: 'ether5-parking' }, // offline
	{ name: 'AP — Annex Hall', online: true, uptimePct: '98.40', latencyMs: 22, users: 9, throughputMbps: 47, latitude: '14.555500', longitude: '121.025400', address: 'Annex Hall', interfaceName: 'wlan6-annex' }
] satisfies (typeof networkHealth.$inferInsert)[];

const STAFF = [
	{ name: 'Olivia Owner', email: 'owner@veent.test', role: STAFF_ROLE.owner, status: STAFF_STATUS.active },
	{ name: 'Adrian Admin', email: 'adrian@veent.test', role: STAFF_ROLE.admin, status: STAFF_STATUS.active },
	{ name: 'Bea Admin', email: 'bea@veent.test', role: STAFF_ROLE.admin, status: STAFF_STATUS.active },
	{ name: 'Cleo Admin', email: 'cleo@veent.test', role: STAFF_ROLE.admin, status: STAFF_STATUS.active },
	{ name: 'Pia Pending', email: 'pia@veent.test', role: STAFF_ROLE.admin, status: STAFF_STATUS.pending },
	{ name: 'Dane Disabled', email: 'dane@veent.test', role: STAFF_ROLE.admin, status: STAFF_STATUS.disabled }
] as const;

// ───────────────────────────── main ─────────────────────────────
async function main() {
	// Phase 1 — clean rebuild. Drop both the app schema and drizzle's journal so
	// migrate() reapplies all 10 from zero into a known-good schema.
	console.log('▸ Clean rebuild: dropping schema…');
	const admin = postgres(DATABASE_URL!, { max: 1 });
	await admin.unsafe(
		'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;'
	);
	await admin.end();

	const client = postgres(DATABASE_URL!);
	const db = drizzle(client);

	console.log('▸ Applying migrations…');
	await migrate(db, { migrationsFolder });

	// Phase 2 — catalog. admin_role is seeded by migration 0005; packages/APs here.
	console.log('▸ Seeding packages + APs…');
	const pkgRows = await db.insert(packages).values(SEED_PACKAGES).returning();
	const bundles = pkgRows.filter((p) => p.type === 'bundle');
	const tiers = pkgRows.filter((p) => p.type === 'tier');
	const apRows = await db.insert(networkHealth).values(SEED_APS).returning();
	const onlineAps = apRows.filter((a) => a.online);

	// Phase 3 — staff via better-auth (real password hashes → login works).
	console.log('▸ Creating staff (better-auth)…');
	const auth = betterAuth({
		baseURL: ORIGIN,
		secret: BETTER_AUTH_SECRET,
		database: drizzleAdapter(db, { provider: 'pg', schema: adminAuthSchema }),
		emailAndPassword: { enabled: true },
		advanced: { cookiePrefix: 'radius-admin' }
	});
	const staffIds = new Map<string, string>(); // email → admin_user.id (for issue seeding)
	for (const s of STAFF) {
		// signUpEmail creates the auth user + credential account (hashed password).
		// ponytail: pending/disabled members get a password too — unrealistic, but the
		// sign-in guard gates on admin_profile.status, not on credentials, so this lets
		// you test the "not activated"/"disabled" login-rejection paths with a known pw.
		const res = await auth.api.signUpEmail({
			body: { name: s.name, email: s.email, password: STAFF_PASSWORD }
		});
		staffIds.set(s.email, res.user.id);
		await db
			.insert(adminProfile)
			.values({
				userId: res.user.id,
				role: s.role,
				status: s.status,
				lastActiveAt: s.status === STAFF_STATUS.active ? minutesAgo(randInt(1, 600)) : null
			})
			.onConflictDoUpdate({
				target: adminProfile.userId,
				set: { role: s.role, status: s.status }
			});
	}

	// Phase 3b — incidents (admin_issue). A small, representative mix: an unresolved high-priority
	// AP outage, an in-progress speed complaint with two assignees, a resolved one with a note, and
	// an unassigned general incident. All human-sourced; Sentry-sourced ones arrive via the app (Phase 4).
	console.log('▸ Seeding incidents…');
	const ownerId = staffIds.get('owner@veent.test')!;
	const adrianId = staffIds.get('adrian@veent.test')!;
	const beaId = staffIds.get('bea@veent.test')!;
	const cleoId = staffIds.get('cleo@veent.test')!;
	const ap0 = apRows[0];
	const ap1 = apRows[1];
	const daysFromNow = (n: number) => new Date(Date.now() + n * 86_400_000);

	const SEED_INCIDENTS: {
		row: typeof adminIssue.$inferInsert;
		assignees: string[];
	}[] = [
		{
			row: {
				title: `${ap0.name} access point offline`,
				description: 'No uplink since this morning; guests in the area cannot connect. Needs an on-site check.',
				status: ISSUE_STATUS.open,
				priority: ISSUE_PRIORITY.high,
				networkId: ap0.id,
				networkName: ap0.name,
				dueDate: daysFromNow(1),
				createdBy: ownerId
			},
			assignees: [adrianId]
		},
		{
			row: {
				title: 'Slow speeds reported near the lobby',
				description: 'Multiple guests report < 2 Mbps during peak hours. Investigate channel congestion vs backhaul.',
				status: ISSUE_STATUS.inProgress,
				priority: ISSUE_PRIORITY.medium,
				networkId: ap1.id,
				networkName: ap1.name,
				dueDate: daysFromNow(4),
				createdBy: ownerId
			},
			assignees: [beaId, cleoId]
		},
		{
			row: {
				title: 'Captive portal not loading on some Android devices',
				description: 'Redirect intermittently failed; traced to a stale DNS cache on the gateway.',
				status: ISSUE_STATUS.resolved,
				priority: ISSUE_PRIORITY.low,
				networkName: ap0.name,
				networkId: ap0.id,
				resolutionNote: 'Flushed gateway DNS and pinned the portal host. Verified on 3 devices.',
				resolvedBy: adrianId,
				resolvedAt: new Date(),
				createdBy: ownerId
			},
			assignees: [adrianId]
		},
		{
			row: {
				title: 'Draft monthly network health summary',
				description: 'General ops task — no specific access point.',
				status: ISSUE_STATUS.open,
				priority: ISSUE_PRIORITY.high,
				createdBy: ownerId
			},
			assignees: []
		}
	];

	for (const { row, assignees } of SEED_INCIDENTS) {
		const [inserted] = await db.insert(adminIssue).values(row).returning({ id: adminIssue.id });
		// Mirror the app's createIssue timeline so seeded incidents aren't blank in the history/feed:
		// a `created` event, then one `assigned` per assignee. ponytail: literal event types (match the
		// admin_issue_event CHECK) — importing ISSUE_EVENT from app $lib into this script isn't worth it.
		await db.insert(adminIssueEvent).values({ issueId: inserted.id, actorId: ownerId, type: 'created' });
		if (assignees.length > 0) {
			await db.insert(adminIssueAssignee).values(
				assignees.map((adminUserId) => ({ issueId: inserted.id, adminUserId, assignedBy: ownerId }))
			);
			await db.insert(adminIssueEvent).values(
				assignees.map((adminUserId) => ({
					issueId: inserted.id,
					actorId: ownerId,
					type: 'assigned',
					toValue: adminUserId
				}))
			);
		}
	}

	// Phase 4 — customers. Direct inserts; assigned a cohort that fixes their state.
	console.log(`▸ Creating ${CUSTOMER_COUNT} customers…`);
	type Cohort = 'normal' | 'low' | 'blocked';
	interface Cust {
		id: string;
		phone: string;
		cohort: Cohort;
		online: boolean;
		mac: string;
	}
	const customers: Cust[] = [];
	for (let i = 0; i < CUSTOMER_COUNT; i++) {
		const id = crypto.randomUUID();
		// Customers register by phone only (no name/email). Mirror the customer app's
		// better-auth signUpOnVerification: name = phone, email = synthesized OTP alias.
		const phone = `+6391${String(i).padStart(8, '0')}`;
		// First 3 blocked, next 4 low-balance, rest normal. ~40% of non-blocked online.
		const cohort: Cohort = i < 3 ? 'blocked' : i < 7 ? 'low' : 'normal';
		const online = cohort !== 'blocked' && rand() < 0.45;
		const mac = macFor(i);

		await db.insert(customerUser).values({
			id,
			name: phone,
			email: `${phone}@otp.veent.local`,
			emailVerified: false,
			phoneNumber: phone,
			phoneNumberVerified: true,
			createdAt: daysAgoRandom(PAYMENT_WINDOW_DAYS),
			updatedAt: now
		});
		await db.insert(customerProfile).values({
			userId: id,
			role: 'user',
			creditBalance: '0', // reconciled from the ledger at the end
			blocked: cohort === 'blocked',
			// Vary free-time cooldown: some recently used (in cooldown), some eligible.
			lastFreeSessionAt: rand() < 0.5 ? minutesAgo(randInt(5, 60 * 24)) : null
		});
		customers.push({ id, phone, cohort, online, mac });
	}

	// Phase 5a — payments + matching topup ledger. The ledger drives the Dashboard's
	// gross-revenue KPI (sum of packages.fiatCost over topups) and the customer
	// balances; payment_transactions drives the Finance page (settled revenue funnel).
	console.log(`▸ Recording ${PAYMENT_COUNT} payments over ${PAYMENT_WINDOW_DAYS}d…`);
	const ledgerByUser = new Map<string, number>(); // userId → net credits
	let successCount = 0;
	for (let i = 0; i < PAYMENT_COUNT; i++) {
		const status = weighted([
			[PAYMENT_STATUS.success, 70],
			[PAYMENT_STATUS.failed, 15],
			[PAYMENT_STATUS.expired, 10],
			[PAYMENT_STATUS.cancelled, 5]
		] as const);
		const bundle = pick(bundles);
		// 12% of payments are unattributed (failed webhook with no referenceId) — the
		// Finance table must handle null user/package gracefully.
		const cust = status !== PAYMENT_STATUS.success && rand() < 0.4 ? null : pick(customers);
		const fund = pick(FUND_SOURCES);
		const success = status === PAYMENT_STATUS.success;
		// Skew a third of payments into the last 7 days so the Dashboard's 7-day
		// revenue chart and the Finance "7d" view both have data.
		const createdAt = rand() < 0.33 ? minutesAgo(randInt(0, 7 * 24 * 60)) : daysAgoRandom(PAYMENT_WINDOW_DAYS);
		const txId = `tx_${i.toString().padStart(5, '0')}_${Math.floor(rand() * 1e6).toString(36)}`;

		await db.insert(paymentTransactions).values({
			id: txId,
			status,
			amount: String(bundle.fiatCost ?? 0),
			currency: 'PHP',
			fundSourceType: fund,
			fundSourceMasked: fund === 'card' ? `**** ${randInt(1000, 9999)}` : null,
			receiptNo: success ? `RCPT-${randInt(100000, 999999)}` : null,
			// One checkout = one reference (the R18 partial unique index on reference_no enforces
			// it) — so the reference must be unique per PAYMENT, not per customer, or a repeat
			// buyer collides on payment_transactions_reference_no_key and the seed aborts.
			referenceNo: cust ? `ref_${i.toString().padStart(5, '0')}_${cust.id.slice(0, 8)}` : null,
			errorCode: success ? null : status === PAYMENT_STATUS.failed ? 'PAYMENT_DECLINED' : null,
			errorMessage: status === PAYMENT_STATUS.failed ? 'Card was declined by issuer.' : null,
			// Buyer is the customer's phone — accounts are phone-only (matches the Users table's
			// User column). Unattributed events (no referenceId) have no buyer.
			buyerName: cust?.phone ?? 'Guest Checkout',
			buyerEmail: null,
			userId: cust?.id ?? null,
			packageId: bundle.id,
			createdAt
		});

		if (success && cust) {
			successCount++;
			const credits = bundle.creditsProvided ?? 0;
			await db.insert(creditLedger).values({
				userId: cust.id,
				packageId: bundle.id,
				amount: credits,
				type: LEDGER_TYPE.topup,
				externalTransactionId: txId, // idempotency key (unique)
				createdAt
			});
			ledgerByUser.set(cust.id, (ledgerByUser.get(cust.id) ?? 0) + credits);
		}
	}

	// Phase 5b — some spend rows (tier purchases) so balances move both ways and the
	// ledger has 'spend' entries. Keep spends below the user's topups.
	for (const c of customers) {
		const topups = ledgerByUser.get(c.id) ?? 0;
		if (topups <= 0) continue;
		const spends = randInt(0, 2);
		for (let s = 0; s < spends; s++) {
			const tier = pick(tiers);
			const cost = tier.creditCost ?? 0;
			if (cost <= 0 || (ledgerByUser.get(c.id) ?? 0) < cost) continue;
			await db.insert(creditLedger).values({
				userId: c.id,
				packageId: tier.id,
				amount: -cost,
				type: LEDGER_TYPE.spend,
				createdAt: daysAgoRandom(30)
			});
			ledgerByUser.set(c.id, (ledgerByUser.get(c.id) ?? 0) - cost);
		}
	}

	// Phase 5c — reconcile balances to the ledger sum. Force the 'low' cohort under
	// ₱10 (a few promo credits) so the Users page shows the "Low Balance" tone.
	console.log('▸ Reconciling balances…');
	for (const c of customers) {
		let balance = ledgerByUser.get(c.id) ?? 0;
		if (c.cohort === 'low') {
			// Force a deliberately small balance (<₱10) for the "Low Balance" tone. Insert
			// a balancing row = target − current so the ledger still sums to the stored
			// balance: a positive delta is a promo grant, a negative delta a spend.
			const target = randInt(0, 9);
			const delta = target - balance;
			if (delta !== 0) {
				await db.insert(creditLedger).values({
					userId: c.id,
					amount: delta,
					type: delta >= 0 ? LEDGER_TYPE.promo : LEDGER_TYPE.spend,
					createdAt: daysAgoRandom(20)
				});
			}
			balance = target;
			ledgerByUser.set(c.id, balance);
		}
		await db
			.update(customerProfile)
			.set({ creditBalance: String(balance) })
			.where(eq(customerProfile.userId, c.id));
	}

	// Phase 5d — network sessions. Active (online users) + historical (expired) +
	// free-time. Active sessions attribute to a networkId for per-AP counts; some
	// expire in <3min to show the "Low Time" tone on the Dashboard.
	console.log('▸ Logging network sessions…');
	let activeCount = 0;
	let freeCount = 0;
	for (const c of customers) {
		// Historical: 1–4 past sessions per customer (expired) for avg-session + lastMac.
		const past = randInt(1, 4);
		for (let p = 0; p < past; p++) {
			const tier = pick(tiers);
			const dur = tier.durationMinutes ?? 60;
			const startedAt = daysAgoRandom(30);
			await db.insert(networkSessions).values({
				userId: c.id,
				macAddress: c.mac,
				packageId: tier.id,
				networkId: pick(apRows).id,
				status: SESSION_STATUS.expired,
				startedAt,
				expiresAt: new Date(startedAt.getTime() + dur * 60_000)
			});
		}

		// A handful of free-time sessions (packageId null) → Free-Time Grants KPI.
		if (rand() < 0.35) {
			freeCount++;
			const startedAt = daysAgoRandom(7);
			await db.insert(networkSessions).values({
				userId: c.id,
				macAddress: c.mac,
				packageId: null,
				networkId: pick(onlineAps).id,
				status: SESSION_STATUS.expired,
				startedAt,
				expiresAt: new Date(startedAt.getTime() + 15 * 60_000)
			});
		}

		// Active session for online customers (unexpired). 25% are "Low Time" (<3min).
		if (c.online) {
			activeCount++;
			const lowTime = rand() < 0.25;
			const isFree = rand() < 0.2;
			const tier = pick(tiers);
			await db.insert(networkSessions).values({
				userId: c.id,
				macAddress: c.mac,
				packageId: isFree ? null : tier.id,
				networkId: pick(onlineAps).id,
				status: SESSION_STATUS.active,
				startedAt: minutesAgo(randInt(1, 50)),
				expiresAt: lowTime ? minutesAhead(randInt(1, 2)) : minutesAhead(randInt(10, 180))
			});
			if (isFree) freeCount++;
		}
	}

	// ───────────────────────────── self-check ─────────────────────────────
	// Invariant: every customer's stored balance == the sum of their ledger rows.
	// If this fails, the hand-maintained reconciliation (Phase 5c) drifted.
	const drift = await db.execute(sql`
		SELECT cp.user_id
		FROM customer_profile cp
		LEFT JOIN (
			SELECT user_id, COALESCE(SUM(amount), 0) AS s FROM credit_ledger GROUP BY user_id
		) l ON l.user_id = cp.user_id
		WHERE cp.credit_balance <> COALESCE(l.s, 0)
	`);
	const driftRows = drift as unknown as unknown[];
	if (driftRows.length > 0) {
		throw new Error(`Self-check FAILED: ${driftRows.length} customer balance(s) don't match their ledger.`);
	}

	// ───────────────────────────── report ─────────────────────────────
	console.log('\n✓ Seed complete. Self-check passed (balances == ledger).\n');
	console.log(`  Staff:        ${STAFF.length} (1 owner, ${STAFF.length - 1} admins)`);
	console.log(`  Customers:    ${CUSTOMER_COUNT} (3 blocked, 4 low-balance, ${activeCount} online)`);
	console.log(`  APs:          ${apRows.length} (${onlineAps.length} online, 1 degraded, 1 offline, 1 unmapped)`);
	console.log(`  Payments:     ${PAYMENT_COUNT} (${successCount} settled) over ${PAYMENT_WINDOW_DAYS}d`);
	console.log(`  Sessions:     ${activeCount} active, ${freeCount} free-time grants, + history`);
	console.log('\n  Login (any staff): password = ' + STAFF_PASSWORD);
	console.log('    owner@veent.test    → owner, active   (full access incl. Staff + wipe)');
	console.log('    adrian@veent.test   → admin, active   (no Staff page)');
	console.log('    pia@veent.test      → admin, pending  (login should be REJECTED)');
	console.log('    dane@veent.test     → admin, disabled (login should be REJECTED)');
	console.log('\n  Where to look:');
	console.log('    /dashboard → KPIs, 7-day revenue chart, live Active Sessions, AP health');
	console.log('    /networks  → all health tones; /map → mapped pins (Rooftop is unmapped)');
	console.log('    /users     → blocked/low/online rows; block/kick/Allow-WiFi actions');
	console.log('    /finance   → toggle 7d/30d/90d; success/failed/expired mix; CSV export');
	console.log('    /staff     → owner-only; active/pending/disabled badges\n');

	await client.end();
	process.exit(0);
}

main().catch((err) => {
	console.error('\n✗ Seed failed:', err);
	process.exit(1);
});
