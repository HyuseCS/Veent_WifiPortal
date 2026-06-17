/**
 * Provider-agnostic payment abstraction. The app codes against `PaymentProvider`
 * only; swapping Maya for another gateway means swapping the implementation, not
 * the call sites.
 */

export interface CreateCheckoutInput {
	/** Our internal reference (e.g. `${userId}:${packageId}`). Echoed back on the webhook. */
	referenceId: string;
	/** Amount in the smallest currency unit (centavos for PHP). */
	amountMinor: number;
	currency: string; // e.g. 'PHP'
	description: string;
	/** Where the gateway sends the user after paying / cancelling. */
	successUrl: string;
	cancelUrl: string;
	/** Optional contact info to prefill the checkout. */
	buyer?: { name?: string; email?: string; phone?: string };
}

export interface CreateCheckoutResult {
	/** Gateway-side id for the checkout/payment intent. */
	checkoutId: string;
	/** URL to redirect the user to. */
	redirectUrl: string;
}

/** A normalized, verified payment event derived from a raw webhook request. */
export interface PaymentEvent {
	/** The gateway's unique transaction id — stored as credit_ledger.external_transaction_id (idempotency key). */
	externalTransactionId: string;
	/** Our referenceId from checkout creation. */
	referenceId: string;
	status: 'paid' | 'failed' | 'expired' | 'pending';
	amountMinor: number;
	currency: string;
}

export interface PaymentProvider {
	readonly name: string;
	/** Create a hosted checkout and return where to send the user. */
	createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult>;
	/**
	 * Verify a webhook's authenticity (signature/HMAC) and parse it into a
	 * normalized event. MUST throw if verification fails — callers treat a thrown
	 * error as "reject the webhook".
	 */
	verifyWebhook(rawBody: string, headers: Headers): Promise<PaymentEvent>;
}
