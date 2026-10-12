import { describe, it, expect, vi, beforeEach } from 'vitest';

const captured = vi.hoisted(() => ({ sendOTP: null as null | ((a: unknown) => Promise<void>) }));
const requestEvent = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$app/environment', () => ({ dev: false }));
vi.mock('$app/server', () => ({ getRequestEvent: () => requestEvent.current }));
vi.mock('better-auth/minimal', () => ({
	betterAuth: () => ({ api: { sendPhoneNumberOTP: vi.fn().mockResolvedValue(undefined) } })
}));
vi.mock('better-auth/adapters/drizzle', () => ({ drizzleAdapter: () => ({}) }));
vi.mock('better-auth/svelte-kit', () => ({ sveltekitCookies: () => ({}) }));
vi.mock('better-auth/plugins', () => ({
	phoneNumber: (opts: { sendOTP: (a: unknown) => Promise<void> }) => {
		captured.sendOTP = opts.sendOTP;
		return {};
	},
	oneTimeToken: () => ({})
}));
vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('$lib/server/otp', () => ({
	PENDING_COOKIE: 'veent-portal-verify',
	PENDING_COOKIE_SECURE: false,
	PENDING_MAX_AGE: 300,
	serializePending: () => 'pending',
	sendOtp: vi.fn().mockResolvedValue(undefined)
}));
vi.mock('$lib/server/otpRateLimit', () => ({
	enforceOtpSendLimit: vi.fn().mockResolvedValue(undefined),
	RateLimitError: class extends Error {},
	retryAfterMessage: () => ''
}));
vi.mock('$lib/server/network', () => ({
	network: {
		listDhcpLeases: vi.fn(async () => [
			{
				mac: '2E:47:8F:2D:35:8F',
				address: '10.210.44.159',
				hostname: null,
				agentCircuitId: 'OLT-9 xpon 0/1/0/4:16.3.70',
				status: 'bound',
				srcMac: 'F4:B7:8D:A6:80:88'
			}
		])
	}
}));

import { actions } from './+page.server';
import { enforceOtpSendLimit } from '$lib/server/otpRateLimit';
import { DEVICE_COOKIE } from '$lib/server/portal';

const RELAY = 'F4:B7:8D:A6:80:88';
const REAL = 'AA:BB:CC:DD:EE:07';

function loginEvent(opts: { qsMac?: string; deviceMac?: string }) {
	const qs = opts.qsMac ? `?mac=${opts.qsMac}` : '';
	return {
		url: new URL(`http://portal/login${qs}`),
		request: { formData: async () => new Map([['phone', '09171234567']]) },
		cookies: {
			get: (n: string) => (n === DEVICE_COOKIE ? opts.deviceMac : undefined),
			set: vi.fn()
		},
		locals: {} as Record<string, unknown>,
		getClientAddress: () => '10.99.9.9'
	} as never;
}

const run = (e: never) => Promise.resolve(actions.default(e)).catch(() => undefined);

describe('login relay MAC guard (FR-009, FR-012)', () => {
	beforeEach(() => vi.clearAllMocks());

	it('relay portal MAC reaches enforceOtpSendLimit as undefined', async () => {
		await run(loginEvent({ qsMac: 'F4-B7-8D-A6-80-88' }));
		expect(enforceOtpSendLimit).toHaveBeenCalledWith('+639171234567', undefined, '10.99.9.9');
	});

	it('relay device cookie reaches enforceOtpSendLimit as undefined', async () => {
		await run(loginEvent({ deviceMac: RELAY }));
		expect(enforceOtpSendLimit).toHaveBeenCalledWith('+639171234567', undefined, '10.99.9.9');
	});

	it('a normal MAC is passed through', async () => {
		await run(loginEvent({ qsMac: REAL }));
		expect(enforceOtpSendLimit).toHaveBeenCalledWith('+639171234567', REAL, '10.99.9.9');
	});

	it('the sendOTP hook with a relay portal MAC calls enforceOtpSendLimit with mac undefined', async () => {
		await import('$lib/server/auth');
		requestEvent.current = {
			url: new URL('http://portal/api/auth/phone-number/send-otp?mac=F4-B7-8D-A6-80-88'),
			cookies: { get: () => undefined, set: vi.fn() },
			locals: {},
			getClientAddress: () => '10.99.9.9'
		};
		await captured.sendOTP!({ phoneNumber: '+639171234567', code: '123456' });
		expect(enforceOtpSendLimit).toHaveBeenCalledWith('+639171234567', undefined, '10.99.9.9');
	});
});
