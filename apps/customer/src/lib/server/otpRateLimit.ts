import { consumeRateLimit } from '@veent/core';
import { db } from '$lib/server/db';

/**
 * OTP-send throttle for the captive portal. Composes the shared, transactional
 * `consumeRateLimit` primitive (@veent/core, backed by the `rate_limits` table)
 * over BOTH the phone number and the device MAC.
 *
 * Without it, `/login` and the verify-page `resend` hit the SMS gateway with no
 * cap, so a number can be spammed and the operator's SMS credits drained (each
 * send bills one — iTexMo's `TotalCreditUsed`). This is the wiring the architecture
 * review flagged as the top-priority fix (docs/ARCHITECTURE_REVIEW.md).
 *
 * Policy: OTP_SENDS_PER_HOUR per identifier per rolling hour (a higher cap than
 * the primitive's grace-grant default, which is for a different flow).
 */
const OTP_SENDS_PER_HOUR = 5;
// Per-source send cap (M-3). The per-phone cap only protects an individual number; it does nothing
// against one source requesting 5 codes each across an enumerable PH mobile space to drain the
// operator's paid SMS balance. A per-IP axis bounds the aggregate a single source can send.
const OTP_SENDS_PER_HOUR_IP = 20;

// OTP *verify* budget (H-1). The send limiter above only bounds fresh codes; without a
// verify cap the 3-attempt guard in better-auth's phoneNumber plugin is a non-atomic
// read-check-write that a concurrency race defeats, making the 6-digit code brute-forceable.
// Per-phone is the axis that directly bounds guesses against ONE victim's live code; per-IP
// and per-MAC add a cap on a single source enumerating many numbers. Generous for legit use
// (1–3 attempts) but infeasible against a 10^6 space. Keyed under `scope` so these counters
// never share a row with the send limiter's phone/mac column counters.
const OTP_VERIFY_PER_HOUR_PHONE = 10;
const OTP_VERIFY_PER_HOUR_IP = 20;
const OTP_VERIFY_PER_HOUR_MAC = 20;

/** Thrown when an identifier has exhausted its OTP budget for the window. */
export class RateLimitError extends Error {
	readonly retryAfterSec: number;
	constructor(retryAfterSec: number) {
		super('Too many code requests.');
		this.name = 'RateLimitError';
		this.retryAfterSec = retryAfterSec;
	}
}

/** Throw a RateLimitError (with the furthest retry-at) if any check came back blocked. */
function throwIfBlocked(results: { allowed: boolean; retryAt: Date | null }[], now: Date): void {
	const blocked = results.filter((r) => !r.allowed);
	if (blocked.length === 0) return;
	const retryAtMs = blocked.reduce(
		(latest, r) => Math.max(latest, r.retryAt?.getTime() ?? now.getTime()),
		0
	);
	throw new RateLimitError(Math.max(1, Math.ceil((retryAtMs - now.getTime()) / 1000)));
}

/**
 * Check-and-record one OTP send against the phone and (if present) the device
 * MAC. Throws RateLimitError if either identifier is over budget.
 */
export async function enforceOtpSendLimit(phone: string, mac?: string, ip?: string): Promise<void> {
	const now = new Date();
	const checks = [
		consumeRateLimit(db, { key: { phoneNumber: phone }, max: OTP_SENDS_PER_HOUR, now })
	];
	if (mac) {
		checks.push(consumeRateLimit(db, { key: { macAddress: mac }, max: OTP_SENDS_PER_HOUR, now }));
	}
	if (ip) {
		checks.push(
			consumeRateLimit(db, {
				key: { scope: 'otp_send:ip', identifier: ip },
				max: OTP_SENDS_PER_HOUR_IP,
				now
			})
		);
	}
	throwIfBlocked(await Promise.all(checks), now);
}

/**
 * Check-and-record one OTP *verify* attempt against the target phone and (if present) the
 * device MAC and client IP. Throws RateLimitError when any axis is over budget. Call this
 * BEFORE handing the code to better-auth so a burst of guesses can't outrun its attempt
 * counter (H-1).
 */
export async function enforceOtpVerifyLimit(
	phone: string,
	mac?: string,
	ip?: string
): Promise<void> {
	const now = new Date();
	const checks = [
		consumeRateLimit(db, {
			key: { scope: 'otp_verify:phone', identifier: phone },
			max: OTP_VERIFY_PER_HOUR_PHONE,
			now
		})
	];
	if (ip) {
		checks.push(
			consumeRateLimit(db, {
				key: { scope: 'otp_verify:ip', identifier: ip },
				max: OTP_VERIFY_PER_HOUR_IP,
				now
			})
		);
	}
	if (mac) {
		checks.push(
			consumeRateLimit(db, {
				key: { scope: 'otp_verify:mac', identifier: mac },
				max: OTP_VERIFY_PER_HOUR_MAC,
				now
			})
		);
	}
	throwIfBlocked(await Promise.all(checks), now);
}

/** "try again in ~12 minutes" — friendly retry phrasing for the UI. */
export function retryAfterMessage(retryAfterSec: number): string {
	const mins = Math.ceil(retryAfterSec / 60);
	return mins <= 1
		? 'Too many code requests. Please wait a minute and try again.'
		: `Too many code requests. Please try again in about ${mins} minutes.`;
}
