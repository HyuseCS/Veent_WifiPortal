import { randomUUID } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { phoneNumber } from 'better-auth/plugins';
import { getRequestEvent } from '$app/server';
import { customerAuthSchema, customerProfile } from '@veent/db';
import { db } from '$lib/server/db';
import { normalizePhone } from '$lib/phone';
import { sendOtp } from '$lib/server/otp';

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
	// Sessions expire a fixed 24h after login (was defaulting to 7 days). Refresh
	// is disabled so the expiry is pinned to login time and never slides on
	// activity — a guest who logs in today must re-authenticate ~24h later.
	session: {
		expiresIn: 60 * 60 * 24, // 24 hours
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
	advanced: { cookiePrefix: 'veent-portal' },
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
				getTempEmail: () => `${randomUUID()}@phone.veent.local`,
				getTempName: (phone) => phone
			},
			sendOTP: async ({ phoneNumber: phone, code }) => {
				await sendOtp(phone, code);
			}
		}),
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});
