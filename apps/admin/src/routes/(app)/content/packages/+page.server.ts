import { error, fail, type RequestEvent } from '@sveltejs/kit';
import { STAFF_ROLE } from '@veent/core';
import { db } from '$lib/server/db';
import { requireOwner as ownerGate } from '$lib/server/auth-guard';
import { verifyStepUp } from '$lib/server/step-up';
import {
	listPackages,
	createPackage,
	updatePackage,
	setPackageActive,
	deletePackage,
	PACKAGE_TYPES,
	type PackageInput,
	type PackageType
} from '$lib/server/packages';
import type { Actions, PageServerLoad } from './$types';

/** Owner-only page: manage purchasable packages — the CMS "Package Control". */
export const load: PageServerLoad = async (event) => {
	const { user } = await event.parent();
	if (user.role !== STAFF_ROLE.owner) {
		throw error(403, 'Only the owner can manage packages.');
	}
	return { packages: await listPackages(db) };
};

/** Re-assert owner from the DB (never trust client state) on every mutation. */
const requireOwner = (userId: string | undefined) =>
	ownerGate(userId, 'Only the owner can manage packages.');

const isType = (v: string): v is PackageType => (PACKAGE_TYPES as readonly string[]).includes(v);

/**
 * Parse + validate a package form into a normalized input, enforcing the per-type required
 * fields so a customer-facing offer is never half-configured (a bundle with no price, a tier
 * with no duration). Returns the input or a human error string.
 */
function parsePackage(form: FormData): { input: PackageInput } | { error: string } {
	const name = String(form.get('name') ?? '').trim();
	const type = String(form.get('type') ?? '');
	if (!name) return { error: 'Name is required.' };
	if (!isType(type)) return { error: 'Pick a valid package type.' };

	// '' → null (field not applicable to this type); a non-numeric entry → NaN flag.
	const num = (key: string): number | null => {
		const raw = String(form.get(key) ?? '').trim();
		if (raw === '') return null;
		const n = Number(raw);
		return Number.isFinite(n) && n >= 0 ? n : NaN;
	};
	const fiatCost = num('fiatCost');
	const creditsProvided = num('creditsProvided');
	const creditCost = num('creditCost');
	const pointsCost = num('pointsCost');
	const durationMinutes = num('durationMinutes');
	if (
		[fiatCost, creditsProvided, creditCost, pointsCost, durationMinutes].some((v) =>
			Number.isNaN(v)
		)
	) {
		return { error: 'Numeric fields must be non-negative numbers.' };
	}

	if (type === 'bundle' && (fiatCost == null || creditsProvided == null)) {
		return { error: 'A bundle needs a peso price and the credits it provides.' };
	}
	if (type === 'tier') {
		if (creditCost == null || pointsCost == null || durationMinutes == null) {
			return { error: 'A tier needs a credit cost, a points cost, and a duration (minutes).' };
		}
		// Zero is saveable by `num` (>= 0) but unbuyable: `spend*Tx` rejects a non-positive amount,
		// which the buy action can only surface as a misleading "grant failed" 502. Require > 0.
		if (creditCost <= 0 || pointsCost <= 0 || durationMinutes <= 0) {
			return { error: 'A tier’s credit cost, points cost, and duration must be greater than zero.' };
		}
	}
	if (type === 'free') {
		if (durationMinutes == null) {
			return { error: 'Free Time needs a duration (minutes).' };
		}
		if (durationMinutes <= 0) {
			return { error: 'Free Time’s duration must be greater than zero.' };
		}
	}

	const int = (v: number | null) => (v == null ? null : Math.trunc(v));
	return {
		input: {
			name,
			type,
			fiatCost,
			creditsProvided: int(creditsProvided),
			creditCost: int(creditCost),
			pointsCost: int(pointsCost),
			durationMinutes: int(durationMinutes),
			isActive: form.get('isActive') === 'on' || form.get('isActive') === 'true'
		}
	};
}

function packageId(form: FormData): number | null {
	const id = Number(form.get('id'));
	return Number.isInteger(id) && id > 0 ? id : null;
}

// Every content write is owner-only AND TOTP step-up-gated (a deliberate code per save, so a
// fat-fingered change can't land without re-confirming identity). The code is the LAST gate —
// checked after field validation so a rotating code isn't wasted on an unrelated form error.
const stepUp = (event: RequestEvent, code: FormDataEntryValue | null, action: string) =>
	verifyStepUp(event, String(code ?? ''), { scope: 'admin_content_step_up', action });

export const actions: Actions = {
	create: async (event) => {
		const denied = await requireOwner(event.locals.user?.id);
		if (denied) return denied;
		const form = await event.request.formData();
		const parsed = parsePackage(form);
		if ('error' in parsed) return fail(400, { action: 'create', error: parsed.error });
		const denied2 = await stepUp(event, form.get('code'), 'create');
		if (denied2) return denied2;
		const id = await createPackage(db, parsed.input);
		return { ok: true, action: 'create', id };
	},

	update: async (event) => {
		const denied = await requireOwner(event.locals.user?.id);
		if (denied) return denied;
		const form = await event.request.formData();
		const id = packageId(form);
		if (id == null) return fail(400, { action: 'update', error: 'Invalid package.' });
		const parsed = parsePackage(form);
		if ('error' in parsed) return fail(400, { action: 'update', error: parsed.error, id });
		const denied2 = await stepUp(event, form.get('code'), 'update');
		if (denied2) return denied2;
		await updatePackage(db, id, parsed.input);
		return { ok: true, action: 'update', id };
	},

	toggleActive: async (event) => {
		const denied = await requireOwner(event.locals.user?.id);
		if (denied) return denied;
		const form = await event.request.formData();
		const id = packageId(form);
		if (id == null) return fail(400, { action: 'toggleActive', error: 'Invalid package.' });
		const denied2 = await stepUp(event, form.get('code'), 'toggleActive');
		if (denied2) return denied2;
		await setPackageActive(db, id, form.get('isActive') === 'true');
		return { ok: true, action: 'toggleActive', id };
	},

	remove: async (event) => {
		const denied = await requireOwner(event.locals.user?.id);
		if (denied) return denied;
		const form = await event.request.formData();
		const id = packageId(form);
		if (id == null) return fail(400, { action: 'remove', error: 'Invalid package.' });
		const denied2 = await stepUp(event, form.get('code'), 'remove');
		if (denied2) return denied2;
		await deletePackage(db, id);
		return { ok: true, action: 'remove', id };
	}
};
