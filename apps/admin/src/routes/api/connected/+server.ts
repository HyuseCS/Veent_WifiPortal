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

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user) error(401, 'Not authenticated');

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
