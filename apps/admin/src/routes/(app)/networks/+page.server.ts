import { db } from '$lib/server/db';
import { network } from '$lib/server/network';
import { refreshNetworkHealth } from '@veent/core';
import { listNetworkHealth } from '$lib/server/queries';
import type { PageServerLoad } from './$types';

/** Per-interface health for the Networks page. Pulls a live sample from the router
 * (link/users/throughput) into `network_health` on view, then reads it back. The
 * refresh is best-effort: on the stub controller or a router error it's a no-op and
 * we show the last-known rows. (The (app) layout already guards auth.) */
export const load: PageServerLoad = async () => {
	try {
		await refreshNetworkHealth(db, network);
	} catch (err) {
		console.error('[admin] network health refresh failed:', err);
	}
	return { networks: await listNetworkHealth(db) };
};
