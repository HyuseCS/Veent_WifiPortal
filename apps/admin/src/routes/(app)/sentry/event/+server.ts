import { error, json, type RequestEvent } from '@sveltejs/kit';
import { logger } from '$lib/server/logger';
import { clientIp, rateLimit } from '$lib/server/rateLimit';
import { getIssueEvent, isSentryConfigured } from '$lib/server/sentry';
import type { RequestHandler } from './$types';

const log = logger('sentry');

/**
 * Latest-event detail for one issue — the row-open modal fetches `?id=<issueId>` here. Endpoints
 * don't run the page load, so we re-assert auth: hooks.server.ts only sets locals.user for ACTIVE
 * staff, so its presence IS the authorization (same gate as the resolve/ignore actions). Returns a
 * narrowed view model — the raw Sentry payload and the auth token never reach the browser.
 */
export const GET: RequestHandler = async (event: RequestEvent) => {
	if (!event.locals.user?.id) throw error(401, 'Not signed in.');
	if (!isSentryConfigured()) throw error(503, 'Sentry API not configured.');

	const rl = await rateLimit('admin_sentry_event', clientIp(event), 60, 15 * 60 * 1000);
	if (!rl.allowed) throw error(429, 'Too many requests. Please wait a few minutes.');

	const id = event.url.searchParams.get('id')?.trim();
	if (!id) throw error(400, 'Missing issue id.');

	try {
		// Stack traces / event metadata are sensitive — keep them out of any shared/proxy cache.
		return json(await getIssueEvent(id), { headers: { 'cache-control': 'no-store' } });
	} catch (err) {
		log.error('event fetch failed', err);
		throw error(502, 'Sentry request failed.');
	}
};
