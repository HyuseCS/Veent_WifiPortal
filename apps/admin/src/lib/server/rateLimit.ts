import type { RequestEvent } from '@sveltejs/kit';
import { consumeRateLimit } from '@veent/core';
import { db } from '$lib/server/db';

/**
 * Generic request rate limiting for admin endpoints (login, exports), backed by the shared
 * `consumeRateLimit` primitive (@veent/core, `rate_limits` table) under distinct scopes.
 * Email-send limiting lives in `emailRateLimit.ts`.
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
