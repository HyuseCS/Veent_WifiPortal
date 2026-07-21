import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mutable state both virtual-module mocks read through, so each test can flip
// `dev` and set env without re-importing. `$app/environment`'s `dev` is exposed via
// a getter so the live named import reflects changes between tests.
const state = vi.hoisted(() => ({
	dev: false,
	env: {} as Record<string, string | undefined>
}));

// sendOtp now appends to customer_otp_delivery_log after a gateway accept. Chain-mock the
// Drizzle verbs (db.insert().values()) it uses; `values` resolves unless a test overrides it.
const insertValues = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/db', () => ({
	db: { insert: () => ({ values: insertValues }) }
}));
vi.mock('@veent/db/schema', () => ({ customerOtpDeliveryLog: {} }));
vi.mock('@veent/core', () => ({ captureHandled: vi.fn() }));

vi.mock('$app/environment', () => ({
	get dev() {
		return state.dev;
	},
	browser: false,
	building: false
}));
vi.mock('$env/dynamic/private', () => ({
	get env() {
		return state.env;
	}
}));

import { sendOtp } from './otp';
import { captureHandled } from '@veent/core';

const PHONE = '+639171234567';
const CODE = '123456';

function mockFetch(response: Partial<Response> & { ok: boolean }) {
	// Default a successful iTexMo body (Error: false, one recipient Accepted).
	const full = {
		json: async () => ({ Error: false, Accepted: 1, Failed: 0 }),
		text: async () => '',
		...response
	} as Response;
	const fn = vi.fn().mockResolvedValue(full);
	vi.stubGlobal('fetch', fn);
	return fn;
}

const LOCAL = '09171234567'; // PHONE converted to iTexMo's local format

/** Set all three iTexMo credentials so sendOtp attempts a real send. */
function configure() {
	state.env.ITEXMO_API_CODE = 'test-code';
	state.env.ITEXMO_EMAIL = 'me@example.com';
	state.env.ITEXMO_PASSWORD = 'secret';
}

beforeEach(() => {
	state.dev = false;
	state.env = {};
	vi.unstubAllGlobals();
	vi.clearAllMocks();
	insertValues.mockResolvedValue(undefined);
});

/**
 * The delivery-log insert is fire-and-forget (`void`-ed), so it is NOT part of sendOtp's own
 * await chain — sendOtp can resolve before the insert's promise settles. Flush the microtask
 * queue before asserting on it, or the assertion races the thing it is meant to prove.
 */
const flush = () => new Promise((r) => setImmediate(r));

describe('sendOtp (iTexMo)', () => {
	// Cast is the coded default now, so iTexMo must be selected explicitly.
	beforeEach(() => {
		state.env.SMS_PROVIDER = 'itexmo';
	});

	it('POSTs the code to the iTexMo broadcast API with a JSON body when configured', async () => {
		configure();
		const fetchFn = mockFetch({ ok: true });

		await sendOtp(PHONE, CODE);

		expect(fetchFn).toHaveBeenCalledTimes(1);
		const [url, opts] = fetchFn.mock.calls[0];
		expect(url).toBe('https://api.itexmo.com/api/broadcast-otp');
		expect(opts.method).toBe('POST');
		const body = JSON.parse(opts.body as string);
		expect(body.ApiCode).toBe('test-code');
		expect(body.Email).toBe('me@example.com');
		expect(body.Password).toBe('secret');
		expect(body.Recipients).toEqual([LOCAL]); // E.164 converted to local 09… format
		expect(body.Message).toContain(CODE);
		expect(body.SenderId).toBeUndefined(); // omitted unless ITEXMO_SENDER_ID is set
	});

	it('includes SenderId when ITEXMO_SENDER_ID is set', async () => {
		configure();
		state.env.ITEXMO_SENDER_ID = 'ITM.TEST3';
		const fetchFn = mockFetch({ ok: true });

		await sendOtp(PHONE, CODE);

		const body = JSON.parse(fetchFn.mock.calls[0][1].body as string);
		expect(body.SenderId).toBe('ITM.TEST3');
	});

	it('throws when the API accepts no recipient (Accepted: 0)', async () => {
		configure();
		mockFetch({ ok: true, json: async () => ({ Error: false, Accepted: 0, Failed: 1 }) });

		await expect(sendOtp(PHONE, CODE)).rejects.toThrow(/iTexMo SMS rejected/);
	});

	it('throws (with the gateway body) on a non-OK HTTP response', async () => {
		configure();
		mockFetch({ ok: false, status: 500, text: async () => 'gateway down' });

		await expect(sendOtp(PHONE, CODE)).rejects.toThrow(/500.*gateway down/);
	});

	it('throws when the API responds with Error: true', async () => {
		configure();
		mockFetch({ ok: true, json: async () => ({ Error: true, Message: 'invalid api code' }) });

		await expect(sendOtp(PHONE, CODE)).rejects.toThrow(/invalid api code/);
	});

	it('throws in production when unconfigured and never calls the gateway', async () => {
		state.dev = false; // production
		const fetchFn = mockFetch({ ok: true });

		await expect(sendOtp(PHONE, CODE)).rejects.toThrow(/iTexMo not configured/);
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('falls back to the console in dev when unconfigured (no gateway call)', async () => {
		state.dev = true; // dev
		const fetchFn = mockFetch({ ok: true });
		const info = vi.spyOn(console, 'info').mockImplementation(() => {});

		await expect(sendOtp(PHONE, CODE)).resolves.toBeUndefined();
		expect(fetchFn).not.toHaveBeenCalled();
		expect(info).toHaveBeenCalledWith(expect.stringContaining(CODE));
	});
});

/** Cast success body; the default mockFetch body is iTexMo-shaped. */
const castOk = { json: async () => ({ success: true, message_id: 'CAST123' }) };

describe('sendOtp (Cast — default provider)', () => {
	it('POSTs the code to the Cast OTP API with the E.164 number as-is', async () => {
		state.env.CAST_API_KEY = 'cast_test_key';
		const fetchFn = mockFetch({ ok: true, ...castOk });

		await sendOtp(PHONE, CODE); // SMS_PROVIDER unset — Cast is the default

		expect(fetchFn).toHaveBeenCalledTimes(1);
		const [url, opts] = fetchFn.mock.calls[0];
		expect(url).toBe('https://api.cast.ph/api/v1/otp/send');
		expect(opts.method).toBe('POST');
		expect(opts.headers['x-api-key']).toBe('cast_test_key');
		const body = JSON.parse(opts.body as string);
		expect(body.to).toBe(PHONE); // E.164, no reformatting
		expect(body.message).toContain(CODE);
		expect(body.sender_id).toBeUndefined(); // omitted unless CAST_SENDER_ID is set
	});

	it('includes sender_id when CAST_SENDER_ID is set', async () => {
		state.env.CAST_API_KEY = 'cast_test_key';
		state.env.CAST_SENDER_ID = 'PARAFIBER';
		const fetchFn = mockFetch({ ok: true, ...castOk });

		await sendOtp(PHONE, CODE);

		const body = JSON.parse(fetchFn.mock.calls[0][1].body as string);
		expect(body.sender_id).toBe('PARAFIBER');
	});

	it('throws (surfacing error_code) when the API responds success: false', async () => {
		state.env.CAST_API_KEY = 'cast_test_key';
		mockFetch({
			ok: true,
			json: async () => ({ success: false, error_code: 'INSUFFICIENT_CREDITS', error: 'no credits' })
		});

		await expect(sendOtp(PHONE, CODE)).rejects.toThrow(/INSUFFICIENT_CREDITS/);
	});

	it('throws on a non-OK HTTP response', async () => {
		state.env.CAST_API_KEY = 'cast_test_key';
		mockFetch({ ok: false, status: 502, json: async () => null });

		await expect(sendOtp(PHONE, CODE)).rejects.toThrow(/Cast SMS rejected \(502\)/);
	});

	it('throws in production when unconfigured and never calls the gateway', async () => {
		state.dev = false; // production
		const fetchFn = mockFetch({ ok: true, ...castOk });

		await expect(sendOtp(PHONE, CODE)).rejects.toThrow(/Cast not configured/);
		expect(fetchFn).not.toHaveBeenCalled();
	});
});

/**
 * Delivery-log persistence. A gateway ACCEPT is not a DELIVERY, so every accepted send is
 * recorded for the sweep cron to re-check against Cast's DLR endpoint.
 */
describe('sendOtp — delivery-log persistence', () => {
	it('(a) records the provider, Cast message id and MASKED phone after a successful accept', async () => {
		state.env.CAST_API_KEY = 'cast_test_key';
		mockFetch({ ok: true, ...castOk });

		await sendOtp(PHONE, CODE);
		await flush();

		expect(insertValues).toHaveBeenCalledTimes(1);
		const row = insertValues.mock.calls[0][0];
		expect(row.provider).toBe('cast');
		expect(row.providerMessageId).toBe('CAST123');
		// Masked only — the raw E.164 number must never be persisted.
		expect(row.phoneMasked).toBe('+63 ••• ••• 4567');
		expect(row.phoneMasked).not.toContain('9171234');
	});

	it('records a row with a null message id for a provider that returns none (iTexMo)', async () => {
		state.env.SMS_PROVIDER = 'itexmo';
		configure();
		mockFetch({ ok: true });

		await sendOtp(PHONE, CODE);
		await flush();

		expect(insertValues).toHaveBeenCalledTimes(1);
		expect(insertValues.mock.calls[0][0]).toMatchObject({
			provider: 'itexmo',
			providerMessageId: null
		});
	});

	it('(b) does NOT fail the OTP send when the delivery-log insert fails', async () => {
		state.env.CAST_API_KEY = 'cast_test_key';
		mockFetch({ ok: true, ...castOk });
		insertValues.mockRejectedValue(new Error('db down'));

		// The whole point: a logging failure degrades to a Sentry warning, never a failed login.
		await expect(sendOtp(PHONE, CODE)).resolves.toBeUndefined();

		// Must flush first — the insert is void-ed, so its catch handler has not run yet when
		// sendOtp resolves. Asserting here without the flush would pass even if the rejection
		// escaped the try/catch entirely, laundering the exact bug this test exists to catch.
		await flush();
		expect(captureHandled).toHaveBeenCalledTimes(1);
		expect(captureHandled).toHaveBeenCalledWith(
			expect.any(Error),
			expect.objectContaining({ tags: { area: 'otp-send-log' } })
		);
	});

	it('does not write a row when the gateway rejects the send', async () => {
		state.env.CAST_API_KEY = 'cast_test_key';
		mockFetch({ ok: true, json: async () => ({ success: false, error: 'no credits' }) });

		await expect(sendOtp(PHONE, CODE)).rejects.toThrow();
		await flush();

		expect(insertValues).not.toHaveBeenCalled();
	});
});

/** (c) Provider dispatch: a typo must fail loudly instead of silently routing to Cast. */
describe('sendOtp — provider dispatch', () => {
	it('throws on an unrecognized non-empty SMS_PROVIDER and never calls a gateway', async () => {
		state.env.CAST_API_KEY = 'cast_test_key';
		state.env.SMS_PROVIDER = 'twilio';
		const fetchFn = mockFetch({ ok: true, ...castOk });

		await expect(sendOtp(PHONE, CODE)).rejects.toThrow(/Unrecognized SMS_PROVIDER: "twilio"/);
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it.each([undefined, '', '   ', 'cast', 'CAST'])(
		'routes SMS_PROVIDER=%p to Cast',
		async (value) => {
			state.env.CAST_API_KEY = 'cast_test_key';
			if (value !== undefined) state.env.SMS_PROVIDER = value;
			const fetchFn = mockFetch({ ok: true, ...castOk });

			await sendOtp(PHONE, CODE);

			expect(fetchFn.mock.calls[0][0]).toBe('https://api.cast.ph/api/v1/otp/send');
		}
	);

	it.each([
		['smsgate', 'https://api.sms-gate.app/3rdparty/v1/messages'],
		['unisms', 'https://unismsapi.com/api/sms'],
		['itexmo', 'https://api.itexmo.com/api/broadcast-otp']
	])('still routes SMS_PROVIDER=%s to its own gateway', async (provider, url) => {
		state.env.SMS_PROVIDER = provider;
		configure();
		state.env.UNISMS_SECRET_KEY = 'sk_test';
		state.env.UNISMS_SENDER_ID = 'VEENT';
		state.env.SMSGATE_USERNAME = 'u';
		state.env.SMSGATE_PASSWORD = 'p';
		const fetchFn = mockFetch({
			ok: true,
			json: async () => ({
				Error: false,
				Accepted: 1,
				message: { status: 'queued' },
				id: 'sg-1',
				state: 'Pending'
			})
		});

		await sendOtp(PHONE, CODE);

		expect(fetchFn.mock.calls[0][0]).toBe(url);
	});
});
