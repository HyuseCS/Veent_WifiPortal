import { fail } from '@sveltejs/kit';
import { setBlocked, revokeUserSessions } from '@veent/core';
import { db } from '$lib/server/db';
import { network } from '$lib/server/network';
import { listUsers } from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';

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
	}
};
