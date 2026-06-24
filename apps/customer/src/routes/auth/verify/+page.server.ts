import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { APIError } from 'better-auth/api';
import { auth } from '$lib/server/auth';
import {
	PENDING_COOKIE,
	PENDING_MAX_AGE,
	maskPhone,
	parsePending,
	serializePending
} from '$lib/server/otp';
import { enforceOtpSendLimit, RateLimitError, retryAfterMessage } from '$lib/server/otpRateLimit';
import { dev } from '$app/environment';

export const load: PageServerLoad = (event) => {
	if (event.locals.user) {
		return redirect(302, '/dashboard');
	}
	const pending = parsePending(event.cookies.get(PENDING_COOKIE));
	if (!pending) {
		// No code in flight (expired or never started) — back to the start.
		return redirect(303, '/login');
	}
	return { maskedPhone: maskPhone(pending.phone) };
};

export const actions: Actions = {
	verify: async (event) => {
		const pending = parsePending(event.cookies.get(PENDING_COOKIE));
		if (!pending) {
			return redirect(303, '/login');
		}

		const code = (await event.request.formData()).get('code')?.toString().replace(/\D/g, '') ?? '';
		if (!/^\d{6}$/.test(code)) {
			return fail(400, { message: 'Enter the 6-digit code.' });
		}

		try {
			// Verifies the code, sets phone_number_verified, signs the user in (and,
			// for a new number, creates the account via signUpOnVerification). The
			// session cookie is set through the sveltekitCookies plugin.
			await auth.api.verifyPhoneNumber({ body: { phoneNumber: pending.phone, code } });
		} catch (error) {
			if (error instanceof APIError) {
				return fail(400, { message: 'That code is incorrect or expired. Try again.' });
			}
			throw error;
		}

		event.cookies.delete(PENDING_COOKIE, { path: '/' });
		// Carry the device MAC into the dashboard URL so the grant works even if the
		// captive browser dropped our cookie along the way.
		const dest = pending.mac ? `/dashboard?mac=${encodeURIComponent(pending.mac)}` : '/dashboard';
		return redirect(303, dest);
	},

	resend: async (event) => {
		const pending = parsePending(event.cookies.get(PENDING_COOKIE));
		if (!pending) {
			return redirect(303, '/login');
		}

		// Same per-phone + per-MAC throttle as the initial send — resend is the
		// other unauthenticated path into the SMS gateway.
		try {
			await enforceOtpSendLimit(pending.phone, pending.mac);
		} catch (error) {
			if (error instanceof RateLimitError) {
				return fail(429, { message: retryAfterMessage(error.retryAfterSec) });
			}
			throw error;
		}

		await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: pending.phone } });

		// Refresh the pending-cookie window so it doesn't expire before the new code.
		event.cookies.set(
			PENDING_COOKIE,
			serializePending({ phone: pending.phone, intent: pending.intent, mac: pending.mac }),
			{
				path: '/',
				httpOnly: true,
				sameSite: 'lax',
				secure: !dev,
				maxAge: PENDING_MAX_AGE
			}
		);

		return { resent: true };
	}
};
