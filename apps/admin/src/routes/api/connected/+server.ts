import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { listActiveSessions } from '$lib/server/queries';
import type { RequestHandler } from './$types';

/**
 * GET /api/connected — Server-Sent Events stream of currently-connected sessions
 * (business rule #5: SSE, never client-side polling). Emits an ActiveSession[]
 * snapshot on connect and every 5s after.
 *
 * NOTE: this currently re-queries the DB on a timer. The production upgrade is to
 * push from the router's RADIUS accounting feed instead of polling — same wire
 * format, so the client (EventSource) doesn't change.
 */
const INTERVAL_MS = 5000;

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user) error(401, 'Not authenticated');

	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		start(controller) {
			let closed = false;

			const push = async () => {
				if (closed) return;
				try {
					const sessions = await listActiveSessions(db);
					controller.enqueue(encoder.encode(`data: ${JSON.stringify(sessions)}\n\n`));
				} catch {
					// transient query error — keep the stream open, try again next tick
				}
			};

			void push();
			const timer = setInterval(push, INTERVAL_MS);

			event.request.signal.addEventListener('abort', () => {
				closed = true;
				clearInterval(timer);
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
