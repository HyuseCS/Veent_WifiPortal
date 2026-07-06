import type { RequestEvent } from '@sveltejs/kit';
import { grantAdminAccess, revokeAdminAccess, ADMIN_BYPASS_TTL_MINUTES } from '@veent/core';
import { network } from '$lib/server/network';
import { logger } from '$lib/server/logger';

const log = logger('admin-bypass');

// The device MAC, resolved from the router at LOGIN (postLogin, where getClientAddress() works) and
// stashed here so the (app) layout can slide the 4h window forward on activity WITHOUT re-doing the
// flaky live IP→MAC lookup — and without event.getClientAddress(), which is NOT reliably available in
// the layout-load context (it throws "Could not determine clientAddress" on SvelteKit __data.json
// navigation sub-requests, which is why the pre-cookie slide never actually ran). httpOnly: the
// browser never reads it; we only trust it because WE set it from a router-vouched lookup.
const ADMIN_DEV_MAC_COOKIE = 'admin_dev_mac';

/** Persist the login-resolved device MAC so the sliding renewal + logout revoke can reuse it. */
export function setAdminDevMacCookie(event: RequestEvent, mac: string): void {
	event.cookies.set(ADMIN_DEV_MAC_COOKIE, mac, {
		httpOnly: true,
		sameSite: 'lax',
		path: '/',
		maxAge: 60 * 60 * 24 * 30 // 30d; re-written on every login
	});
}

// Sliding-renewal throttle, keyed by device MAC. The admin bypass is a fixed 4h window
// (ADMIN_BYPASS_TTL_MINUTES) slid forward on dashboard activity so an actively-working admin never
// drops, while an idle/departed device ages out at 4h and is reaped by the customer revoke cron
// (sweepAdminAccess). Re-granting on EVERY page load would hammer the router, so we only refresh once
// the window is past ~half its life. In-memory: resets on restart, bounded by the handful of staff MACs.
const REFRESH_INTERVAL_MS = (ADMIN_BYPASS_TTL_MINUTES / 2) * 60_000; // 2h at a 4h TTL
const lastRefreshByMac = new Map<string, number>();

/**
 * Slide an active staff member's device bypass forward on dashboard activity. Fire-and-forget from
 * the (app) layout load — MUST never throw or block the page (best-effort, self-logging). Uses the
 * MAC stashed at login (cookie), so it needs no getClientAddress() and no live IP→MAC lookup.
 * Throttled so the vast majority of loads do no work at all. No-op until a login has stashed a MAC.
 */
export async function refreshAdminBypass(event: RequestEvent): Promise<void> {
	try {
		const mac = event.cookies.get(ADMIN_DEV_MAC_COOKIE);
		if (!mac) return; // no login-resolved device on this browser yet
		const now = Date.now();
		const last = lastRefreshByMac.get(mac);
		if (last !== undefined && now - last < REFRESH_INTERVAL_MS) return;
		await grantAdminAccess(network, mac);
		lastRefreshByMac.set(mac, now);
	} catch (err) {
		log.error('admin bypass refresh failed:', err);
	}
}

/**
 * Remove the signing-out device's admin bypass (best-effort). Called from /logout — MUST never block
 * the sign-out. Revokes the MAC stashed at login (reliable, unlike a fresh lookup would be) and
 * clears the cookie. Tag-scoped inside revokeAdminAccess, so it can never touch a guest binding.
 */
export async function revokeAdminBypass(event: RequestEvent): Promise<void> {
	const mac = event.cookies.get(ADMIN_DEV_MAC_COOKIE);
	try {
		if (mac) await revokeAdminAccess(network, mac);
	} catch (err) {
		log.error('admin bypass revoke on logout failed:', err);
	} finally {
		event.cookies.delete(ADMIN_DEV_MAC_COOKIE, { path: '/' });
		if (mac) lastRefreshByMac.delete(mac);
	}
}
