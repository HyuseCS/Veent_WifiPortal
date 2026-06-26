import { fail } from '@sveltejs/kit';
import { getAdminRole, getSessionLimits, updateSessionLimits, STAFF_ROLE } from '@veent/core';
import { db } from '$lib/server/db';
import type { Actions, PageServerLoad } from './$types';

// Section-level owner gate lives in content/+layout.server.ts; the save action re-asserts it.
export const load: PageServerLoad = async () => ({ limits: await getSessionLimits(db) });

async function requireOwner(userId: string | undefined) {
	if (!userId || (await getAdminRole(db, userId)) !== STAFF_ROLE.owner) {
		return fail(403, { error: 'Only the owner can manage content.' });
	}
	return null;
}

/** Parse a required positive integer within [min, max]; returns NaN on anything invalid. */
function intIn(form: FormData, key: string, min: number, max: number): number {
	const raw = String(form.get(key) ?? '').trim();
	const n = Number(raw);
	if (raw === '' || !Number.isInteger(n) || n < min || n > max) return NaN;
	return n;
}

export const actions: Actions = {
	save: async (event) => {
		const denied = await requireOwner(event.locals.user?.id);
		if (denied) return denied;

		const form = await event.request.formData();
		const maxDevicesPerAccount = intIn(form, 'maxDevicesPerAccount', 1, 20);
		const freeTimeMinutes = intIn(form, 'freeTimeMinutes', 1, 1440);
		const freeTimeCooldownHours = intIn(form, 'freeTimeCooldownHours', 0, 168);

		if (Number.isNaN(maxDevicesPerAccount)) {
			return fail(400, { error: 'Device cap must be a whole number from 1 to 20.' });
		}
		if (Number.isNaN(freeTimeMinutes)) {
			return fail(400, { error: 'Free-time minutes must be a whole number from 1 to 1440.' });
		}
		if (Number.isNaN(freeTimeCooldownHours)) {
			return fail(400, { error: 'Cooldown hours must be a whole number from 0 to 168.' });
		}

		await updateSessionLimits(db, {
			maxDevicesPerAccount,
			freeTimeMinutes,
			freeTimeCooldownHours
		});
		return { ok: true };
	}
};
