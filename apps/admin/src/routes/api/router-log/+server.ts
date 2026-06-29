import { json, error } from '@sveltejs/kit';
import { network } from '$lib/server/network';
import type { RequestHandler } from './$types';

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
	if (!network.listRouterLog) return json({ entries: [] });
	try {
		const entries = await network.listRouterLog({ limit: 60 });
		return json({ entries });
	} catch (err) {
		console.error('[admin] router log fetch failed:', err);
		return json({ entries: [], error: 'Router log unavailable' });
	}
};
