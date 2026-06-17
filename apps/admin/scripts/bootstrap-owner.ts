/**
 * Bootstraps the first owner account for the admin dashboard.
 *
 *   OWNER_EMAIL=you@veent.io OWNER_PASSWORD=... OWNER_NAME="You" bun run bootstrap:owner
 *
 * (bun auto-loads apps/admin/.env, so DATABASE_URL / BETTER_AUTH_SECRET / ORIGIN
 * and the OWNER_* vars can live there instead of the command line.)
 *
 * Idempotent: if the email already exists, it just (re)asserts the owner profile.
 * Public self-registration is disabled, so this is the only way to seed the owner;
 * everyone else is created by the owner's invite flow.
 *
 * Builds its own better-auth instance (no SvelteKit plugins) so it runs outside the
 * request context — same secret + adapter, so the password hash is compatible.
 */
import { eq } from 'drizzle-orm';
import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { createDb, adminAuthSchema, adminUser, adminProfile } from '@veent/db';
import { STAFF_ROLE, STAFF_STATUS } from '@veent/core';

const { DATABASE_URL, BETTER_AUTH_SECRET, ORIGIN, OWNER_EMAIL, OWNER_PASSWORD } = process.env;
const OWNER_NAME = process.env.OWNER_NAME ?? 'Owner';

function required(name: string, value: string | undefined): string {
	if (!value) {
		console.error(`Missing ${name}. Set it in apps/admin/.env or the command line.`);
		process.exit(1);
	}
	return value;
}

const databaseUrl = required('DATABASE_URL', DATABASE_URL);
required('BETTER_AUTH_SECRET', BETTER_AUTH_SECRET);
const email = required('OWNER_EMAIL', OWNER_EMAIL).toLowerCase();
const password = required('OWNER_PASSWORD', OWNER_PASSWORD);
if (password.length < 8) {
	console.error('OWNER_PASSWORD must be at least 8 characters.');
	process.exit(1);
}

const db = createDb(databaseUrl);
const auth = betterAuth({
	baseURL: ORIGIN,
	secret: BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'pg', schema: adminAuthSchema }),
	emailAndPassword: { enabled: true },
	advanced: { cookiePrefix: 'veent-admin' }
});

async function main() {
	const [existing] = await db
		.select({ id: adminUser.id })
		.from(adminUser)
		.where(eq(adminUser.email, email))
		.limit(1);

	let userId: string;
	if (existing) {
		userId = existing.id;
		console.log(`= owner auth user already exists (${email})`);
	} else {
		const res = await auth.api.signUpEmail({ body: { name: OWNER_NAME, email, password } });
		userId = res.user.id;
		console.log(`+ created owner auth user (${email})`);
	}

	await db
		.insert(adminProfile)
		.values({ userId, role: STAFF_ROLE.owner, status: STAFF_STATUS.active })
		.onConflictDoUpdate({
			target: adminProfile.userId,
			set: { role: STAFF_ROLE.owner, status: STAFF_STATUS.active }
		});

	console.log(`✓ owner ready: ${email} (role=owner, status=active)`);
	process.exit(0);
}

main().catch((err) => {
	console.error('Bootstrap failed:', err);
	process.exit(1);
});
