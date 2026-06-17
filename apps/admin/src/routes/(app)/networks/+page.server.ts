import { db } from '$lib/server/db';
import { listNetworkHealth } from '$lib/server/queries';
import type { PageServerLoad } from './$types';

/** Per-AP health for the Networks page. Sample data until a real router/controller
 * telemetry feed writes to `network_health`. (The (app) layout already guards auth.) */
export const load: PageServerLoad = async () => {
	return { networks: await listNetworkHealth(db) };
};
