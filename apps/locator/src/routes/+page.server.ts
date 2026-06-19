import { db } from '$lib/server/db';
import { listPublicLocations } from '$lib/server/locations';
import type { PageServerLoad } from './$types';

/** Public map data: every AP that has coordinates set. Read-only — the locator
 * never touches routers or internal telemetry. */
export const load: PageServerLoad = async () => {
	return { locations: await listPublicLocations(db) };
};
