import { error, fail } from '@sveltejs/kit';
import {
	getAdminRole,
	setStaffStatus,
	removeStaff,
	promoteToOwner,
	STAFF_ROLE,
	STAFF_STATUS
} from '@veent/core';
import { adminProfile } from '@veent/db';
import { auth, inviteSendFailures } from '$lib/server/auth';
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

		// Create ONLY the user row, directly via better-auth's internal adapter. We
		// deliberately do NOT use signUpEmail: it auto-signs-in the new account
		// (autoSignIn is on by default) and the sveltekitCookies plugin would then
		// write the invitee's session cookie onto the owner's response — logging the
		// owner in as the freshly-invited member. No password or credential account is
		// created here; the invitee has none until they set one on /activate, where
		// better-auth's resetPassword creates the credential account on first use.
		// `pending` status is the not-yet-activated flag (flips to active on reset).
		const ctx = await auth.$context;
		if (await ctx.internalAdapter.findUserByEmail(email)) {
			return fail(400, { error: 'A staff member with that email already exists.' });
		}
		const user = await ctx.internalAdapter.createUser({ name, email, emailVerified: false });
		const userId = user.id;

		await db
			.insert(adminProfile)
			.values({ userId, role: STAFF_ROLE.admin, status: STAFF_STATUS.pending })
			.onConflictDoNothing();

		// Issues the reset token → fires sendResetPassword, which sends the activation
		// email. better-auth awaits the callback but swallows a thrown error, so the
		// send outcome is surfaced via inviteSendFailures (keyed by email) instead.
		await auth.api.requestPasswordReset({ body: { email, redirectTo: '/activate' } });

		// Atomic create+send: if the email didn't go out, roll the pending account back
		// (cascades user + profile + account) so no orphaned invite is left behind.
		if (inviteSendFailures.has(email)) {
			inviteSendFailures.delete(email);
			await removeStaff(db, userId);
			return fail(502, { error: "Couldn't send the invitation email. Please try again." });
		}

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
	},

	/**
	 * Promote an existing active admin to owner. Owner-only. The service scopes the
	 * change to active admins, so promoting an owner / pending / disabled row is a
	 * no-op. (The "all owners must confirm" gate is deferred — direct for now.)
	 */
	promote: async (event) => {
		const denied = await requireOwner(event.locals.user?.id);
		if (denied) return denied;

		const form = await event.request.formData();
		const userId = String(form.get('userId') ?? '');
		if (!userId) return fail(400, { error: 'Missing userId' });

		const promoted = await promoteToOwner(db, userId);
		if (!promoted) {
			return fail(400, { error: 'Only an active admin can be promoted to owner.' });
		}
		return { ok: true, action: 'promote' };
	}
};
