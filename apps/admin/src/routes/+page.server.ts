import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

/** Admin has no standalone landing — send visitors straight to the dashboard
 * (which itself redirects to /login when unauthenticated). */
export const load: PageServerLoad = () => {
	redirect(302, '/dashboard');
};
