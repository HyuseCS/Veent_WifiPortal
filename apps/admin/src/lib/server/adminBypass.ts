import type { RequestEvent } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { grantAdminAccess, revokeAdminAccess, ADMIN_BYPASS_TTL_MINUTES } from '@veent/core';
import { adminBypassDevice } from '@veent/db';
import { db } from '$lib/server/db';
import { network } from '$lib/server/network';
import { logger } from '$lib/server/logger';

const log = logger('admin-bypass');

// The bypassed device MAC, resolved from the router at LOGIN (postLogin, where getClientAddress()
// works) and stored keyed by the better-auth session token so the (app) layout can slide the 4h
// window forward and logout can revoke — both WITHOUT re-doing the flaky live IP→MAC lookup, and
// without event.getClientAddress() (which throws "Could not determine clientAddress" in the
// layout-load __data.json context). This replaces the old signed cookie, which didn't reliably
// survive the login form-action through to logout. Per-session: two devices → two rows, each
// revoked independently on its own sign-out; the row FK-cascades away when the session ends.

/** Persist the login-resolved device MAC for this session so refresh + logout can reuse it. */
export async function rememberAdminDevice(sessionToken: string, mac: string): Promise<void> {
	try {
		await db
			.insert(adminBypassDevice)
			.values({ sessionToken, mac, updatedAt: new Date() })
			.onConflictDoUpdate({
				target: adminBypassDevice.sessionToken,
				set: { mac, updatedAt: new Date() }
			});
	} catch (err) {
		log.error('admin bypass device persist failed:', err);
	}
}

async function macForSession(sessionToken: string): Promise<string | null> {
	const rows = await db
		.select({ mac: adminBypassDevice.mac })
		.from(adminBypassDevice)
		.where(eq(adminBypassDevice.sessionToken, sessionToken))
		.limit(1);
	return rows[0]?.mac ?? null;
}

// Sliding-renewal throttle, keyed by session token. The admin bypass is a fixed 4h window
// (ADMIN_BYPASS_TTL_MINUTES) slid forward on dashboard activity so an actively-working admin never
// drops, while an idle/departed device ages out at 4h and is reaped by the customer revoke cron
// (sweepAdminAccess). Re-granting on EVERY page load would hammer the router, so we only refresh once
// the window is past ~half its life. In-memory: resets on restart (harmless — the next load re-grants
// from the stored MAC), bounded by the handful of active staff sessions.
const REFRESH_INTERVAL_MS = (ADMIN_BYPASS_TTL_MINUTES / 2) * 60_000; // 2h at a 4h TTL
const lastRefreshByToken = new Map<string, number>();

/**
 * Slide an active staff member's device bypass forward on dashboard activity. Fire-and-forget from
 * the (app) layout load — MUST never throw or block the page (best-effort, self-logging). Uses the
 * MAC stored at login (keyed by session token), so it needs no getClientAddress() and no live
 * IP→MAC lookup. Throttled so the vast majority of loads do no DB or router work at all. No-op until
 * a login has stored a device for this session.
 */
export async function refreshAdminBypass(event: RequestEvent): Promise<void> {
	try {
		const token = event.locals.session?.token;
		if (!token) return;
		const now = Date.now();
		const last = lastRefreshByToken.get(token);
		if (last !== undefined && now - last < REFRESH_INTERVAL_MS) return; // throttle before any query
		const mac = await macForSession(token);
		if (!mac) return; // no bypassed device on this session yet
		await grantAdminAccess(network, mac);
		lastRefreshByToken.set(token, now);
	} catch (err) {
		log.error('admin bypass refresh failed:', err);
	}
}

/**
 * Remove the signing-out device's admin bypass (best-effort). Called from /logout — MUST never block
 * the sign-out. Revokes the MAC stored for this session (reliable, unlike a fresh lookup would be),
 * then deletes the row. Tag-scoped inside revokeAdminAccess, so it can never touch a guest binding.
 */
export async function revokeAdminBypass(event: RequestEvent): Promise<void> {
	const token = event.locals.session?.token;
	if (!token) {
		log.warn('admin bypass revoke skipped on logout — no session');
		return;
	}
	try {
		const mac = await macForSession(token);
		if (mac) {
			await revokeAdminAccess(network, mac);
			log.info(`admin bypass revoked on logout: mac=${mac}`);
		} else {
			// No stored device for this session — nothing was granted (capture missed) or it was
			// already revoked. The binding, if any, then ages out at the 4h TTL.
			log.warn('admin bypass revoke skipped on logout — no stored device for session');
		}
	} catch (err) {
		log.error('admin bypass revoke on logout failed:', err);
	} finally {
		try {
			await db.delete(adminBypassDevice).where(eq(adminBypassDevice.sessionToken, token));
		} catch (err) {
			log.error('admin bypass device row delete failed:', err);
		}
		lastRefreshByToken.delete(token);
	}
}
