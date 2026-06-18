import { env } from '$env/dynamic/private';
import postgres from 'postgres';
import { db } from '$lib/server/db';
import { dashboardSnapshot } from '$lib/server/queries';
import type { DashboardSnapshot } from '$lib/types';

/**
 * Process-wide live feed for the admin dashboard.
 *
 * Postgres triggers (migration 0006) fire `pg_notify('dashboard')` on every write
 * to network_sessions / credit_ledger / network_health — from ANY app. This holds
 * ONE long-lived LISTEN connection (separate from the Drizzle query pool, which
 * LISTEN would otherwise tie up), debounces notify bursts, re-queries the snapshot
 * ONCE per burst, and fans it out to every subscribed SSE client.
 */

// ponytail: 250ms debounce coalesces write bursts; raise if a tab shows a partial snapshot.
const DEBOUNCE_MS = 250;

type Subscriber = (snap: DashboardSnapshot) => void;
const subscribers = new Set<Subscriber>();

let listenClient: postgres.Sql | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

async function broadcast() {
	debounceTimer = null;
	if (subscribers.size === 0) return;
	try {
		const snap = await dashboardSnapshot(db);
		for (const cb of subscribers) cb(snap);
	} catch {
		// transient query error — next notify re-tries; keep the feed alive
	}
}

function onNotify() {
	if (debounceTimer) return; // a re-query is already scheduled for this burst
	debounceTimer = setTimeout(broadcast, DEBOUNCE_MS);
}

function ensureListening() {
	if (listenClient) return;
	// Dedicated single connection; postgres.js owns it and re-issues LISTEN on reconnect.
	listenClient = postgres(env.DATABASE_URL, { max: 1 });
	void listenClient.listen('dashboard', onNotify);
}

/** Subscribe to live snapshots. Opens the LISTEN connection on the first subscriber
 * and keeps it for the process lifetime (one idle connection — fine). Returns an
 * unsubscribe fn. */
export function subscribe(cb: Subscriber): () => void {
	ensureListening();
	subscribers.add(cb);
	return () => subscribers.delete(cb);
}
