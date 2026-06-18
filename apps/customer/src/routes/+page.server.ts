import { getPortalContext } from '$lib/server/portal';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	// The captive redirect lands here WITH `?mac=`, but captive mini-browsers often
	// drop our cookie before the next navigation. So carry the MAC forward in the
	// link URL — `getPortalContext` reads query params before the cookie, so the
	// dashboard/login page still gets it regardless of cookie survival.
	const ctx = getPortalContext(event);
	const portalQuery = ctx?.mac ? `?mac=${encodeURIComponent(ctx.mac)}` : '';
	return { user: event.locals.user ?? null, portalQuery };
};
