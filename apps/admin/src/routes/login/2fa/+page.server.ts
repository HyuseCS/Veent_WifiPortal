import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '$lib/server/auth';
import { APIError } from 'better-auth/api';
import { rateLimit, clientIp } from '$lib/server/rateLimit';
import { finishStaffSignIn } from '$lib/server/postLogin';
import { isTotpCode } from '$lib/server/twoFactor';
import { logger } from '$lib/server/logger';

const log = logger('login-2fa');

export const load: PageServerLoad = (event) => {
	// Already fully signed in (session established) → no second factor pending.
	if (event.locals.user) {
		return redirect(302, '/dashboard');
	}
	return {};
};

export const actions: Actions = {
	verify: async (event) => {
		// Blunt brute-forcing of the 6-digit code: 10 attempts / 15 min per IP (mirrors login).
		const rl = await rateLimit('admin_login_2fa_ip', clientIp(event), 10, 15 * 60 * 1000);
		if (!rl.allowed) {
			return fail(429, { message: 'Too many attempts. Please wait a few minutes.' });
		}

		const formData = await event.request.formData();
		const code = formData.get('code')?.toString().trim() ?? '';
		if (!code) return fail(400, { message: 'Enter your authentication code.' });

		// A 6-digit numeric input is a TOTP; anything else is treated as a backup code.
		// Both endpoints need `headers` so the plugin can read the signed two-factor cookie
		// set during signInEmail.
		let res;
		try {
			res = isTotpCode(code)
				? await auth.api.verifyTOTP({ body: { code }, headers: event.request.headers })
				: await auth.api.verifyBackupCode({ body: { code }, headers: event.request.headers });
		} catch (error) {
			if (error instanceof APIError) {
				return fail(400, { message: 'Invalid or expired code. Please try again.' });
			}
			log.error('2FA verify unexpected error:', error);
			return fail(500, { message: 'Unexpected error' });
		}

		// Session is fully established now — safe to run the shared staff gate + device grant.
		// `res.token` is the verified session's token — keys the device MAC we persist for the bypass.
		const denied = await finishStaffSignIn(event, res.user.id, res.token);
		if (denied) return denied;

		return redirect(302, '/dashboard');
	}
};
