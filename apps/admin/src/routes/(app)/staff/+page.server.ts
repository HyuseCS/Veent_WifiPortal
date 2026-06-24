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
import { checkAdminEmailLimit } from '$lib/server/emailRateLimit';
import { listStaff } from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Upper bound on a single mass-invite batch — kept under the per-actor email cap (20/hr)
 *  so a full batch never trips its own rate limiter, and the payload stays bounded. */
const MAX_INVITES = 10;

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

/**
 * Invite a single admin: validate → rate-limit → create a pending account → send the
 * activation email, rolling the account back if the send fails. Returns the email on
 * success or a per-row error string. Owner auth is asserted once by the caller.
 *
 * See the long note in the loop body below for WHY this uses the internal adapter rather
 * than signUpEmail (it would log the owner in as the invitee).
 */
async function inviteOne(
	actorId: string,
	name: string,
	email: string
): Promise<{ email: string } | { error: string }> {
	if (!name || !email) return { error: 'Name and email are required.' };
	if (!emailPattern.test(email)) return { error: `"${email}" is not a valid email address.` };

	// Cap invite emails per recipient + per owner BEFORE creating anything, so a mail-bomb
	// attempt can't mint pending accounts or send a flood of Resend mail.
	const limited = await checkAdminEmailLimit(email, actorId);
	if (limited) {
		return {
			error:
				limited.scope === 'recipient'
					? `Too many invitations sent to ${email} recently.`
					: 'Per-owner invite limit reached. Try again later.'
		};
	}

	// Create ONLY the user row, directly via better-auth's internal adapter. We deliberately
	// do NOT use signUpEmail: it auto-signs-in the new account (autoSignIn is on by default)
	// and the sveltekitCookies plugin would then write the invitee's session cookie onto the
	// owner's response — logging the owner in as the freshly-invited member. No password or
	// credential account is created here; the invitee has none until they set one on /activate,
	// where better-auth's resetPassword creates the credential account on first use. `pending`
	// status is the not-yet-activated flag (flips to active on reset).
	const ctx = await auth.$context;
	if (await ctx.internalAdapter.findUserByEmail(email)) {
		return { error: `A staff member with email ${email} already exists.` };
	}
	const user = await ctx.internalAdapter.createUser({ name, email, emailVerified: false });
	const userId = user.id;

	await db
		.insert(adminProfile)
		.values({ userId, role: STAFF_ROLE.admin, status: STAFF_STATUS.pending })
		.onConflictDoNothing();

	// Issues the reset token → fires sendResetPassword, which sends the activation email.
	// better-auth awaits the callback but swallows a thrown error, so the send outcome is
	// surfaced via inviteSendFailures (keyed by email) instead.
	await auth.api.requestPasswordReset({ body: { email, redirectTo: '/activate' } });

	// Atomic create+send: if the email didn't go out, roll the pending account back (cascades
	// user + profile + account) so no orphaned invite is left behind.
	if (inviteSendFailures.has(email)) {
		inviteSendFailures.delete(email);
		await removeStaff(db, userId);
		return { error: `Couldn't send the invitation email to ${email}.` };
	}

	return { email };
}

export const actions: Actions = {
	/**
	 * Mass-invite admins. Reads one (name, email) pair per submitted row, then invites each
	 * (pending account + activation email) via `inviteOne`. Reports per-row outcomes so a bad
	 * address in the batch doesn't sink the good ones: `sent` lists succeeded emails, `failed`
	 * lists the rest with reasons. Only an all-fail batch returns `fail()`.
	 */
	invite: async (event) => {
		const denied = await requireOwner(event.locals.user?.id);
		if (denied) return denied;

		const form = await event.request.formData();
		const names = form.getAll('name').map((v) => String(v).trim());
		const emails = form.getAll('email').map((v) => String(v).trim().toLowerCase());

		// Pair rows by index; drop fully-blank rows (a leftover empty row shouldn't error).
		const rows = names
			.map((name, i) => ({ name, email: emails[i] ?? '' }))
			.filter((r) => r.name || r.email);

		if (rows.length === 0) return fail(400, { error: 'Add at least one staff member.' });
		if (rows.length > MAX_INVITES) {
			return fail(400, { error: `You can invite up to ${MAX_INVITES} people at once.` });
		}

		const sent: string[] = [];
		const failed: { email: string; error: string }[] = [];
		// ponytail: sequential — batches are small (≤10) and the per-actor rate-limit counter
		// would race under parallel sends. Upgrade to batched concurrency only if it ever matters.
		for (const row of rows) {
			const res = await inviteOne(event.locals.user!.id, row.name, row.email);
			if ('email' in res) sent.push(res.email);
			else failed.push({ email: row.email || row.name || '(blank)', error: res.error });
		}

		if (sent.length === 0) return fail(400, { action: 'invite', sent, failed });
		return { ok: true, action: 'invite', sent, failed };
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
