import { env } from '$env/dynamic/private';
import { createListenClient } from '@veent/db';

/**
 * Process-wide per-ACCOUNT live feed for the customer dashboard.
 *
 * Postgres triggers (migration 0018) fire `pg_notify('account', <user_id>)` on every
 * write to customer_profile / network_sessions / credit_ledger — from ANY app. This
 * holds ONE long-lived LISTEN connection (separate from the Drizzle query pool), routes
 * each notify to ONLY that account's subscribers, and debounces per-account bursts so a
 * multi-row write (e.g. unbinding several devices) re-pushes once, not N times.
 */

// ponytail: 250ms debounce coalesces a write burst for one account; raise if a tab shows
// a partial view.
const DEBOUNCE_MS = 250;

const subscribers = new Map<string, Set<() => void>>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let listenClient: ReturnType<typeof createListenClient> | null = null;

function fire(userId: string) {
	timers.delete(userId);
	const subs = subscribers.get(userId);
	if (!subs) return;
	for (const cb of subs) cb();
}

function onNotify(userId: string) {
	if (!userId) return;
	if (timers.has(userId)) return; // a fire is already scheduled for this account's burst
	timers.set(userId, setTimeout(() => fire(userId), DEBOUNCE_MS));
}

function ensureListening() {
	if (listenClient) return;
	// Dedicated single connection; postgres.js owns it and re-issues LISTEN on reconnect.
	listenClient = createListenClient(env.DATABASE_URL);
	void listenClient.listen('account', onNotify);
}

/**
 * Subscribe to live notifications for ONE account. `cb` is called (debounced) whenever a
 * write touches that account. Opens the LISTEN connection on the first subscriber and keeps
 * it for the process lifetime (one idle connection). Returns an unsubscribe fn.
 */
export function subscribeAccount(userId: string, cb: () => void): () => void {
	ensureListening();
	let set = subscribers.get(userId);
	if (!set) {
		set = new Set();
		subscribers.set(userId, set);
	}
	set.add(cb);
	return () => {
		const s = subscribers.get(userId);
		if (!s) return;
		s.delete(cb);
		if (s.size === 0) subscribers.delete(userId);
	};
}
