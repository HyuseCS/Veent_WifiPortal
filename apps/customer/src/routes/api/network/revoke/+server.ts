import { json } from '@sveltejs/kit';
import * as Sentry from '@sentry/sveltekit';
import { expireDueAccounts, reconcileGuestBindings } from '@veent/core';
import { db } from '$lib/server/db';
import { network } from '$lib/server/network';
import { requireCron } from '$lib/server/cron';
import type { RequestHandler } from './$types';

/**
 * POST /api/network/revoke — cron-callable. Finds accounts whose access window is
 * up, re-blocks ALL their bound device MACs on the controller, and marks them expired.
 *
 * Auth: shared secret in the `x-cron-secret` header (set CRON_SECRET in env), plus an
 * optional source-IP allowlist (`CRON_IP_ALLOWLIST`). Run from a scheduler every minute,
 * OR rely on the router's hardware timeout and use this as a reconciler.
 */
export const POST: RequestHandler = async (event) => {
	requireCron(event);

	// Sentry cron check-in: makes a DEAD scheduler detectable ("the cron never ran"), which the
	// endpoint's own error coverage can't see. No-op passthrough when Sentry isn't initialised; a
	// throw still fails the check-in AND bubbles to handleError (deliberately no swallowing catch).
	return Sentry.withMonitor(
		'customer-network-revoke',
		async () => {
			const revoked = await expireDueAccounts(db, network);
			// Then sweep router bindings the DB no longer backs (wipe/cascade/crash orphans).
			const reconciled = await reconcileGuestBindings(db, network);
			return json({ ok: true, revoked, reconciled });
		},
		{
			schedule: { type: 'crontab', value: '* * * * *' },
			checkinMargin: 5,
			maxRuntime: 5,
			timezone: 'UTC'
		}
	);
};
