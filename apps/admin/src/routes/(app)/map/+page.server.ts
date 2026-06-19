import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import { createNetworkPlace, listNetworkHealth } from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ networks: await listNetworkHealth(db) });

/** A finite number within [min, max], else null. */
function coord(raw: FormDataEntryValue | null, min: number, max: number): number | null {
	const n = Number(String(raw ?? '').trim());
	return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

export const actions: Actions = {
	/** Drop a new router location on the map (admin-only; the whole app is). */
	addPlace: async ({ request }) => {
		const form = await request.formData();

		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { error: 'Give the place a name.' });

		const lat = coord(form.get('latitude'), -90, 90);
		const lng = coord(form.get('longitude'), -180, 180);
		if (lat === null || lng === null) {
			return fail(400, { error: 'Pick a spot on the map first.' });
		}

		const address = String(form.get('address') ?? '').trim() || null;
		// Keep full precision from the map click; the column rounds to 6 decimals.
		await createNetworkPlace(db, {
			name,
			latitude: String(lat),
			longitude: String(lng),
			address
		});
		return { added: true };
	}
};
