import { json, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { expireDueSessions, reconcileGuestBindings } from '@veent/core';
import { db } from '$lib/server/db';
import { network } from '$lib/server/network';
import { cronIpAllowed } from '$lib/server/rateLimit';
import type { RequestHandler } from './$types';

/**
 * POST /api/network/revoke — cron-callable. Finds active sessions whose time is
 * up, re-blocks each MAC on the controller, and marks them expired.
 *
 * Auth: shared secret in the `x-cron-secret` header (set CRON_SECRET in env), plus an
 * optional source-IP allowlist (`CRON_IP_ALLOWLIST`). Run from a scheduler every minute,
 * OR rely on the router's hardware timeout and use this as a reconciler.
 */
export const POST: RequestHandler = async (event) => {
	if (!cronIpAllowed(event, env.CRON_IP_ALLOWLIST)) error(403, 'Forbidden');
	const secret = event.request.headers.get('x-cron-secret');
	if (!env.CRON_SECRET || secret !== env.CRON_SECRET) error(401, 'Unauthorized');

	const revoked = await expireDueSessions(db, network);
	// Then sweep router bindings the DB no longer backs (wipe/cascade/crash orphans).
	const reconciled = await reconcileGuestBindings(db, network);
	return json({ ok: true, revoked, reconciled });
};
