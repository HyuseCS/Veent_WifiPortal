/**
 * Load-test session seeder.
 *
 *   bun run --filter veent-customer loadtest:seed            # 100 users (default)
 *   COUNT=250 bun run --filter veent-customer loadtest:seed  # custom count
 *
 * The grant endpoint requires an authenticated customer session, and the portal is
 * phone-OTP only — so we can't just POST credentials from k6. Instead we stand up a
 * SEPARATE better-auth instance against the SAME `customer_*` tables and the SAME
 * BETTER_AUTH_SECRET / cookiePrefix as the app, but with a `sendOTP` that CAPTURES the
 * code instead of texting it. Running sendOTP → verifyPhoneNumber per user mints a real,
 * app-valid signed session cookie for each. We write those cookies to `sessions.json`
 * for the k6 script to replay.
 *
 * Test users are tagged with the `@loadtest.veent.local` email domain so `cleanup.ts`
 * can find and remove them (and their router bindings) afterward.
 *
 * Env (from apps/customer/.env): DATABASE_URL, BETTER_AUTH_SECRET, ORIGIN.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { phoneNumber } from 'better-auth/plugins';
import { customerAuthSchema, customerProfile } from '@veent/db';

const { DATABASE_URL, BETTER_AUTH_SECRET, ORIGIN } = process.env;
if (!DATABASE_URL) throw new Error('DATABASE_URL is not set (apps/customer/.env)');
if (!BETTER_AUTH_SECRET) throw new Error('BETTER_AUTH_SECRET is not set (apps/customer/.env)');

const COUNT = Number(process.env.COUNT || 100);
export const EMAIL_DOMAIN = 'loadtest.veent.local'; // marker for cleanup.ts

// Reserved, deterministic PH-mobile test range: +6399 + 8 digits (index).
// Deterministic so a re-run targets the same numbers — run cleanup between runs, or
// existing users will be on their free-time cooldown and grants will 429.
const phoneFor = (i: number) => `+6399${String(i).padStart(8, '0')}`;
// Locally-administered MAC (02:…), one per user, matching isValidMac's six-octet shape.
const macFor = (i: number) => {
	const h = i.toString(16).padStart(6, '0');
	return `02:00:00:${h.slice(0, 2)}:${h.slice(2, 4)}:${h.slice(4, 6)}`;
};

const client = postgres(DATABASE_URL, { max: 4 });
const db = drizzle(client);

// Captured OTP codes, keyed by phone (populated by the sendOTP seam below).
const codes = new Map<string, string>();

const auth = betterAuth({
	baseURL: ORIGIN,
	secret: BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'pg', schema: customerAuthSchema }),
	emailAndPassword: { enabled: false },
	session: { expiresIn: 60 * 60 * 12, disableSessionRefresh: true },
	// Mirror the app: every customer_user gets a 1:1 customer_profile.
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
			expiresIn: 300,
			allowedAttempts: 3,
			signUpOnVerification: {
				getTempEmail: (phone) => `${phone.replace('+', '')}@${EMAIL_DOMAIN}`,
				getTempName: (phone) => phone
			},
			// The capturing seam — NO SMS. Just remember the code so we can verify it below.
			sendOTP: async ({ phoneNumber: phone, code }) => {
				codes.set(phone, code);
			}
		})
	]
});

type Session = { phone: string; mac: string; cookie: string };

async function mint(i: number): Promise<Session | null> {
	const phone = phoneFor(i);
	await auth.api.sendPhoneNumberOTP({ body: { phoneNumber: phone } });
	const code = codes.get(phone);
	if (!code) {
		console.warn(`  [${i}] no OTP captured for ${phone} — skipping`);
		return null;
	}
	// returnHeaders → we can read the Set-Cookie the sveltekitCookies plugin would normally set.
	const { headers } = await auth.api.verifyPhoneNumber({
		body: { phoneNumber: phone, code },
		returnHeaders: true
	});
	const cookie = headers
		.getSetCookie()
		.map((c) => c.split(';')[0])
		.filter((c) => c.startsWith('veent-portal'))
		.join('; ');
	if (!cookie) {
		console.warn(`  [${i}] no session cookie for ${phone} — skipping`);
		return null;
	}
	return { phone, mac: macFor(i), cookie };
}

console.log(`Minting ${COUNT} customer sessions (tagged @${EMAIL_DOMAIN})…`);
const sessions: Session[] = [];
for (let i = 0; i < COUNT; i++) {
	const s = await mint(i);
	if (s) sessions.push(s);
	if ((i + 1) % 25 === 0) console.log(`  …${i + 1}/${COUNT}`);
}

const out = fileURLToPath(new URL('./sessions.json', import.meta.url));
writeFileSync(out, JSON.stringify(sessions, null, 2));
console.log(`\n✓ Wrote ${sessions.length} sessions → ${out}`);
console.log('  Next: point k6 at the app host and run grant-spike.js (see README).');
await client.end();
