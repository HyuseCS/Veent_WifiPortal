import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * H-1: the OTP *verify* throttle. These specs pin the routing logic — which axes are consumed,
 * that verify counters live in a SEPARATE namespace from sends (so they can't share a budget),
 * and that each axis blocks independently — by mocking the shared `consumeRateLimit` primitive.
 * No DB: the primitive's own atomicity is covered in @veent/core.
 */
const state = vi.hoisted(() => ({
	seen: [] as { scope?: string; identifier?: string; phoneNumber?: string; macAddress?: string }[],
	blocked: new Set<string>() // keys, as `${scope|col}:${value}`, that report over-budget
}));

function keyId(key: {
	scope?: string;
	identifier?: string;
	phoneNumber?: string;
	macAddress?: string;
}): string {
	if (key.scope) return `${key.scope}:${key.identifier}`;
	if (key.phoneNumber) return `phoneNumber:${key.phoneNumber}`;
	if (key.macAddress) return `macAddress:${key.macAddress}`;
	return 'unknown';
}

vi.mock('$lib/server/db', () => ({ db: {} }));
vi.mock('@veent/core', () => ({
	consumeRateLimit: vi.fn(async (_db: unknown, opts: { key: Record<string, string> }) => {
		state.seen.push(opts.key);
		const allowed = !state.blocked.has(keyId(opts.key));
		return { allowed, remaining: allowed ? 1 : 0, retryAt: allowed ? null : new Date(60_000) };
	})
}));

import { enforceOtpVerifyLimit, enforceOtpSendLimit, RateLimitError } from './otpRateLimit';

const PHONE = '+639171234567';
const MAC = 'AA:BB:CC:DD:EE:FF';
const IP = '1.2.3.4';

beforeEach(() => {
	state.seen = [];
	state.blocked.clear();
});

describe('enforceOtpVerifyLimit', () => {
	it('consumes phone, ip, and mac axes under the otp_verify: namespace', async () => {
		await enforceOtpVerifyLimit(PHONE, MAC, IP);
		expect(state.seen).toContainEqual({ scope: 'otp_verify:phone', identifier: PHONE });
		expect(state.seen).toContainEqual({ scope: 'otp_verify:ip', identifier: IP });
		expect(state.seen).toContainEqual({ scope: 'otp_verify:mac', identifier: MAC });
		// Never the bare phone/mac COLUMN keys the send limiter uses — separate rows.
		expect(state.seen.some((k) => k.phoneNumber || k.macAddress)).toBe(false);
	});

	it('throttles when the per-phone budget is exhausted', async () => {
		state.blocked.add(`otp_verify:phone:${PHONE}`);
		await expect(enforceOtpVerifyLimit(PHONE, MAC, IP)).rejects.toBeInstanceOf(RateLimitError);
	});

	it('blocks per-IP independently of per-phone', async () => {
		state.blocked.add(`otp_verify:ip:${IP}`);
		// Same phone, a different (un-blocked) IP still passes.
		await expect(enforceOtpVerifyLimit(PHONE, MAC, '9.9.9.9')).resolves.toBeUndefined();
		// The blocked IP is rejected.
		await expect(enforceOtpVerifyLimit(PHONE, MAC, IP)).rejects.toBeInstanceOf(RateLimitError);
	});

	it('works with only a phone (mac/ip optional)', async () => {
		await enforceOtpVerifyLimit(PHONE);
		expect(state.seen).toEqual([{ scope: 'otp_verify:phone', identifier: PHONE }]);
	});
});

describe('enforceOtpSendLimit', () => {
	it('uses phone/mac column keys plus a distinct per-IP scope, never the verify scope', async () => {
		await enforceOtpSendLimit(PHONE, MAC, IP);
		expect(state.seen).toContainEqual({ phoneNumber: PHONE });
		expect(state.seen).toContainEqual({ macAddress: MAC });
		// M-3: per-source cap under its own scope (not the verify namespace).
		expect(state.seen).toContainEqual({ scope: 'otp_send:ip', identifier: IP });
		expect(state.seen.some((k) => k.scope?.startsWith('otp_verify'))).toBe(false);
	});

	it('throttles when the per-IP send budget is exhausted', async () => {
		state.blocked.add(`otp_send:ip:${IP}`);
		await expect(enforceOtpSendLimit(PHONE, MAC, IP)).rejects.toBeInstanceOf(RateLimitError);
	});
});
