import type {
	PaymentProvider,
	CreateCheckoutInput,
	CreateCheckoutResult,
	PaymentEvent
} from './types';

export interface MayaConfig {
	publicKey: string;
	secretKey: string;
	/**
	 * Optional. Maya Checkout webhooks are NOT HMAC-signed, so this is unused for
	 * verification — authenticity is established by re-fetching the payment from
	 * Maya with `secretKey` (see verifyWebhook). Kept for forward-compat / env parity.
	 */
	webhookSecret?: string;
	/** Toggle the API host. */
	sandbox?: boolean;
}

const PROD_BASE = 'https://pg.paymaya.com';
const SANDBOX_BASE = 'https://pg-sandbox.paymaya.com';

/** Basic auth header for a Maya API key (key as username, blank password). */
function basicAuth(key: string): string {
	return `Basic ${Buffer.from(`${key}:`).toString('base64')}`;
}

/** Split a display name into Maya's firstName/lastName fields. */
function splitName(name?: string): { firstName?: string; lastName?: string } {
	const trimmed = name?.trim();
	if (!trimmed) return {};
	const parts = trimmed.split(/\s+/);
	if (parts.length === 1) return { firstName: parts[0] };
	return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

/**
 * Map a Maya payment status to our normalized event status.
 * Maya values: PAYMENT_SUCCESS, PAYMENT_FAILED, PAYMENT_EXPIRED, PAYMENT_CANCELLED,
 * AUTHORIZED, CAPTURED, plus various pending/pre-payment states.
 */
function mapStatus(raw: string | undefined, isPaid: boolean): PaymentEvent['status'] {
	if (isPaid) return 'paid';
	switch (raw) {
		case 'PAYMENT_SUCCESS':
		case 'CAPTURED':
			return 'paid';
		case 'PAYMENT_FAILED':
		case 'PAYMENT_CANCELLED':
			return 'failed';
		case 'PAYMENT_EXPIRED':
			return 'expired';
		default:
			return 'pending';
	}
}

/**
 * Maya (PayMaya) payment provider.
 *
 *  - Checkout: POST {base}/checkout/v1/checkouts with Basic auth (publicKey).
 *  - Webhook:  Maya Checkout webhooks are unsigned, so we don't trust the POST
 *    body. We re-fetch the payment from GET {base}/payments/v1/payments/{id}
 *    with the secretKey and use THAT authoritative status — a spoofed webhook
 *    can't produce a real paid payment id under our account.
 */
export function createMayaProvider(config: MayaConfig): PaymentProvider {
	const base = config.sandbox ? SANDBOX_BASE : PROD_BASE;

	return {
		name: 'maya',

		async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
			if (!config.publicKey) throw new Error('maya: publicKey not configured');

			const { firstName, lastName } = splitName(input.buyer?.name);
			const buyer =
				firstName || input.buyer?.email || input.buyer?.phone
					? {
							firstName,
							lastName,
							contact: { phone: input.buyer?.phone, email: input.buyer?.email }
						}
					: undefined;

			const res = await fetch(`${base}/checkout/v1/checkouts`, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					authorization: basicAuth(config.publicKey)
				},
				body: JSON.stringify({
					totalAmount: {
						// Maya expects a major-unit decimal (pesos), not centavos.
						value: input.amountMinor / 100,
						currency: input.currency
					},
					buyer,
					items: [
						{
							name: input.description,
							quantity: 1,
							totalAmount: { value: input.amountMinor / 100, currency: input.currency }
						}
					],
					redirectUrl: {
						success: input.successUrl,
						failure: input.cancelUrl,
						cancel: input.cancelUrl
					},
					requestReferenceNumber: input.referenceId
				})
			});

			if (!res.ok) {
				const detail = await res.text().catch(() => '');
				throw new Error(`maya.createCheckout failed (${res.status}): ${detail}`);
			}

			const data = (await res.json()) as { checkoutId?: string; redirectUrl?: string };
			if (!data.redirectUrl || !data.checkoutId) {
				throw new Error('maya.createCheckout: missing checkoutId/redirectUrl in response');
			}
			return { checkoutId: data.checkoutId, redirectUrl: data.redirectUrl };
		},

		async verifyWebhook(rawBody: string, _headers: Headers): Promise<PaymentEvent> {
			if (!config.secretKey) throw new Error('maya: secretKey not configured');

			let payload: { id?: string; paymentId?: string };
			try {
				payload = JSON.parse(rawBody);
			} catch {
				throw new Error('maya: webhook body is not valid JSON');
			}

			// The webhook payload mirrors the GET Payment response; `id` is the payment id.
			const paymentId = payload.id ?? payload.paymentId;
			if (!paymentId) throw new Error('maya: webhook payload missing payment id');

			// Authoritative re-fetch — this is what makes an unsigned webhook trustworthy.
			const res = await fetch(`${base}/payments/v1/payments/${encodeURIComponent(paymentId)}`, {
				headers: { authorization: basicAuth(config.secretKey) }
			});
			if (!res.ok) {
				const detail = await res.text().catch(() => '');
				throw new Error(`maya: payment lookup failed (${res.status}): ${detail}`);
			}

			const payment = (await res.json()) as {
				id: string;
				isPaid?: boolean;
				status?: string;
				paymentStatus?: string;
				amount?: string | number;
				currency?: string;
				requestReferenceNumber?: string;
			};

			const status = mapStatus(payment.paymentStatus ?? payment.status, payment.isPaid === true);
			if (!payment.requestReferenceNumber) {
				throw new Error('maya: payment missing requestReferenceNumber');
			}

			return {
				externalTransactionId: payment.id,
				referenceId: payment.requestReferenceNumber,
				status,
				amountMinor: Math.round(Number(payment.amount ?? 0) * 100),
				currency: payment.currency ?? 'PHP'
			};
		}
	};
}
