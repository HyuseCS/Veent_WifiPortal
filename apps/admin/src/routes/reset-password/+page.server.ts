import { fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { auth } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

/** Reset landing for a member who followed the emailed link. The token comes from
 * the ?token= query. Unauthenticated by design — they can't sign in yet. */
export const load: PageServerLoad = (event) => {
	const token = event.url.searchParams.get('token') ?? '';
	return { hasToken: token.length > 0 };
};

export const actions: Actions = {
	default: async (event) => {
		const form = await event.request.formData();
		const token = String(form.get('token') ?? '');
		const password = String(form.get('password') ?? '');
		const confirm = String(form.get('confirm') ?? '');

		if (!token) return fail(400, { message: 'Missing or invalid reset link.' });
		if (password.length < 8) {
			return fail(400, { message: 'Password must be at least 8 characters.' });
		}
		if (password !== confirm) return fail(400, { message: 'Passwords do not match.' });

		try {
			// Sets the new password and consumes the token. The onPasswordReset hook in auth.ts
			// only re-activates *pending* members, so an already-active member's status is
			// untouched here — and mandatory TOTP still gates the next sign-in.
			await auth.api.resetPassword({ body: { newPassword: password, token } });
		} catch (err) {
			if (err instanceof APIError) {
				return fail(400, { message: 'This reset link is invalid or has expired.' });
			}
			throw err;
		}

		return redirect(302, '/login?reset=1');
	}
};
