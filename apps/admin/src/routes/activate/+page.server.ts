import { fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { auth } from '$lib/server/auth';
import type { Actions, PageServerLoad } from './$types';

/** Activation landing for invited staff. The token comes from the emailed link
 * (?token=…). Unauthenticated by design — invitees have no session yet. */
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

		if (!token) return fail(400, { message: 'Missing or invalid activation link.' });
		if (password.length < 8) {
			return fail(400, { message: 'Password must be at least 8 characters.' });
		}
		if (password !== confirm) return fail(400, { message: 'Passwords do not match.' });

		try {
			// Sets the password and consumes the token; the onPasswordReset hook in
			// auth.ts flips the member's status pending → active.
			await auth.api.resetPassword({ body: { newPassword: password, token } });
		} catch (err) {
			if (err instanceof APIError) {
				return fail(400, { message: 'This activation link is invalid or has expired.' });
			}
			throw err;
		}

		return redirect(302, '/login?activated=1');
	}
};
