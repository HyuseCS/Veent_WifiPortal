import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { dashboardSnapshot } from '$lib/server/queries';
import { subscribe } from '$lib/server/dashboard-feed';
import type { RequestHandler } from './$types';

/**
 * GET /api/connected — Server-Sent Events stream of the whole dashboard
 * (business rule #5: SSE, never client-side polling). Emits a DashboardSnapshot
 * on connect, then a fresh snapshot whenever a Postgres trigger notifies the feed
 * (any app's write to sessions / credit_ledger / network_health). No DB polling.
 */
const HEARTBEAT_MS = 25_000;

// Cap concurrent SSE streams per user: each open stream holds a connection + a feed
// subscription and re-renders on every dashboard notify, so an unbounded fan-out is a cheap
// resource-exhaustion vector. A handful of tabs is normal; far more is abuse or a leak.
// ponytail: per-process in-memory count — with multiple app instances the cap is per
// instance; fine until horizontally scaled (then move the count to a shared store).
const MAX_STREAMS_PER_USER = 6;
const openStreams = new Map<string, number>();

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user) error(401, 'Not authenticated');
	// Mandatory 2FA applies here too. `hooks.server.ts` exposes locals.user to any ACTIVE staff
	// regardless of enrollment (so the /enroll-2fa flow can run), and the (app) layout only
	// guards page loads — not this API route. Without this check, a staff member who is signed
	// in but hasn't enrolled (or an attacker with only their password) could stream the whole
	// live dashboard via curl, bypassing the enrollment gate.
	if (!event.locals.user.twoFactorEnabled) error(403, 'Two-factor enrollment required');
	const userId = event.locals.user.id;

	if ((openStreams.get(userId) ?? 0) >= MAX_STREAMS_PER_USER) {
		error(429, 'Too many open dashboard connections. Close some tabs and try again.');
	}
	const openCount = (openStreams.get(userId) ?? 0) + 1;
	openStreams.set(userId, openCount);
	// Observability: open SSE connection count per user (resource-usage / leak signal).
	console.info('[sse] connected', { userId, open: openCount });
	let released = false;
	const release = () => {
		if (released) return;
		released = true;
		const n = (openStreams.get(userId) ?? 1) - 1;
		if (n <= 0) openStreams.delete(userId);
		else openStreams.set(userId, n);
		console.info('[sse] disconnected', { userId, open: Math.max(0, n) });
	};

	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		async start(controller) {
			let closed = false;

			const send = (payload: string) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(payload));
				} catch {
					// controller already torn down — ignore
				}
			};

			// Initial snapshot so the page is live immediately, not on the next write.
			try {
				send(`data: ${JSON.stringify(await dashboardSnapshot(db))}\n\n`);
			} catch {
				// transient — the first notify will fill it in
			}

			const unsubscribe = subscribe((snap) => send(`data: ${JSON.stringify(snap)}\n\n`));

			// Pushes are now sporadic; keep idle connections alive through proxies.
			const heartbeat = setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS);

			event.request.signal.addEventListener('abort', () => {
				closed = true;
				release();
				unsubscribe();
				clearInterval(heartbeat);
				// The controller may already be closed when the client disconnects;
				// closing again throws ERR_INVALID_STATE and would crash the server.
				try {
					controller.close();
				} catch {
					// already closed — nothing to do
				}
			});
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache',
			connection: 'keep-alive'
		}
	});
};
