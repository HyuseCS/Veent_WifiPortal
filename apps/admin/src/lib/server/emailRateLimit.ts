import { consumeRateLimit } from '@veent/core';
import { db } from '$lib/server/db';

/**
 * Rate limiting for transactional admin emails (staff invites, wipe codes) — every send
 * costs money via Resend and risks the sender domain's reputation if abused. Backed by the
 * shared `consumeRateLimit` primitive (@veent/core, `rate_limits` table) under a scope
 * distinct from the customer OTP limiter, so the two never share a counter row.
 *
 * Two caps: per RECIPIENT (anti mail-bomb on one address) and, when the acting staff
 * member is known, per ACTOR (a single compromised owner can't spray many addresses).
 */

const PER_RECIPIENT_PER_HOUR = 5;
const PER_ACTOR_PER_HOUR = 20;
const WINDOW_MS = 60 * 60 * 1000;

export interface EmailLimitBlock {
	/** Which cap tripped, for the operator-facing message. */
	scope: 'recipient' | 'actor';
	retryAt: Date | null;
}

/**
 * Consume one email-send slot. Returns the first cap that blocks, else null (allowed).
 * Note: both caps are consumed even if the first blocks — a rate limiter erring slightly
 * stricter is the safe direction.
 */
export async function checkAdminEmailLimit(
	recipient: string,
	actorId?: string
): Promise<EmailLimitBlock | null> {
	const recip = await consumeRateLimit(db, {
		key: { scope: 'admin_email', identifier: recipient.toLowerCase() },
		max: PER_RECIPIENT_PER_HOUR,
		windowMs: WINDOW_MS
	});
	if (!recip.allowed) return { scope: 'recipient', retryAt: recip.retryAt };

	if (actorId) {
		const actor = await consumeRateLimit(db, {
			key: { scope: 'admin_email_actor', identifier: actorId },
			max: PER_ACTOR_PER_HOUR,
			windowMs: WINDOW_MS
		});
		if (!actor.allowed) return { scope: 'actor', retryAt: actor.retryAt };
	}
	return null;
}
