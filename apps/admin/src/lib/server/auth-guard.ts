import { fail } from '@sveltejs/kit';
import { getAdminRole, STAFF_ROLE, MANAGER_ROLES } from '@veent/core';
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

/**
 * Manager gate: passes for `owner` OR `system_admin`. Backs the Issues (manage) and
 * Content actions. Same posture as `requireOwner` — re-reads the role from the DB on
 * every call, never trusts a client/session flag. Returns a 403 `ActionFailure` to hand
 * straight back, or `null` when the caller may proceed.
 */
export async function requireManager(
	userId: string | undefined,
	message = 'You do not have permission to perform this action.'
) {
	const role = userId ? await getAdminRole(db, userId) : null;
	if (!role || !MANAGER_ROLES.includes(role)) {
		return fail(403, { error: message });
	}
	return null;
}
