// ⚠️ TEMPORARY — open admin registration. DELETE THIS ROUTE BEFORE PRODUCTION.
//
// Browser-based equivalent of `bun run bootstrap:owner`: anyone who submits this
// form gets a fully active OWNER account. There is intentionally NO gate, so while
// this route exists it is an open admin-account hole. It is a dev convenience only —
// remove `src/routes/register/` (and the temp link in login/+page.svelte) before prod.
import { fail, redirect } from '@sveltejs/kit';
import { APIError } from 'better-auth/api';
import { STAFF_ROLE, STAFF_STATUS } from '@veent/core';
import { adminProfile } from '@veent/db';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const load: PageServerLoad = (event) => {
	if (event.locals.user) {
		return redirect(302, '/dashboard');
	}
	return {};
};

export const actions: Actions = {
	default: async (event) => {
		const formData = await event.request.formData();
		const name = String(formData.get('name') ?? '').trim();
		const email = String(formData.get('email') ?? '')
			.trim()
			.toLowerCase();
		const password = String(formData.get('password') ?? '');

		if (!name || !email || !password) {
			return fail(400, { message: 'Name, email, and password are all required.' });
		}
		if (!emailPattern.test(email)) {
			return fail(400, { message: 'Enter a valid email address.' });
		}
		if (password.length < 8) {
			return fail(400, { message: 'Password must be at least 8 characters.' });
		}

		// Create the better-auth user. autoSignIn (on by default) + the sveltekitCookies
		// plugin set the session cookie on this response, so the user lands authenticated —
		// same mechanism the login `signInEmail` action relies on.
		let userId: string;
		try {
			const res = await auth.api.signUpEmail({ body: { name, email, password } });
			userId = res.user.id;
		} catch (error) {
			if (error instanceof APIError) {
				return fail(400, { message: 'An account with that email already exists.' });
			}
			return fail(500, { message: 'Unexpected error creating the account.' });
		}

		// Mint a fully active owner (mirrors scripts/bootstrap-owner.ts). Upsert so a
		// re-submit after a partial run still converges on owner/active.
		await db
			.insert(adminProfile)
			.values({ userId, role: STAFF_ROLE.owner, status: STAFF_STATUS.active })
			.onConflictDoUpdate({
				target: adminProfile.userId,
				set: { role: STAFF_ROLE.owner, status: STAFF_STATUS.active }
			});

		return redirect(302, '/dashboard');
	}
};
