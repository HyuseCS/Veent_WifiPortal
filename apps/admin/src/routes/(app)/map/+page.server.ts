import { db } from '$lib/server/db';
import { listNetworkHealth } from '$lib/server/queries';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ networks: await listNetworkHealth(db) });
