import { describe, it, expect, vi, afterEach } from 'vitest';
import { createMayaProvider } from '@veent/core';

/**
 * Reconcile trust-boundary tests for Maya `getCheckoutStatus` (the cron + on-return safety net).
 * Maya's checkout resource doesn't reliably report paid, so when a checkout exposes a payment id
 * we must re-verify against the authoritative PAYMENT endpoint — the SAME source the webhook
 * trusts. These pin that: a paid payment is confirmed via the payments endpoint (not the checkout
 * body), and a checkout with no payment yet stays pending without touching the payments endpoint.
 */

const provider = createMayaProvider({ publicKey: 'pk', secretKey: 'sk', sandbox: true });

afterEach(() => vi.unstubAllGlobals());

/** Route the fetch mock by URL so we can distinguish the checkout GET from the payment GET. */
function mockByUrl(handler: (url: string) => unknown) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) => {
			const body = handler(url);
			return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
		})
	);
}

describe('getCheckoutStatus — authoritative via the payments endpoint', () => {
	it('verifies the PAYMENT resource when the checkout exposes a payment id', async () => {
		const calls: string[] = [];
		mockByUrl((url) => {
			calls.push(url);
			if (url.includes('/checkout/v1/checkouts/')) {
				// Checkout body deliberately looks unpaid — status must NOT come from here.
				return { id: 'chk_1', status: 'PENDING', payments: [{ id: 'pay_1' }] };
			}
			if (url.includes('/payments/v1/payments/pay_1')) {
				return { id: 'pay_1', isPaid: true, amount: '100.00', currency: 'PHP', requestReferenceNumber: 'ref_1' };
			}
			throw new Error(`unexpected url ${url}`);
		});

		const evt = await provider.getCheckoutStatus!('chk_1');
		expect(evt?.status).toBe('paid'); // from the payment, despite the checkout saying PENDING
		expect(evt?.externalTransactionId).toBe('pay_1');
		expect(evt?.amountMinor).toBe(10000);
		expect(evt?.referenceId).toBe('ref_1');
		expect(calls.some((u) => u.includes('/payments/v1/payments/pay_1'))).toBe(true);
	});

	it('does NOT report paid from the checkout body when no payment id is present (avoids amountless credit)', async () => {
		// Regression: a checkout that CLAIMS paid but has surfaced no payment carries no trustworthy
		// amount. Reporting `paid` here credited against NaN → settled-but-uncredited, trapping the
		// payment. It must stay `pending` so the next pass (once Maya attaches the payment) credits.
		mockByUrl((url) => {
			if (url.includes('/checkout/v1/checkouts/')) {
				return { id: 'chk_3', isPaid: true, paymentStatus: 'PAYMENT_SUCCESS', requestReferenceNumber: 'ref_3' };
			}
			throw new Error(`unexpected url ${url}`);
		});
		const evt = await provider.getCheckoutStatus!('chk_3');
		expect(evt?.status).toBe('pending'); // NOT 'paid'
	});

	it('maps a terminal checkout failure even without a payment id (no amount needed)', async () => {
		mockByUrl(() => ({ id: 'chk_4', paymentStatus: 'PAYMENT_EXPIRED', requestReferenceNumber: 'ref_4' }));
		const evt = await provider.getCheckoutStatus!('chk_4');
		expect(evt?.status).toBe('expired');
	});

	it('falls back to checkout status (pending) and does NOT hit payments when no payment exists yet (deprecated path)', async () => {
		const calls: string[] = [];
		mockByUrl((url) => {
			calls.push(url);
			if (url.includes('/checkout/v1/checkouts/')) {
				return { id: 'chk_2', status: 'PENDING', requestReferenceNumber: 'ref_2', totalAmount: { value: '50.00' } };
			}
			throw new Error(`unexpected url ${url}`);
		});

		const evt = await provider.getCheckoutStatus!('chk_2');
		expect(evt?.status).toBe('pending');
		expect(calls.some((u) => u.includes('/payments/v1/payments'))).toBe(false);
	});
});

/**
 * getPaymentByReference — the reconcile path that credits without a webhook. It resolves the
 * payment straight from OUR request reference number via GET /payments/v1/payment-rrns/{rrn}, so a
 * missed webhook credits even if the DO/tunnel never recovers. One RRN can carry multiple attempts;
 * a settled success must win.
 */
describe('getPaymentByReference — authoritative RRN lookup', () => {
	it('picks the successful payment among multiple attempts for one reference', async () => {
		mockByUrl((url) => {
			if (url.includes('/payments/v1/payment-rrns/ref_9')) {
				return [
					{ id: 'pay_fail', status: 'PAYMENT_FAILED', amount: '100.00', requestReferenceNumber: 'ref_9' },
					{ id: 'pay_ok', isPaid: true, amount: '100.00', currency: 'PHP', requestReferenceNumber: 'ref_9' }
				];
			}
			throw new Error(`unexpected url ${url}`);
		});
		const evt = await provider.getPaymentByReference!('ref_9');
		expect(evt?.status).toBe('paid');
		expect(evt?.externalTransactionId).toBe('pay_ok');
		expect(evt?.amountMinor).toBe(10000);
	});

	it('returns null when the gateway has no payment for the reference yet', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: false, status: 404, json: async () => [], text: async () => '' }))
		);
		const evt = await provider.getPaymentByReference!('ref_none');
		expect(evt).toBeNull();
	});
});
