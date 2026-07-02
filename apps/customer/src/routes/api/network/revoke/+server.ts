import { json } from '@sveltejs/kit';
import { expireDueAccounts, reconcileGuestBindings, sweepCheckoutAccess } from '@veent/core';
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

	const revoked = await expireDueAccounts(db, network);
	// Then sweep router bindings the DB no longer backs (wipe/cascade/crash orphans).
	const reconciled = await reconcileGuestBindings(db, network);
	// Reclaim expired per-device checkout walled-garden allows (the reCAPTCHA scoping) so an
	// abandoned checkout can't leave google.com open on an IP that DHCP later hands to another
	// device. Self-describing on the router (comment-stamped), so no DB state to reconcile.
	const sweptCheckoutAccess = await sweepCheckoutAccess(network);
	return json({ ok: true, revoked, reconciled, sweptCheckoutAccess });
};
