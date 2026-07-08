import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { renderSVG } from 'uqr';
import { auth } from '$lib/server/auth';
import { APIError } from 'better-auth/api';
import { isTotpCode, secretFromTotpUri } from '$lib/server/twoFactor';
import { finishStaffSignIn } from '$lib/server/postLogin';
import { logger } from '$lib/server/logger';

const log = logger('enroll-2fa');

/**
 * Mandatory TOTP enrollment. Reached by any authenticated staff member who hasn't
 * enrolled yet (the (app) layout redirects them here). Two steps on one page:
 *   1) ?/enable  — password-gated; stores a fresh secret and returns the QR +
 *                  backup codes (shown ONCE). Does not yet flip twoFactorEnabled.
 *   2) ?/confirm — verifyTOTP on the authenticated session flips twoFactorEnabled
 *                  = true, then we redirect to the dashboard.
 */
export const load: PageServerLoad = (event) => {
	// Must be signed in (hooks only sets locals.user for active staff)…
	if (!event.locals.user) {
		return redirect(302, '/login');
	}
	// …and not already enrolled (else there's nothing to do here).
	if ((event.locals.user as { twoFactorEnabled?: boolean }).twoFactorEnabled) {
		return redirect(302, '/dashboard');
	}
	return {};
};

export const actions: Actions = {
	enable: async (event) => {
		const formData = await event.request.formData();
		const password = formData.get('password')?.toString() ?? '';
		if (!password) return fail(400, { step: 'enable', message: 'Enter your password.' });

		try {
			const res = await auth.api.enableTwoFactor({
				body: { password },
				headers: event.request.headers
			});
			// Render the otpauth:// URI to an inline SVG server-side — no client QR component.
			const qrSvg = renderSVG(res.totpURI);
			// Pull the raw secret out of the otpauth URI for the manual-entry fallback.
			const secret = secretFromTotpUri(res.totpURI);
			return { step: 'confirm', qrSvg, secret, backupCodes: res.backupCodes };
		} catch (error) {
			if (error instanceof APIError) {
				return fail(400, { step: 'enable', message: 'Incorrect password. Please try again.' });
			}
			log.error('2FA enable unexpected error:', error);
			return fail(500, { step: 'enable', message: 'Unexpected error' });
		}
	},

	confirm: async (event) => {
		const formData = await event.request.formData();
		const code = formData.get('code')?.toString().trim() ?? '';
		// Enrollment confirm only accepts a freshly-generated TOTP (not a backup code).
		// The secret + backup codes are shown once (from ?/enable); carry them through so a
		// mistyped code keeps them on screen. NB: the QR is deliberately NOT round-tripped —
		// it's rendered via {@html}, so re-emitting client-posted markup would be an injection
		// vector. The manual key (secret, text) stays available for re-entry instead.
		const echo = {
			step: 'confirm' as const,
			secret: formData.get('secret')?.toString() ?? '',
			backupCodes: (formData.get('backupCodes')?.toString() ?? '').split('\n').filter(Boolean)
		};

		if (!isTotpCode(code)) {
			return fail(400, { ...echo, message: 'Enter the 6-digit code from your app.' });
		}

		let res;
		try {
			// On an authenticated session with twoFactorEnabled still false, a valid code
			// flips it true and refreshes the session. headers → reads the session cookie.
			res = await auth.api.verifyTOTP({ body: { code }, headers: event.request.headers });
		} catch (error) {
			if (error instanceof APIError) {
				return fail(400, { ...echo, message: 'Invalid code. Please try again.' });
			}
			log.error('2FA verify unexpected error:', error);
			return fail(500, { ...echo, message: 'Unexpected error' });
		}

		// A second factor is now established — this is the first-login moment where the device bypass
		// may safely be granted (L-2: the direct-login path withheld it). Best-effort inside the gate.
		const userId = res?.user?.id ?? event.locals.user!.id;
		const token = res?.token ?? event.locals.session?.token;
		const denied = await finishStaffSignIn(event, userId, token, { grantDevice: true });
		if (denied) return denied;

		return redirect(302, '/dashboard');
	}
};
