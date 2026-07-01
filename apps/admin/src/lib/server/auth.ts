import { env } from '$env/dynamic/private';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { twoFactor } from 'better-auth/plugins/two-factor';
import { getRequestEvent } from '$app/server';
import { adminAuthSchema } from '@veent/db';
import { activateStaff } from '@veent/core';
import { db } from '$lib/server/db';
import { mailer } from '$lib/server/email';
import { activationEmail } from '$lib/server/emails/activation';
import { resetPasswordEmail } from '$lib/server/emails/reset-password';

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
		// No public self-signup. Staff are created ONLY via the owner-only /staff invite flow
		// (internalAdapter.createUser) — never the better-auth POST /api/auth/sign-up/email route,
		// which is mounted by the handler and would otherwise let anyone create an admin_user row
		// (email-squatting an invitee's address / DB pollution). This keeps the "no browser
		// owner-signup" guarantee true for the auth API surface, not just the page routes.
		disableSignUp: true,
		// Staff invites reuse the password-reset token machinery: the owner invites a
		// member, we issue a reset token, and the member sets their password on the
		// /activate page. The token URL is emailed via the Resend mailer (stub-logs
		// subject + recipient locally when RESEND_API_KEY is unset).
		resetPasswordTokenExpiresIn: 60 * 60 * 24, // 24h, generous for an invite
		// ONE better-auth reset-token callback serves two flows that both ride the
		// password-reset machinery: the owner-only INVITE (redirectTo '/activate') and
		// the self-serve FORGOT-PASSWORD (redirectTo '/reset-password'). We branch on the
		// `callbackURL` query param specifically — NOT a substring of `url`, because
		// better-auth's own endpoint path contains "reset-password" for BOTH flows.
		sendResetPassword: async ({ user, url, token }) => {
			let isReset = false;
			try {
				isReset = (new URL(url).searchParams.get('callbackURL') ?? '').includes('reset-password');
			} catch {
				// Unparseable url → fall through to the invite/activation path (the original behaviour).
			}

			if (isReset) {
				// Self-serve forgot-password for an existing member. The action always returns a
				// generic response (no account enumeration), so a send failure is only logged —
				// surfacing it would leak whether the address exists. A reset never bypasses TOTP.
				const link = `${env.ORIGIN}/reset-password?token=${token}`;
				const { subject, html, text } = resetPasswordEmail({ url: link, name: user.name });
				try {
					await mailer.send({ to: user.email, subject, html, text });
				} catch (err) {
					console.warn('[email] password-reset send failed:', (err as Error)?.message);
				}
				return;
			}

			// Invite/activation path. No token/URL logging. The stub mailer logs subject +
			// recipient only (dev). On failure we record it (see inviteSendFailures) rather than
			// throw, because better-auth swallows a thrown callback error — the invite action
			// reads the record and rolls the half-created account back.
			const activateUrl = `${env.ORIGIN}/activate?token=${token}`;
			const { subject, html, text } = activationEmail({ url: activateUrl, name: user.name });
			try {
				await mailer.send({ to: user.email, subject, html, text });
				inviteSendFailures.delete(user.email);
			} catch (err) {
				// Observability: email-delivery failure signal (no address/token logged).
				console.warn('[email] invite send failed:', (err as Error)?.message);
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
		// Mandatory TOTP second factor for staff (enrollment gate in (app)/+layout.server.ts).
		// secret + backupCodes are stored encrypted (BETTER_AUTH_SECRET) in admin_two_factor.
		twoFactor({ issuer: 'RADIUS Admin' }),
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});
