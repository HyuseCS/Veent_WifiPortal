import type { DB } from '@veent/db';
import { ADMIN_BYPASS_TAG, type NetworkController } from '../integrations/network';
import { hasLiveAccessForMac } from './sessions';

/**
 * Admin-device internet access — distinct from guest sessions.
 *
 * When an active staff member signs in to the (LAN-served, walled-garden-
 * whitelisted) admin dashboard, we drop the firewall for their device so they
 * have working internet without buying credits or burning their Free Time.
 *
 * Unlike guest grants this writes NO `network_sessions` row and no account window. Instead the
 * bypass is SELF-EXPIRING: the binding comment carries a creation stamp (`veent-admin:<epochMs>`)
 * and `sweepAdminAccess` reaps it past ADMIN_BYPASS_TTL_MINUTES. The window is SLIDING — re-asserted
 * on admin dashboard activity — so an actively-working admin never drops while an idle/departed
 * device ages out. Losing the bypass is never a lockout: the dashboard is walled-garden-reachable
 * without it; only general internet lapses (restored on the next activity/sign-in). The binding's
 * own tag keeps it separable from — and tag-scoped-revoke-safe against — guest bypasses.
 */

/**
 * Fixed cap on an admin-device bypass — 4h ("half a work day"), slid forward on activity. The reap
 * runs every minute from the customer revoke cron (`sweepAdminAccess`); the router binding is
 * self-describing (timestamped comment), so no DB row tracks it.
 */
export const ADMIN_BYPASS_TTL_MINUTES = 240;

/**
 * Drops the firewall for an admin device, or slides its window forward on re-assert. Idempotent —
 * the controller re-stamps the binding WITHOUT re-flushing an already-bypassed device. If the MAC
 * already carries a guest bypass, this no-ops (the device already has internet; paid time is not
 * clobbered). `durationMinutes` is unused by the bypass — time lives in the timestamped comment.
 */
export async function grantAdminAccess(
	network: NetworkController,
	macAddress: string
): Promise<void> {
	await network.grant({ macAddress, durationMinutes: 0, tag: ADMIN_BYPASS_TAG });
}

/** Re-blocks an admin device (sign-out / revoke). Tag-scoped so it only removes the admin bypass,
 * never a guest binding sharing the MAC. Idempotent. */
export async function revokeAdminAccess(
	network: NetworkController,
	macAddress: string
): Promise<void> {
	await network.revoke(macAddress, { tag: ADMIN_BYPASS_TAG });
}

/**
 * Reap admin bypasses past the 4h cap (called every minute from the customer revoke cron). Mutual
 * exclusion across the expiry: for each reaped MAC that STILL backs a live guest window (the device
 * is also a paying/free guest), restore its guest binding so it doesn't go dark — the account window
 * is the source of truth. Returns the number reaped. Best-effort: a failed restore self-heals via
 * the next reconcile / dashboard auto-bind.
 */
export async function sweepAdminAccess(
	db: DB,
	network: NetworkController,
	ttlMinutes: number = ADMIN_BYPASS_TTL_MINUTES
): Promise<number> {
	if (!network.sweepAdminBindings) return 0;
	const reapedMacs = await network.sweepAdminBindings({ maxAgeMs: ttlMinutes * 60_000 });
	for (const mac of reapedMacs) {
		if (await hasLiveAccessForMac(db, mac)) {
			// No tag → a guest binding; grant precedence guards against a double-bind.
			try {
				await network.grant({ macAddress: mac, durationMinutes: 0 });
			} catch {
				// Best-effort — reconcile / dashboard auto-bind restores it on the next pass.
			}
		}
	}
	return reapedMacs.length;
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
// Per-attempt timeout, retried below. The router is authoritative and stable (probe-verified: an
// IP resolves consistently across hotspot-host/lease/ARP) — the misses were transient: a fresh
// per-call TLS connection occasionally exceeds the timeout, or the hotspot host table is momentarily
// empty mid-reconnect. A short retry converts that flake into the grant it should have been.
// ponytail: 3 attempts × 2.5s + 2 × 300ms backoff ≈ 8s worst case, only on a genuinely absent
// device; the happy path returns on attempt 1. Bump the counts if the router gets slower.
const RESOLVE_TIMEOUT_MS = 2_500;
const RESOLVE_ATTEMPTS = 3;
const RESOLVE_RETRY_BACKOFF_MS = 300;
const macByIpCache = new Map<string, { mac: string; at: number }>();

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

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
	// getClientAddress() on a dual-stack Node listener yields IPv4-mapped IPv6 (`::ffff:10.0.0.5`),
	// but RouterOS stores plain IPv4 — a raw `?address=::ffff:…` lookup misses and the admin grant
	// silently no-ops. Strip the prefix so this matches the customer path (which strips at its own
	// call sites in network-location.ts / rateLimit.ts). ponytail: only the mapped-v4 case; a real
	// IPv6 client isn't on the hotspot v4 LAN, so it correctly falls through to null.
	const ip = ipAddress.replace(/^::ffff:/, '');
	const now = Date.now();
	const cached = macByIpCache.get(ip);
	if (cached && now - cached.at < MAC_CACHE_TTL_MS) return cached.mac;
	// Retry the live lookup: a transient timeout OR a momentary empty host table (device
	// mid-reconnect) both clear on a second try, so a single flake no longer costs the grant.
	let sawError = false;
	for (let attempt = 0; attempt < RESOLVE_ATTEMPTS; attempt++) {
		if (attempt > 0) await sleep(RESOLVE_RETRY_BACKOFF_MS);
		try {
			const mac = await withTimeout(Promise.resolve(network.resolveMacByIp(ip)), RESOLVE_TIMEOUT_MS);
			if (mac) {
				macByIpCache.set(ip, { mac, at: now });
				return mac;
			}
			// Clean "not found" this attempt — retry a couple times before believing the device is
			// genuinely absent (it may be briefly out of the hotspot host/lease tables on reconnect).
		} catch {
			sawError = true; // router timed out / errored — keep trying
		}
	}
	// Every attempt missed. On a persistent error, last-known beats a false "can't detect device",
	// but only within a bounded window: past MAC_CACHE_STALE_MAX_MS the DHCP lease may have moved this
	// IP to a different device, so a stale MAC is worse than null. A clean not-found returns null.
	if (sawError && cached && now - cached.at < MAC_CACHE_STALE_MAX_MS) return cached.mac;
	return null;
}
