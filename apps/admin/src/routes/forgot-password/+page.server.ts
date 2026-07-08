import { fail, redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { rateLimit, clientIp } from '$lib/server/rateLimit';
import { checkAdminEmailLimit } from '$lib/server/emailRateLimit';
import type { Actions, PageServerLoad } from './$types';

/** Public — a member who can't sign in has no session. Bounce anyone already in. */
export const load: PageServerLoad = (event) => {
	if (event.locals.user) return redirect(302, '/dashboard');
	return {};
};

export const actions: Actions = {
	default: async (event) => {
		// Per-IP throttle: caps reset-email flooding + enumeration probing from one address.
		const rl = await rateLimit('admin_forgot_ip', clientIp(event), 5, 15 * 60 * 1000);
		if (!rl.allowed) {
			return fail(429, { message: 'Too many requests. Please wait a few minutes and try again.' });
		}

		const form = await event.request.formData();
		const email = form.get('email')?.toString().trim() ?? '';
		if (!email) return fail(400, { message: 'Enter your email address.' });

		// Per-recipient cap (L-9): the per-IP limit above doesn't stop a distributed source (rotating
		// IPs) from mail-bombing ONE staff mailbox. Reuse the same per-recipient limiter the invite path
		// uses. Over cap → silently skip the (paid) send and still return the generic confirmation, so
		// this stays enumeration-safe (the client can't tell a suppressed send from a non-existent one).
		if (await checkAdminEmailLimit(email)) {
			return { sent: true };
		}

		// Fire the reset token → sendResetPassword (auth.ts) mails the /reset-password link.
		// We NEVER reveal whether the address matched an account: any error is swallowed and the
		// same generic confirmation is returned, so this endpoint can't be used to enumerate staff.
		try {
			await auth.api.requestPasswordReset({ body: { email, redirectTo: '/reset-password' } });
		} catch (err) {
			console.warn('[forgot-password] requestPasswordReset error:', (err as Error)?.message);
		}

		return { sent: true };
	}
};
