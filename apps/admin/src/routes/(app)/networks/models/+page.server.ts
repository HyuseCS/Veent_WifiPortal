import { fail, redirect } from '@sveltejs/kit';
import { STAFF_ROLE } from '@veent/core';
import { db } from '$lib/server/db';
import { requireOwner as ownerGate } from '$lib/server/auth-guard';
import {
	listRouterModels,
	createRouterModel,
	updateRouterModel,
	deleteRouterModel
} from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';

/** Re-asserts owner from the DB (never trust client state) for the mutating actions. */
const requireOwner = (userId: string | undefined) =>
	ownerGate(userId, 'Only the owner can manage router models.');

/** Owner-only catalog editor. The whole page is gated, not just the actions: a non-owner who
 * navigates here is bounced back to the Networks overview rather than shown an empty editor. */
export const load: PageServerLoad = async (event) => {
	const { user } = await event.parent();
	if (user.role !== STAFF_ROLE.owner) redirect(302, '/networks');
	return { models: await listRouterModels(db) };
};

/** Slug for a new model id: lowercase alphanumerics + single hyphens, 2–48 chars. It's the
 * immutable key stored on network_health.model, so it must be URL/identifier-safe. */
function modelSlug(raw: FormDataEntryValue | null): string | null {
	const s = String(raw ?? '').trim().toLowerCase();
	return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) && s.length >= 2 && s.length <= 48 ? s : null;
}

/** Display name: non-empty, trimmed, capped. */
function modelName(raw: FormDataEntryValue | null): string | null {
	const s = String(raw ?? '').trim();
	return s.length >= 1 && s.length <= 60 ? s : null;
}

/** Advertised range in metres: integer in the same sane band the map enforces. */
function modelRange(raw: FormDataEntryValue | null): number | null {
	const n = Math.round(Number(String(raw ?? '').trim()));
	return Number.isFinite(n) && n >= 10 && n <= 5000 ? n : null;
}

export const actions: Actions = {
	/** Add a router/AP model to the catalog. Owner-only (it's fleet-wide config). */
	addModel: async (event) => {
		const denied = await requireOwner(event.locals.user?.id);
		if (denied) return denied;

		const form = await event.request.formData();
		const id = modelSlug(form.get('id'));
		const name = modelName(form.get('name'));
		const rangeMeters = modelRange(form.get('rangeMeters'));
		if (!id || !name || rangeMeters === null) {
			return fail(400, { action: 'addModel', error: 'Check the id, name, and range (10–5000 m).' });
		}
		// Reject a duplicate id rather than letting the PK violation surface as a 500.
		if ((await listRouterModels(db)).some((m) => m.id === id)) {
			return fail(409, { action: 'addModel', error: `A model with id "${id}" already exists.` });
		}
		await createRouterModel(db, { id, name, rangeMeters });
		return { ok: true, action: 'addModel', id };
	},

	/** Edit a model's name + advertised range (id is immutable). Owner-only. */
	updateModel: async (event) => {
		const denied = await requireOwner(event.locals.user?.id);
		if (denied) return denied;

		const form = await event.request.formData();
		const id = modelSlug(form.get('id'));
		const name = modelName(form.get('name'));
		const rangeMeters = modelRange(form.get('rangeMeters'));
		if (!id || !name || rangeMeters === null) {
			return fail(400, { action: 'updateModel', error: 'Check the name and range (10–5000 m).' });
		}
		if (!(await listRouterModels(db)).some((m) => m.id === id)) {
			return fail(404, { action: 'updateModel', error: 'That model no longer exists.' });
		}
		await updateRouterModel(db, id, { name, rangeMeters });
		return { ok: true, action: 'updateModel', id };
	},

	/** Remove a model from the catalog. Owner-only. Blocks deleting the last model — the
	 *  catalog must never be empty (the app treats the first model as the default). APs on a
	 *  deleted model fall back to the default range (loose ref, no FK), so no orphan cleanup. */
	deleteModel: async (event) => {
		const denied = await requireOwner(event.locals.user?.id);
		if (denied) return denied;

		const id = modelSlug((await event.request.formData()).get('id'));
		if (!id) return fail(400, { action: 'deleteModel', error: 'Unknown model.' });

		const models = await listRouterModels(db);
		if (!models.some((m) => m.id === id)) {
			return fail(404, { action: 'deleteModel', error: 'That model no longer exists.' });
		}
		if (models.length <= 1) {
			return fail(400, { action: 'deleteModel', error: 'Keep at least one model in the catalog.' });
		}
		await deleteRouterModel(db, id);
		return { ok: true, action: 'deleteModel', id };
	}
};
