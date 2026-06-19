import { db } from '$lib/server/db';
import {
	dashboardKpis,
	revenueByDay,
	listActiveSessions,
	listNetworkHealth
} from '$lib/server/queries';
import type { PageServerLoad } from './$types';

/**
 * Dashboard SSR seed: the full snapshot (`kpis`, `revenue`, `activeSessions`, `networks`)
 * in the shapes from `$lib/types`. The page then goes fully live over /api/connected (SSE,
 * event-driven by Postgres triggers); it never polls. The persisted layout choice comes
 * from the (app) layout load, which also guards auth.
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
