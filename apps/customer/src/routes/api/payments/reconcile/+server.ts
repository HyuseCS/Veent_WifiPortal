import { json } from '@sveltejs/kit';
import { reconcilePendingPayments } from '@veent/core';
import { db } from '$lib/server/db';
import { payments } from '$lib/server/payments';
import { requireCron } from '$lib/server/cron';
import type { RequestHandler } from './$types';

/**
 * POST /api/payments/reconcile — cron-callable safety net for missed webhooks.
 *
 * Polls the gateway for every pending checkout old enough that its webhook has had a
 * chance, and credits any that actually paid (idempotent — coordinates with the webhook
 * via the payment_checkouts claim, so it can never double-credit). Catches the case the
 * on-return poll can't: the buyer paid and never came back to the processing page.
 *
 * Auth: shared secret in the `x-cron-secret` header (set CRON_SECRET in env) — same
 * convention as the revoke cron. Point a scheduler at it, e.g. every minute:
 *   * * * * * curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" http://127.0.0.1:5173/api/payments/reconcile
 */
export const POST: RequestHandler = async (event) => {
	requireCron(event);

	const result = await reconcilePendingPayments(db, payments);
	return json({ ok: true, ...result });
};
