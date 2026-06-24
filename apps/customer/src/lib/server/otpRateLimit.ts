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

/** Thrown when an identifier has exhausted its OTP-send budget for the window. */
export class RateLimitError extends Error {
	readonly retryAfterSec: number;
	constructor(retryAfterSec: number) {
		super('Too many code requests.');
		this.name = 'RateLimitError';
		this.retryAfterSec = retryAfterSec;
	}
}

/**
 * Check-and-record one OTP send against the phone and (if present) the device
 * MAC. Throws RateLimitError if either identifier is over budget.
 */
export async function enforceOtpSendLimit(phone: string, mac?: string): Promise<void> {
	const now = new Date();
	const checks = [consumeRateLimit(db, { key: { phoneNumber: phone }, max: OTP_SENDS_PER_HOUR, now })];
	if (mac) {
		checks.push(consumeRateLimit(db, { key: { macAddress: mac }, max: OTP_SENDS_PER_HOUR, now }));
	}

	const blocked = (await Promise.all(checks)).filter((r) => !r.allowed);
	if (blocked.length > 0) {
		const retryAtMs = blocked.reduce(
			(latest, r) => Math.max(latest, r.retryAt?.getTime() ?? now.getTime()),
			0
		);
		throw new RateLimitError(Math.max(1, Math.ceil((retryAtMs - now.getTime()) / 1000)));
	}
}

/** "try again in ~12 minutes" — friendly retry phrasing for the UI. */
export function retryAfterMessage(retryAfterSec: number): string {
	const mins = Math.ceil(retryAfterSec / 60);
	return mins <= 1
		? 'Too many code requests. Please wait a minute and try again.'
		: `Too many code requests. Please try again in about ${mins} minutes.`;
}
