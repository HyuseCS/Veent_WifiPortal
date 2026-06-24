import { fail } from '@sveltejs/kit';
import { dev } from '$app/environment';
import {
	setBlocked,
	revokeUserSessions,
	extendAccessAndBindDevice,
	deleteCustomers,
	wipeCustomers,
	getAdminRole,
	STAFF_ROLE
} from '@veent/core';
import { db } from '$lib/server/db';
import { network } from '$lib/server/network';
import { mailer } from '$lib/server/email';
import { checkAdminEmailLimit } from '$lib/server/emailRateLimit';
import { wipeCodeEmail } from '$lib/server/emails/wipe-code';
import { issueWipeCode, consumeWipeCode } from '$lib/server/wipe-verification';
import { listUsers } from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';

/** Re-asserts owner from the DB (never trust client state) for wipe actions. */
async function requireOwner(userId: string | undefined) {
	if (!userId || (await getAdminRole(db, userId)) !== STAFF_ROLE.owner) {
		return fail(403, { error: 'Only the owner can wipe the customer database.' });
	}
	return null;
}

/** A real device MAC (six colon-separated hex octets). */
const MAC_RE = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/;
/** Comp duration for the dev "Allow WiFi" override. */
const COMP_MINUTES = 60;

/**
 * User management. Returns `users` in the AdminUserRow shape — swap the page's
 * `import { users } from '$lib/mocks'` for `let { data } = $props()` to go live.
 * (The (app) layout already guards auth.)
 */
export const load: PageServerLoad = async (event) => {
	const { user } = await event.parent();
	return { users: await listUsers(db), isOwner: user.role === STAFF_ROLE.owner };
};

export const actions: Actions = {
	/** Block: refuse future grants AND cut current access. */
	block: async (event) => {
		const userId = String((await event.request.formData()).get('userId') ?? '');
		if (!userId) return fail(400, { error: 'Missing userId' });
		await setBlocked(db, userId, true);
		const revoked = await revokeUserSessions(db, network, userId);
		return { ok: true, action: 'block', revoked };
	},

	/** Unblock: allow grants again (does not re-open any session). */
	unblock: async (event) => {
		const userId = String((await event.request.formData()).get('userId') ?? '');
		if (!userId) return fail(400, { error: 'Missing userId' });
		await setBlocked(db, userId, false);
		return { ok: true, action: 'unblock' };
	},

	/** Kick: cut current access now, but leave the account un-blocked. */
	kick: async (event) => {
		const userId = String((await event.request.formData()).get('userId') ?? '');
		if (!userId) return fail(400, { error: 'Missing userId' });
		const revoked = await revokeUserSessions(db, network, userId);
		return { ok: true, action: 'kick', revoked };
	},

	/**
	 * Allow WiFi (DEV ONLY): comp the user onto the network without payment — extends
	 * their ACCOUNT access window by COMP_MINUTES and binds their last-known device MAC,
	 * granted on the router and logged like any access (so it shows online and the revoke
	 * cron expires it). Gated to dev: this bypasses credits/Free Time entirely.
	 */
	allowWifi: async (event) => {
		if (!dev) return fail(403, { error: 'Allow WiFi is a dev-only override.' });
		const form = await event.request.formData();
		const userId = String(form.get('userId') ?? '');
		const mac = String(form.get('mac') ?? '');
		if (!userId) return fail(400, { error: 'Missing userId' });
		if (!MAC_RE.test(mac)) {
			return fail(400, { error: 'No known device MAC for this user yet.' });
		}
		try {
			await extendAccessAndBindDevice(db, network, {
				userId,
				macAddress: mac,
				durationMinutes: COMP_MINUTES
			});
		} catch (err) {
			console.error('[admin] allowWifi grant failed:', err);
			return fail(502, { error: 'Network controller rejected the grant.' });
		}
		return { ok: true, action: 'allowWifi', minutes: COMP_MINUTES };
	},

	/** Bulk hard-delete: removes the selected customers (cascades to all their
	 *  domain + auth rows) after dropping any live router grants. */
	delete: async (event) => {
		const ids = String((await event.request.formData()).get('userIds') ?? '')
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
		if (ids.length === 0) return fail(400, { error: 'No users selected.' });
		const removed = await deleteCustomers(db, network, ids);
		return { ok: true, action: 'delete', removed };
	},

	/** Step 1 of the wipe: owner requests a one-time code, emailed to their own
	 *  address. Proves inbox control before an irreversible destruction. */
	requestWipeCode: async (event) => {
		const denied = await requireOwner(event.locals.user?.id);
		if (denied) return denied;

		const owner = event.locals.user!;

		// Cap wipe-code emails so the owner's inbox can't be flooded with codes.
		const limited = await checkAdminEmailLimit(owner.email, owner.id);
		if (limited) {
			return fail(429, { error: 'Too many verification codes requested. Try again later.' });
		}

		const code = issueWipeCode(owner.id);
		const { subject, html, text } = wipeCodeEmail({ code, name: owner.name });
		// Dev affordance: the stub mailer never logs bodies, so surface the code here
		// to keep the flow testable until real email (Resend) is wired up.
		if (dev) console.log(`[wipe] verification code for ${owner.email}: ${code}`);
		try {
			await mailer.send({ to: owner.email, subject, html, text });
		} catch (err) {
			// Observability: email-delivery failure signal (no address/code logged).
			console.warn('[email] wipe code send failed:', (err as Error)?.message);
			return fail(502, { error: "Couldn't send the verification code. Please try again." });
		}
		return { ok: true, action: 'requestWipeCode' };
	},

	/** Step 2: wipe the entire customer database. Owner-only, gated on the emailed
	 *  one-time code (single-use, expires in 10 min). */
	wipe: async (event) => {
		const denied = await requireOwner(event.locals.user?.id);
		if (denied) return denied;

		const code = String((await event.request.formData()).get('code') ?? '').trim();
		if (!consumeWipeCode(event.locals.user!.id, code)) {
			return fail(400, { error: 'Invalid or expired code.' });
		}
		const removed = await wipeCustomers(db, network);
		return { ok: true, action: 'wipe', removed };
	}
};
