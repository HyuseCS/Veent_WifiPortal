// Mobile "Unresolved issues" page. Shares the dashboard's resolve/ignore actions (the row forms
// post to ?/resolve on THIS route), but loads issues only — it never renders the volume chart, so
// there's no reason to make getDashboard()'s extra stats fetch.
import { getIssues, isSentryConfigured } from '$lib/server/sentry';
import type { PageServerLoad } from './$types';
import { _managerContext } from '../+page.server';

export { actions } from '../+page.server';

export const load: PageServerLoad = async (event) => {
	const { user } = await event.parent();
	const ctx = await _managerContext(user);
	if (!isSentryConfigured()) return { configured: false as const, ...ctx };
	return { ...(await getIssues()), ...ctx };
};
