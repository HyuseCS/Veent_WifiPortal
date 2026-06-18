import { fail } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { setBlocked, revokeUserSessions, startSession } from '@veent/core';
import { db } from '$lib/server/db';
import { network } from '$lib/server/network';
import { listUsers } from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';

/** A real device MAC (six colon-separated hex octets). */
const MAC_RE = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/;
/** Comp duration for the dev "Allow WiFi" override. */
const COMP_MINUTES = 60;

/**
 * User management. Returns `users` in the AdminUserRow shape — swap the page's
 * `import { users } from '$lib/mocks'` for `let { data } = $props()` to go live.
 * (The (app) layout already guards auth.)
 */
export const load: PageServerLoad = async () => {
	return { users: await listUsers(db) };
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
	 * Allow WiFi (DEV ONLY): comp the user onto the network without payment — a
	 * COMP_MINUTES session on their last-known device MAC, granted on the router and
	 * logged like any session (so it shows online and the revoke cron expires it).
	 * Gated to dev: this bypasses credits/Free Time entirely.
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
			await startSession(db, network, { userId, macAddress: mac, durationMinutes: COMP_MINUTES });
		} catch (err) {
			console.error('[admin] allowWifi grant failed:', err);
			return fail(502, { error: 'Network controller rejected the grant.' });
		}
		return { ok: true, action: 'allowWifi', minutes: COMP_MINUTES };
	}
};
