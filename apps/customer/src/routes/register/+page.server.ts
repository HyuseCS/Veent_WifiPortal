import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { auth, userExistsByPhone } from '$lib/server/auth';
import { normalizePhone } from '$lib/phone';
import { PENDING_COOKIE, PENDING_MAX_AGE, serializePending } from '$lib/server/otp';
import { dev } from '$app/environment';

export const load: PageServerLoad = (event) => {
	if (event.locals.user) {
		return redirect(302, '/connected');
	}
	return {};
};

export const actions: Actions = {
	// Registration collects name + phone. Validate, ensure the number is new, text
	// a one-time code, and carry the name to /login/verify (applied after verify).
	default: async (event) => {
		const formData = await event.request.formData();
		const name = formData.get('name')?.toString().trim() ?? '';
		const phoneRaw = formData.get('phone')?.toString() ?? '';
		const phone = normalizePhone(phoneRaw);

		const errors: { name?: string; phone?: string } = {};
		if (name.length < 2) errors.name = 'Enter your name.';
		if (!phone) errors.phone = 'Enter a valid Philippine mobile number.';

		if (errors.name || errors.phone || !phone) {
			return fail(400, { name, phone: phoneRaw, errors });
		}

		if (await userExistsByPhone(phone)) {
			const dupErrors: { name?: string; phone?: string } = {
				phone: 'This number is already registered. Sign in instead.'
			};
			return fail(409, { name, phone: phoneRaw, errors: dupErrors });
		}

		await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: phone } });

		event.cookies.set(PENDING_COOKIE, serializePending({ phone, intent: 'register', name }), {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: !dev,
			maxAge: PENDING_MAX_AGE
		});

		return redirect(303, '/login/verify');
	}
};
