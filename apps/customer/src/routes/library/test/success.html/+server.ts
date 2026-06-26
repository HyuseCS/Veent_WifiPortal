import type { RequestHandler } from './$types';

/** Same exact body the CNA requires; shared contract with `/hotspot-detect.html`. */
const APPLE_SUCCESS = '<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>';

/**
 * Apple captive-portal probe alias (`/library/test/success.html`) — some iOS/macOS versions
 * probe this path instead of `/hotspot-detect.html`. Identical contract: a 200 whose body is
 * exactly the Apple Success page. See `hotspot-detect.html/+server.ts`.
 */
export const prerender = false;

export const GET: RequestHandler = () =>
	new Response(APPLE_SUCCESS, {
		status: 200,
		headers: { 'content-type': 'text/html', 'cache-control': 'no-store' }
	});
