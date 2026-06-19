import type {
	PaymentProvider,
	CreateCheckoutInput,
	CreateCheckoutResult,
	PaymentEvent
} from './types';

export interface MayaConfig {
	publicKey: string;
	secretKey: string;
	/** Secret used to verify webhook signatures. */
	webhookSecret: string;
	/** Toggle the API host. */
	sandbox?: boolean;
}

const PROD_BASE = 'https://pg.paymaya.com';
const SANDBOX_BASE = 'https://pg-sandbox.paymaya.com';

/** Maya webhook status → normalized PaymentEvent status. */
const STATUS_MAP: Record<string, PaymentEvent['status']> = {
	PAYMENT_SUCCESS: 'paid',
	PAYMENT_FAILED: 'failed',
	PAYMENT_EXPIRED: 'expired',
	PAYMENT_CANCELLED: 'cancelled',
	COMPLETED: 'paid', // Checkout API uses 'COMPLETED' on the checkout object
	EXPIRED: 'expired'
};

/** Hex HMAC of `body` keyed by `secret`. Algorithm configurable for the signature check. */
async function hmacHex(body: string, secret: string, hash: 'SHA-256' | 'SHA-512'): Promise<string> {
	const enc = new TextEncoder();
	const key = await crypto.subtle.importKey(
		'raw',
		enc.encode(secret),
		{ name: 'HMAC', hash },
		false,
		['sign']
	);
	const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
	return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string compare (avoids leaking match progress via timing). */
function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

/** Pull the first present value down a dotted path, e.g. pick(p, 'a.b.c'). */
function pick(obj: unknown, path: string): unknown {
	return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], obj);
}

/**
 * Maya (PayMaya) payment provider.
 *
 * STUB: the network calls and signature verification are marked with TODOs.
 * The contract (createCheckout / verifyWebhook) and the surrounding app wiring
 * are complete, so dropping in the real Maya Checkout API + webhook HMAC is an
 * isolated change here — no route or service code needs to move.
 *
 * Real integration notes:
 *  - Checkout: POST {base}/checkout/v1/checkouts with Basic auth (publicKey).
 *  - Webhook:  register at {base}/checkout/v1/webhooks; verify the signature
 *    header against `webhookSecret` before trusting the payload.
 */
export function createMayaProvider(config: MayaConfig): PaymentProvider {
	const base = config.sandbox ? SANDBOX_BASE : PROD_BASE;

	return {
		name: 'maya',

		async createCheckout(input: CreateCheckoutInput): Promise<CreateCheckoutResult> {
			if (!config.publicKey) throw new Error('maya: publicKey not configured');

			// TODO(maya): replace stub with real Checkout API call:
			//   const res = await fetch(`${base}/checkout/v1/checkouts`, {
			//     method: 'POST',
			//     headers: {
			//       'content-type': 'application/json',
			//       authorization: `Basic ${btoa(config.publicKey + ':')}`
			//     },
			//     body: JSON.stringify({
			//       totalAmount: { value: input.amountMinor / 100, currency: input.currency },
			//       requestReferenceNumber: input.referenceId,
			//       redirectUrl: { success: input.successUrl, failure: input.cancelUrl, cancel: input.cancelUrl },
			//       buyer: input.buyer
			//     })
			//   });
			//   const data = await res.json();
			//   return { checkoutId: data.checkoutId, redirectUrl: data.redirectUrl };
			void base;
			throw new Error('maya.createCheckout: not implemented (stub) — wire the Maya Checkout API');
		},

		async verifyWebhook(rawBody: string, headers: Headers): Promise<PaymentEvent> {
			if (!config.webhookSecret) throw new Error('maya: webhookSecret not configured');

			// Verify the signature over the RAW body, then THROW on mismatch — never trust
			// an unverified payload.
			// ponytail: assumes HMAC-SHA256 hex in `paymaya-signature`/`x-signature`. Maya's
			// exact scheme (algo + header) must be confirmed in the Maya dashboard's webhook
			// config; if it differs, change the hash arg / header name here only.
			const signature = headers.get('paymaya-signature') ?? headers.get('x-signature') ?? '';
			if (!signature) throw new Error('maya: missing webhook signature header');
			const expected = await hmacHex(rawBody, config.webhookSecret, 'SHA-256');
			if (!timingSafeEqual(signature.trim().toLowerCase(), expected)) {
				throw new Error('maya: invalid webhook signature');
			}

			const payload = JSON.parse(rawBody);

			const rawStatus = String(payload.paymentStatus ?? payload.status ?? '');
			const status = STATUS_MAP[rawStatus];
			if (!status) throw new Error(`maya: unrecognized payment status '${rawStatus}'`);

			// Fund source shape differs between the Charges and Checkout payloads.
			const fundSource = payload.fundSource ?? {};
			const fundDetails = fundSource.details ?? {};

			const amountRaw = payload.totalAmount?.value ?? payload.amount;

			return {
				externalTransactionId: String(payload.id),
				// Always a string ('' when omitted) so the webhook handler can `.split(':')`.
				referenceId: String(payload.requestReferenceNumber ?? ''),
				status,
				amountMinor: Math.round(Number(amountRaw) * 100),
				currency: String(payload.currency ?? payload.totalAmount?.currency ?? 'PHP'),
				fundSourceType: fundSource.type ?? payload.paymentScheme ?? undefined,
				fundSourceMasked: fundDetails.masked ?? fundDetails.last4 ?? undefined,
				receiptNo:
					payload.receiptNumber ??
					(pick(payload, 'paymentDetails.responses.efs.receipt.receiptNo') as string) ??
					undefined,
				referenceNo: payload.requestReferenceNumber ?? undefined,
				errorCode:
					(pick(payload, 'paymentDetails.responses.efs.unhandledError.0.code') as string) ??
					payload.errorCode ??
					undefined,
				errorMessage:
					(pick(payload, 'paymentDetails.responses.efs.unhandledError.0.message') as string) ??
					payload.errorMessage ??
					undefined,
				buyerName:
					[payload.buyer?.firstName, payload.buyer?.lastName].filter(Boolean).join(' ') || undefined,
				buyerEmail: payload.buyer?.contact?.email ?? payload.buyer?.email ?? undefined
			};
		}
	};
}
