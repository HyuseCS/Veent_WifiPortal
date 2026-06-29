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

/** Per-attempt timeout for an outbound Maya call. */
const MAYA_FETCH_TIMEOUT_MS = 8_000;
/** Extra attempts after the first on a transient failure (timeout / network error / 5xx / 429). */
const MAYA_FETCH_RETRIES = 2;

/** A single `fetch` bounded by an AbortController timeout — a hung Maya API can't pin us forever. */
async function fetchWithTimeout(
	url: string,
	init: RequestInit,
	timeoutMs: number
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

/**
 * `fetch` with a timeout AND a small bounded retry. Retries only TRANSIENT failures — a
 * timeout/abort, a network error, or a 5xx/429 upstream — never a deterministic 4xx (e.g. 404
 * "no such payment", 401 bad key), which would just fail identically every time. On the final
 * attempt the response (even a 5xx) is returned so the caller's existing `!res.ok` branch can
 * surface the upstream detail; a final timeout/network error is normalized to a clear message.
 *
 * Why this matters here: every webhook hit triggers an authoritative outbound re-fetch. Without
 * a timeout, a slow Maya API holds the request (and a DB pool slot) open, so a burst of webhooks
 * during a Maya slowdown can exhaust the request pool. The cap bounds that blast radius.
 */
async function fetchWithRetry(
	url: string,
	init: RequestInit,
	timeoutMs = MAYA_FETCH_TIMEOUT_MS,
	retries = MAYA_FETCH_RETRIES
): Promise<Response> {
	for (let attempt = 0; ; attempt++) {
		try {
			const res = await fetchWithTimeout(url, init, timeoutMs);
			if ((res.status >= 500 || res.status === 429) && attempt < retries) continue;
			return res;
		} catch (e) {
			if (attempt < retries) continue;
			if (e instanceof Error && e.name === 'AbortError') {
				throw new Error(`maya: request timed out after ${timeoutMs}ms`);
			}
			throw e instanceof Error ? e : new Error(String(e));
		}
	}
}

/**
 * Parse a Maya major-unit amount (pesos) to integer minor units (centavos). Returns NaN —
 * never a silent 0 — for a missing/garbled amount, so the credit-time amount check refuses
 * to credit rather than crediting against a bogus 0 (security-review Q/D).
 */
function toMinor(amount: string | number | undefined | null): number {
	if (amount === undefined || amount === null || amount === '') return NaN;
	return Math.round(Number(amount) * 100);
}

/** Split a display name into Maya's firstName/lastName fields. */
function splitName(name?: string): { firstName?: string; lastName?: string } {
	const trimmed = name?.trim();
	if (!trimmed) return {};
	const parts = trimmed.split(/\s+/);
	if (parts.length === 1) return { firstName: parts[0] };
	return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

/** Shape of the fields we read off a Maya payment object (GET /payments/v1/payments/{id}). */
interface MayaPayment {
	id: string;
	isPaid?: boolean;
	status?: string;
	paymentStatus?: string;
	amount?: string | number;
	currency?: string;
	requestReferenceNumber?: string;
	receiptNumber?: string;
	errorCode?: string;
	errorMessage?: string;
	fundSource?: {
		type?: string;
		description?: string;
		details?: { last4?: string; masked?: string; scheme?: string };
	};
	buyer?: { firstName?: string; lastName?: string; contact?: { email?: string; phone?: string } };
}

/**
 * Pull the optional Finance detail off a re-fetched Maya payment into the normalized
 * PaymentEvent fields. Everything is best-effort — a missing field maps to undefined,
 * never throws — because these feed the admin Finance report, not the credit decision.
 */
function mapDetail(
	p: MayaPayment
): Pick<
	PaymentEvent,
	'fundSourceType' | 'fundSourceMasked' | 'receiptNo' | 'errorCode' | 'errorMessage' | 'buyerName' | 'buyerEmail'
> {
	const masked = p.fundSource?.details?.last4
		? `••••${p.fundSource.details.last4}`
		: (p.fundSource?.details?.masked ?? undefined);
	const buyerName = [p.buyer?.firstName, p.buyer?.lastName].filter(Boolean).join(' ').trim() || undefined;
	return {
		fundSourceType: p.fundSource?.type ?? undefined,
		fundSourceMasked: masked,
		receiptNo: p.receiptNumber ?? undefined,
		errorCode: p.errorCode ?? undefined,
		errorMessage: p.errorMessage ?? undefined,
		buyerName,
		buyerEmail: p.buyer?.contact?.email ?? undefined
	};
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
			return 'failed';
		case 'PAYMENT_CANCELLED':
			return 'cancelled';
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

		async verifyWebhook(rawBody: string): Promise<PaymentEvent> {
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
			// Bounded by a timeout + small retry so a slow Maya API can't pin this request.
			const res = await fetchWithRetry(`${base}/payments/v1/payments/${encodeURIComponent(paymentId)}`, {
				headers: { authorization: basicAuth(config.secretKey) }
			});
			if (!res.ok) {
				const detail = await res.text().catch(() => '');
				throw new Error(`maya: payment lookup failed (${res.status}): ${detail}`);
			}

			const payment = (await res.json()) as MayaPayment;

			const status = mapStatus(payment.paymentStatus ?? payment.status, payment.isPaid === true);
			if (!payment.requestReferenceNumber) {
				throw new Error('maya: payment missing requestReferenceNumber');
			}

			return {
				externalTransactionId: payment.id,
				referenceId: payment.requestReferenceNumber,
				status,
				amountMinor: toMinor(payment.amount),
				currency: payment.currency ?? 'PHP',
				referenceNo: payment.requestReferenceNumber,
				...mapDetail(payment)
			};
		},

		async getCheckoutStatus(checkoutId: string): Promise<PaymentEvent | null> {
			if (!config.secretKey) throw new Error('maya: secretKey not configured');

			// Outbound read of the checkout's current state — the reconcile safety net.
			// Same timeout + retry bound as the webhook re-fetch.
			const res = await fetchWithRetry(`${base}/checkout/v1/checkouts/${encodeURIComponent(checkoutId)}`, {
				headers: { authorization: basicAuth(config.secretKey) }
			});
			if (res.status === 404) return null; // gateway has no record (yet)
			if (!res.ok) {
				const detail = await res.text().catch(() => '');
				throw new Error(`maya: checkout lookup failed (${res.status}): ${detail}`);
			}

			const c = (await res.json()) as {
				id: string;
				paymentStatus?: string;
				status?: string;
				isPaid?: boolean;
				totalAmount?: { value?: string | number } | string | number;
				requestReferenceNumber?: string;
				// ponytail: a paid checkout exposes its payment id; field name confirmed in
				// the Maya dashboard. Falls back to the checkout id — only used for tracing,
				// not for credit idempotency (the payment_checkouts claim guards that).
				payments?: { id?: string }[];
			};

			const status = mapStatus(c.paymentStatus ?? c.status, c.isPaid === true);
			const amount = typeof c.totalAmount === 'object' ? c.totalAmount?.value : c.totalAmount;
			return {
				externalTransactionId: c.payments?.[0]?.id ?? c.id ?? checkoutId,
				referenceId: c.requestReferenceNumber ?? '',
				status,
				amountMinor: toMinor(amount),
				currency: 'PHP',
				referenceNo: c.requestReferenceNumber ?? undefined
			};
		}
	};
}
