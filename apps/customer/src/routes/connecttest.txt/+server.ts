import type { RequestHandler } from './$types';

/**
 * Windows 10/11 connectivity probe (`/connecttest.txt`) — the newer companion to `/ncsi.txt`.
 * Windows expects a 200 with the exact body `Microsoft Connect Test`. Returning it the moment
 * the router forwards the probe to a granted device clears the captive state (Issue 2).
 */
export const prerender = false;

export const GET: RequestHandler = () =>
	new Response('Microsoft Connect Test', {
		status: 200,
		headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' }
	});
