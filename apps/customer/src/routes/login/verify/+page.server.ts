import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { APIError } from 'better-auth/api';
import { auth, setUserName } from '$lib/server/auth';
import { PENDING_COOKIE, PENDING_MAX_AGE, maskPhone, parsePending, serializePending } from '$lib/server/otp';
import { dev } from '$app/environment';

export const load: PageServerLoad = (event) => {
	if (event.locals.user) {
		return redirect(302, '/connected');
	}
	const pending = parsePending(event.cookies.get(PENDING_COOKIE));
	if (!pending) {
		// No code in flight (expired or never started) — back to the start.
		return redirect(303, '/login');
	}
	return { maskedPhone: maskPhone(pending.phone), intent: pending.intent };
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

		// Apply the name captured at registration (signUpOnVerification seeds a
		// temporary one).
		if (pending.intent === 'register' && pending.name) {
			await setUserName(pending.phone, pending.name);
		}

		event.cookies.delete(PENDING_COOKIE, { path: '/' });
		return redirect(303, '/dashboard');
	},

	resend: async (event) => {
		const pending = parsePending(event.cookies.get(PENDING_COOKIE));
		if (!pending) {
			return redirect(303, '/login');
		}

		await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: pending.phone } });

		// Refresh the pending-cookie window so it doesn't expire before the new code.
		event.cookies.set(
			PENDING_COOKIE,
			serializePending({ phone: pending.phone, intent: pending.intent, name: pending.name }),
			{ path: '/', httpOnly: true, sameSite: 'lax', secure: !dev, maxAge: PENDING_MAX_AGE }
		);

		return { resent: true };
	}
};
