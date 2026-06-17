import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { auth, userExistsByPhone } from '$lib/server/auth';
import { normalizePhone } from '$lib/phone';
import { PENDING_COOKIE, PENDING_MAX_AGE, serializePending } from '$lib/server/otp';
import { dev } from '$app/environment';

export const load: PageServerLoad = (event) => {
	if (event.locals.user) {
		return redirect(302, '/dashboard');
	}
	return {};
};

export const actions: Actions = {
	// Login is phone-only: validate the number, confirm an account exists, text a
	// one-time code, then hand off to /login/verify.
	default: async (event) => {
		const formData = await event.request.formData();
		const phoneRaw = formData.get('phone')?.toString() ?? '';
		const phone = normalizePhone(phoneRaw);

		if (!phone) {
			return fail(400, { phone: phoneRaw, message: 'Enter a valid Philippine mobile number.' });
		}

		if (!(await userExistsByPhone(phone))) {
			return fail(404, { phone: phoneRaw, message: 'No account found for this number. Create one first.' });
		}

		await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: phone } });

		event.cookies.set(PENDING_COOKIE, serializePending({ phone, intent: 'login' }), {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: !dev,
			maxAge: PENDING_MAX_AGE
		});

		return redirect(303, '/login/verify');
	}
};
