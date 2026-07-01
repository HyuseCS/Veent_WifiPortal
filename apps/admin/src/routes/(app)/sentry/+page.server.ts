import { fail, type RequestEvent } from '@sveltejs/kit';
import { requireOwner } from '$lib/server/auth-guard';
import { logger } from '$lib/server/logger';
import { clientIp, rateLimit } from '$lib/server/rateLimit';
import { getDashboard, ignoreIssue, isSentryConfigured, resolveIssue } from '$lib/server/sentry';
import type { Actions, PageServerLoad } from './$types';

const log = logger('sentry');

/** Thin: delegate to the facade. Unconfigured → an EmptyState on the page, never a 500. */
export const load: PageServerLoad = async () => {
	if (!isSentryConfigured()) return { configured: false as const };
	return getDashboard();
};

/** Shared owner + rate-limit + id-parse guard for both mutations; runs the given Sentry call. */
async function mutate(event: RequestEvent, action: string, run: (id: string) => Promise<void>) {
	// Re-assert owner from the DB (loads don't run on POST) — a just-demoted owner is blocked here.
	const denied = await requireOwner(event.locals.user?.id, 'Only the owner can manage Sentry issues.');
	if (denied) return denied;

	const rl = await rateLimit('admin_sentry_mutate', clientIp(event), 30, 15 * 60 * 1000);
	if (!rl.allowed) return fail(429, { action, error: 'Too many attempts. Please wait a few minutes.' });

	const id = String((await event.request.formData()).get('id') ?? '').trim();
	if (!id) return fail(400, { action, error: 'Missing issue id.' });

	try {
		await run(id);
		return { action, ok: true };
	} catch (err) {
		log.error(`${action} failed`, err);
		return fail(502, { action, error: 'Sentry request failed. Try again.' });
	}
}

export const actions: Actions = {
	resolve: (event) => mutate(event, 'resolve', resolveIssue),
	ignore: (event) => mutate(event, 'ignore', ignoreIssue)
};
