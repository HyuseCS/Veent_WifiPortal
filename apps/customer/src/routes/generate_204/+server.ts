import type { RequestHandler } from './$types';

/**
 * Android / ChromeOS captive-portal probe (`/generate_204`, also `/gen_204`).
 *
 * The OS hits this expecting a bare **204 No Content**. While a device is still behind the
 * hotspot the router intercepts the probe and redirects it to the portal (that's what raises
 * the "Sign in to network" sheet). Once the device is granted, the router lets the probe through
 * to us — answering 204 here the instant it arrives tells the OS "you're online" without waiting
 * for its own retry timer, so the captive notification dismisses fast (Issue 2).
 *
 * Unconditional success is correct: reaching this handler at all means the router already
 * decided this device is allowed through. `no-store` so a cached 204 can't mask a later
 * captive state.
 */
export const prerender = false;

export const GET: RequestHandler = () =>
	new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
