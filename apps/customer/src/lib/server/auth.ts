import { randomUUID } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { phoneNumber, oneTimeToken } from 'better-auth/plugins';
import { getRequestEvent } from '$app/server';
import { customerAuthSchema, customerProfile } from '@veent/db';
import { db } from '$lib/server/db';
import { normalizePhone } from '$lib/phone';
import { sendOtp } from '$lib/server/otp';
import { enforceOtpSendLimit } from '$lib/server/otpRateLimit';
import { getPortalContext } from '$lib/server/portal';

// Issue 2b/C1: pin cookie `Secure` to the ORIGIN protocol (NOT NODE_ENV). With the TLS portal
// (ORIGIN=https://…) every portal session cookie is Secure, so it can't be sidejacked off the
// open guest WiFi. In local dev (ORIGIN unset / http) cookies stay non-Secure so localhost works.
const useSecureCookies = (env.ORIGIN ?? '').startsWith('https://');

// Customer (captive-portal) auth instance. Backed by the `customer_*` tables and
// scoped with its own cookie prefix + secret so a portal session can never be
// validated by the admin app, even on a shared parent domain.
//
// Guests authenticate by phone + OTP (better-auth phoneNumber plugin). The
// plugin owns code generation, the 5-minute expiry, attempt limiting, and the
// `customer_user.phone_number` / `phone_number_verified` columns. `sendOtp` is
// our single SMS delivery seam.
export const auth = betterAuth({
	baseURL: env.ORIGIN,
	secret: env.BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'pg', schema: customerAuthSchema }),
	// Phone-OTP ONLY. Email/password sign-in & sign-up are deliberately OFF: the portal never
	// uses them, and leaving them on (with the deterministic temp email below) let an attacker
	// pre-register `<phone>@…` with a password before the real owner's first SMS login — an
	// account-collision / takeover surface (SECURITY_RISKS R3). The phoneNumber plugin is the
	// only credential provider.
	emailAndPassword: { enabled: false },
	// Sessions expire a fixed 12h after login (was 24h, originally 7 days). Refresh
	// is disabled so the expiry is pinned to login time and never slides on
	// activity — a guest who logs in now must re-authenticate ~12h later.
	session: {
		expiresIn: 60 * 60 * 12, // 12 hours
		disableSessionRefresh: true
	},
	// Every customer_user must have a 1:1 customer_profile (holds credit_balance,
	// cooldown, etc.). Create it right after the auth user is committed so the
	// portal can always read a profile. Idempotent: a retried hook is a no-op.
	databaseHooks: {
		user: {
			create: {
				after: async (user) => {
					await db.insert(customerProfile).values({ userId: user.id }).onConflictDoNothing();
				}
			}
		}
	},
	advanced: {
		cookiePrefix: 'veent-portal',
		useSecureCookies,
		// HttpOnly + SameSite=Lax are better-auth defaults; set explicitly as the portal's
		// session-cookie security baseline (Issue 2b/C1). Lax (not Strict) so the one-time-token
		// handoff — a top-level GET navigation in the system browser — still sets/carries the cookie.
		defaultCookieAttributes: {
			httpOnly: true,
			sameSite: 'lax',
			secure: useSecureCookies
		}
	},
	plugins: [
		phoneNumber({
			otpLength: 6,
			expiresIn: 300, // 5 minutes
			allowedAttempts: 3,
			phoneNumberValidator: (value) => normalizePhone(value) !== null,
			// First successful verification of an unknown number creates the account.
			// The portal is phone-only (no name collected), so we seed a temporary
			// email and use the phone itself as the display name; the UI greets
			// guests by their (masked) phone rather than a name.
			signUpOnVerification: {
				// better-auth's user table needs a unique email; the portal never reads it (phone
				// logins match on phone_number, not email). Use a RANDOM, unguessable address so it
				// can't be derived from the phone and pre-registered — runs once, at account creation.
				// The Maya/Kount buyer email is the REAL one collected on the top-up form, not this.
				getTempEmail: () => `${randomUUID()}@phone.veent.local`,
				getTempName: (phone) => phone
			},
			sendOTP: async ({ phoneNumber: phone, code }) => {
				// Charge the per-phone (+ per-MAC) send cap HERE — the one seam EVERY send passes
				// through, including a direct POST to /api/auth/phone-number/send-otp that skips the
				// form actions and would otherwise bypass the limit (SMS-bomb a number / drain the
				// operator's SMS credits). The form actions enforce first for a friendly retry
				// message and set locals.otpLimitEnforced so their sends aren't double-counted here.
				// On a direct call there's no portal context, so this falls back to a phone-only cap.
				const ev = getRequestEvent();
				if (!ev.locals.otpLimitEnforced) {
					await enforceOtpSendLimit(phone, getPortalContext(ev)?.mac);
				}
				await sendOtp(phone, code);
			}
		}),
		oneTimeToken({
			// CNA→browser handoff (Issue 2b/B). The CNA mints a short-lived token for its session;
			// opening the carried link in the system browser consumes it and mints a session there,
			// so the guest skips a second OTP. Hardening:
			//  - single-use — the plugin invalidates the token on first verify (defeats replay),
			//  - short TTL — minutes is the plugin's granularity; 2 keeps the link's live window tight,
			//  - storeToken 'hashed' — only a hash is at rest, so a DB read can't replay a token,
			//  - disableClientRequest — generation is server-only (auth.api in our load/route),
			//    never a browser-hittable /api/auth/one-time-token/generate endpoint.
			expiresIn: 2,
			storeToken: 'hashed',
			disableClientRequest: true
		}),
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});
