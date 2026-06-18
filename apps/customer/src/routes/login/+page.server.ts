import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '$lib/server/auth';
import { normalizePhone } from '$lib/phone';
import { PENDING_COOKIE, PENDING_MAX_AGE, serializePending } from '$lib/server/otp';
import { getPortalContext } from '$lib/server/portal';
import { dev } from '$app/environment';

export const load: PageServerLoad = (event) => {
	if (event.locals.user) {
		return redirect(302, '/dashboard');
	}
	return {};
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

		await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: phone } });

		// Stash the captive-portal device MAC alongside the pending verification, so
		// the dashboard can grant access after verify regardless of cookie survival.
		const mac = getPortalContext(event)?.mac;
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
