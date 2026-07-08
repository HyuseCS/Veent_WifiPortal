import { error } from '@sveltejs/kit';
import { MANAGER_ROLES, type StaffRole } from '@veent/core';
import type { LayoutServerLoad } from './$types';

/** Gate the whole Content Management section (packages, FAQ, session limits) to managers
 * (owner + system_admin). Actions still re-assert the role per-handler (loads don't run
 * on form POSTs). */
export const load: LayoutServerLoad = async (event) => {
	const { user } = await event.parent();
	if (!MANAGER_ROLES.includes(user.role as StaffRole)) {
		throw error(403, 'You do not have permission to manage content.');
	}
	return {};
};
