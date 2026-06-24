import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mutable state both virtual-module mocks read through, so each test can flip
// `dev` and set env without re-importing. `$app/environment`'s `dev` is exposed via
// a getter so the live named import reflects changes between tests.
const state = vi.hoisted(() => ({
	dev: false,
	env: {} as Record<string, string | undefined>
}));

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
});

describe('sendOtp (iTexMo)', () => {
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
