import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '$lib/server/auth';
import { APIError } from 'better-auth/api';
import { rateLimit, clientIp } from '$lib/server/rateLimit';
import { finishStaffSignIn } from '$lib/server/postLogin';
import { logger } from '$lib/server/logger';

const log = logger('login');

export const load: PageServerLoad = (event) => {
	if (event.locals.user) {
		return redirect(302, '/dashboard');
	}
	return {};
};

export const actions: Actions = {
	signInEmail: async (event) => {
		// Per-IP credential throttle: 10 sign-in attempts per 15 min from one address.
		const rl = await rateLimit('admin_login_ip', clientIp(event), 10, 15 * 60 * 1000);
		if (!rl.allowed) {
			return fail(429, { message: 'Too many sign-in attempts. Please wait a few minutes.' });
		}

		const formData = await event.request.formData();
		const email = formData.get('email')?.toString() ?? '';
		const password = formData.get('password')?.toString() ?? '';

		let res;
		try {
			res = await auth.api.signInEmail({ body: { email, password } });
		} catch (error) {
			if (error instanceof APIError) {
				return fail(400, { message: error.message || 'Sign in failed' });
			}
			log.error('sign-in unexpected error:', error);
			return fail(500, { message: 'Unexpected error' });
		}

		// 2FA-enabled staff get NO session here — only a signed two-factor cookie and
		// this redirect signal. The post-login work (status check + device grant) must
		// wait until TOTP is verified, so hand off to /login/2fa and stop here. (Kept
		// outside the try: redirect() throws and the catch above would swallow it.)
		if ('twoFactorRedirect' in res && res.twoFactorRedirect) {
			return redirect(303, '/login/2fa');
		}
		const userId = res.user.id;

		// Not-yet-enrolled staff have a real session now; run the shared gate inline.
		// (They'll be sent to /enroll-2fa by the (app) layout once on the dashboard.)
		const denied = await finishStaffSignIn(event, userId);
		if (denied) return denied;

		return redirect(302, '/dashboard');
	}
	// Public self-registration intentionally removed: admin accounts are created
	// only by owner invitation (see /(app)/staff → ?/invite). Bootstrap the first
	// owner with `bun run bootstrap:owner` in apps/admin.
};
