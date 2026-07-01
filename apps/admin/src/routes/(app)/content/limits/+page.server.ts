import { fail } from '@sveltejs/kit';
import { getSessionLimits, updateSessionLimits } from '@veent/core';
import { db } from '$lib/server/db';
import { requireOwner as ownerGate } from '$lib/server/auth-guard';
import { verifyStepUp } from '$lib/server/step-up';
import { parseIntField } from '$lib/server/formValidation';
import type { Actions, PageServerLoad } from './$types';

// Section-level owner gate lives in content/+layout.server.ts; the save action re-asserts it.
export const load: PageServerLoad = async () => ({ limits: await getSessionLimits(db) });

const requireOwner = (userId: string | undefined) =>
	ownerGate(userId, 'Only the owner can manage content.');

export const actions: Actions = {
	save: async (event) => {
		const denied = await requireOwner(event.locals.user?.id);
		if (denied) return denied;

		const form = await event.request.formData();
		const maxDevicesPerAccount = parseIntField(form, 'maxDevicesPerAccount', { min: 1, max: 20 });
		const freeTimeMinutes = parseIntField(form, 'freeTimeMinutes', { min: 1, max: 1440 });
		const freeTimeCooldownHours = parseIntField(form, 'freeTimeCooldownHours', { min: 0, max: 168 });

		if (maxDevicesPerAccount === null) {
			return fail(400, { error: 'Device cap must be a whole number from 1 to 20.' });
		}
		if (freeTimeMinutes === null) {
			return fail(400, { error: 'Free-time minutes must be a whole number from 1 to 1440.' });
		}
		if (freeTimeCooldownHours === null) {
			return fail(400, { error: 'Cooldown hours must be a whole number from 0 to 168.' });
		}

		// Step-up last: a valid TOTP code confirms the save (after the values validate).
		const stepUp = await verifyStepUp(event, String(form.get('code') ?? ''), {
			scope: 'admin_content_step_up',
			action: 'save'
		});
		if (stepUp) return stepUp;

		await updateSessionLimits(db, {
			maxDevicesPerAccount,
			freeTimeMinutes,
			freeTimeCooldownHours
		});
		return { ok: true };
	}
};
