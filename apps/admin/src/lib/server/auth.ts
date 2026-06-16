import { env } from '$env/dynamic/private';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { adminAuthSchema } from '@veent/db';
import { db } from '$lib/server/db';

// Admin (staff dashboard) auth instance. Backed by the `admin_*` tables and
// scoped with its own cookie prefix + secret so it is fully isolated from the
// customer portal — a portal session is never valid here and vice-versa.
export const auth = betterAuth({
	baseURL: env.ORIGIN,
	secret: env.BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'pg', schema: adminAuthSchema }),
	emailAndPassword: { enabled: true },
	advanced: { cookiePrefix: 'veent-admin' },
	plugins: [
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});
