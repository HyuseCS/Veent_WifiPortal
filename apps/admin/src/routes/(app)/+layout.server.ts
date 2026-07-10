import { redirect } from '@sveltejs/kit';
import { getAdminRole } from '@veent/core';
import { db } from '$lib/server/db';
import { refreshAdminBypass } from '$lib/server/adminBypass';
import { unreadCount, listNotifications } from '$lib/server/notifications';
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

	// Independent reads — run them together so a page load waits on one round-trip, not several.
	// issuesUnread drives the sidebar Incidents badge on every page. The bell's notification LIST is
	// loaded HERE too (not in the /issues sub-layout) so it survives the (app)-level error boundary:
	// an error thrown under /issues renders (app)/+error.svelte, which drops sub-layout data — so a
	// list loaded in /issues/+layout would vanish while issuesUnread (this layout) stays, leaving the
	// bell showing a count over an empty dropdown. Only queried on /issues* routes, where the bell shows.
	const onIssues = event.url.pathname.startsWith('/issues');
	const [role, issuesUnread, notifications] = await Promise.all([
		getAdminRole(db, event.locals.user.id),
		unreadCount(db, event.locals.user.id),
		onIssues ? listNotifications(db, event.locals.user.id) : Promise.resolve([])
	]);
	return {
		user: { ...event.locals.user, role },
		issuesUnread,
		notifications
	};
};
