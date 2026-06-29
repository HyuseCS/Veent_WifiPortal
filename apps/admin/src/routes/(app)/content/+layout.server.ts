import { error } from '@sveltejs/kit';
import { STAFF_ROLE } from '@veent/core';
import type { LayoutServerLoad } from './$types';

/** Gate the whole Content Management section (packages, FAQ, session limits) to owners,
 * the same posture as /staff. Actions still re-assert owner per-handler (loads don't run
 * on form POSTs). */
export const load: LayoutServerLoad = async (event) => {
	const { user } = await event.parent();
	if (user.role !== STAFF_ROLE.owner) {
		throw error(403, 'Only the owner can manage content.');
	}
	return {};
};
