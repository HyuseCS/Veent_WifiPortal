import type { NetworkController } from '../integrations/network';

/**
 * Admin-device internet access — distinct from guest sessions.
 *
 * When an active staff member signs in to the (LAN-served, walled-garden-
 * whitelisted) admin dashboard, we drop the firewall for their device so they
 * have working internet without buying credits or burning their Free Time.
 *
 * Unlike guest grants this writes NO `network_sessions` row and no account window,
 * so the revoke cron (`expireDueAccounts`, which only touches accounts with a lapsed
 * window) never sweeps it — the bypass persists until an explicit sign-out / kick.
 * It also isn't a bound device under any account. The binding carries
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
 *
 * Resilience (this runs on every dashboard load — it's the cookie-free way to
 * identify a returning device): a short IP→MAC cache absorbs a transient router-API
 * blip, and a hard timeout stops a hung API from stalling the page. On a lookup
 * error we fall back to the last-known MAC for that IP rather than "can't detect".
 */
const MAC_CACHE_TTL_MS = 60_000;
// ponytail: 5-min ceiling on the error-path fallback — tolerates a router blip without
// surviving a DHCP lease reassignment (a stale IP→MAC would then point at the wrong device).
const MAC_CACHE_STALE_MAX_MS = 5 * 60_000;
const RESOLVE_TIMEOUT_MS = 5_000;
const macByIpCache = new Map<string, { mac: string; at: number }>();

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const t = setTimeout(() => reject(new Error(`resolveMacByIp timed out after ${ms}ms`)), ms);
		p.then(
			(v) => {
				clearTimeout(t);
				resolve(v);
			},
			(e) => {
				clearTimeout(t);
				reject(e);
			}
		);
	});
}

export async function resolveDeviceMac(
	network: NetworkController,
	ipAddress: string | null | undefined
): Promise<string | null> {
	if (!ipAddress || !network.resolveMacByIp) return null;
	const now = Date.now();
	const cached = macByIpCache.get(ipAddress);
	if (cached && now - cached.at < MAC_CACHE_TTL_MS) return cached.mac;
	try {
		const mac = await withTimeout(
			Promise.resolve(network.resolveMacByIp(ipAddress)),
			RESOLVE_TIMEOUT_MS
		);
		if (mac) {
			macByIpCache.set(ipAddress, { mac, at: now });
			return mac;
		}
		// Clean "not found" (device genuinely absent) — don't resurrect a stale entry.
		return null;
	} catch {
		// Router timed out / errored — last-known beats a false "can't detect device",
		// but only within a bounded window: past MAC_CACHE_STALE_MAX_MS the DHCP lease may
		// have moved this IP to a different device, so a stale MAC is worse than null.
		if (cached && now - cached.at < MAC_CACHE_STALE_MAX_MS) return cached.mac;
		return null;
	}
}
