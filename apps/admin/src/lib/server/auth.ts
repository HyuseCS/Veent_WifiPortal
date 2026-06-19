import { env } from '$env/dynamic/private';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import { adminAuthSchema } from '@veent/db';
import { activateStaff } from '@veent/core';
import { db } from '$lib/server/db';
import { mailer } from '$lib/server/email';
import { activationEmail } from '$lib/server/emails/activation';

/**
 * Records a failed activation-email send so the invite action can roll back.
 *
 * better-auth runs `sendResetPassword` via `runInBackgroundOrAwait`, which awaits
 * the callback but SWALLOWS a thrown error (logs it, returns success anyway). A
 * throw therefore never reaches `requestPasswordReset`'s caller. Since the callback
 * IS awaited, though, it has finished by the time `requestPasswordReset` resolves —
 * so we surface the send outcome here, keyed by email, for the action to inspect.
 */
export const inviteSendFailures = new Map<string, unknown>();

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
		sendResetPassword: async ({ user, token }) => {
			const url = `${env.ORIGIN}/activate?token=${token}`;
			const { subject, html, text } = activationEmail({ url, name: user.name });
			// No token/URL logging in this path. The stub mailer logs subject + recipient
			// only (dev). On failure we record it (see inviteSendFailures) rather than
			// throw, because better-auth swallows a thrown callback error — the invite
			// action reads the record and rolls the half-created account back.
			try {
				await mailer.send({ to: user.email, subject, html, text });
				inviteSendFailures.delete(user.email);
			} catch (err) {
				inviteSendFailures.set(user.email, err);
			}
		},
		// After a pending invitee sets their password, flip them to active. Scoped to
		// pending in the service, so this can't re-activate a disabled member.
		onPasswordReset: async ({ user }) => {
			await activateStaff(db, user.id);
		}
	},
	advanced: { cookiePrefix: 'radius-admin' },
	plugins: [
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});
