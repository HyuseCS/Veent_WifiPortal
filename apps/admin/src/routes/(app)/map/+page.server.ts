import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import {
	createNetworkPlace,
	deleteNetworkPlace,
	listNetworkHealth,
	updateNetworkPlace
} from '$lib/server/queries';
import { routerModels, DEFAULT_MODEL_ID } from '$lib/router-models';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({ networks: await listNetworkHealth(db) });

/** A finite number within [min, max], else null. */
function coord(raw: FormDataEntryValue | null, min: number, max: number): number | null {
	const n = Number(String(raw ?? '').trim());
	return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** A positive integer AP id, else null. */
function apId(raw: FormDataEntryValue | null): number | null {
	const n = Number(String(raw ?? '').trim());
	return Number.isInteger(n) && n > 0 ? n : null;
}

/** Catalog-validated model id (unknown/empty → default), so we never persist an orphan. */
function modelId(raw: FormDataEntryValue | null): string {
	const m = String(raw ?? '').trim();
	return routerModels.some((r) => r.id === m) ? m : DEFAULT_MODEL_ID;
}

/** Operator-calibrated radius in metres, clamped to a sane band; null if absent/invalid
 * (the catalog range is then used as the fallback). */
function rangeMeters(raw: FormDataEntryValue | null): number | null {
	const n = Math.round(Number(String(raw ?? '').trim()));
	return Number.isFinite(n) && n >= 10 && n <= 5000 ? n : null;
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
			address,
			model: modelId(form.get('model')),
			rangeMeters: rangeMeters(form.get('range'))
		});
		return { added: true };
	},

	/** Edit an existing operator-placed AP in place (move / rename / re-model / re-address). */
	updatePlace: async ({ request }) => {
		const form = await request.formData();

		const id = apId(form.get('id'));
		if (id === null) return fail(400, { error: 'Unknown access point.' });

		const name = String(form.get('name') ?? '').trim();
		if (!name) return fail(400, { error: 'Give the place a name.' });

		const lat = coord(form.get('latitude'), -90, 90);
		const lng = coord(form.get('longitude'), -180, 180);
		if (lat === null || lng === null) {
			return fail(400, { error: 'Pick a spot on the map first.' });
		}

		const address = String(form.get('address') ?? '').trim() || null;
		await updateNetworkPlace(db, id, {
			name,
			latitude: String(lat),
			longitude: String(lng),
			address,
			model: modelId(form.get('model')),
			rangeMeters: rangeMeters(form.get('range'))
		});
		return { updated: true };
	},

	/** Remove an operator-placed AP. Safe — network_id is a loose link with no FK. */
	deletePlace: async ({ request }) => {
		const form = await request.formData();

		const id = apId(form.get('id'));
		if (id === null) return fail(400, { error: 'Unknown access point.' });

		await deleteNetworkPlace(db, id);
		return { deleted: true };
	}
};
