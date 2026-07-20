/**
 * Auth gate on the finance CSV export — /finance/export is a +server.ts endpoint, so the
 * (app) layout guard does NOT run for it; it must enforce auth + mandatory 2FA itself
 * (same contract as /api/router-log) — but in front of BOTH sits the central (app) gate in
 * hooks.server.ts, which 302s an unauthenticated hit to /login and an unenrolled one to
 * /enroll-2fa before the endpoint's own 401/403 can fire. Those endpoint checks stay as
 * defence-in-depth; what this spec pins is the hop that actually runs. Before the guard, an
 * anonymous hit 500'd on `locals.user!.id` and a pre-enrollment session could pull the full
 * transaction PII dump.
 */
import { test, expect } from '@playwright/test';
import { STAFF_PASSWORD } from './config';

const EXPORT_PATH = '/finance/export?period=all';

test('enrolled owner still gets the CSV', async ({ page }) => {
	// The suite's default banked session is the 2FA-enrolled owner.
	const ok = await page.request.get(EXPORT_PATH);
	expect(ok.status()).toBe(200);
	expect(ok.headers()['content-type']).toContain('text/csv');
	expect((await ok.text()).split('\n')[0]).toContain('Date,Status,Amount');
});

test.describe('without the banked owner session', () => {
	// Start from a clean cookie jar — the config's default storageState is the enrolled
	// owner, and @playwright/test applies it to every context (even browser.newContext()).
	test.use({ storageState: { cookies: [], origins: [] } });

	test('anonymous is bounced to /login; a pre-enrollment session to /enroll-2fa', async ({
		page,
		context
	}) => {
		// No session at all. The (app) auth gate lives in hooks.server.ts (handleBetterAuth), which
		// 302s to /login BEFORE the endpoint's own 401 can run — so that is the status this hop
		// actually returns. `maxRedirects: 0` is load-bearing: Playwright follows redirects by
		// default, which would silently turn the real 302 into a followed 200 of the login page.
		const unauthed = await context.request.get(EXPORT_PATH, { maxRedirects: 0 });
		expect(unauthed.status()).toBe(302);
		expect(unauthed.headers()['location']).toBe('/login');

		// Log in as a seeded admin who never enrolled (only the owner enrolls in global-setup;
		// bea is untouched by the governance specs). Hooks expose locals.user pre-enrollment,
		// so the endpoint must 403 — not serve the export to a half-onboarded session.
		await page.goto('/login');
		await page.fill('input[name="email"]', 'bea@veent.test');
		await page.fill('input[name="password"]', STAFF_PASSWORD);
		await page.getByRole('button', { name: 'Sign In' }).click();
		await page.waitForURL('**/enroll-2fa'); // authenticated, parked at enrollment

		const gated = await context.request.get(EXPORT_PATH, { maxRedirects: 0 });
		expect(gated.status()).toBe(302);
		expect(gated.headers()['location']).toBe('/enroll-2fa');
	});
});
