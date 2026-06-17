import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { auth } from '$lib/server/auth';

/** Sign the staff user out, then return them to the login screen. */
export const POST: RequestHandler = async ({ request }) => {
	await auth.api.signOut({ headers: request.headers });
	redirect(302, '/login');
};
