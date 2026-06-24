import type { RequestEvent } from '@sveltejs/kit';
import { consumeRateLimit } from '@veent/core';
import { db } from '$lib/server/db';

/**
 * Generic request rate limiting for non-OTP customer endpoints (grant, webhook), backed by
 * the shared `consumeRateLimit` primitive (@veent/core, `rate_limits` table) under distinct
 * scopes. OTP-send limiting lives in `otpRateLimit.ts` (separate scope/columns).
 */

const HOUR = 60 * 60 * 1000;

/** Client IP with the IPv4-mapped-IPv6 prefix (`::ffff:`) stripped. */
export function clientIp(event: RequestEvent): string {
	return event.getClientAddress().replace(/^::ffff:/, '');
}

/** Consume one slot for a (scope, identifier) counter. Returns the limiter result. */
export function rateLimit(scope: string, identifier: string, max: number, windowMs = HOUR) {
	return consumeRateLimit(db, { key: { scope, identifier }, max, windowMs });
}

/**
 * Cron-endpoint IP allowlist: when `CRON_IP_ALLOWLIST` (comma-separated IPs) is set, only
 * those source IPs may call. Unset → no IP restriction (the shared `CRON_SECRET` still
 * applies). Returns true if allowed.
 */
export function cronIpAllowed(event: RequestEvent, allowlist: string | undefined): boolean {
	const allow = allowlist?.split(',').map((s) => s.trim()).filter(Boolean);
	if (!allow?.length) return true;
	return allow.includes(clientIp(event));
}
