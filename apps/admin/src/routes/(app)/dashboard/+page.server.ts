import { db } from '$lib/server/db';
import { dashboardKpis, revenueByDay, listActiveSessions } from '$lib/server/queries';
import type { PageServerLoad } from './$types';

/**
 * Dashboard data. Returns `kpis`, `revenue`, and an initial `activeSessions`
 * snapshot in the shapes from `$lib/types`. The page can swap its `$lib/mocks`
 * imports for `data`, and subscribe to /api/connected (SSE) for live session
 * updates instead of polling. (The (app) layout already guards auth.)
 */
export const load: PageServerLoad = async () => {
	const [kpis, revenue, activeSessions] = await Promise.all([
		dashboardKpis(db),
		revenueByDay(db),
		listActiveSessions(db)
	]);
	return { kpis, revenue, activeSessions };
};
