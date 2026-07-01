import { fail } from '@sveltejs/kit';
import { getAdminRole, STAFF_ROLE } from '@veent/core';
import { db } from '$lib/server/db';

/**
 * Owner-only gate for a form action, extracted from the six identical copies that
 * lived in the staff / users / networks / content pages (they differed only in the
 * error message). Re-reads the role from the DB on every call — never trusts a
 * client/session flag — so a just-demoted owner is blocked on their next action.
 *
 * Returns a 403 `ActionFailure` to hand straight back from the action, or `null`
 * when the caller may proceed. NB: this is NOT `$lib/server/auth` (that's better-auth
 * setup); keep the guard separate.
 */
export async function requireOwner(
	userId: string | undefined,
	message = 'Only the owner can perform this action.'
) {
	if (!userId || (await getAdminRole(db, userId)) !== STAFF_ROLE.owner) {
		return fail(403, { error: message });
	}
	return null;
}
