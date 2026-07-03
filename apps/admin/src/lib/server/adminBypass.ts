import type { RequestEvent } from '@sveltejs/kit';
import {
	grantAdminAccess,
	revokeAdminAccess,
	resolveDeviceMac,
	ADMIN_BYPASS_TTL_MINUTES
} from '@veent/core';
import { network } from '$lib/server/network';
import { logger } from '$lib/server/logger';

const log = logger('admin-bypass');

// Sliding-renewal throttle. The admin bypass is a fixed 4h window (ADMIN_BYPASS_TTL_MINUTES) that we
// slide forward on dashboard activity so an actively-working admin never drops, while an idle /
// departed device ages out at 4h and gets reaped by the customer revoke cron (sweepAdminAccess).
// Re-granting on EVERY page load would hit the router constantly, so we throttle: only refresh once
// the window is past ~half its life. Keyed by the device's LAN IP (per-device on the hotspot LAN)
// and checked BEFORE any router call, so a throttled load does zero router I/O. In-memory: resets on
// restart (one refresh per active IP after) and is bounded by the handful of distinct staff IPs.
// ponytail: no eviction — the set is tiny; add an LRU only if staff IP churn ever makes it grow.
const REFRESH_INTERVAL_MS = (ADMIN_BYPASS_TTL_MINUTES / 2) * 60_000; // 2h at a 4h TTL
const lastRefreshByIp = new Map<string, number>();

/**
 * Slide an active staff member's device bypass forward on dashboard activity. Fire-and-forget from
 * the (app) layout load — MUST never throw or block the page (best-effort, self-logging). Throttled
 * so the vast majority of loads do no work at all. A no-op in dev (the stub can't resolve a MAC).
 */
export async function refreshAdminBypass(event: RequestEvent): Promise<void> {
	try {
		const ip = event.getClientAddress();
		const now = Date.now();
		const last = lastRefreshByIp.get(ip);
		if (last !== undefined && now - last < REFRESH_INTERVAL_MS) return;
		const mac = await resolveDeviceMac(network, ip);
		if (!mac) return; // dev stub / unresolved — nothing to slide
		await grantAdminAccess(network, mac);
		lastRefreshByIp.set(ip, now);
	} catch (err) {
		log.error('admin bypass refresh failed:', err);
	}
}

/**
 * Remove the signing-out device's admin bypass (best-effort). Called from /logout — MUST never block
 * the sign-out. Tag-scoped inside revokeAdminAccess, so it can never touch a guest binding.
 */
export async function revokeAdminBypass(event: RequestEvent): Promise<void> {
	try {
		const ip = event.getClientAddress();
		const mac = await resolveDeviceMac(network, ip);
		if (mac) await revokeAdminAccess(network, mac);
		lastRefreshByIp.delete(ip);
	} catch (err) {
		log.error('admin bypass revoke on logout failed:', err);
	}
}
