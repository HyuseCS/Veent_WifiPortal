import type { RequestHandler } from './$types';

/** Exact body iOS/macOS CNA looks for — any deviation keeps the captive sheet open. */
const APPLE_SUCCESS = '<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>';

/**
 * Apple (iOS/macOS) captive-portal probe (`/hotspot-detect.html`, also reached as
 * `/library/test/success.html`). The CNA fetches this and dismisses the "Sign in to network"
 * sheet **only** if it gets a 200 whose body is exactly the Success page above.
 *
 * Behind the hotspot the router intercepts this and serves the portal instead. Once the device
 * is granted, the router forwards the probe here and we return the real Success page so the OS
 * confirms connectivity immediately (Issue 2). Reaching this handler means the device is already
 * allowed through, so unconditional success is correct.
 */
export const prerender = false;

export const GET: RequestHandler = () =>
	new Response(APPLE_SUCCESS, {
		status: 200,
		headers: { 'content-type': 'text/html', 'cache-control': 'no-store' }
	});
