/**
 * Load-test cleanup — MUST run after a real-router stress run.
 *
 *   bun run --filter veent-customer loadtest:cleanup
 *
 * Removes everything the load test created:
 *   1. Deletes the tagged test users (`@loadtest.veent.local`). Their `customer_session`
 *      and `network_sessions` rows cascade away (FK onDelete: cascade).
 *   2. Runs reconcileGuestBindings against the router, which removes any guest ip-binding
 *      no longer backed by an active DB session — i.e. the ~100 bindings the grants created.
 *
 * Run this on the HOST machine (the teammate's laptop) — it needs the same DATABASE_URL
 * and MIKROTIK_* env the app uses to reach the router.
 */
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { like, inArray } from 'drizzle-orm';
import { customerUser, customerProfile } from '@veent/db';
import { createNetworkController, reconcileGuestBindings } from '@veent/core';

const { DATABASE_URL } = process.env;
if (!DATABASE_URL) throw new Error('DATABASE_URL is not set (apps/customer/.env)');

const TEST_DOMAIN = 'loadtest.veent.local'; // keep in sync with seed-sessions.ts EMAIL_DOMAIN

const client = postgres(DATABASE_URL, { max: 4 });
const db = drizzle(client);

// 1. Delete the tagged test users (sessions + network_sessions cascade).
const rows = await db
	.select({ id: customerUser.id })
	.from(customerUser)
	.where(like(customerUser.email, `%@${TEST_DOMAIN}`));
const ids = rows.map((r) => r.id);

if (ids.length) {
	await db.delete(customerProfile).where(inArray(customerProfile.userId, ids));
	await db.delete(customerUser).where(inArray(customerUser.id, ids));
	console.log(`✓ Deleted ${ids.length} test users (+ cascaded sessions/network_sessions).`);
} else {
	console.log('No @' + TEST_DOMAIN + ' users found — nothing to delete in the DB.');
}

// 2. Sweep the router bindings those grants left behind (now orphaned).
if (process.env.MIKROTIK_HOST) {
	const network = createNetworkController({
		controller: 'mikrotik',
		host: process.env.MIKROTIK_HOST || '',
		user: process.env.MIKROTIK_USER || '',
		password: process.env.MIKROTIK_PASSWORD || '',
		port: process.env.MIKROTIK_PORT ? Number(process.env.MIKROTIK_PORT) : undefined,
		tls: process.env.MIKROTIK_TLS === 'true',
		insecureTls: process.env.MIKROTIK_TLS_INSECURE === 'true'
	});
	const reconciled = await reconcileGuestBindings(db, network);
	console.log(`✓ Router reconcile removed ${reconciled} orphaned guest binding(s).`);
} else {
	console.warn(
		'⚠ MIKROTIK_HOST not set — skipped router reconcile. Run this on the host laptop, or ' +
			'manually remove the test bindings: /ip hotspot ip-binding print / remove.'
	);
}

await client.end();
