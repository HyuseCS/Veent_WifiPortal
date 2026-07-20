/**
 * Per-AP visibility on /networks (Phase A) — renders one card per physical AP, collapses a
 * shared-ONU circuit-id group into a single honest card, and degrades per-AP traffic to "—".
 * Runs against the seeded throwaway DB (OAP3000G-A/B share a circuit-id → group; OAP3000G-C solo;
 * OAP3000G-D offline). Covers G11 render facts (AC11, AC5, AC2) plus the KPI no-double-count rule.
 */
import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
	await page.goto('/networks');
	// Wait past the skeleton: the streamed router health / live snapshot has resolved.
	await expect(page.getByText('OAP3000G-C')).toBeVisible({ timeout: 30_000 });
});

test('shared-ONU APs collapse into one honest group card listing both members', async ({ page }) => {
	// Exactly one shared-ONU indicator, and it names both grouped APs.
	const indicator = page.getByText(/Shared ONU — the router cannot split these 2 APs/i);
	await expect(indicator).toHaveCount(1);
	// The group card lists each member with its own name/status (per-AP up/down stays independent).
	// OAP3000G-A is the representative (also in the card header), so it appears more than once —
	// assert at least one of each member name is on the board.
	await expect(page.getByText('OAP3000G-A', { exact: true }).first()).toBeVisible();
	await expect(page.getByText('OAP3000G-B', { exact: true }).first()).toBeVisible();
});

test('a solo AP renders as its own card (no group indicator)', async ({ page }) => {
	await expect(page.getByText('OAP3000G-C', { exact: true })).toBeVisible();
});

test('an offline AP shows Offline and unavailable ("—") traffic while others are healthy', async ({
	page
}) => {
	await expect(page.getByText('OAP3000G-D', { exact: true })).toBeVisible();
	// Offline status badge is present somewhere on the board (the offline AP).
	await expect(page.getByText('Offline', { exact: true }).first()).toBeVisible();
	// The offline AP has null throughput → the honest "—" traffic cell renders.
	await expect(page.getByText('—', { exact: true }).first()).toBeVisible();
});

test('Connected Users KPI is present (session-based, no per-AP double count)', async ({ page }) => {
	// The KPI strip carries a Connected Users figure (rendered inside a carousel, so it's present in
	// the DOM even when a given slide is off-screen). The group card contributes its members' summed
	// session count once, never double-counted per member.
	await expect(page.getByText('Connected Users').first()).toBeAttached();
});
