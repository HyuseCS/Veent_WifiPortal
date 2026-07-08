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

		// Per-account lockout (L-2): the per-IP cap above doesn't stop a distributed source from
		// guessing ONE account's password across rotating IPs. Cap attempts per email too. Generous
		// (10/15min) so a legitimate one-shot sign-in is never locked; the generic message leaks no
		// account-existence signal. Keyed on the normalized email under its own scope.
		if (email) {
			const acct = await rateLimit('admin_login_account', email.trim().toLowerCase(), 10, 15 * 60 * 1000);
			if (!acct.allowed) {
				return fail(429, { message: 'Too many sign-in attempts. Please wait a few minutes.' });
			}
		}

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

		// Not-yet-enrolled staff have a real session now; run the shared gate inline. This path is
		// ONLY reached by an unenrolled user (enrolled staff diverted to /login/2fa above), so grant
		// NO device bypass here — a password-only half-login must not get internet (L-2). The bypass
		// fires once they prove a second factor at the /enroll-2fa confirm step. They'll be sent to
		// /enroll-2fa by the (app) layout.
		const denied = await finishStaffSignIn(event, userId, res.token, { grantDevice: false });
		if (denied) return denied;

		return redirect(302, '/dashboard');
	}
	// Public self-registration intentionally removed: admin accounts are created
	// only by owner invitation (see /(app)/staff → ?/invite). Bootstrap the first
	// owner with `bun run bootstrap:owner` in apps/admin.
};
