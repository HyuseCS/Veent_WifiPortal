import { fail, type ActionFailure, type RequestEvent } from '@sveltejs/kit';
import { getStaffStatus, STAFF_STATUS, grantAdminAccess, resolveDeviceMac } from '@veent/core';
import { auth } from '$lib/server/auth';
import { db } from '$lib/server/db';
import { network } from '$lib/server/network';
import { logger } from '$lib/server/logger';
import { rememberAdminDevice } from '$lib/server/adminBypass';

const log = logger('sign-in');

/**
 * Post-authentication staff gate, shared by both sign-in paths: the direct
 * password path (no 2FA enrolled) and the `/login/2fa` TOTP-verify path. Keeping
 * it in one place means the security-sensitive checks (active-status, sign-out,
 * device grant) can't drift between the two.
 *
 * Returns an `ActionFailure` to hand straight back from the action when the user
 * may NOT proceed (already signed back out), or `null` when cleared — the caller
 * then redirects to /dashboard.
 *
 * The active-status gate runs on every call. The device internet grant runs ONLY when
 * `opts.grantDevice` is set — i.e. after a second factor is actually proven (the /login/2fa
 * verify path, or the /enroll-2fa confirm step). The direct password path passes it false, so a
 * not-yet-enrolled staffer never receives a bypass on a password-only half-login (L-2).
 */
export async function finishStaffSignIn(
	event: RequestEvent,
	userId: string,
	// The new session's token (from the better-auth sign-in result). event.locals.session is still
	// null here — hooks populated locals from the pre-sign-in request — so the token must be threaded
	// in. It keys the persisted device MAC so the layout slide + logout revoke can find it. Optional:
	// the 2FA verify result types it as maybe-undefined; a missing token just skips persistence (the
	// grant still fires — best-effort, as ever).
	sessionToken: string | undefined,
	opts?: { grantDevice?: boolean }
): Promise<ActionFailure<{ message: string }> | null> {
	// Only active staff may sign in. Pending invitees and disabled members are
	// signed straight back out (the cookie was just set during sign-in/verify).
	const status = await getStaffStatus(db, userId);
	if (status !== STAFF_STATUS.active) {
		await auth.api.signOut({ headers: event.request.headers });
		const message =
			status === STAFF_STATUS.pending
				? 'Your account is not activated yet — check your activation email.'
				: 'Your account is not active. Contact the owner.';
		return fail(403, { message });
	}

	// Grant the device internet bypass only once a second factor has been proven (L-2). Resolve the
	// MAC from the LAN IP (the admin URL is walled-garden-whitelisted, so there's no captive-portal
	// `?mac=` to read) and drop the firewall. Best-effort — a failed/unsupported grant (e.g. dev stub)
	// must never block sign-in.
	if (opts?.grantDevice) {
		try {
			const ip = event.getClientAddress();
			const mac = await resolveDeviceMac(network, ip);
			if (mac) {
				await grantAdminAccess(network, mac);
				// Persist the router-resolved MAC (keyed by session token) so the (app) layout can slide
				// the 4h window forward and logout can revoke, both without re-doing the flaky lookup /
				// getClientAddress().
				if (sessionToken) await rememberAdminDevice(sessionToken, mac);
				log.info(`admin bypass granted: ip=${ip} mac=${mac}`);
			} else {
				// Not an error (device may be off-hotspot / on cellular) — but the IP the server saw is
				// the whole diagnostic: if it isn't the device's hotspot LAN IP (proxy/NAT), the router
				// can't map it and no veent-admin binding is written. console-only (not Sentry).
				log.warn(`admin bypass skipped — no MAC for client ip=${ip}`);
			}
		} catch (err) {
			log.error('device internet grant on sign-in failed:', err);
		}
	}

	return null;
}
