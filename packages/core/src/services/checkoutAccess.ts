import type { NetworkController } from '../integrations/network/types';

/**
 * Per-device pre-auth access for Maya's checkout reCAPTCHA.
 *
 * Maya's checkout page renders a Google reCAPTCHA served from google.com/gstatic.com. Those
 * hosts must be reachable BEFORE the buyer has internet (they're buying it), so they used to
 * sit in the hotspot walled garden as a *global* allow. The problem: Android's captive-portal
 * detector probes `http(s)://www.google.com/generate_204` (and `connectivitycheck.gstatic.com`),
 * and a global allow lets those probes return a real `204` pre-auth — so every connecting guest
 * briefly shows "connected" then flips back to "Sign in to network" (the flash). MikroTik can't
 * path-filter HTTPS, so the probe can't be blocked while google.com is globally open.
 *
 * The fix: don't open these hosts globally. Open them for ONE device — the one actively at
 * checkout — scoped to its LAN IP (`src-address`). Guests on the sign-in screen never get a
 * `204` from google.com, so the flash is gone; the paying device (already past the sign-in
 * screen) gets its captcha. Entries are swept on a TTL by `sweepCheckoutAccess`.
 *
 * Keep this list to what reCAPTCHA actually loads — narrower than the old `*.google.com` /
 * `*.gstatic.com` wildcards on purpose, so it never re-opens a connectivity-probe host.
 */
export const CHECKOUT_ACCESS_HOSTS = ['www.google.com', 'www.gstatic.com', 'www.recaptcha.net'];

/** Default lifetime of a per-device checkout allow before `sweepCheckoutAccess` reclaims it. */
export const CHECKOUT_ACCESS_TTL_MINUTES = 15;

/**
 * Open the reCAPTCHA hosts for the buyer's device only, scoped to its current LAN IP. Call this
 * right before redirecting to the gateway. Best-effort by contract: returns `{ ok: false }` when
 * the controller can't do it (stub/dev) or the router doesn't know the device's IP yet — the
 * caller should never block a checkout on it.
 */
export async function openCheckoutAccess(
	network: NetworkController,
	input: { macAddress: string }
): Promise<{ ok: boolean; ipAddress: string | null }> {
	if (!network.openHostAccessForDevice) return { ok: false, ipAddress: null };
	const { ipAddress } = await network.openHostAccessForDevice({
		macAddress: input.macAddress,
		hosts: CHECKOUT_ACCESS_HOSTS
	});
	return { ok: ipAddress != null, ipAddress };
}

/**
 * Reclaim per-device checkout allows older than `ttlMinutes`. Safe to run on a schedule (wire it
 * into the revoke cron) — it only touches entries this module created, matched by their comment
 * stamp. Returns the number removed (0 when unsupported).
 */
export async function sweepCheckoutAccess(
	network: NetworkController,
	ttlMinutes: number = CHECKOUT_ACCESS_TTL_MINUTES
): Promise<number> {
	if (!network.sweepHostAccess) return 0;
	return network.sweepHostAccess({ maxAgeMs: ttlMinutes * 60_000 });
}
