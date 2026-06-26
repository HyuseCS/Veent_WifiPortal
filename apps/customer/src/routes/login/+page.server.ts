import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '$lib/server/auth';
import { normalizePhone } from '$lib/phone';
import { PENDING_COOKIE, PENDING_MAX_AGE, serializePending } from '$lib/server/otp';
import { enforceOtpSendLimit, RateLimitError, retryAfterMessage } from '$lib/server/otpRateLimit';
import { getPortalContext } from '$lib/server/portal';
import { dev } from '$app/environment';

export const load: PageServerLoad = (event) => {
	if (event.locals.user) {
		return redirect(302, '/dashboard');
	}
	// An "Open in your browser" handoff link that was already used or has expired bounces here
	// with ?handoff=expired (see /auth/handoff) — surface a gentle note so the guest just logs in.
	return { handoffExpired: event.url.searchParams.get('handoff') === 'expired' };
};

export const actions: Actions = {
	// One unified phone-only entry: validate the number, text a one-time code, then
	// hand off to /auth/verify. There is no separate sign-up — a first-time number
	// is created automatically on first successful verification
	// (signUpOnVerification in $lib/server/auth), so we no longer gate on whether
	// an account already exists.
	default: async (event) => {
		const formData = await event.request.formData();
		const phoneRaw = formData.get('phone')?.toString() ?? '';
		const phone = normalizePhone(phoneRaw);

		if (!phone) {
			return fail(400, { phone: phoneRaw, message: 'Enter a valid Philippine mobile number.' });
		}

		// Throttle sends per phone + device MAC BEFORE hitting the SMS gateway, so a
		// number can't be spammed and operator credits can't be drained.
		const mac = getPortalContext(event)?.mac;
		try {
			await enforceOtpSendLimit(phone, mac);
		} catch (error) {
			if (error instanceof RateLimitError) {
				return fail(429, { phone: phoneRaw, message: retryAfterMessage(error.retryAfterSec) });
			}
			throw error;
		}

		await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: phone } });

		// Stash the captive-portal device MAC alongside the pending verification, so
		// the dashboard can grant access after verify regardless of cookie survival.
		event.cookies.set(PENDING_COOKIE, serializePending({ phone, intent: 'login', mac }), {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: !dev,
			maxAge: PENDING_MAX_AGE
		});

		return redirect(303, '/auth/verify');
	}
};
