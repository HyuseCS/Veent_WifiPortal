import { error } from '@sveltejs/kit';
import { isValidMac } from '@veent/core';
import { db } from '$lib/server/db';
import { buildAccountView } from '$lib/server/account-view';
import { subscribeAccount } from '$lib/server/account-feed';
import type { RequestHandler } from './$types';

/**
 * GET /api/account/stream — Server-Sent Events stream of THIS account's live dashboard
 * slice (balance, free-time, access window, devices). Business rule #5: SSE, never
 * client-side polling. Emits a view on connect, then a fresh view whenever a Postgres
 * trigger notifies the feed for this user (pause/resume, purchase, bind/unbind, balance
 * change — from any of the account's devices). No DB polling.
 *
 * `?mac=` is the current device's MAC (display-only: it flags `thisDevice` / `atCap` in
 * the device list). The streamed data is always scoped to the authenticated user.
 */
const HEARTBEAT_MS = 25_000;

// Cap concurrent streams per account: each holds a connection + a feed subscription and
// re-queries on every account write. A few tabs/devices is normal; far more is abuse or a leak.
// ponytail: per-process in-memory count — per instance until horizontally scaled.
const MAX_STREAMS_PER_USER = 4;
const openStreams = new Map<string, number>();

export const GET: RequestHandler = async (event) => {
	if (!event.locals.user) error(401, 'Not authenticated');
	const userId = event.locals.user.id;

	const macParam = event.url.searchParams.get('mac');
	const mac = isValidMac(macParam) ? macParam : null;

	if ((openStreams.get(userId) ?? 0) >= MAX_STREAMS_PER_USER) {
		error(429, 'Too many open connections. Close some tabs and try again.');
	}
	openStreams.set(userId, (openStreams.get(userId) ?? 0) + 1);
	let released = false;
	const release = () => {
		if (released) return;
		released = true;
		const n = (openStreams.get(userId) ?? 1) - 1;
		if (n <= 0) openStreams.delete(userId);
		else openStreams.set(userId, n);
	};

	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		async start(controller) {
			let closed = false;
			let sending = false;
			let pending = false;

			const send = (payload: string) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(payload));
				} catch {
					// controller already torn down — ignore
				}
			};

			// Re-query + push the account view. Serialized: if a notify lands mid-query, run
			// ONE more pass after (so we never miss the latest state nor interleave frames).
			const pushView = async () => {
				if (closed || sending) {
					pending = true;
					return;
				}
				sending = true;
				try {
					do {
						pending = false;
						const view = await buildAccountView(db, userId, mac);
						send(`data: ${JSON.stringify(view)}\n\n`);
					} while (pending && !closed);
				} catch {
					// transient query error — the next notify retries
				} finally {
					sending = false;
				}
			};

			await pushView(); // initial view so the page is live immediately

			const unsubscribe = subscribeAccount(userId, () => void pushView());
			const heartbeat = setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS);

			event.request.signal.addEventListener('abort', () => {
				closed = true;
				release();
				unsubscribe();
				clearInterval(heartbeat);
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
