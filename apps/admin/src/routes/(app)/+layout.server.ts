import { redirect } from '@sveltejs/kit';
import { getAdminRole } from '@veent/core';
import { db } from '$lib/server/db';
import { DASH_LAYOUT_COOKIE, parseDashLayout } from '$lib/dashboard-layout';
import type { LayoutServerLoad } from './$types';

/** Auth guard for every page in the (app) shell: only signed-in staff get in.
 * Also surfaces the staff member's role so the sidebar + owner-only pages can gate
 * on a server-provided value (never trust a client flag), and the persisted dashboard
 * layout so the header switcher + dashboard grid render the saved arrangement on load. */
export const load: LayoutServerLoad = async (event) => {
	if (!event.locals.user) {
		return redirect(302, '/login');
	}
	const role = await getAdminRole(db, event.locals.user.id);
	return {
		user: { ...event.locals.user, role },
		dashLayout: parseDashLayout(event.cookies.get(DASH_LAYOUT_COOKIE))
	};
};
