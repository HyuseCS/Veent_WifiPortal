import type { Handle } from '@sveltejs/kit';
import { building } from '$app/environment';
import { getStaffStatus, STAFF_STATUS } from '@veent/core';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { svelteKitHandler } from 'better-auth/svelte-kit';

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	const session = await auth.api.getSession({ headers: event.request.headers });

	// Expose the user to app code ONLY while their staff status is `active`. Status is
	// re-checked on every request here (not just at login), so disabling a staff member
	// takes effect immediately for their live session — across pages AND /api — instead
	// of lingering until the cookie expires. A disabled/pending/profile-less session is
	// left unauthenticated (better-auth's own /api/auth/* routes still run, so sign-out
	// works). Note: getSession already hits the DB; this adds one cheap status read.
	if (session) {
		const status = await getStaffStatus(db, session.user.id);
		if (status === STAFF_STATUS.active) {
			event.locals.session = session.session;
			event.locals.user = session.user;
		}
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

export const handle: Handle = handleBetterAuth;
