/**
 * Seeds starter `packages` rows (the storefront catalog). Idempotent: re-running
 * inserts only packages whose `name` is not already present, so it is safe to run
 * repeatedly in dev.
 *
 *   bun run db:seed            # from the repo root (delegates to @veent/db)
 *
 * Reads DATABASE_URL from packages/db/.env (bun auto-loads it).
 */
import { eq } from 'drizzle-orm';
import { createDb } from './client';
import { packages, networkHealth } from './schema';

type SeedPackage = typeof packages.$inferInsert;
type SeedAp = typeof networkHealth.$inferInsert;

// Three package "types":
//   free   — the 15-min free window (no fiat, no credit cost)
//   bundle — buy credits with fiat (PayMongo/Xendit)
//   tier   — spend credits for a block of access time
const seedPackages: SeedPackage[] = [
	{ name: 'Free Time', type: 'free', durationMinutes: 15, creditCost: 0, isActive: true },

	{ name: '₱20 — 50 Credits', type: 'bundle', fiatCost: 20, creditsProvided: 50, isActive: true },
	{ name: '₱50 — 150 Credits', type: 'bundle', fiatCost: 50, creditsProvided: 150, isActive: true },
	{
		name: '₱100 — 350 Credits',
		type: 'bundle',
		fiatCost: 100,
		creditsProvided: 350,
		isActive: true
	},

	{ name: '1 Hour', type: 'tier', creditCost: 20, durationMinutes: 60, isActive: true },
	{ name: '3 Hours', type: 'tier', creditCost: 50, durationMinutes: 180, isActive: true },
	{ name: '1 Day', type: 'tier', creditCost: 150, durationMinutes: 1440, isActive: true }
];

// SAMPLE per-AP health for the Networks page. Synthetic until a real router /
// controller telemetry feed writes here — keep this honest, not "live".
// No coordinates: the locator map starts empty; an operator sets each AP's
// location from the admin Networks page.
const seedNetworkHealth: SeedAp[] = [
	{ name: 'AP — Ground Floor', online: true, uptimePct: '99.80', latencyMs: 12, users: 38, throughputMbps: 84 },
	{ name: 'AP — Floor 2', online: true, uptimePct: '99.50', latencyMs: 15, users: 27, throughputMbps: 61 },
	{ name: 'AP — Cafe Patio', online: true, uptimePct: '97.10', latencyMs: 48, users: 12, throughputMbps: 22 },
	{ name: 'AP — Parking Lobby', online: false, uptimePct: '0.00', latencyMs: null, users: 0, throughputMbps: 0 }
];

async function seed() {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL is not set (copy packages/db/.env.example to .env)');

	const db = createDb(url);

	let inserted = 0;
	for (const pkg of seedPackages) {
		const existing = await db
			.select({ id: packages.id })
			.from(packages)
			.where(eq(packages.name, pkg.name))
			.limit(1);

		if (existing.length === 0) {
			await db.insert(packages).values(pkg);
			inserted++;
			console.log(`+ ${pkg.name}`);
		} else {
			console.log(`= ${pkg.name} (exists, skipped)`);
		}
	}

	console.log(`\nPackages: ${inserted} inserted, ${seedPackages.length - inserted} skipped.`);

	// Network health — idempotent by AP name.
	let apsInserted = 0;
	for (const ap of seedNetworkHealth) {
		const existing = await db
			.select({ id: networkHealth.id })
			.from(networkHealth)
			.where(eq(networkHealth.name, ap.name))
			.limit(1);

		if (existing.length === 0) {
			await db.insert(networkHealth).values(ap);
			apsInserted++;
			console.log(`+ ${ap.name}`);
		} else {
			console.log(`= ${ap.name} (exists, skipped)`);
		}
	}
	console.log(
		`Network health: ${apsInserted} inserted, ${seedNetworkHealth.length - apsInserted} skipped.`
	);

	console.log('\nSeed complete.');
	process.exit(0);
}

seed().catch((err) => {
	console.error('Seed failed:', err);
	process.exit(1);
});
