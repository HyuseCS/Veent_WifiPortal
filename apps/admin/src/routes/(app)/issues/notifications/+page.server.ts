import { db } from '$lib/server/db';
import { listNotifications } from '$lib/server/notifications';
import type { PageServerLoad } from './$types';

/**
 * Notification history — every notifiable item on the user's incidents, read and unread. (The
 * mark-read actions live on the /issues index route; this page's forms post there and the reload
 * refreshes this list.) ponytail: capped at 100 — the newest are what matter; raise/paginate if a
 * heavy user ever needs deeper history.
 */
export const load: PageServerLoad = async (event) => {
	const { user } = await event.parent();
	return { history: await listNotifications(db, user.id, { unreadOnly: false, limit: 100 }) };
};
