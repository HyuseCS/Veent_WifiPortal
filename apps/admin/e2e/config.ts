/**
 * Shared constants + helpers for the admin governance E2E suite.
 *
 * The whole suite runs against a THROWAWAY database (radius_admin_test), never the
 * dev DB — the seed does DROP SCHEMA, so this isolation is load-bearing. The same
 * three env values are injected into the preview server (playwright.config webServer.env)
 * and the seed subprocess (global-setup) so cookies/2FA/decrypt all line up.
 */
import postgres from 'postgres';

export const TEST_DATABASE_URL =
	process.env.E2E_DATABASE_URL ?? 'postgres://root:root@localhost:5432/radius_admin_test';
export const TEST_BETTER_AUTH_SECRET = 'e2e-test-secret-at-least-32-chars-long-xx';
export const TEST_ORIGIN = 'http://localhost:4173';

/** Env block shared by the seed subprocess and the preview webServer.
 *  Playwright merges process.env into webServer.env, and `bun` auto-loads apps/admin/.env
 *  into the runner — so we must explicitly override anything that would otherwise leak the
 *  dev config: the DB, the router, AND the mailer (a real RESEND_API_KEY would make wipe/
 *  invite attempt a live send). Blanking the mail vars forces the console stub. */
export const TEST_ENV = {
	DATABASE_URL: TEST_DATABASE_URL,
	BETTER_AUTH_SECRET: TEST_BETTER_AUTH_SECRET,
	ORIGIN: TEST_ORIGIN,
	NETWORK_CONTROLLER: 'stub', // never fire a real router grant from a test login
	RESEND_API_KEY: '', // force the stub mailer (no live email from tests)
	EMAIL_FROM: ''
};

/** Where global-setup parks the authenticated owner session + their TOTP secret. */
export const OWNER_STORAGE_STATE = 'e2e/.auth/owner.json';
export const OWNER_TOTP_SECRET_FILE = 'e2e/.auth/owner-totp.txt';

/** Seeded staff (apps/admin/scripts/seed-test-data.ts). Password is shared. */
export const STAFF_PASSWORD = 'password123';
export const OWNER_EMAIL = 'owner@veent.test';

/** Read a staff member's current role straight from the test DB (governance assertion). */
export async function staffRole(email: string): Promise<string | null> {
	const sql = postgres(TEST_DATABASE_URL, { max: 1 });
	try {
		const rows = await sql<{ role: string }[]>`
			SELECT ap.role
			FROM admin_profile ap
			JOIN admin_user u ON u.id = ap.user_id
			WHERE u.email = ${email}
		`;
		return rows[0]?.role ?? null;
	} finally {
		await sql.end();
	}
}

/** Read a staff member's {role, status}, or null if absent (e.g. a fresh invitee check). */
export async function staffByEmail(
	email: string
): Promise<{ role: string; status: string } | null> {
	const sql = postgres(TEST_DATABASE_URL, { max: 1 });
	try {
		const rows = await sql<{ role: string; status: string }[]>`
			SELECT ap.role, ap.status
			FROM admin_profile ap
			JOIN admin_user u ON u.id = ap.user_id
			WHERE u.email = ${email}
		`;
		return rows[0] ?? null;
	} finally {
		await sql.end();
	}
}

/** Force a seeded staff member's role — lets each spec set its own preconditions so
 *  test order never matters (the seed only runs once, in global-setup). */
export async function setStaffRole(email: string, role: 'owner' | 'admin'): Promise<void> {
	const sql = postgres(TEST_DATABASE_URL, { max: 1 });
	try {
		await sql`
			UPDATE admin_profile ap
			SET role = ${role}
			FROM admin_user u
			WHERE u.id = ap.user_id AND u.email = ${email}
		`;
	} finally {
		await sql.end();
	}
}
