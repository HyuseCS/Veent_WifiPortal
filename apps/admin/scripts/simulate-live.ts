/**
 * Live activity simulator for the admin dashboard. Runs FOREVER (Ctrl+C to stop),
 * performing random customer/network actions at random intervals — people signing
 * up, arriving and leaving, buying credits, payments failing, AP health flapping —
 * so you can watch the live SSE dashboard (/dashboard, /networks) update in real time.
 *
 *   bun run --filter radius-admin test:simulate           # populate on top of whatever's there
 *   bun run --filter radius-admin test:simulate:fresh     # wipe data first, then build from scratch
 *   SIM_MIN_MS=300 SIM_MAX_MS=1500 bun run ... test:simulate   # go faster
 *
 * SELF-BOOTSTRAPPING: needs only a migrated schema. If the catalog (packages / APs)
 * or the owner login is missing it creates them, so it works on a clean/empty DB
 * with NO seed run first. Customers are NOT pre-created — the simulator signs them
 * up over time, so you literally watch the user base, revenue, and sessions grow
 * from zero. (Run after `test:seed` too: the bootstrap is idempotent and it just
 * adds activity on top.)
 *
 * How the live update works: Postgres triggers (migration 0006) fire
 * pg_notify('dashboard') on every write to network_sessions / credit_ledger /
 * network_health. The admin app LISTENs and re-pushes a snapshot over SSE. This
 * script just writes to those tables; the dashboard reacts on its own.
 *
 * ponytail: pure-DB writes via Drizzle — never calls the network controller, so it
 * can't fire a real router grant (apps/admin/.env may point at a live MikroTik).
 * Uses Math.random (real wall-clock randomness) on purpose — this is a live sim.
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, count, desc, eq, gt, isNotNull, sql } from 'drizzle-orm';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import {
	adminAuthSchema,
	adminProfile,
	adminUser,
	creditLedger,
	customerProfile,
	customerUser,
	networkHealth,
	networkSessions,
	packages,
	paymentTransactions
} from '@veent/db';
import { LEDGER_TYPE, SESSION_STATUS, STAFF_ROLE, STAFF_STATUS } from '@veent/core';

const { DATABASE_URL, BETTER_AUTH_SECRET, ORIGIN } = process.env;
if (!DATABASE_URL) throw new Error('DATABASE_URL is not set (apps/admin/.env)');

const MIN_MS = Number(process.env.SIM_MIN_MS ?? 800);
const MAX_MS = Number(process.env.SIM_MAX_MS ?? 4000);
const FRESH = process.argv.includes('--fresh') || process.env.FRESH === '1';
const OWNER_EMAIL = 'owner@veent.test';
const OWNER_PASSWORD = 'password123';

const FUND_SOURCES = ['card', 'gcash', 'maya-wallet', 'shopeepay', 'qrph'] as const;
const FIRST = ['Ana', 'Ben', 'Carlos', 'Divya', 'Erin', 'Felix', 'Grace', 'Hugo', 'Ines', 'Jomar', 'Kira', 'Leo', 'Maya', 'Noel', 'Olive', 'Paolo', 'Quinn', 'Rina', 'Sami', 'Tonio'] as const;
const LAST = ['Reyes', 'Santos', 'Cruz', 'Lim', 'Garcia', 'Tan', 'Diaz', 'Flores', 'Mendoza', 'Castro', 'Aquino', 'Ramos', 'Torres', 'Gomez', 'Bautista', 'Navarro', 'Salazar', 'Villar', 'Ocampo', 'Yu'] as const;

const rand = () => Math.random();
const randInt = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)];
const chance = (p: number) => rand() < p;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toLocaleTimeString('en-PH', { hour12: false });
const log = (icon: string, msg: string) => console.log(`[${stamp()}] ${icon} ${msg}`);

const client = postgres(DATABASE_URL);
const db = drizzle(client);

// ───────────────────────────── bootstrap catalog (idempotent) ─────────────────────────────
const SEED_PACKAGES = [
	{ name: 'Free Time', type: 'free', durationMinutes: 15, creditCost: 0, isActive: true },
	{ name: '₱20 — 50 Credits', type: 'bundle', fiatCost: 20, creditsProvided: 50, isActive: true },
	{ name: '₱50 — 150 Credits', type: 'bundle', fiatCost: 50, creditsProvided: 150, isActive: true },
	{ name: '₱100 — 350 Credits', type: 'bundle', fiatCost: 100, creditsProvided: 350, isActive: true },
	{ name: '1 Hour', type: 'tier', creditCost: 20, durationMinutes: 60, isActive: true },
	{ name: '3 Hours', type: 'tier', creditCost: 50, durationMinutes: 180, isActive: true },
	{ name: '1 Day', type: 'tier', creditCost: 150, durationMinutes: 1440, isActive: true }
] satisfies (typeof packages.$inferInsert)[];

const SEED_APS = [
	{ name: 'AP — Ground Floor', online: true, uptimePct: '99.80', latencyMs: 12, throughputMbps: 84, latitude: '14.554700', longitude: '121.024500', address: 'Ground Floor', interfaceName: 'ether2-ground' },
	{ name: 'AP — Floor 2', online: true, uptimePct: '99.50', latencyMs: 15, throughputMbps: 61, latitude: '14.554900', longitude: '121.024700', address: '2nd Floor', interfaceName: 'wlan2-floor2' },
	{ name: 'AP — Cafe Patio', online: true, uptimePct: '97.10', latencyMs: 48, throughputMbps: 22, latitude: '14.555200', longitude: '121.025100', address: 'Cafe Patio', interfaceName: 'wlan3-patio' },
	{ name: 'AP — Rooftop Deck', online: true, uptimePct: '99.90', latencyMs: 9, throughputMbps: 95, latitude: null, longitude: null, address: null, interfaceName: 'wlan4-roof' },
	{ name: 'AP — Parking Lobby', online: false, uptimePct: '0.00', latencyMs: null, throughputMbps: 0, latitude: '14.554300', longitude: '121.024200', address: 'Basement Parking', interfaceName: 'ether5-parking' },
	{ name: 'AP — Annex Hall', online: true, uptimePct: '98.40', latencyMs: 22, throughputMbps: 47, latitude: '14.555500', longitude: '121.025400', address: 'Annex Hall', interfaceName: 'wlan6-annex' }
] satisfies (typeof networkHealth.$inferInsert)[];

async function ensureSchema() {
	try {
		await db.select({ id: packages.id }).from(packages).limit(1);
	} catch {
		console.error(
			'Schema not found. Create it once with `bun run --filter radius-admin test:seed`\n' +
				'(or `bun run db:migrate` from the repo root), then re-run the simulator.'
		);
		process.exit(1);
	}
}

async function maybeFresh() {
	if (!FRESH) return;
	// Same wipe as test:clear — empty all data, keep the schema + admin_role lookup.
	await client.unsafe('TRUNCATE customer_user, admin_user, network_health, packages RESTART IDENTITY CASCADE;');
	log('🧹', 'Fresh start: cleared all data.');
}

async function ensureCatalog() {
	const [{ value: pkgN }] = await db.select({ value: count() }).from(packages);
	if (pkgN === 0) {
		await db.insert(packages).values(SEED_PACKAGES);
		log('📦', `Bootstrapped ${SEED_PACKAGES.length} packages.`);
	}
	const [{ value: apN }] = await db.select({ value: count() }).from(networkHealth);
	if (apN === 0) {
		await db.insert(networkHealth).values(SEED_APS);
		log('📡', `Bootstrapped ${SEED_APS.length} access points.`);
	}
}

async function ensureOwner() {
	const [existing] = await db.select({ id: adminUser.id }).from(adminUser).where(eq(adminUser.email, OWNER_EMAIL)).limit(1);
	if (existing) return;
	if (!BETTER_AUTH_SECRET) {
		log('⚠️ ', `No owner login and BETTER_AUTH_SECRET unset — run \`bootstrap:owner\` to log in.`);
		return;
	}
	const auth = betterAuth({
		baseURL: ORIGIN,
		secret: BETTER_AUTH_SECRET,
		database: drizzleAdapter(db, { provider: 'pg', schema: adminAuthSchema }),
		emailAndPassword: { enabled: true },
		advanced: { cookiePrefix: 'radius-admin' }
	});
	const res = await auth.api.signUpEmail({ body: { name: 'Olivia Owner', email: OWNER_EMAIL, password: OWNER_PASSWORD } });
	await db
		.insert(adminProfile)
		.values({ userId: res.user.id, role: STAFF_ROLE.owner, status: STAFF_STATUS.active })
		.onConflictDoUpdate({ target: adminProfile.userId, set: { role: STAFF_ROLE.owner, status: STAFF_STATUS.active } });
	log('🔑', `Created owner login: ${OWNER_EMAIL} / ${OWNER_PASSWORD}`);
}

// ───────────────────────────── live state ─────────────────────────────
interface Cust {
	id: string;
	name: string;
	blocked: boolean;
	mac: string;
}
let customers: Cust[] = [];
let bundles: (typeof packages.$inferSelect)[] = [];
let tiers: (typeof packages.$inferSelect)[] = [];
let signupSeq = 0;

async function loadState() {
	const pkgRows = await db.select().from(packages);
	bundles = pkgRows.filter((p) => p.type === 'bundle');
	tiers = pkgRows.filter((p) => p.type === 'tier');

	const rows = await db
		.select({ id: customerUser.id, name: customerUser.name, blocked: customerProfile.blocked })
		.from(customerUser)
		.innerJoin(customerProfile, eq(customerProfile.userId, customerUser.id));
	// Reuse each existing customer's most recent MAC so the Users "last device" is stable.
	const macByUser = new Map<string, string>();
	const hist = await db
		.selectDistinctOn([networkSessions.userId], { userId: networkSessions.userId, mac: networkSessions.macAddress })
		.from(networkSessions)
		.where(isNotNull(networkSessions.macAddress))
		.orderBy(networkSessions.userId, desc(networkSessions.startedAt));
	for (const r of hist) if (r.mac) macByUser.set(r.userId, r.mac);

	customers = rows.map((c, i) => ({
		id: c.id,
		name: c.name,
		blocked: c.blocked,
		mac: macByUser.get(c.id) ?? synthMac(i)
	}));
	signupSeq = customers.length;
}

const synthMac = (n: number) => `DE:AD:BE:EF:${randInt(16, 255).toString(16).padStart(2, '0').toUpperCase()}:${(n % 256).toString(16).padStart(2, '0').toUpperCase()}`;

const onlineApIds = async () =>
	(await db.select({ id: networkHealth.id }).from(networkHealth).where(eq(networkHealth.online, true))).map((r) => r.id);
const activeUserIds = async () =>
	new Set(
		(
			await db
				.select({ userId: networkSessions.userId })
				.from(networkSessions)
				.where(and(eq(networkSessions.status, SESSION_STATUS.active), gt(networkSessions.expiresAt, new Date())))
		).map((r) => r.userId)
	);

// ───────────────────────────── actions ─────────────────────────────

/** A brand-new customer signs up (zero balance, no history). Grows the user base. */
async function signup(): Promise<Cust> {
	const seq = signupSeq++;
	const name = `${FIRST[seq % FIRST.length]} ${LAST[(seq * 7) % LAST.length]}`;
	const id = crypto.randomUUID();
	await db.insert(customerUser).values({
		id,
		name,
		email: `sim${seq}@example.com`,
		emailVerified: true,
		phoneNumber: `+63900${String(seq).padStart(7, '0')}`,
		phoneNumberVerified: true,
		createdAt: new Date(),
		updatedAt: new Date()
	});
	await db.insert(customerProfile).values({ userId: id, role: 'user', creditBalance: '0', blocked: false });
	const cust: Cust = { id, name, blocked: false, mac: synthMac(seq) };
	customers.push(cust);
	log('👤', `New signup: ${name}`);
	return cust;
}

/** A customer comes online: start an active session. Spends credits for a tier if
 *  they can afford one (and notifies via the ledger write); otherwise free 15 min. */
async function arrive() {
	if (customers.length === 0) await signup();
	const online = await activeUserIds();
	const candidates = customers.filter((c) => !c.blocked && !online.has(c.id));
	if (candidates.length === 0) return;
	const cust = pick(candidates);
	const apIds = await onlineApIds();
	const networkId = apIds.length ? pick(apIds) : null;
	const now = new Date();

	let packageId: number | null = null;
	let minutes = 15;
	let how = 'Free Time';
	if (chance(0.7) && tiers.length) {
		const tier = pick(tiers);
		const cost = tier.creditCost ?? 0;
		const spent = await db
			.update(customerProfile)
			.set({ creditBalance: sql`${customerProfile.creditBalance} - ${cost}` })
			.where(and(eq(customerProfile.userId, cust.id), sql`${customerProfile.creditBalance} >= ${cost}`))
			.returning({ balance: customerProfile.creditBalance });
		if (spent.length) {
			await db.insert(creditLedger).values({ userId: cust.id, packageId: tier.id, amount: -cost, type: LEDGER_TYPE.spend });
			packageId = tier.id;
			minutes = tier.durationMinutes ?? 60;
			how = `${tier.name} (−${cost} cr)`;
		}
	}

	await db.insert(networkSessions).values({
		userId: cust.id,
		macAddress: cust.mac,
		packageId,
		networkId,
		status: SESSION_STATUS.active,
		startedAt: now,
		expiresAt: new Date(now.getTime() + minutes * 60_000)
	});
	log('🟢', `${cust.name} connected — ${how}, ${minutes}m`);
}

/** A customer leaves: expire one currently-active session. */
async function depart() {
	const [s] = await db
		.select({ id: networkSessions.id, userId: networkSessions.userId })
		.from(networkSessions)
		.where(and(eq(networkSessions.status, SESSION_STATUS.active), gt(networkSessions.expiresAt, new Date())))
		.orderBy(sql`random()`)
		.limit(1);
	if (!s) return;
	await db.update(networkSessions).set({ status: SESSION_STATUS.expired }).where(eq(networkSessions.id, s.id));
	log('🔴', `${customers.find((c) => c.id === s.userId)?.name ?? s.userId} disconnected`);
}

/** A successful top-up: payment_transactions + credit_ledger + balance increment. */
async function topup() {
	if (customers.length === 0) await signup();
	if (bundles.length === 0) return;
	const cust = pick(customers);
	const bundle = pick(bundles);
	const credits = bundle.creditsProvided ?? 0;
	const fund = pick(FUND_SOURCES);
	const txId = `tx_live_${Date.now()}_${randInt(1000, 9999)}`;
	const now = new Date();

	await db.transaction(async (tx) => {
		await tx.insert(paymentTransactions).values({
			id: txId,
			status: 'PAYMENT_SUCCESS',
			amount: String(bundle.fiatCost ?? 0),
			currency: 'PHP',
			fundSourceType: fund,
			fundSourceMasked: fund === 'card' ? `**** ${randInt(1000, 9999)}` : null,
			receiptNo: `RCPT-${randInt(100000, 999999)}`,
			referenceNo: `ref_${cust.id.slice(0, 8)}`,
			buyerName: cust.name,
			buyerEmail: `${cust.name.split(' ')[0].toLowerCase()}@example.com`,
			userId: cust.id,
			packageId: bundle.id,
			createdAt: now
		});
		await tx.insert(creditLedger).values({
			userId: cust.id,
			packageId: bundle.id,
			amount: credits,
			type: LEDGER_TYPE.topup,
			externalTransactionId: txId,
			createdAt: now
		});
		await tx
			.update(customerProfile)
			.set({ creditBalance: sql`${customerProfile.creditBalance} + ${credits}` })
			.where(eq(customerProfile.userId, cust.id));
	});
	log('💰', `${cust.name} bought ${bundle.name} via ${fund} (+${credits} cr)`);
}

/** A failed payment — recorded in the funnel (Finance), no credit, no dashboard push. */
async function failedPayment() {
	if (bundles.length === 0) return;
	const cust = customers.length && chance(0.6) ? pick(customers) : null;
	const bundle = pick(bundles);
	const status = pick(['PAYMENT_FAILED', 'PAYMENT_EXPIRED', 'PAYMENT_CANCELLED'] as const);
	await db.insert(paymentTransactions).values({
		id: `tx_live_${Date.now()}_${randInt(1000, 9999)}`,
		status,
		amount: String(bundle.fiatCost ?? 0),
		currency: 'PHP',
		fundSourceType: pick(FUND_SOURCES),
		errorCode: status === 'PAYMENT_FAILED' ? 'PAYMENT_DECLINED' : null,
		errorMessage: status === 'PAYMENT_FAILED' ? 'Card was declined by issuer.' : null,
		buyerName: cust?.name ?? 'Guest Checkout',
		buyerEmail: cust ? `${cust.name.split(' ')[0].toLowerCase()}@example.com` : null,
		userId: cust?.id ?? null,
		packageId: bundle.id,
		createdAt: new Date()
	});
	log('⚠️ ', `${cust?.name ?? 'Guest'} payment ${status.replace('PAYMENT_', '').toLowerCase()}`);
}

/** AP telemetry flap: new latency/throughput sample, occasionally toggles online. */
async function healthFlap() {
	const aps = await db.select().from(networkHealth);
	if (aps.length === 0) return;
	const ap = pick(aps);
	const goOffline = chance(0.1);
	const online = goOffline ? false : chance(0.95) ? true : ap.online;
	await db
		.update(networkHealth)
		.set({
			online,
			latencyMs: online ? randInt(8, 80) : null,
			throughputMbps: online ? randInt(15, 95) : 0,
			uptimePct: online ? (95 + rand() * 5).toFixed(2) : '0.00',
			lastSampleAt: new Date()
		})
		.where(eq(networkHealth.id, ap.id));
	log(online ? '📶' : '📵', `${ap.name} ${online ? 'sample updated' : 'went OFFLINE'}`);
}

// Weighted mix. Signups are frequent early on (small user base) then taper naturally
// as arrive/topup pick from the growing pool.
function nextAction(): () => Promise<void> {
	const signupWeight = customers.length < 8 ? 30 : customers.length < 25 ? 12 : 4;
	const ACTIONS: [() => Promise<void>, number][] = [
		[signup, signupWeight],
		[arrive, 30],
		[depart, 20],
		[topup, 20],
		[healthFlap, 14],
		[failedPayment, 8]
	];
	const total = ACTIONS.reduce((s, [, w]) => s + w, 0);
	let r = rand() * total;
	return ACTIONS.find(([, w]) => (r -= w) < 0)?.[0] ?? arrive;
}

// ───────────────────────────── run ─────────────────────────────
await ensureSchema();
await maybeFresh();
await ensureCatalog();
await ensureOwner();
await loadState();

let running = true;
process.on('SIGINT', () => {
	running = false;
	console.log('\nStopping simulator…');
});

console.log(`▸ Live simulator started — ${customers.length} customers, ${bundles.length} bundles, ${tiers.length} tiers.`);
console.log(`  Interval ${MIN_MS}–${MAX_MS}ms. Open /dashboard and watch. Ctrl+C to stop.\n`);

while (running) {
	try {
		await nextAction()();
	} catch (err) {
		log('✗', `action failed: ${(err as Error).message}`);
	}
	await sleep(randInt(MIN_MS, MAX_MS));
}

await client.end();
process.exit(0);
