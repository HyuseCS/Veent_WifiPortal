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
	const fn = vi.fn().mockResolvedValue(response);
	vi.stubGlobal('fetch', fn);
	return fn;
}

beforeEach(() => {
	state.dev = false;
	state.env = {};
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('sendOtp (Semaphore)', () => {
	it('POSTs the code to Semaphore with form params when configured', async () => {
		state.env.SEMAPHORE_API_KEY = 'test-key';
		const fetchFn = mockFetch({ ok: true });

		await sendOtp(PHONE, CODE);

		expect(fetchFn).toHaveBeenCalledTimes(1);
		const [url, opts] = fetchFn.mock.calls[0];
		expect(url).toBe('https://api.semaphore.co/api/v4/messages');
		expect(opts.method).toBe('POST');
		const body = opts.body as URLSearchParams;
		expect(body.get('apikey')).toBe('test-key');
		expect(body.get('number')).toBe(PHONE);
		expect(body.get('message')).toContain(CODE);
		// No sender name configured → param omitted (uses account default).
		expect(body.get('sendername')).toBeNull();
	});

	it('includes sendername when SEMAPHORE_SENDER_NAME is set', async () => {
		state.env.SEMAPHORE_API_KEY = 'test-key';
		state.env.SEMAPHORE_SENDER_NAME = 'VEENT';
		const fetchFn = mockFetch({ ok: true });

		await sendOtp(PHONE, CODE);

		const body = fetchFn.mock.calls[0][1].body as URLSearchParams;
		expect(body.get('sendername')).toBe('VEENT');
	});

	it('throws (with the gateway error body) on a non-OK response', async () => {
		state.env.SEMAPHORE_API_KEY = 'test-key';
		mockFetch({ ok: false, status: 402, text: async () => 'insufficient credits' });

		await expect(sendOtp(PHONE, CODE)).rejects.toThrow(/402.*insufficient credits/);
	});

	it('throws in production when unconfigured and never calls the gateway', async () => {
		state.dev = false; // production
		const fetchFn = mockFetch({ ok: true });

		await expect(sendOtp(PHONE, CODE)).rejects.toThrow(/Semaphore not configured/);
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
