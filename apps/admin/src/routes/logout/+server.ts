import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { auth } from '$lib/server/auth';
import { revokeAdminBypass } from '$lib/server/adminBypass';

/** Sign the staff user out, drop their device's internet bypass, then return to the login screen. */
export const POST: RequestHandler = async (event) => {
	// Best-effort — never block sign-out on the router. Tag-scoped, so it can't touch a guest binding.
	await revokeAdminBypass(event);
	await auth.api.signOut({ headers: event.request.headers });
	redirect(302, '/login');
};
