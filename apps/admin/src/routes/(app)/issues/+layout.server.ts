import { db } from '$lib/server/db';
import { listNotifications } from '$lib/server/notifications';
import type { LayoutServerLoad } from './$types';

/**
 * Notification list for the Topbar bell, shared by every /issues* route (the board AND the
 * detail page) so the dropdown has data wherever the bell is shown — the bell reads it from
 * `page.data`. The global unread COUNT (badge) comes from the (app) layout; this is just the list.
 */
export const load: LayoutServerLoad = async (event) => {
	const { user } = await event.parent();
	return { notifications: await listNotifications(db, user.id) };
};
