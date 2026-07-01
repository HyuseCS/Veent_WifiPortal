import { json, error } from '@sveltejs/kit';
import { network } from '$lib/server/network';
import { rateLimit } from '$lib/server/rateLimit';
import { logger } from '$lib/server/logger';
import type { RequestHandler } from './$types';

const log = logger('router-log');

/**
 * GET /api/router-log — recent entries from the router's system log, newest first.
 * Session-authed (admin only). The Networks page's live log panel polls this.
 * Returns an empty list (not an error) when the controller can't read the log
 * (stub/dev) or the router is briefly unreachable, so the panel degrades quietly.
 */
export const GET: RequestHandler = async (event) => {
	if (!event.locals.user) error(401, 'Not authenticated');
	// Mandatory 2FA: same as /api/connected — the (app) layout doesn't guard this API route, and
	// hooks expose locals.user pre-enrollment, so enforce enrollment here or an un-enrolled
	// session could read the router system log directly.
	if (!event.locals.user.twoFactorEnabled) error(403, 'Two-factor enrollment required');

	// Each call opens a connection to the physical router, so cap it per-admin to stop a
	// scripted hammer from DoS-ing the device. 120/min comfortably clears the panel's 5s poll
	// (≈12/min/tab, so ~10 tabs of headroom) while cutting abuse at ~2 req/s.
	const rl = await rateLimit('admin_router_log', event.locals.user.id, 120, 60_000);
	if (!rl.allowed) return json({ entries: [], error: 'Rate limited' }, { status: 429 });

	if (!network.listRouterLog) return json({ entries: [] });
	try {
		const entries = await network.listRouterLog({ limit: 60 });
		return json({ entries });
	} catch (err) {
		// Router unreachable / api-ssl failure → capture (grouped into one Sentry Issue) and degrade.
		log.error('router log fetch failed:', err);
		return json({ entries: [], error: 'Router log unavailable' });
	}
};
