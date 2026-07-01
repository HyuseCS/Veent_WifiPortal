import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMayaProvider } from '@veent/core';

/**
 * Trust-boundary tests for Maya `verifyWebhook`. Maya Checkout webhooks are unsigned, so the
 * provider does NOT trust the POST body — it takes only the payment id from it and re-fetches
 * the authoritative payment from Maya's API with the secret key. These tests pin that
 * behavior + the normalization (status mapping, centavo conversion, reference passthrough) by
 * mocking the re-fetch; a spoofed body can never reach the credit path without a matching real
 * payment under our account.
 */

const provider = createMayaProvider({ publicKey: 'pk', secretKey: 'sk', sandbox: true });
const headers = new Headers();

// Mock the authoritative GET /payments/{id} re-fetch.
function mockFetchOnce(payment: unknown, ok = true, status = 200) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => ({
			ok,
			status,
			json: async () => payment,
			text: async () => JSON.stringify(payment)
		}))
	);
}

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe('maya verifyWebhook', () => {
	it('re-fetches by the body payment id and maps a PAYMENT_SUCCESS to paid (centavos)', async () => {
		const fetchMock = vi.fn(async (..._args: unknown[]) => ({
			ok: true,
			status: 200,
			json: async () => ({
				id: 'pay_123',
				paymentStatus: 'PAYMENT_SUCCESS',
				amount: '120.50',
				currency: 'PHP',
				requestReferenceNumber: 'ref_abc'
			}),
			text: async () => ''
		}));
		vi.stubGlobal('fetch', fetchMock);

		const evt = await provider.verifyWebhook(JSON.stringify({ id: 'pay_123' }), headers);

		// Re-fetched the payment id from the body (not trusted the body's other fields).
		expect(fetchMock).toHaveBeenCalledOnce();
		expect(String(fetchMock.mock.calls[0][0])).toContain('/payments/v1/payments/pay_123');
		expect(evt).toEqual({
			externalTransactionId: 'pay_123',
			referenceId: 'ref_abc',
			status: 'paid',
			amountMinor: 12050,
			currency: 'PHP',
			referenceNo: 'ref_abc'
		});
	});

	it('treats isPaid=true as paid regardless of status string', async () => {
		mockFetchOnce({ id: 'p', isPaid: true, amount: 10, currency: 'PHP', requestReferenceNumber: 'r' });
		const evt = await provider.verifyWebhook(JSON.stringify({ id: 'p' }), headers);
		expect(evt.status).toBe('paid');
		expect(evt.amountMinor).toBe(1000);
	});

	it('maps failed, cancelled and expired statuses distinctly', async () => {
		mockFetchOnce({ id: 'p', paymentStatus: 'PAYMENT_FAILED', amount: 5, requestReferenceNumber: 'r' });
		expect((await provider.verifyWebhook(JSON.stringify({ id: 'p' }), headers)).status).toBe('failed');

		// PAYMENT_CANCELLED is its own status (not folded into failed) so Finance can separate
		// user-cancelled from gateway-failed attempts.
		mockFetchOnce({ id: 'p', paymentStatus: 'PAYMENT_CANCELLED', amount: 5, requestReferenceNumber: 'r' });
		expect((await provider.verifyWebhook(JSON.stringify({ id: 'p' }), headers)).status).toBe('cancelled');

		mockFetchOnce({ id: 'p', paymentStatus: 'PAYMENT_EXPIRED', amount: 5, requestReferenceNumber: 'r' });
		expect((await provider.verifyWebhook(JSON.stringify({ id: 'p' }), headers)).status).toBe('expired');
	});

	it('extracts Finance detail (fund source, receipt, buyer, error) from the re-fetched payment', async () => {
		mockFetchOnce({
			id: 'pay_9',
			paymentStatus: 'PAYMENT_SUCCESS',
			amount: 100,
			currency: 'PHP',
			requestReferenceNumber: 'ref_9',
			receiptNumber: 'R-001',
			fundSource: { type: 'card', details: { last4: '4242' } },
			buyer: { firstName: 'Ada', lastName: 'Lovelace', contact: { email: 'ada@example.com' } }
		});
		const evt = await provider.verifyWebhook(JSON.stringify({ id: 'pay_9' }), headers);
		expect(evt).toMatchObject({
			fundSourceType: 'card',
			fundSourceMasked: '••••4242',
			receiptNo: 'R-001',
			buyerName: 'Ada Lovelace',
			buyerEmail: 'ada@example.com',
			referenceNo: 'ref_9'
		});
	});

	it('rejects a body that is not valid JSON', async () => {
		await expect(provider.verifyWebhook('not json', headers)).rejects.toThrow(/valid JSON/);
	});

	it('rejects a body with no payment id (never re-fetches)', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		await expect(provider.verifyWebhook(JSON.stringify({ foo: 1 }), headers)).rejects.toThrow(
			/missing payment id/
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('throws when the authoritative re-fetch fails (never trusts the body)', async () => {
		mockFetchOnce('', false, 500);
		await expect(provider.verifyWebhook(JSON.stringify({ id: 'p' }), headers)).rejects.toThrow(
			/payment lookup failed/
		);
	});

	it('throws when the authoritative payment has no reference number', async () => {
		mockFetchOnce({ id: 'p', paymentStatus: 'PAYMENT_SUCCESS', amount: 5 });
		await expect(provider.verifyWebhook(JSON.stringify({ id: 'p' }), headers)).rejects.toThrow(
			/missing requestReferenceNumber/
		);
	});
});

/**
 * Resilience of the authoritative re-fetch: it's bounded by a timeout + small retry so a slow or
 * flapping Maya API can't pin the webhook request (and a DB pool slot) open. Transient failures
 * (timeout/abort, network error, 5xx/429) are retried; a deterministic 4xx is not; the retry
 * count is bounded so a persistent outage fails fast instead of hammering forever.
 */
describe('maya verifyWebhook re-fetch resilience', () => {
	const paidOk = {
		ok: true,
		status: 200,
		json: async () => ({
			id: 'p',
			paymentStatus: 'PAYMENT_SUCCESS',
			amount: 10,
			currency: 'PHP',
			requestReferenceNumber: 'r'
		}),
		text: async () => ''
	};
	const upstream500 = { ok: false, status: 500, json: async () => ({}), text: async () => '' };

	it('retries a transient 5xx, then succeeds on a later attempt', async () => {
		const fetchMock = vi.fn().mockResolvedValueOnce(upstream500).mockResolvedValueOnce(paidOk);
		vi.stubGlobal('fetch', fetchMock);
		const evt = await provider.verifyWebhook(JSON.stringify({ id: 'p' }), headers);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(evt.status).toBe('paid');
	});

	it('retries a network error, then succeeds on a later attempt', async () => {
		const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(paidOk);
		vi.stubGlobal('fetch', fetchMock);
		const evt = await provider.verifyWebhook(JSON.stringify({ id: 'p' }), headers);
		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(evt.status).toBe('paid');
	});

	it('normalizes a persistent abort/timeout into a clear "timed out" error', async () => {
		const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
		const fetchMock = vi.fn().mockRejectedValue(abort);
		vi.stubGlobal('fetch', fetchMock);
		await expect(provider.verifyWebhook(JSON.stringify({ id: 'p' }), headers)).rejects.toThrow(/timed out/);
		// 1 initial attempt + 2 bounded retries.
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it('stops retrying after the bounded number of attempts on a persistent 5xx', async () => {
		const fetchMock = vi.fn().mockResolvedValue(upstream500);
		vi.stubGlobal('fetch', fetchMock);
		await expect(provider.verifyWebhook(JSON.stringify({ id: 'p' }), headers)).rejects.toThrow(
			/payment lookup failed/
		);
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it('does NOT retry a deterministic 404 (no such payment) — fails on the first attempt', async () => {
		const notFound = { ok: false, status: 404, json: async () => ({}), text: async () => '' };
		const fetchMock = vi.fn().mockResolvedValue(notFound);
		vi.stubGlobal('fetch', fetchMock);
		await expect(provider.verifyWebhook(JSON.stringify({ id: 'p' }), headers)).rejects.toThrow(
			/payment lookup failed/
		);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});
});
