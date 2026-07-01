import { error } from '@sveltejs/kit';
import { STAFF_ROLE } from '@veent/core';
import type { LayoutServerLoad } from './$types';

/** Owner-only: the Sentry dashboard surfaces data from a mutate-capable API token. Non-owners are
 * blocked outright, same posture as /staff and /content. Actions re-assert owner per-handler
 * (loads don't run on form POSTs). */
export const load: LayoutServerLoad = async (event) => {
	const { user } = await event.parent();
	if (user.role !== STAFF_ROLE.owner) {
		throw error(403, 'Only the owner can view Sentry.');
	}
	return {};
};
