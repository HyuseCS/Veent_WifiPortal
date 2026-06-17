import { env } from '$env/dynamic/private';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { adminAuthSchema } from '@veent/db';
import { activateStaff } from '@veent/core';
import { db } from '$lib/server/db';

// Admin (staff dashboard) auth instance. Backed by the `admin_*` tables and
// scoped with its own cookie prefix + secret so it is fully isolated from the
// customer portal — a portal session is never valid here and vice-versa.
export const auth = betterAuth({
	baseURL: env.ORIGIN,
	secret: env.BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'pg', schema: adminAuthSchema }),
	emailAndPassword: {
		enabled: true,
		// Staff invites reuse the password-reset token machinery: the owner invites a
		// member, we issue a reset token, and the member sets their password on the
		// /activate page. Until SMTP lands, "sending" the email just logs the link.
		resetPasswordTokenExpiresIn: 60 * 60 * 24, // 24h, generous for an invite
		sendResetPassword: async ({ token }) => {
			const url = `${env.ORIGIN}/activate?token=${token}`;
			// TODO(smtp): replace with a real transactional email send.
			console.log(`[invite] activation link (stub email): ${url}`);
		},
		// After a pending invitee sets their password, flip them to active. Scoped to
		// pending in the service, so this can't re-activate a disabled member.
		onPasswordReset: async ({ user }) => {
			await activateStaff(db, user.id);
		}
	},
	advanced: { cookiePrefix: 'veent-admin' },
	plugins: [
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});
