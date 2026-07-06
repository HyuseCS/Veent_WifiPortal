import { json, error, type RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { createHmac } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { customerUser, packages, paymentCheckouts } from '@veent/db';
import {
	creditCheckoutIfUnsettled,
	recordPaymentTransaction,
	captureHandled,
	RetryablePaymentError
} from '@veent/core';
import { db } from '$lib/server/db';
import { payments } from '$lib/server/payments';
import { rateLimit, clientIp } from '$lib/server/rateLimit';

/**
 * Salted, truncated fingerprint of a sensitive value (buyer email, client IP, internal user id)
 * for fraud-review logs. Keeps the one signal that matters — whether the SAME value recurs across
 * unattributed events (an attack pattern) — without writing raw PII / identifiers to logs at rest.
 * HMAC with the server secret so low-entropy inputs (IPs, emails) can't be brute-forced back out
 * of the digest; null/empty stays null so "absent" is still distinguishable from "present".
 */
function fingerprint(value: string | null | undefined): string | null {
	if (!value) return null;
	const secret = env.BETTER_AUTH_SECRET || 'veent-portal-dev-secret';
	return createHmac('sha256', secret).update(value).digest('base64url').slice(0, 12);
}

/**
 * The Maya payment webhook — the source of truth for adding credits. Shared by two routes:
 *   - POST /api/webhooks/payment                 (direct Maya → us; local dev with ngrok)
 *   - POST /api/webhooks/maya/payment-status     (Maya → Veent DO relay → us; production)
 * Both are identical: the DO forwards Maya's event verbatim (plus its own harmless `__ow_*`
 * keys), and this handler re-verifies against Maya regardless of who delivered it.
 *
 * Verifies the event authoritatively (provider.verifyWebhook re-fetches the payment from
 * the gateway with the secret key and trusts THAT, not the unsigned webhook body; throws on
 * any mismatch/lookup failure), records EVERY event (success and failure) in
 * payment_transactions for the admin Finance page, then credits the buyer's balance EXACTLY
 * ONCE — addCredits is idempotent on the gateway transaction id, so retried webhooks can't
 * double-credit (business rule #3). Crediting goes through creditCheckoutIfUnsettled, which
 * claims the matching payment_checkouts row so the webhook and the reconcile safety net can
 * never both credit the same payment.
 *
 * `referenceId` is the value we set at checkout: a 32-hex per-attempt nonce.
 */
export async function handlePaymentWebhook(event: RequestEvent): Promise<Response> {
	// Per-IP flood cap. Every call triggers an outbound authoritative re-fetch to Maya, so
	// this blunts request-amplification abuse. Deliberately generous (120/min/IP) — far above
	// any real Maya webhook volume from a single source, so legit events are never dropped.
	// NOTE: behind the Veent DO relay, the DO strips Maya's IP and forwards over the site's ngrok
	// tunnel, so the source seen here is the local tunnel peer — one bucket for the endpoint. That
	// is an acceptable global bound for a single site (120 events/min ≫ real payment volume), and
	// the DO can't preserve Maya's IP anyway, so there is no true source to key on or log.
	const flood = await rateLimit('payment_webhook_ip', clientIp(event), 120, 60_000);
	if (!flood.allowed) error(429, 'Too many requests');

	const raw = await event.request.text();

	let evt;
	try {
		evt = await payments.verifyWebhook(raw, event.request.headers);
	} catch (e) {
		// Distinguish a TRANSIENT upstream failure (Maya timeout / network error / 5xx re-fetch)
		// from a PERMANENT bad request (spoofed/garbled body, unknown payment id). Mapping every
		// failure to 400 wrongly tells the gateway "give up" on a payment that may be real — so a
		// retryable error returns 5xx (gateway retries delivery) while a malformed body stays 400
		// (retrying it would fail identically). The reconcile safety net still backs both cases.
		const retryable = e instanceof RetryablePaymentError;
		// Observability: surface verification failures — a spike in either is worth alerting on.
		console.warn(
			`[webhook] verification failed (${retryable ? 'retryable' : 'permanent'}):`,
			(e as Error).message
		);
		// Money-path failure → capture as error so it's alertable. scrubEvent masks any buyer PII
		// in the error before send.
		captureHandled(e, {
			level: 'error',
			tags: { area: 'payment', scope: 'webhook', retryable: String(retryable) }
		});
		// Keep the detail in the server log only — don't reflect internal/gateway error text to an
		// unauthenticated caller (info disclosure / payment-id probing aid).
		if (retryable) error(502, 'Upstream verification unavailable');
		error(400, 'Webhook verification failed');
	}

	// Resolve the buyer from the pending checkout we recorded at creation — referenceId is
	// a short token (Maya caps it at 36 chars), so the buyer isn't encoded in the string.
	// A reference with no matching checkout row (e.g. foreign webhooks on shared sandbox
	// keys, or a forged reference) stays UNATTRIBUTED — recorded for Finance, not credited —
	// rather than 500ing. Crediting itself additionally requires the checkout row (and a
	// matching amount) inside creditCheckoutIfUnsettled, so attribution alone never credits.
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
		// Fraud-review signal: a *paid* event under our Maya account that maps to no live
		// checkout/user/package is anomalous (forged reference, foreign webhook on shared
		// sandbox keys, or a deleted user/package after the fact). Log full context — but
		// NEVER credit. A spike here is worth alerting on. We log identifiers, not card data
		// (only the gateway's masked fund source, which carries no full PAN).
		console.warn('[webhook] UNATTRIBUTED paid event — recorded, not credited', {
			txId: evt.externalTransactionId,
			referenceId: evt.referenceId, // random 32-hex nonce — no PII
			amountMinor: evt.amountMinor,
			currency: evt.currency,
			// Why each leg failed attribution, so the alert points at the cause. Sensitive legs are
			// fingerprinted (correlation, no raw value) or reduced to presence — never logged raw.
			hadCheckoutRow: !!co,
			refUserFp: fingerprint(refUserId),
			hadRefPackage: refPackageId !== null,
			userExists,
			pkgExists,
			fundSourceType: evt.fundSourceType ?? null,
			fundSourceMasked: evt.fundSourceMasked ?? null,
			buyerEmailFp: fingerprint(evt.buyerEmail),
			receiptNo: evt.receiptNo ?? null,
			ipFp: fingerprint(clientIp(event))
		});
		// B2.2: page immediately on any unattributed *paid* event — count 1, not volume-based. The
		// 200-ack above stays (deliberate anti-500 design; remediation is a manual refund/credit).
		// Non-PII fields only — scrubEvent runs again on send.
		captureHandled(new Error('unattributed paid event'), {
			level: 'error',
			tags: { area: 'payment', scope: 'attribution' },
			extra: {
				txId: evt.externalTransactionId,
				amountMinor: evt.amountMinor,
				hadCheckoutRow: !!co,
				userExists,
				pkgExists
			}
		});
		return json({ ok: true, recorded: true, credited: false, reason: 'unattributed' });
	}

	// Credit through the shared claim path: it atomically claims the matching checkout
	// (by referenceId, unique per attempt) so the webhook and the reconcile safety net
	// can't both credit. Idempotent on the gateway txn id as a second guard.
	const result = await creditCheckoutIfUnsettled(db, {
		referenceId: evt.referenceId,
		userId: attributedUserId,
		packageId: attributedPackageId,
		externalTransactionId: evt.externalTransactionId,
		amountMinor: evt.amountMinor
	});

	// Observability: one structured line per paid event — feeds webhook success-rate tracking.
	// `credited: false` here means an idempotent replay (already credited), not a failure.
	console.info('[webhook] paid', { txId: evt.externalTransactionId, credited: result.credited });

	return json({ ok: true, credited: result.credited, balance: result.balance });
}
