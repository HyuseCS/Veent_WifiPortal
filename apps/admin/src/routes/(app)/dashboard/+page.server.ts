import { db } from '$lib/server/db';
import {
	dashboardKpis,
	revenueByDay,
	listActiveSessions,
	listNetworkHealth
} from '$lib/server/queries';
import type { PageServerLoad } from './$types';

/**
 * Dashboard data. Returns `kpis`, `revenue`, an initial `activeSessions` snapshot, and
 * `networks` health in the shapes from `$lib/types`. Live session updates arrive over
 * /api/connected (SSE); the page never polls. The persisted layout choice comes from the
 * (app) layout load. (The (app) layout also guards auth.)
 */
export const load: PageServerLoad = async () => {
	const [kpis, revenue, activeSessions, networks] = await Promise.all([
		dashboardKpis(db),
		revenueByDay(db),
		listActiveSessions(db),
		listNetworkHealth(db)
	]);

	return { kpis, revenue, activeSessions, networks };
};
