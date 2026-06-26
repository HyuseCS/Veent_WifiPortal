import type { RequestHandler } from './$types';

/**
 * Android captive-portal probe alias (`/gen_204`) — older/alt Android builds use this path
 * instead of `/generate_204`. Same contract: a bare 204. See `generate_204/+server.ts`.
 */
export const prerender = false;

export const GET: RequestHandler = () =>
	new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
