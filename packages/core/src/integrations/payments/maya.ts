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

			// TODO(maya): verify the signature header against webhookSecret (HMAC)
			// and THROW if it does not match. Never trust an unverified payload.
			//   const signature = headers.get('paymaya-signature');
			//   if (!signatureIsValid(rawBody, signature, config.webhookSecret)) {
			//     throw new Error('maya: invalid webhook signature');
			//   }
			void headers;

			// TODO(maya): map the verified payload to a normalized PaymentEvent.
			//   const payload = JSON.parse(rawBody);
			//   return {
			//     externalTransactionId: payload.id,
			//     referenceId: payload.requestReferenceNumber,
			//     status: payload.status === 'PAYMENT_SUCCESS' ? 'paid' : 'failed',
			//     amountMinor: Math.round(Number(payload.amount) * 100),
			//     currency: payload.currency
			//   };
			void rawBody;
			throw new Error('maya.verifyWebhook: not implemented (stub) — verify signature + map payload');
		}
	};
}
