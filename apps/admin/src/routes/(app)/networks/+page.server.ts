import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { network } from '$lib/server/network';
import { refreshNetworkHealth } from '@veent/core';
import { listNetworkHealth, setNetworkLocation } from '$lib/server/queries';
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

/** Parse a coordinate input: blank → null (clear); else a finite number within
 * [min, max]. Returns `false` on an invalid value. */
function parseCoord(raw: string, min: number, max: number): string | null | false {
	const v = raw.trim();
	if (v === '') return null;
	const n = Number(v);
	if (!Number.isFinite(n) || n < min || n > max) return false;
	return v;
}

export const actions: Actions = {
	/** Save (or clear) one AP's map coordinates for the public locator. */
	setLocation: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!Number.isInteger(id)) return fail(400, { error: 'Invalid access point.' });

		const latitude = parseCoord(String(form.get('latitude') ?? ''), -90, 90);
		const longitude = parseCoord(String(form.get('longitude') ?? ''), -180, 180);
		if (latitude === false) return fail(400, { id, error: 'Latitude must be between −90 and 90.' });
		if (longitude === false)
			return fail(400, { id, error: 'Longitude must be between −180 and 180.' });
		// Coordinates are a pair — a lone lat or lng won't place a pin.
		if ((latitude === null) !== (longitude === null)) {
			return fail(400, { id, error: 'Set both latitude and longitude, or clear both.' });
		}

		const address = String(form.get('address') ?? '').trim() || null;
		await setNetworkLocation(db, id, { latitude, longitude, address });
		return { id, saved: true };
	}
};
