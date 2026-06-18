import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '$lib/server/auth';
import { APIError } from 'better-auth/api';
import { getStaffStatus, STAFF_STATUS, grantAdminAccess, resolveDeviceMac } from '@veent/core';
import { db } from '$lib/server/db';
import { network } from '$lib/server/network';

export const load: PageServerLoad = (event) => {
	if (event.locals.user) {
		return redirect(302, '/dashboard');
	}
	return {};
};

export const actions: Actions = {
	signInEmail: async (event) => {
		const formData = await event.request.formData();
		const email = formData.get('email')?.toString() ?? '';
		const password = formData.get('password')?.toString() ?? '';

		let userId: string;
		try {
			const res = await auth.api.signInEmail({ body: { email, password } });
			userId = res.user.id;
		} catch (error) {
			if (error instanceof APIError) {
				return fail(400, { message: error.message || 'Sign in failed' });
			}
			return fail(500, { message: 'Unexpected error' });
		}

		// Only active staff may sign in. Pending invitees and disabled members are
		// signed straight back out (the cookie was just set by signInEmail).
		const status = await getStaffStatus(db, userId);
		if (status !== STAFF_STATUS.active) {
			await auth.api.signOut({ headers: event.request.headers });
			const message =
				status === STAFF_STATUS.pending
					? 'Your account is not activated yet — check your activation email.'
					: 'Your account is not active. Contact the owner.';
			return fail(403, { message });
		}

		// Active staff get instant internet on their device: resolve the MAC from
		// the LAN IP (the admin URL is walled-garden-whitelisted, so there's no
		// captive-portal `?mac=` to read) and drop the firewall. Best-effort — a
		// failed/​unsupported grant (e.g. dev stub) must never block sign-in.
		try {
			const mac = await resolveDeviceMac(network, event.getClientAddress());
			if (mac) await grantAdminAccess(network, mac);
		} catch (err) {
			console.error('[admin] device internet grant on sign-in failed:', err);
		}

		return redirect(302, '/dashboard');
	}
	// Public self-registration intentionally removed: admin accounts are created
	// only by owner invitation (see /(app)/staff → ?/invite). Bootstrap the first
	// owner with `bun run bootstrap:owner` in apps/admin.
};
