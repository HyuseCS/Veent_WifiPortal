import { fail } from '@sveltejs/kit';
import { db } from '$lib/server/db';
import {
	clusterMembers,
	createNetworkPlace,
	deleteNetworkPlace,
	listNetworkHealth,
	listRouterModels,
	setClusterName,
	updateNetworkPlace
} from '$lib/server/queries';
import { rangeFor, defaultModelId, type RouterModel } from '$lib/router-models';
import { reachesAny } from '$lib/reach';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => ({
	networks: await listNetworkHealth(db),
	// The catalog feeds the client model picker (and re-sizes domes); ordered with the
	// default model first (see listRouterModels).
	models: await listRouterModels(db)
});

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

/** Catalog-validated model id (unknown/empty → default), so we never persist an orphan.
 * Validated against the live catalog passed in, not a hardcoded list. */
function modelId(raw: FormDataEntryValue | null, models: RouterModel[]): string {
	const m = String(raw ?? '').trim();
	return models.some((r) => r.id === m) ? m : defaultModelId(models);
}

/** Operator-calibrated radius in metres, clamped to a sane band; null if absent/invalid
 * (the catalog range is then used as the fallback). */
function rangeMeters(raw: FormDataEntryValue | null): number | null {
	const n = Math.round(Number(String(raw ?? '').trim()));
	return Number.isFinite(n) && n >= 10 && n <= 5000 ? n : null;
}

/** Coverage-reach join guard: an AP at (lat,lng) with `range` may join cluster `name` only if
 * some existing member's dome reaches it (domes overlap). Empty name or an unpopulated cluster
 * (no other members yet) is always allowed — seeding a new group. */
async function clusterReachable(
	name: string | null,
	lat: number,
	lng: number,
	range: number,
	excludeId: number | null,
	models: RouterModel[]
): Promise<boolean> {
	if (!name) return true;
	const members = await clusterMembers(db, name, excludeId);
	if (members.length === 0) return true;
	// Same overlap math the client clusterer uses (shared `$lib/reach`), so the join
	// guard can't drift from what the operator sees on the map.
	const domes = members
		.filter((m) => m.latitude != null && m.longitude != null)
		.map((m) => ({
			lat: Number(m.latitude),
			lng: Number(m.longitude),
			range: m.rangeMeters ?? rangeFor(models, m.model)
		}));
	return reachesAny(lat, lng, range, domes);
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
		const models = await listRouterModels(db);
		const model = modelId(form.get('model'), models);
		const range = rangeMeters(form.get('range'));
		const cluster = String(form.get('cluster') ?? '').trim() || null;
		if (!(await clusterReachable(cluster, lat, lng, range ?? rangeFor(models, model), null, models))) {
			return fail(400, { error: 'Too far from that cluster.' });
		}
		// Keep full precision from the map click; the column rounds to 6 decimals.
		await createNetworkPlace(db, {
			name,
			latitude: String(lat),
			longitude: String(lng),
			address,
			model,
			rangeMeters: range,
			clusterName: cluster
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
		const models = await listRouterModels(db);
		const model = modelId(form.get('model'), models);
		const range = rangeMeters(form.get('range'));
		const cluster = String(form.get('cluster') ?? '').trim() || null;
		if (!(await clusterReachable(cluster, lat, lng, range ?? rangeFor(models, model), id, models))) {
			return fail(400, { error: 'Too far from that cluster.' });
		}
		await updateNetworkPlace(db, id, {
			name,
			latitude: String(lat),
			longitude: String(lng),
			address,
			model,
			rangeMeters: range,
			clusterName: cluster
		});
		return { updated: true };
	},

	/** Name (or clear) an overlap cluster — mirrors the label across its current members. */
	nameCluster: async ({ request }) => {
		const form = await request.formData();

		const ids = String(form.get('ids') ?? '')
			.split(',')
			.map((s) => apId(s))
			.filter((n): n is number => n !== null);
		if (ids.length === 0) return fail(400, { error: 'No cluster members.' });

		const name = String(form.get('name') ?? '').trim() || null;
		await setClusterName(db, ids, name);
		return { named: true };
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
