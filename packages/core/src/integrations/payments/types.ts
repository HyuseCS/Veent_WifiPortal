/**
 * Provider-agnostic payment abstraction. The app codes against `PaymentProvider`
 * only; swapping Maya for another gateway means swapping the implementation, not
 * the call sites.
 */

/**
 * Thrown by a provider's read paths (webhook verify / reconcile lookups) when the failure is
 * TRANSIENT — a gateway 5xx/429, a request timeout, or a network error — as opposed to a
 * malformed/spoofed payload or a permanent 4xx (bad key, unknown payment). The webhook route maps
 * this to a 5xx so the gateway RETRIES delivery, rather than a 400 that tells it to give up on a
 * payment that may well be real. `instanceof` survives the `traceMethods` wrapper (it re-throws the
 * original error unchanged).
 */
export class RetryablePaymentError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'RetryablePaymentError';
	}
}

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
	/**
	 * This site's public origin (e.g. `https://<site>.ngrok-free.app`), carried into the
	 * gateway's metadata so the central Veent DO relay can route the server-to-server webhook
	 * back to THIS server. One shared Maya account fans out to many NAT'd sites: Maya notifies
	 * the DO (its single registered webhook URL), the DO reads `metadata.originUrl` off the
	 * echoed event and forwards it verbatim to `${originUrl}/api/webhooks/maya/payment-status`.
	 * Bare origin, no path — the DO appends the webhook path. Optional at this layer: providers
	 * / direct-webhook deployments without a relay simply ignore it.
	 */
	originUrl?: string;
	/**
	 * Buyer info for the checkout / fraud scoring. Maya's Kount fraud protection requires
	 * firstName + lastName + email — collected on the top-up form. Split into firstName/lastName
	 * because Kount validates them separately. All optional at this layer so non-Kount providers
	 * can ignore them; the Maya checkout path is responsible for ensuring they're present.
	 */
	buyer?: {
		firstName?: string;
		lastName?: string;
		email?: string;
		phone?: string;
		/** ISO 3166 two-letter country code for the billing address (e.g. 'PH'). */
		billingAddressCountryCode?: string;
	};
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
	/** Our referenceId from checkout creation. Always a string ('' when the gateway
	 * omits it, e.g. on some failure events) so callers can safely `.split(':')`. */
	referenceId: string;
	status: 'paid' | 'failed' | 'expired' | 'cancelled' | 'pending';
	amountMinor: number;
	currency: string;
	// Optional provider detail — populated by Maya, left undefined by other providers.
	// Surfaced on the admin Finance page (payment_transactions); not used for crediting.
	fundSourceType?: string;
	fundSourceMasked?: string;
	receiptNo?: string;
	referenceNo?: string;
	errorCode?: string;
	errorMessage?: string;
	buyerName?: string;
	buyerEmail?: string;
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
	/**
	 * Reconciliation: fetch a checkout's CURRENT status straight from the gateway
	 * (outbound request — works behind NAT, needs no inbound webhook). The safety net
	 * behind a missed webhook. Returns a normalized event, or null if the gateway has
	 * no payment for it yet. Optional: providers that can't poll omit it.
	 */
	getCheckoutStatus?(checkoutId: string): Promise<PaymentEvent | null>;
	/**
	 * Reconciliation by OUR reference id (requestReferenceNumber). Resolves the authoritative
	 * payment straight from the reference we set at checkout — needing neither an inbound webhook
	 * NOR the gateway's checkout→payment mapping — so a missed webhook still credits even if the
	 * relay/tunnel never recovers. Preferred over getCheckoutStatus by the reconcile safety nets.
	 * Returns a normalized event, or null if the gateway has no payment for the reference yet.
	 * Optional: providers without a by-reference lookup omit it.
	 */
	getPaymentByReference?(referenceId: string): Promise<PaymentEvent | null>;
}
