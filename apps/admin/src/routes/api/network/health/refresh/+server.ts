import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { refreshNetworkHealth } from '@veent/core';
import { db } from '$lib/server/db';
import { network } from '$lib/server/network';
import type { RequestHandler } from './$types';

/**
 * POST /api/network/health/refresh — cron-callable. Pulls a live per-interface
 * sample from the router and writes it to `network_health`, so the Networks page
 * stays warm even when nobody's viewing it (the page also refreshes on view).
 *
 * Auth: shared secret in the `x-cron-secret` header (set CRON_SECRET in env) —
 * same convention as the customer revoke cron. Point a scheduler at it, e.g.:
 *   * * * * * curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" http://10.0.0.147:5174/api/network/health/refresh
 *
 * No-op count of 0 on the stub controller (nothing to sample).
 */
export const POST: RequestHandler = async (event) => {
	const secret = event.request.headers.get('x-cron-secret');
	if (!env.CRON_SECRET || secret !== env.CRON_SECRET) error(401, 'Unauthorized');

	const interfaces = await refreshNetworkHealth(db, network);
	return json({ ok: true, interfaces });
};
