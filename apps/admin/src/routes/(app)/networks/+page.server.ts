import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { network } from '$lib/server/network';
import { refreshNetworkHealth } from '@veent/core';
import { listNetworkHealth, setNetworkInterface } from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';

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

export const actions: Actions = {
	/** Bind this pin to a router AP/interface (or clear it) for user attribution. */
	setInterface: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!Number.isInteger(id)) return fail(400, { error: 'Invalid access point.' });

		const interfaceName = String(form.get('interfaceName') ?? '').trim() || null;
		await setNetworkInterface(db, id, interfaceName);
		return { id, boundInterface: true };
	}
};
