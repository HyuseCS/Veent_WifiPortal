import { error, fail } from '@sveltejs/kit';
import { randomUUID } from 'node:crypto';
import { APIError } from 'better-auth/api';
import { getAdminRole, setStaffStatus, removeStaff, STAFF_ROLE, STAFF_STATUS } from '@veent/core';
import { adminProfile } from '@veent/db';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { listStaff } from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Owner-only page: manage staff (admins). Non-owners are blocked outright. */
export const load: PageServerLoad = async (event) => {
	const { user } = await event.parent();
	if (user.role !== STAFF_ROLE.owner) {
		throw error(403, 'Only the owner can manage staff.');
	}
	return { staff: await listStaff(db) };
};

/** Re-asserts owner from the DB (never trust client state) for every mutation. */
async function requireOwner(userId: string | undefined) {
	if (!userId || (await getAdminRole(db, userId)) !== STAFF_ROLE.owner) {
		return fail(403, { error: 'Only the owner can manage staff.' });
	}
	return null;
}

export const actions: Actions = {
	/**
	 * Invite a new admin. Creates a pending (activation-ready) account — NOT a
	 * usable login — then issues a password-reset token; the member sets their
	 * password from the activation link (stub-logged until SMTP lands).
	 */
	invite: async (event) => {
		const denied = await requireOwner(event.locals.user?.id);
		if (denied) return denied;

		const form = await event.request.formData();
		const name = String(form.get('name') ?? '').trim();
		const email = String(form.get('email') ?? '')
			.trim()
			.toLowerCase();

		if (!name || !email) return fail(400, { error: 'Name and email are required.' });
		if (!emailPattern.test(email)) return fail(400, { error: 'Enter a valid email address.' });

		// Create the better-auth account with a throwaway password the invitee never
		// learns; they set their real one on activation. Called server-side without
		// forwarding cookies, so the owner's session is untouched.
		let userId: string;
		try {
			const res = await auth.api.signUpEmail({
				body: { name, email, password: randomUUID() + randomUUID() }
			});
			userId = res.user.id;
		} catch (err) {
			if (err instanceof APIError) {
				return fail(400, { error: 'A staff member with that email already exists.' });
			}
			throw err;
		}

		await db
			.insert(adminProfile)
			.values({ userId, role: STAFF_ROLE.admin, status: STAFF_STATUS.pending })
			.onConflictDoNothing();

		// Issues the reset token → fires sendResetPassword (stub-logs the link).
		await auth.api.requestPasswordReset({ body: { email, redirectTo: '/activate' } });

		return { ok: true, action: 'invite', email };
	},

	/** Enable or disable a staff member (owner protected in the service). */
	setStatus: async (event) => {
		const denied = await requireOwner(event.locals.user?.id);
		if (denied) return denied;

		const form = await event.request.formData();
		const userId = String(form.get('userId') ?? '');
		const status = String(form.get('status') ?? '');
		if (!userId) return fail(400, { error: 'Missing userId' });
		if (status !== STAFF_STATUS.active && status !== STAFF_STATUS.disabled) {
			return fail(400, { error: 'Invalid status' });
		}
		const changed = await setStaffStatus(db, userId, status);
		return { ok: changed, action: 'setStatus' };
	},

	/** Permanently remove a staff member (owner protected in the service). */
	remove: async (event) => {
		const denied = await requireOwner(event.locals.user?.id);
		if (denied) return denied;

		const form = await event.request.formData();
		const userId = String(form.get('userId') ?? '');
		if (!userId) return fail(400, { error: 'Missing userId' });
		if (userId === event.locals.user?.id) {
			return fail(400, { error: 'You cannot remove yourself.' });
		}
		const removed = await removeStaff(db, userId);
		return { ok: removed, action: 'remove' };
	}
};
