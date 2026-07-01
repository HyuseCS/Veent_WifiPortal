import { error, fail, type RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import {
	setStaffStatus,
	removeStaff,
	promoteToOwner,
	STAFF_ROLE,
	STAFF_STATUS,
	type Owner
} from '@veent/core';
import { adminProfile } from '@veent/db';
import { APIError } from 'better-auth/api';
import { auth, inviteSendFailures } from '$lib/server/auth';
import { requireOwner as ownerGate } from '$lib/server/auth-guard';
import { db } from '$lib/server/db';
import { mailer } from '$lib/server/email';
import { checkAdminEmailLimit } from '$lib/server/emailRateLimit';
import { listStaff, getStaffName } from '$lib/server/queries';
import { rateLimit, clientIp } from '$lib/server/rateLimit';
import { isTotpCode } from '$lib/server/twoFactor';
import { namesMatch } from '$lib/confirm';
import {
	createRequest,
	recordApproval,
	cancelRequest,
	listOpenRequests,
	type OwnerChangeAction
} from '$lib/server/owner-change';
import {
	ownerChangeRequestedEmail,
	ownerChangeExecutedEmail
} from '$lib/server/emails/owner-change';
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
	return {
		staff: await listStaff(db),
		ownerChanges: await listOpenRequests(),
		// So the UI can show which pending requests THIS owner still needs to approve.
		currentUserId: user.id
	};
};

/** Re-asserts owner from the DB (never trust client state) for every mutation. */
const requireOwner = (userId: string | undefined) =>
	ownerGate(userId, 'Only the owner can manage staff.');

/**
 * TOTP step-up shared by the owner-change actions: per-IP rate limit + verify the
 * acting owner's authenticator code (same pattern as ?/promote). Returns an
 * ActionFailure to hand back, or null when verified.
 */
async function ownerStepUp(event: RequestEvent, code: string, action: string) {
	const rl = await rateLimit('admin_owner_change_step_up', clientIp(event), 5, 15 * 60 * 1000);
	if (!rl.allowed) {
		return fail(429, { action, error: 'Too many attempts. Please wait a few minutes.' });
	}
	if (!isTotpCode(code)) {
		return fail(400, { action, error: 'Enter the 6-digit code from your authenticator.' });
	}
	try {
		await auth.api.verifyTOTP({ body: { code }, headers: event.request.headers });
	} catch (err) {
		if (err instanceof APIError) return fail(400, { action, error: 'Invalid authenticator code.' });
		return fail(500, { action, error: 'Unexpected error' });
	}
	return null;
}

/** Best-effort: a failed send never blocks the state change (the DB row is truth). */
async function sendOwnerEmail(to: string, msg: { subject: string; html: string; text: string }) {
	try {
		await mailer.send({ to, ...msg });
	} catch (err) {
		console.warn('[email] owner-change send failed:', (err as Error)?.message);
	}
}

/** Notify required approvers ("approve") + the target ("aware"), each email-rate-limited. */
async function notifyRequested(
	approvers: Owner[],
	target: Owner,
	action: OwnerChangeAction,
	actorId: string,
	url: string
) {
	for (const o of approvers) {
		if (await checkAdminEmailLimit(o.email, actorId)) continue;
		await sendOwnerEmail(
			o.email,
			ownerChangeRequestedEmail({
				recipientName: o.name,
				targetName: target.name,
				action,
				isApprover: true,
				url
			})
		);
	}
	// Inform the target unless they initiated their own exit (they already know).
	if (target.id !== actorId && !(await checkAdminEmailLimit(target.email, actorId))) {
		await sendOwnerEmail(
			target.email,
			ownerChangeRequestedEmail({
				recipientName: target.name,
				targetName: target.name,
				action,
				isApprover: false,
				url
			})
		);
	}
}

/** Notify everyone (owners + target, captured pre-mutation) that the change executed. */
async function notifyExecuted(
	ownersBefore: Owner[],
	target: Owner,
	action: OwnerChangeAction,
	actorId: string
) {
	const recipients = new Map(ownersBefore.map((o) => [o.id, o] as const));
	recipients.set(target.id, target); // ensure the target is included even after removal
	for (const o of recipients.values()) {
		if (await checkAdminEmailLimit(o.email, actorId)) continue;
		await sendOwnerEmail(
			o.email,
			ownerChangeExecutedEmail({ recipientName: o.name, targetName: target.name, action })
		);
	}
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

	// createUser already committed the auth row; if the profile insert or the reset call
	// throws, roll the user back so a bare, profile-less account isn't orphaned (it would
	// otherwise block re-inviting the same email via the findUserByEmail guard above).
	try {
		await db
			.insert(adminProfile)
			.values({ userId, role: STAFF_ROLE.admin, status: STAFF_STATUS.pending })
			.onConflictDoNothing();

		// Issues the reset token → fires sendResetPassword, which sends the activation email.
		// better-auth awaits the callback but swallows a thrown error, so the send outcome is
		// surfaced via inviteSendFailures (keyed by email) instead.
		await auth.api.requestPasswordReset({ body: { email, redirectTo: '/activate' } });
	} catch {
		await removeStaff(db, userId);
		return { error: `Couldn't create the invitation for ${email}.` };
	}

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
	 * Promote an existing active admin to owner. Owner-only, plus a two-gate step-up:
	 * the owner must (1) type the target's name and (2) re-enter their own TOTP code.
	 * Both are enforced here, not just in the UI. The service scopes the change to
	 * active admins, so promoting an owner / pending / disabled row is a no-op.
	 * (The "all owners must confirm" gate is deferred — direct for now.)
	 */
	promote: async (event) => {
		const denied = await requireOwner(event.locals.user?.id);
		if (denied) return denied;

		// Throttle the TOTP step-up to blunt code brute-forcing (per source IP).
		const rl = await rateLimit('admin_promote_step_up', clientIp(event), 5, 15 * 60 * 1000);
		if (!rl.allowed) {
			return fail(429, { action: 'promote', error: 'Too many attempts. Please wait a few minutes.' });
		}

		const form = await event.request.formData();
		const userId = String(form.get('userId') ?? '');
		const confirmName = String(form.get('confirmName') ?? '');
		const code = String(form.get('code') ?? '').trim();
		if (!userId) return fail(400, { action: 'promote', error: 'Missing userId' });

		// Gate 1 — type-to-confirm: the typed name must match the target's name.
		const targetName = await getStaffName(db, userId);
		if (!targetName || !namesMatch(confirmName, targetName)) {
			return fail(400, { action: 'promote', error: 'The typed name does not match.' });
		}

		// Gate 2 — TOTP step-up: re-verify the acting owner's authenticator code. On an
		// authenticated session, verifyTOTP checks the code against the stored secret and
		// throws on mismatch (no login two-factor cookie needed). headers → reads the session.
		if (!isTotpCode(code)) {
			return fail(400, { action: 'promote', error: 'Enter the 6-digit code from your authenticator.' });
		}
		try {
			await auth.api.verifyTOTP({ body: { code }, headers: event.request.headers });
		} catch (error) {
			if (error instanceof APIError) {
				return fail(400, { action: 'promote', error: 'Invalid authenticator code.' });
			}
			return fail(500, { action: 'promote', error: 'Unexpected error' });
		}

		const promoted = await promoteToOwner(db, userId);
		if (!promoted) {
			return fail(400, { action: 'promote', error: 'Only an active admin can be promoted to owner.' });
		}
		return { ok: true, action: 'promote' };
	},

	/**
	 * Open a request to demote/remove an owner. Owner-only, two-gate step-up (type the
	 * target's name + TOTP). The request needs unanimous approval from all OTHER owners
	 * before it executes — except the 2-owner peer case, where the initiator's approval
	 * is already unanimous and it executes here. Emails the approvers + target.
	 */
	requestOwnerChange: async (event) => {
		const actorId = event.locals.user?.id;
		const denied = await requireOwner(actorId);
		if (denied || !actorId) return denied ?? fail(403, { action: 'requestOwnerChange', error: 'Forbidden' });

		const form = await event.request.formData();
		const targetUserId = String(form.get('targetUserId') ?? '');
		const action = String(form.get('action') ?? '') as OwnerChangeAction;
		const confirmName = String(form.get('confirmName') ?? '');
		const code = String(form.get('code') ?? '').trim();
		const reason = String(form.get('reason') ?? '').trim() || null;
		if (!targetUserId) return fail(400, { action: 'requestOwnerChange', error: 'Missing target.' });
		if (action !== 'demote' && action !== 'remove') {
			return fail(400, { action: 'requestOwnerChange', error: 'Invalid action.' });
		}

		// Gate 1 — type-to-confirm the target's name.
		const targetName = await getStaffName(db, targetUserId);
		if (!targetName || !namesMatch(confirmName, targetName)) {
			return fail(400, { action: 'requestOwnerChange', error: 'The typed name does not match.' });
		}
		// Gate 2 — TOTP step-up.
		const stepFail = await ownerStepUp(event, code, 'requestOwnerChange');
		if (stepFail) return stepFail;

		const res = await createRequest({ targetUserId, action, initiatedBy: actorId, reason });
		if (!res.ok) return fail(400, { action: 'requestOwnerChange', error: res.error });

		const url = `${env.ORIGIN ?? ''}/staff`;
		await notifyRequested(res.approvers, res.target, res.action, actorId, url);
		if (res.executed) await notifyExecuted(res.owners, res.target, res.action, actorId);

		return { ok: true, action: 'requestOwnerChange', executed: res.executed };
	},

	/** Approve a pending owner-change. Owner-only + TOTP step-up. Executes when unanimous. */
	approveOwnerChange: async (event) => {
		const actorId = event.locals.user?.id;
		const denied = await requireOwner(actorId);
		if (denied || !actorId) return denied ?? fail(403, { action: 'approveOwnerChange', error: 'Forbidden' });

		const form = await event.request.formData();
		const requestId = String(form.get('requestId') ?? '');
		const code = String(form.get('code') ?? '').trim();
		if (!requestId) return fail(400, { action: 'approveOwnerChange', error: 'Missing request.' });

		const stepFail = await ownerStepUp(event, code, 'approveOwnerChange');
		if (stepFail) return stepFail;

		const res = await recordApproval(requestId, actorId);
		if (!res.ok) return fail(400, { action: 'approveOwnerChange', error: res.error });
		if (res.executed && res.target) {
			await notifyExecuted(res.owners, res.target, res.action, actorId);
		}
		return { ok: true, action: 'approveOwnerChange', executed: res.executed };
	},

	/** Cancel a pending owner-change request. Owner-only, and only the initiator (enforced
	 *  in cancelRequest) — so a target can't cancel the request against themselves. */
	cancelOwnerChange: async (event) => {
		const actorId = event.locals.user?.id;
		const denied = await requireOwner(actorId);
		if (denied || !actorId) return denied ?? fail(403, { action: 'cancelOwnerChange', error: 'Forbidden' });

		const form = await event.request.formData();
		const requestId = String(form.get('requestId') ?? '');
		if (!requestId) return fail(400, { action: 'cancelOwnerChange', error: 'Missing request.' });
		await cancelRequest(requestId, actorId);
		return { ok: true, action: 'cancelOwnerChange' };
	}
};
