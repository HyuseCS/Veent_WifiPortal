import { fail, type RequestEvent } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { auth } from '$lib/server/auth';
import { rateLimit, clientIp } from '$lib/server/rateLimit';
import { isTotpCode } from '$lib/server/twoFactor';

/**
 * TOTP step-up verification, shared by the high-stakes actions that re-prompt for the
 * acting user's authenticator code (the staff promote/owner-change flow has its own copy
 * of this; /content uses this one). Per-IP rate limit, then verify the 6-digit code
 * against better-auth.
 *
 * Returns an `ActionFailure` (tagged with `action` so the page can surface the message on
 * the right form) to hand straight back, or `null` when the code is valid.
 */
export async function verifyStepUp(
	event: RequestEvent,
	code: string,
	opts: { scope: string; action: string }
) {
	// Key the throttle on the acting account (step-up is always authenticated): rotating IPs
	// can't sidestep it, and users behind a shared NAT don't throttle each other. IP is only a
	// fallback for the should-never-happen case of no resolved user.
	const identifier = event.locals.user?.id ?? clientIp(event);
	const rl = await rateLimit(opts.scope, identifier, 5, 15 * 60 * 1000);
	if (!rl.allowed) {
		return fail(429, { action: opts.action, error: 'Too many attempts. Please wait a few minutes.' });
	}
	if (!isTotpCode(code)) {
		return fail(400, { action: opts.action, error: 'Enter the 6-digit code from your authenticator.' });
	}
	try {
		await auth.api.verifyTOTP({ body: { code }, headers: event.request.headers });
	} catch (err) {
		if (err instanceof APIError) {
			return fail(400, { action: opts.action, error: 'Invalid authenticator code.' });
		}
		return fail(500, { action: opts.action, error: 'Unexpected error' });
	}
	return null;
}
