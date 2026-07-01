/**
 * Governance flow 1 — promote admin → owner (the TOTP step-up path).
 *
 * Pins: an enrolled owner on the owner-only /staff page can promote an admin by
 * clearing BOTH gates the server re-enforces (typed-name match + a live TOTP code),
 * and the target's role actually flips to `owner` in the DB. This is the regression
 * net for any later refactor of the promote action / PromoteDialog.
 */
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { OWNER_TOTP_SECRET_FILE, setStaffRole, staffRole } from './config';
import { totp } from './totp';

const TARGET_NAME = 'Adrian Admin';
const TARGET_EMAIL = 'adrian@veent.test';

test('owner promotes an admin to owner via TOTP step-up', async ({ page }) => {
	await setStaffRole(TARGET_EMAIL, 'admin'); // self-seed precondition (order-independent)
	expect(await staffRole(TARGET_EMAIL)).toBe('admin');

	await page.goto('/staff');
	await page.getByRole('button', { name: `Give ${TARGET_NAME} the owner role` }).click();

	// Both gates: type the exact name + a fresh authenticator code for the acting owner.
	const secret = readFileSync(OWNER_TOTP_SECRET_FILE, 'utf8').trim();
	const dlg = page.locator('dialog[open]');
	await dlg.locator('input[name="confirmName"]').fill(TARGET_NAME);
	await dlg.locator('input[name="code"]').fill(totp(secret));
	await dlg.getByRole('button', { name: 'Promote to owner' }).click();

	// On success the dialog closes itself…
	await expect(page.getByRole('heading', { name: 'Promote to owner' })).toBeHidden();
	// …and the role is genuinely flipped server-side.
	await expect.poll(() => staffRole(TARGET_EMAIL)).toBe('owner');
});
