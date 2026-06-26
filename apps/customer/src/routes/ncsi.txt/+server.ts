import type { RequestHandler } from './$types';

/**
 * Windows NCSI captive-portal probe (`/ncsi.txt`). Windows expects a 200 with the exact body
 * `Microsoft NCSI`; anything else flips the network to "No Internet" / opens the captive page.
 * Once the device is granted and the router forwards this probe to us, returning the expected
 * body clears the captive state immediately (Issue 2). Companion: `/connecttest.txt`.
 */
export const prerender = false;

export const GET: RequestHandler = () =>
	new Response('Microsoft NCSI', {
		status: 200,
		headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' }
	});
