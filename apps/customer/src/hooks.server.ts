import type { Handle } from '@sveltejs/kit';
import { building } from '$app/environment';
import { auth } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { capturePortalContext } from '$lib/server/portal';

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	// Stash the device MAC / callback from the captive-portal redirect before the
	// auth flow's redirects drop the query string.
	capturePortalContext(event);

	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

export const handle: Handle = handleBetterAuth;
