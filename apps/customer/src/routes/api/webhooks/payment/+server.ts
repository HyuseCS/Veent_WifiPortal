import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { customerUser, packages, paymentCheckouts, paymentTransactions } from '@veent/db';
import { creditCheckoutIfUnsettled } from '@veent/core';
import { db } from '$lib/server/db';
import { payments } from '$lib/server/payments';
import type { RequestHandler } from './$types';

const STATUS_DB: Record<string, string> = {
	paid: 'PAYMENT_SUCCESS',
	failed: 'PAYMENT_FAILED',
	expired: 'PAYMENT_EXPIRED',
	cancelled: 'PAYMENT_CANCELLED',
	pending: 'PAYMENT_PENDING'
};

/**
 * POST /api/webhooks/payment — the source of truth for adding credits.
 *
 * Verifies the gateway signature (provider.verifyWebhook throws if invalid),
 * records EVERY event (success and failure) in payment_transactions for the admin
 * Finance page, then credits the buyer's balance EXACTLY ONCE — addCredits is
 * idempotent on the gateway transaction id, so retried webhooks can't double-credit
 * (business rule #3). Crediting goes through creditCheckoutIfUnsettled, which claims
 * the matching payment_checkouts row so the webhook and the reconcile safety net can
 * never both credit the same payment.
 *
 * `referenceId` is the value we set at checkout: `${userId}:${packageId}:${nonce}`.
 */
export const POST: RequestHandler = async (event) => {
	const raw = await event.request.text();

	let evt;
	try {
		evt = await payments.verifyWebhook(raw, event.request.headers);
	} catch (e) {
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
				.select({ userId: paymentCheckouts.userId, packageId: paymentCheckouts.packageId })
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

	// Record the event for Finance reporting. onConflictDoUpdate (NOT DoNothing): Maya
	// can resend or send a later status transition for the same tx id, and we must keep
	// the latest state, not freeze the first one seen.
	const txRow = {
		id: evt.externalTransactionId,
		status: STATUS_DB[evt.status] ?? evt.status.toUpperCase(),
		amount: String(evt.amountMinor / 100),
		currency: evt.currency,
		fundSourceType: evt.fundSourceType ?? null,
		fundSourceMasked: evt.fundSourceMasked ?? null,
		receiptNo: evt.receiptNo ?? null,
		referenceNo: evt.referenceNo ?? null,
		errorCode: evt.errorCode ?? null,
		errorMessage: evt.errorMessage ?? null,
		buyerName: evt.buyerName ?? null,
		buyerEmail: evt.buyerEmail ?? null,
		userId: attributedUserId,
		packageId: attributedPackageId
	};
	await db
		.insert(paymentTransactions)
		.values(txRow)
		.onConflictDoUpdate({
			target: paymentTransactions.id,
			set: {
				status: txRow.status,
				amount: txRow.amount,
				fundSourceType: txRow.fundSourceType,
				fundSourceMasked: txRow.fundSourceMasked,
				receiptNo: txRow.receiptNo,
				errorCode: txRow.errorCode,
				errorMessage: txRow.errorMessage
			}
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

	return json({ ok: true, credited: result.credited, balance: result.balance });
};
