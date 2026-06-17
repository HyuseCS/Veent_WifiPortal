import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

/** Auth guard for every page in the (app) shell: only signed-in staff get in. */
export const load: LayoutServerLoad = (event) => {
	if (!event.locals.user) {
		return redirect(302, '/login');
	}
	return { user: event.locals.user };
};
