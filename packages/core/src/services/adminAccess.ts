import type { NetworkController } from '../integrations/network';

/**
 * Admin-device internet access — distinct from guest sessions.
 *
 * When an active staff member signs in to the (LAN-served, walled-garden-
 * whitelisted) admin dashboard, we drop the firewall for their device so they
 * have working internet without buying credits or burning their Free Time.
 *
 * Unlike guest grants this writes NO `network_sessions` row, so the time-based
 * revoke cron (`expireDueSessions`, which only revokes session MACs) never sweeps
 * it — the bypass persists until an explicit sign-out / kick. The binding carries
 * its own tag so it's identifiable on the router and separable from guest bypasses.
 */
export const ADMIN_BYPASS_TAG = 'veent-admin';

/**
 * Drops the firewall for an admin device. Idempotent (re-asserts the bypass).
 * `durationMinutes: 0` signals "no time limit" — the MikroTik controller creates
 * a standing ip-binding and the cron leaves untagged-by-session MACs alone.
 */
export async function grantAdminAccess(
	network: NetworkController,
	macAddress: string
): Promise<void> {
	await network.grant({ macAddress, durationMinutes: 0, tag: ADMIN_BYPASS_TAG });
}

/** Re-blocks an admin device (sign-out / revoke). Idempotent. */
export async function revokeAdminAccess(
	network: NetworkController,
	macAddress: string
): Promise<void> {
	await network.revoke(macAddress);
}

/**
 * Resolves the signing-in device's MAC from its LAN IP via the controller, for
 * the admin path where the captive-portal `?mac=` redirect was bypassed. Returns
 * null when the controller can't resolve it (e.g. the dev stub) so callers can
 * treat the grant as best-effort and never block sign-in on it.
 */
export async function resolveDeviceMac(
	network: NetworkController,
	ipAddress: string | null | undefined
): Promise<string | null> {
	if (!ipAddress || !network.resolveMacByIp) return null;
	return network.resolveMacByIp(ipAddress);
}
