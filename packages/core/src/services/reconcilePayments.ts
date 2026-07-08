import { and, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { type DB, paymentCheckouts, paymentTransactions, packages } from '@veent/db';
import { LEDGER_TYPE, SETTLEMENT_CURRENCY } from '../config';
import type { PaymentEvent, PaymentProvider } from '../integrations/payments';
import { addCreditsTx } from './credits';
import { earnPointsTx } from './points';
import { getSessionLimits } from './settings';
import { captureHandled } from '../observability';

/** Normalized PaymentEvent.status → the raw gateway status we persist for Finance. */
const STATUS_DB: Record<string, string> = {
	paid: 'PAYMENT_SUCCESS',
	failed: 'PAYMENT_FAILED',
	expired: 'PAYMENT_EXPIRED',
	cancelled: 'PAYMENT_CANCELLED',
	pending: 'PAYMENT_PENDING'
};

/** Where a recorded payment is attributed (resolved from the matching checkout). */
export interface PaymentAttribution {
	userId: string | null;
	packageId: number | null;
	networkId: number | null;
}

/**
 * Upsert a gateway event into payment_transactions (the Finance record). Shared by the
 * webhook AND the reconcile safety nets, so a payment that settles WITHOUT a webhook — local
 * dev (Maya can't POST to localhost), or a missed/late prod webhook caught by the on-return
 * poll or cron — still appears in Finance, not just in credit_ledger. Idempotent:
 * onConflictDoUpdate keeps the latest status/detail when a webhook later enriches a row a
 * reconcile pass recorded first. network_id is INSERT-only (left out of the update set) — the
 * location is fixed at checkout and must not be overwritten by a later event.
 */
export async function recordPaymentTransaction(
	db: DB,
	evt: PaymentEvent,
	attribution: PaymentAttribution
): Promise<void> {
	const row = {
		id: evt.externalTransactionId,
		status: STATUS_DB[evt.status] ?? evt.status.toUpperCase(),
		// A garbled/missing gateway amount arrives as NaN (maya.toMinor) so the credit path
		// refuses it; record 0 rather than writing 'NaN' into the numeric Finance column.
		amount: String(Number.isFinite(evt.amountMinor) ? evt.amountMinor / 100 : 0),
		currency: evt.currency,
		fundSourceType: evt.fundSourceType ?? null,
		fundSourceMasked: evt.fundSourceMasked ?? null,
		receiptNo: evt.receiptNo ?? null,
		referenceNo: evt.referenceNo ?? null,
		errorCode: evt.errorCode ?? null,
		errorMessage: evt.errorMessage ?? null,
		buyerName: evt.buyerName ?? null,
		buyerEmail: evt.buyerEmail ?? null,
		userId: attribution.userId,
		packageId: attribution.packageId,
		networkId: attribution.networkId
	};
	// Gateway-supplied detail a later event (Maya resend or a PENDING→SUCCESS transition) may
	// legitimately backfill. Shared by the id-conflict upsert and the referenceNo dedupe below.
	const detail = {
		status: row.status,
		amount: row.amount,
		currency: row.currency,
		fundSourceType: row.fundSourceType,
		fundSourceMasked: row.fundSourceMasked,
		receiptNo: row.receiptNo,
		referenceNo: row.referenceNo,
		errorCode: row.errorCode,
		errorMessage: row.errorMessage,
		buyerName: row.buyerName,
		buyerEmail: row.buyerEmail
	};

	// Finance reporting integrity: ONE Maya payment can reach here via two paths under DIFFERENT
	// gateway ids — the webhook keys on the payment id, while the on-return poll / reconcile cron
	// may fall back to the checkout id when Maya doesn't surface the payment id. Left unchecked
	// that writes two PAYMENT_SUCCESS rows for one payment and double-counts "settled revenue".
	// Both paths carry the SAME referenceNo (requestReferenceNumber / our referenceId echo), so a
	// partial unique index on reference_no (payment_transactions_reference_no_key) lets Postgres
	// reject the divergent duplicate atomically — closing the simultaneous-insert race a prior
	// select-then-update couldn't. (One Maya checkout = one referenceNo = one terminal payment.)
	// NEVER downgrade a terminal SUCCESS. Maya issues MULTIPLE payment ids under one RRN (a card
	// fails, the buyer retries, it succeeds — see fetchPaymentByRrn's [fail, ok] handling), and
	// webhook delivery isn't ordered, so a late FAILED event can arrive after the SUCCESS is already
	// recorded. Guard both write paths: skip the update when it would overwrite a PAYMENT_SUCCESS row
	// with a non-success status. (The buyer is credited via the independent claim regardless; this
	// protects Finance reporting from a paid txn flipping to "failed".)
	const noDowngrade = sql`NOT (${paymentTransactions.status} = ${STATUS_DB.paid} AND ${row.status} <> ${STATUS_DB.paid})`;
	try {
		await db
			.insert(paymentTransactions)
			.values(row)
			.onConflictDoUpdate({
				target: paymentTransactions.id,
				// Keep the latest detail when Maya resends or a later status transition (e.g.
				// PENDING→SUCCESS) enriches a row a reconcile pass recorded first. networkId and
				// the userId/packageId attribution stay INSERT-only (fixed at first record); the
				// gateway-supplied detail is what a transition can legitimately backfill.
				set: detail,
				setWhere: noDowngrade
			});
	} catch (e) {
		// 23505 = unique_violation: the same payment arrived under a DIFFERENT id and tripped the
		// reference_no index (the id-conflict clause above only catches same-id resends). Collapse
		// onto the existing row instead of writing a divergent duplicate. All callers pass `db`
		// (never a tx), so the failed INSERT doesn't poison a surrounding transaction.
		// drizzle-orm wraps driver errors in DrizzleQueryError, so the SQLSTATE lives on the
		// cause chain — walk it (bounded), keeping the bare .code shape for driver-direct errors.
		const err = e as { code?: string; cause?: { code?: string; cause?: { code?: string } } };
		const pgCode = err.code ?? err.cause?.code ?? err.cause?.cause?.code;
		if (row.referenceNo && pgCode === '23505') {
			await db
				.update(paymentTransactions)
				.set(detail)
				.where(and(eq(paymentTransactions.referenceNo, row.referenceNo), noDowngrade));
			return;
		}
		throw e;
	}
}

/**
 * Payment reconciliation — the SAFETY NET behind the webhook.
 *
 * Crediting is gated by an ATOMIC claim on payment_checkouts.status ({pending,expired}→settled):
 * whichever path wins the claim credits, the other no-ops. So the webhook and these
 * reconcile paths can race freely without ever double-crediting (addCredits idempotency
 * on external_transaction_id is the second line of defence). The claim AND the credit run
 * inside ONE db.transaction, so a crash/throw between them rolls the claim back and the
 * next pass retries — a checkout is never marked settled without the credit landing.
 */

/** Why a credit attempt did not result in a new ledger entry (for the caller / logs). */
export type CreditSkipReason =
	| 'no_checkout'
	| 'already_settled'
	| 'amount_mismatch'
	| 'currency_mismatch'
	| 'unknown_package';

/**
 * A settled-but-uncredited money mismatch (I-1). Buyer paid the gateway but the charge doesn't
 * match the checkout (wrong amount or wrong currency), so we keep the claim to stop retries but
 * do NOT credit. These strand funds and need manual remediation, so alert (not just log): a Sentry
 * issue tagged area=payment scope=credit drives the refund runbook
 * (docs/runbooks/payment-credit-mismatch.md). All fields are non-PII.
 */
function reportCreditMismatch(
	reason: 'amount_mismatch' | 'currency_mismatch',
	ctx: {
		checkoutId: string;
		externalTransactionId: string;
		expectedMinor: number;
		gotMinor: number;
		currency: string;
	}
): void {
	console.warn(`[credit] ${reason} — refusing to credit`, ctx);
	captureHandled(new Error(`credit ${reason}`), {
		level: 'error',
		tags: { area: 'payment', scope: 'credit', reason },
		extra: ctx
	});
}

interface CreditArgs {
	/** Match the checkout by gateway id (reconcile) or by referenceId (webhook). */
	checkoutId?: string;
	referenceId?: string;
	userId: string;
	packageId: number;
	externalTransactionId: string;
	/**
	 * The amount the gateway actually charged (minor units). Asserted against the checkout's
	 * recorded amount before crediting — a mismatch (underpayment, partial capture, a fiatCost
	 * edited under a stale checkout) must NOT credit.
	 */
	amountMinor: number;
	/**
	 * The currency the gateway charged in. Asserted == SETTLEMENT_CURRENCY before crediting (L-3):
	 * checkouts are PHP-only, so a non-PHP charge can't be credited even if its minor amount matches.
	 */
	currency: string;
}

/**
 * Claim the matching unsettled checkout and credit the buyer exactly once.
 *
 * Crediting now REQUIRES a matching payment_checkouts row whose recorded amount equals the
 * amount the gateway charged. A reference with no checkout row is NOT credited (the per-attempt
 * nonce + amount on that row are the binding that makes a paid event trustworthy); an amount
 * mismatch is settled-but-not-credited and flagged. If the row is already settled, no-ops.
 */
export async function creditCheckoutIfUnsettled(
	db: DB,
	args: CreditArgs
): Promise<{ credited: boolean; balance?: number; reason?: CreditSkipReason }> {
	// A non-finite gateway amount means we couldn't determine what was charged (a parse/transient
	// issue — e.g. Maya returned no amount), NOT a real underpayment. Refuse to touch the checkout
	// at all: do NOT claim/settle it, so it stays `pending` and a later reconcile pass or the
	// webhook can retry with a good amount — instead of trapping it settled-but-uncredited (which
	// would make the recovered webhook return `already_settled` and lose the credit forever). Throw
	// so the caller retries: reconcile catches + leaves pending; the webhook 500s → Maya re-delivers.
	if (!Number.isFinite(args.amountMinor)) {
		throw new Error(
			`credit: refusing to settle checkout with a non-finite gateway amount (ref=${args.referenceId ?? args.checkoutId ?? 'unknown'})`
		);
	}

	const match = args.checkoutId
		? eq(paymentCheckouts.id, args.checkoutId)
		: eq(paymentCheckouts.referenceId, args.referenceId ?? '');

	// Admin-tunable points earn rate (cached, non-throwing). Read before the tx so the credit path
	// never blocks on it; 0 disables earning.
	const { pointsEarnRate } = await getSessionLimits(db);

	return db.transaction(async (tx) => {
		// Atomic claim: flip {pending,expired}→settled, returning the checkout's recorded amount
		// so we can assert the gateway charged what we asked. Postgres serializes the UPDATE, so
		// under a webhook/reconcile race exactly one caller gets a row back — only it credits.
		// 'expired' is claimable because the cron blind-expires aged pendings without asking the
		// gateway — it's an administrative stop-polling state, not a money state. A late paid
		// event carries the same gateway-verified proof as pending→settled and must still credit.
		const [claimed] = await tx
			.update(paymentCheckouts)
			.set({ status: 'settled', settledAt: new Date(), externalTransactionId: args.externalTransactionId })
			.where(and(match, inArray(paymentCheckouts.status, ['pending', 'expired'])))
			.returning({ id: paymentCheckouts.id, amount: paymentCheckouts.amount });

		if (!claimed) {
			// Didn't win the claim: either already settled (a prior pass credited — skip), or NO
			// checkout row exists at all. We no longer credit checkout-less payments — a paid event
			// with no matching checkout is recorded for Finance (by the caller) but never credited.
			const [exists] = await tx
				.select({ id: paymentCheckouts.id })
				.from(paymentCheckouts)
				.where(match)
				.limit(1);
			return { credited: false, reason: exists ? 'already_settled' : 'no_checkout' };
		}

		// Amount + currency integrity. A GENUINE terminal mismatch keeps the claim (settled) to stop
		// retries but does NOT credit, and is alerted for manual remediation. This differs from the
		// non-finite-amount case (rejected BEFORE the claim, stays `pending` -> auto-retried): that is
		// indeterminate (we don't know what was charged), whereas a wrong-but-known amount/currency is
		// determinate (we know it's wrong) -- re-polling reads the same value, so leaving it pending
		// would just re-alert every pass.
		const expectedMinor = Math.round(Number(claimed.amount) * 100);
		const mismatchCtx = {
			checkoutId: claimed.id,
			externalTransactionId: args.externalTransactionId,
			expectedMinor,
			gotMinor: args.amountMinor,
			currency: args.currency
		};
		// Currency first (L-3): a foreign-currency amount could numerically coincide with expectedMinor
		// and slip the amount check, so reject a non-PHP settlement before comparing amounts.
		if (args.currency.toUpperCase() !== SETTLEMENT_CURRENCY) {
			reportCreditMismatch('currency_mismatch', mismatchCtx);
			return { credited: false, reason: 'currency_mismatch' };
		}
		if (args.amountMinor !== expectedMinor) {
			reportCreditMismatch('amount_mismatch', mismatchCtx);
			return { credited: false, reason: 'amount_mismatch' };
		}

		const [pkg] = await tx
			.select({ credits: packages.creditsProvided })
			.from(packages)
			.where(eq(packages.id, args.packageId))
			.limit(1);
		if (!pkg) {
			// FK on payment_checkouts.package_id means this shouldn't happen; keep settled, no credit.
			console.warn('[credit] checkout references unknown package', { packageId: args.packageId });
			return { credited: false, reason: 'unknown_package' };
		}

		// Same transaction as the claim: if this throws, the claim rolls back and the next pass
		// retries — never settled-but-uncredited. addCredits idempotency is the second guard.
		const result = await addCreditsTx(tx, {
			userId: args.userId,
			amount: pkg.credits ?? 0,
			type: LEDGER_TYPE.topup,
			packageId: args.packageId,
			externalTransactionId: args.externalTransactionId
		});

		// Award loyalty points in the SAME transaction as the credit — points are earned ONLY on a
		// verified, credited top-up, and if this throws the whole claim rolls back. Idempotent on
		// externalTransactionId (its own unique guard), so a retried webhook can't double-earn.
		// Based on the validated charged amount (expectedMinor), not the package's credit count.
		const points = Math.floor((expectedMinor / 100) * (pointsEarnRate / 100));
		if (points > 0) {
			await earnPointsTx(tx, {
				userId: args.userId,
				packageId: args.packageId,
				amount: points,
				externalTransactionId: args.externalTransactionId
			});
		}

		return { credited: result.credited, balance: result.balance };
	});
}

/** Mark a pending checkout as finished-unpaid (failed/expired/cancelled). */
async function markUnpaid(db: DB, checkoutId: string, status: 'failed' | 'expired') {
	await db
		.update(paymentCheckouts)
		.set({ status, settledAt: new Date() })
		.where(and(eq(paymentCheckouts.id, checkoutId), eq(paymentCheckouts.status, 'pending')));
}

/**
 * Resolve a checkout's authoritative gateway status, PREFERRING the by-reference (RRN) lookup: it
 * resolves the payment from the reference WE set at checkout, needing neither an inbound webhook
 * nor the gateway's checkout→payment mapping — so it credits even if the relay/tunnel never
 * recovers. Falls back to the by-checkout-id status for providers that only offer that.
 */
function resolvePaymentStatus(
	payments: PaymentProvider,
	checkoutId: string,
	referenceId: string | null | undefined
): Promise<PaymentEvent | null> {
	if (payments.getPaymentByReference && referenceId) return payments.getPaymentByReference(referenceId);
	if (payments.getCheckoutStatus) return payments.getCheckoutStatus(checkoutId);
	return Promise.resolve(null);
}

/**
 * Cron pass: poll the gateway for every pending checkout old enough that the webhook
 * has had its chance, and credit any that are actually paid. Catches missed webhooks
 * even when the buyer never returned to the processing page. Bounded both ways: skips
 * very fresh checkouts (give the webhook a head start) and stops chasing very old ones.
 */
export async function reconcilePendingPayments(
	db: DB,
	payments: PaymentProvider,
	opts: { minAgeMs?: number; maxAgeMs?: number } = {}
): Promise<{ checked: number; credited: number }> {
	if (!payments.getPaymentByReference && !payments.getCheckoutStatus) return { checked: 0, credited: 0 };
	const now = Date.now();
	const minAge = new Date(now - (opts.minAgeMs ?? 90_000)); // webhook head start
	const maxAge = new Date(now - (opts.maxAgeMs ?? 24 * 60 * 60 * 1000)); // stop after a day

	const pending = await db
		.select({
			id: paymentCheckouts.id,
			referenceId: paymentCheckouts.referenceId,
			userId: paymentCheckouts.userId,
			packageId: paymentCheckouts.packageId,
			networkId: paymentCheckouts.networkId
		})
		.from(paymentCheckouts)
		.where(
			and(
				eq(paymentCheckouts.status, 'pending'),
				lte(paymentCheckouts.createdAt, minAge),
				gt(paymentCheckouts.createdAt, maxAge)
			)
		);

	let credited = 0;
	for (const c of pending) {
		try {
			const evt = await resolvePaymentStatus(payments, c.id, c.referenceId);
			if (!evt || evt.status === 'pending') continue;
			// Record into payment_transactions like the webhook does, so a reconcile-settled
			// payment still shows in Finance (with its checkout-time AP). Idempotent upsert.
			await recordPaymentTransaction(db, evt, {
				userId: c.userId,
				packageId: c.packageId,
				networkId: c.networkId
			});
			if (evt.status === 'paid') {
				const r = await creditCheckoutIfUnsettled(db, {
					checkoutId: c.id,
					userId: c.userId,
					packageId: c.packageId,
					externalTransactionId: evt.externalTransactionId,
					amountMinor: evt.amountMinor,
					currency: evt.currency
				});
				if (r.credited) credited++;
			} else if (evt.status === 'failed' || evt.status === 'cancelled') {
				await markUnpaid(db, c.id, 'failed');
			} else if (evt.status === 'expired') {
				await markUnpaid(db, c.id, 'expired');
			}
		} catch (err) {
			// transient (gateway/network) — leave pending, retry next pass. Capture so a Maya outage
			// blocking reconcile is visible (grouped into one Issue across the pending set).
			captureHandled(err, { level: 'error', tags: { area: 'reconcile', scope: 'cron' } });
		}
	}

	// Stop polling checkouts that aged out still pending.
	await db
		.update(paymentCheckouts)
		.set({ status: 'expired' })
		.where(and(eq(paymentCheckouts.status, 'pending'), lte(paymentCheckouts.createdAt, maxAge)));

	return { checked: pending.length, credited };
}

/**
 * On-return poll: when the buyer lands back on the processing page, verify THEIR
 * checkout with the gateway right away so a missed webhook self-heals in seconds.
 * Keyed by referenceId (what the processing page can reconstruct from the URL — the
 * gateway checkoutId isn't in the redirect). Throttled via an atomic last_polled_at
 * guard so a fast-refreshing page can't hammer the gateway: at most one gateway call
 * per `throttleMs`, and only while pending.
 */
export async function reconcileCheckout(
	db: DB,
	payments: PaymentProvider,
	referenceId: string,
	opts: { throttleMs?: number } = {}
): Promise<{ credited: boolean }> {
	if (!payments.getPaymentByReference && !payments.getCheckoutStatus) return { credited: false };
	const throttleBefore = new Date(Date.now() - (opts.throttleMs ?? 4000));

	const [claimed] = await db
		.update(paymentCheckouts)
		.set({ lastPolledAt: new Date() })
		.where(
			and(
				eq(paymentCheckouts.referenceId, referenceId),
				eq(paymentCheckouts.status, 'pending'),
				or(isNull(paymentCheckouts.lastPolledAt), lte(paymentCheckouts.lastPolledAt, throttleBefore))
			)
		)
		.returning({
			id: paymentCheckouts.id,
			userId: paymentCheckouts.userId,
			packageId: paymentCheckouts.packageId,
			networkId: paymentCheckouts.networkId
		});
	if (!claimed) return { credited: false }; // settled already, or polled too recently

	try {
		const evt = await resolvePaymentStatus(payments, claimed.id, referenceId);
		// Record into payment_transactions like the webhook does, so a payment that settles
		// via this poll (the usual path in local dev, where Maya can't reach localhost) still
		// shows in Finance with its checkout-time AP. Idempotent upsert.
		if (evt && evt.status !== 'pending') {
			await recordPaymentTransaction(db, evt, {
				userId: claimed.userId,
				packageId: claimed.packageId,
				networkId: claimed.networkId
			});
		}
		if (evt?.status === 'paid') {
			const r = await creditCheckoutIfUnsettled(db, {
				checkoutId: claimed.id,
				userId: claimed.userId,
				packageId: claimed.packageId,
				externalTransactionId: evt.externalTransactionId,
				amountMinor: evt.amountMinor,
				currency: evt.currency
			});
			return { credited: r.credited };
		}
		if (evt && (evt.status === 'failed' || evt.status === 'cancelled')) await markUnpaid(db, claimed.id, 'failed');
		else if (evt?.status === 'expired') await markUnpaid(db, claimed.id, 'expired');
	} catch (err) {
		// transient — the cron/webhook will still catch it. Capture so a persistent Maya-verify
		// failure on the return path is visible (grouped into one Issue).
		captureHandled(err, { level: 'error', tags: { area: 'reconcile', scope: 'on-return' } });
	}
	return { credited: false };
}
