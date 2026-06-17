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
import { packages } from './schema';

type SeedPackage = typeof packages.$inferInsert;

// Three package "types":
//   free   — the 15-min free window (no fiat, no credit cost)
//   bundle — buy credits with fiat (PayMongo/Xendit)
//   tier   — spend credits for a block of access time
const seedPackages: SeedPackage[] = [
	{ name: 'Free Time', type: 'free', durationMinutes: 15, creditCost: 0, isActive: true },

	{ name: '₱20 — 50 Credits', type: 'bundle', fiatCost: 20, creditsProvided: 50, isActive: true },
	{ name: '₱50 — 150 Credits', type: 'bundle', fiatCost: 50, creditsProvided: 150, isActive: true },
	{ name: '₱100 — 350 Credits', type: 'bundle', fiatCost: 100, creditsProvided: 350, isActive: true },

	{ name: '1 Hour', type: 'tier', creditCost: 20, durationMinutes: 60, isActive: true },
	{ name: '3 Hours', type: 'tier', creditCost: 50, durationMinutes: 180, isActive: true },
	{ name: '1 Day', type: 'tier', creditCost: 150, durationMinutes: 1440, isActive: true }
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

	console.log(`\nSeed complete: ${inserted} inserted, ${seedPackages.length - inserted} skipped.`);
	process.exit(0);
}

seed().catch((err) => {
	console.error('Seed failed:', err);
	process.exit(1);
});
