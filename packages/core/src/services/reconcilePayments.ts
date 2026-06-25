import { and, eq, gt, isNull, lte, or } from 'drizzle-orm';
import { type DB, paymentCheckouts, paymentTransactions, packages } from '@veent/db';
import { LEDGER_TYPE } from '../config';
import type { PaymentEvent, PaymentProvider } from '../integrations/payments';
import { addCredits } from './credits';

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
		userId: attribution.userId,
		packageId: attribution.packageId,
		networkId: attribution.networkId
	};
	await db
		.insert(paymentTransactions)
		.values(row)
		.onConflictDoUpdate({
			target: paymentTransactions.id,
			set: {
				status: row.status,
				amount: row.amount,
				fundSourceType: row.fundSourceType,
				fundSourceMasked: row.fundSourceMasked,
				receiptNo: row.receiptNo,
				errorCode: row.errorCode,
				errorMessage: row.errorMessage
			}
		});
}

/**
 * Payment reconciliation — the SAFETY NET behind the webhook.
 *
 * Crediting is gated by an ATOMIC claim on payment_checkouts.status (pending→settled):
 * whichever path wins the claim credits, the other no-ops. So the webhook and these
 * reconcile paths can race freely without ever double-crediting (addCredits idempotency
 * on external_transaction_id is the second line of defence). Everything runs inside a
 * transaction, so if crediting throws the claim rolls back and the next pass retries —
 * a checkout is never marked settled without the credit actually landing.
 */

interface CreditArgs {
	/** Match the checkout by gateway id (reconcile) or by referenceId (webhook). */
	checkoutId?: string;
	referenceId?: string;
	userId: string;
	packageId: number;
	externalTransactionId: string;
}

/**
 * Claim the matching pending checkout and credit the buyer exactly once. If the row
 * is already settled, no-ops. If NO checkout row exists (legacy payments created before
 * this table, or any edge), it still credits — addCredits stays idempotent there.
 */
export async function creditCheckoutIfUnsettled(
	db: DB,
	args: CreditArgs
): Promise<{ credited: boolean; balance?: number }> {
	const match = args.checkoutId
		? eq(paymentCheckouts.id, args.checkoutId)
		: eq(paymentCheckouts.referenceId, args.referenceId ?? '');

	// Atomic claim: flip pending→settled. Postgres serializes the UPDATE, so under a
	// webhook/reconcile race exactly one caller gets a row back — only it credits.
	const claimed = await db
		.update(paymentCheckouts)
		.set({ status: 'settled', settledAt: new Date(), externalTransactionId: args.externalTransactionId })
		.where(and(match, eq(paymentCheckouts.status, 'pending')))
		.returning({ id: paymentCheckouts.id });

	const claimedId = claimed[0]?.id ?? null;
	if (!claimedId) {
		// Didn't win the claim: already settled (skip), or no row at all (legacy → credit;
		// addCredits idempotency is the backstop there).
		const [exists] = await db
			.select({ id: paymentCheckouts.id })
			.from(paymentCheckouts)
			.where(match)
			.limit(1);
		if (exists) return { credited: false };
	}

	/** Undo a claim we can't fulfil, so a later pass retries — never settled-but-uncredited. */
	const revert = async () => {
		if (claimedId) {
			await db
				.update(paymentCheckouts)
				.set({ status: 'pending', settledAt: null })
				.where(eq(paymentCheckouts.id, claimedId));
		}
	};

	const [pkg] = await db
		.select({ credits: packages.creditsProvided })
		.from(packages)
		.where(eq(packages.id, args.packageId))
		.limit(1);
	if (!pkg) {
		await revert();
		return { credited: false };
	}

	try {
		const result = await addCredits(db, {
			userId: args.userId,
			amount: pkg.credits ?? 0,
			type: LEDGER_TYPE.topup,
			packageId: args.packageId,
			externalTransactionId: args.externalTransactionId
		});
		return { credited: result.credited, balance: result.balance };
	} catch (e) {
		await revert();
		throw e;
	}
}

/** Mark a pending checkout as finished-unpaid (failed/expired/cancelled). */
async function markUnpaid(db: DB, checkoutId: string, status: 'failed' | 'expired') {
	await db
		.update(paymentCheckouts)
		.set({ status, settledAt: new Date() })
		.where(and(eq(paymentCheckouts.id, checkoutId), eq(paymentCheckouts.status, 'pending')));
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
	if (!payments.getCheckoutStatus) return { checked: 0, credited: 0 };
	const now = Date.now();
	const minAge = new Date(now - (opts.minAgeMs ?? 90_000)); // webhook head start
	const maxAge = new Date(now - (opts.maxAgeMs ?? 24 * 60 * 60 * 1000)); // stop after a day

	const pending = await db
		.select({
			id: paymentCheckouts.id,
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
			const evt = await payments.getCheckoutStatus!(c.id);
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
					externalTransactionId: evt.externalTransactionId
				});
				if (r.credited) credited++;
			} else if (evt.status === 'failed' || evt.status === 'cancelled') {
				await markUnpaid(db, c.id, 'failed');
			} else if (evt.status === 'expired') {
				await markUnpaid(db, c.id, 'expired');
			}
		} catch {
			// transient (gateway/network) — leave pending, retry next pass
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
	if (!payments.getCheckoutStatus) return { credited: false };
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
		const evt = await payments.getCheckoutStatus(claimed.id);
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
				externalTransactionId: evt.externalTransactionId
			});
			return { credited: r.credited };
		}
		if (evt && (evt.status === 'failed' || evt.status === 'cancelled')) await markUnpaid(db, claimed.id, 'failed');
		else if (evt?.status === 'expired') await markUnpaid(db, claimed.id, 'expired');
	} catch {
		// transient — the cron/webhook will still catch it
	}
	return { credited: false };
}
