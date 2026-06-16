import { env } from '$env/dynamic/private';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { customerAuthSchema } from '@veent/db';
import { db } from '$lib/server/db';

// Customer (captive-portal) auth instance. Backed by the `customer_*` tables and
// scoped with its own cookie prefix + secret so a portal session can never be
// validated by the admin app, even on a shared parent domain.
export const auth = betterAuth({
	baseURL: env.ORIGIN,
	secret: env.BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'pg', schema: customerAuthSchema }),
	emailAndPassword: { enabled: true },
	advanced: { cookiePrefix: 'veent-portal' },
	plugins: [
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});
