/**
 * One-time E2E setup, run before any spec:
 *   1. Validate the TOTP generator against RFC 4226 (fail fast if the crypto is wrong).
 *   2. Seed the throwaway DB (DROP SCHEMA + migrate + deterministic dataset).
 *   3. Drive the owner through mandatory 2FA enrollment on the real preview server,
 *      capture the manual-entry secret, and save an authenticated storageState that
 *      every spec reuses (so no spec re-runs login/enroll).
 *
 * The captured TOTP secret is written alongside the storageState so specs can mint a
 * fresh step-up code for promote / owner-change actions.
 */
import { chromium, type FullConfig } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
	OWNER_EMAIL,
	OWNER_STORAGE_STATE,
	OWNER_TOTP_SECRET_FILE,
	STAFF_PASSWORD,
	TEST_ENV,
	TEST_ORIGIN
} from './config';
import { selfTest, totp } from './totp';

export default async function globalSetup(_config: FullConfig) {
	selfTest();

	// Seed the test DB via the existing script, pointed at the throwaway DB.
	console.log('[e2e] seeding test database…');
	execFileSync('bun', ['run', 'scripts/seed-test-data.ts'], {
		cwd: process.cwd(),
		env: { ...process.env, ...TEST_ENV },
		stdio: 'inherit'
	});

	// Enroll the owner in 2FA through the live server and bank a session.
	console.log('[e2e] enrolling owner 2FA + saving storageState…');
	const browser = await chromium.launch();
	const page = await browser.newPage({ baseURL: TEST_ORIGIN });

	await page.goto('/login');
	await page.fill('input[name="email"]', OWNER_EMAIL);
	await page.fill('input[name="password"]', STAFF_PASSWORD);
	await page.getByRole('button', { name: 'Sign In' }).click();

	// Not yet enrolled → the (app) layout bounces us to /enroll-2fa.
	await page.waitForURL('**/enroll-2fa');
	await page.fill('input[name="password"]', STAFF_PASSWORD);
	await page.getByRole('button', { name: 'Continue' }).click();

	// Step 2: read the manual-entry key, compute a code, tick the backup-codes box, confirm.
	const secret = (await page.locator('span.font-mono.select-all').innerText()).trim();
	await page.locator('input[type="checkbox"]').check();
	await page.fill('input[name="code"]', totp(secret));
	await page.getByRole('button', { name: 'Verify & finish' }).click();
	await page.waitForURL('**/dashboard');

	mkdirSync(dirname(OWNER_STORAGE_STATE), { recursive: true });
	await page.context().storageState({ path: OWNER_STORAGE_STATE });
	writeFileSync(OWNER_TOTP_SECRET_FILE, secret);

	await browser.close();
	console.log('[e2e] setup complete.');
}
