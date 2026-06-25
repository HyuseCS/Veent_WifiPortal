import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { customerUser, packages, paymentCheckouts } from '@veent/db';
import { creditCheckoutIfUnsettled, recordPaymentTransaction } from '@veent/core';
import { db } from '$lib/server/db';
import { payments } from '$lib/server/payments';
import { rateLimit, clientIp } from '$lib/server/rateLimit';
import type { RequestHandler } from './$types';

/**
 * POST /api/webhooks/payment — the source of truth for adding credits.
 *
 * Verifies the event authoritatively (provider.verifyWebhook re-fetches the payment from
 * the gateway with the secret key and trusts THAT, not the unsigned webhook body; throws on
 * any mismatch/lookup failure), records EVERY event (success and failure) in
 * payment_transactions for the admin
 * Finance page, then credits the buyer's balance EXACTLY ONCE — addCredits is
 * idempotent on the gateway transaction id, so retried webhooks can't double-credit
 * (business rule #3). Crediting goes through creditCheckoutIfUnsettled, which claims
 * the matching payment_checkouts row so the webhook and the reconcile safety net can
 * never both credit the same payment.
 *
 * `referenceId` is the value we set at checkout: `${userId}:${packageId}:${nonce}`.
 */
export const POST: RequestHandler = async (event) => {
	// Per-IP flood cap. Every call triggers an outbound authoritative re-fetch to Maya, so
	// this blunts request-amplification abuse. Deliberately generous (120/min/IP) — far above
	// any real Maya webhook volume from a single source, so legit events are never dropped.
	const flood = await rateLimit('payment_webhook_ip', clientIp(event), 120, 60_000);
	if (!flood.allowed) error(429, 'Too many requests');

	const raw = await event.request.text();

	let evt;
	try {
		evt = await payments.verifyWebhook(raw, event.request.headers);
	} catch (e) {
		// Observability: surface verification failures (spoofed/garbled events, gateway lookup
		// errors) — a spike here is a signal worth alerting on.
		console.warn('[webhook] verification failed:', (e as Error).message);
		error(400, `Webhook verification failed: ${(e as Error).message}`);
	}

	// Resolve the buyer from the pending checkout we recorded at creation — referenceId is
	// a short token (Maya caps it at 36 chars), so the buyer isn't encoded in the string.
	// Fall back to the legacy `userId:packageId` format for any in-flight pre-token
	// payments. A reference with no matching row (e.g. foreign webhooks on shared sandbox
	// keys) stays UNATTRIBUTED — recorded for Finance, not credited — rather than 500ing.
	let refUserId: string | null = null;
	let refPackageId: number | null = null;
	const ref = evt.referenceId ?? '';
	const [co] = ref
		? await db
				.select({
					userId: paymentCheckouts.userId,
					packageId: paymentCheckouts.packageId,
					networkId: paymentCheckouts.networkId
				})
				.from(paymentCheckouts)
				.where(eq(paymentCheckouts.referenceId, ref))
				.limit(1)
		: [];
	if (co) {
		refUserId = co.userId;
		refPackageId = co.packageId;
	} else if (ref.includes(':')) {
		const [u, p] = ref.split(':');
		refUserId = u || null;
		refPackageId = Number(p) || null;
	}

	const userExists =
		!!refUserId &&
		(
			await db
				.select({ id: customerUser.id })
				.from(customerUser)
				.where(eq(customerUser.id, refUserId))
				.limit(1)
		).length > 0;
	const pkgExists =
		refPackageId !== null &&
		(await db.select({ id: packages.id }).from(packages).where(eq(packages.id, refPackageId)).limit(1))
			.length > 0;
	const attributedUserId = userExists ? refUserId : null;
	const attributedPackageId = pkgExists ? refPackageId : null;

	// Record the event for Finance reporting (the shared recorder upserts, so a Maya resend
	// or a later status transition keeps the latest state). The reconcile safety nets call
	// the SAME recorder, so a payment that settles without a webhook still lands here.
	// networkId is the AP captured at checkout — carried onto every event (incl. failures)
	// so Finance can report the full funnel by AP; null for a foreign webhook with no checkout.
	await recordPaymentTransaction(db, evt, {
		userId: attributedUserId,
		packageId: attributedPackageId,
		networkId: co?.networkId ?? null
	});

	// Only successful payments add credits; others are recorded above and acknowledged.
	if (evt.status !== 'paid') return json({ ok: true, ignored: true, status: evt.status });

	// A paid event we can't attribute to a live user + package can't be credited (the
	// ledger FKs would throw). It's already recorded above for Finance — acknowledge so
	// Maya stops retrying, rather than 500ing on a payment that genuinely has no owner.
	if (!attributedUserId || attributedPackageId === null) {
		return json({ ok: true, recorded: true, credited: false, reason: 'unattributed' });
	}

	// Credit through the shared claim path: it atomically claims the matching checkout
	// (by referenceId, unique per attempt) so the webhook and the reconcile safety net
	// can't both credit. Idempotent on the gateway txn id as a second guard.
	const result = await creditCheckoutIfUnsettled(db, {
		referenceId: evt.referenceId,
		userId: attributedUserId,
		packageId: attributedPackageId,
		externalTransactionId: evt.externalTransactionId
	});

	// Observability: one structured line per paid event — feeds webhook success-rate tracking.
	// `credited: false` here means an idempotent replay (already credited), not a failure.
	console.info('[webhook] paid', { txId: evt.externalTransactionId, credited: result.credited });

	return json({ ok: true, credited: result.credited, balance: result.balance });
};
