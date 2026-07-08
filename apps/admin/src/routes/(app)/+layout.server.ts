import { redirect } from '@sveltejs/kit';
import { getAdminRole } from '@veent/core';
import { db } from '$lib/server/db';
import { refreshAdminBypass } from '$lib/server/adminBypass';
import { unreadCount } from '$lib/server/notifications';
import type { LayoutServerLoad } from './$types';

/** Auth guard for every page in the (app) shell: only signed-in staff get in.
 * Also surfaces the staff member's role so the sidebar + owner-only pages can gate
 * on a server-provided value (never trust a client flag). */
export const load: LayoutServerLoad = async (event) => {
	if (!event.locals.user) {
		return redirect(302, '/login');
	}
	// Mandatory TOTP: active staff who haven't enrolled yet can't reach any (app) page
	// until they set up a second factor. (Checked before the role read to skip a query.)
	if (!event.locals.user.twoFactorEnabled) {
		return redirect(302, '/enroll-2fa');
	}
	// Slide this staff device's internet bypass forward on activity (fire-and-forget, throttled —
	// see adminBypass.ts). Never awaited: it must not add latency to or fail a page load.
	void refreshAdminBypass(event);

	const role = await getAdminRole(db, event.locals.user.id);
	// Global unread incident-activity count → drives the sidebar Incidents badge on every page.
	const issuesUnread = await unreadCount(db, event.locals.user.id);
	return {
		user: { ...event.locals.user, role },
		issuesUnread
	};
};
