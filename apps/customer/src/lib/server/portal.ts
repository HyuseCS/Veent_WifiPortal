import type { RequestEvent } from '@sveltejs/kit';

/**
 * Captive-portal entry context (device MAC + router callback) capture.
 *
 * When a device hits the WiFi, the router/controller redirects it to this app
 * with the client MAC and a login/callback URL in the query string — but the
 * names differ per vendor, and the subsequent auth redirects drop the query. So
 * on portal entry we normalize and stash the context in a short-lived cookie,
 * then read it back when the user starts a session.
 *
 * Param aliases cover common controllers (UniFi `id`, Omada `clientMac`,
 * Chillispot/Coova `mac`, etc.). Adjust to match the real controller once chosen.
 */
export const PORTAL_COOKIE = 'veent_portal';
const PORTAL_TTL_SECONDS = 60 * 30;

/**
 * Device-scoped MAC memory — account-independent, long-lived.
 *
 * `veent_portal` is browser-scoped AND short-lived, and MAC resolution's durable fallbacks
 * are all keyed by userId. So a second account logging in on the same device (after a sign-out)
 * has NO signal for its MAC — `resolveMacForUser` returns null and the grant can't target this
 * device (see docs/problems/second-account-mac-not-captured.md). This cookie fills that gap: it
 * remembers the last MAC seen in THIS browser regardless of which account (if any) is logged in,
 * and is deliberately NOT cleared on sign-out. Read by `resolveMacForUser` ahead of the per-user
 * fallbacks. Same HTTP-vs-HTTPS posture as `veent_portal` (the LAN portal is often plain HTTP).
 */
export const DEVICE_COOKIE = 'veent_device';
const DEVICE_TTL_SECONDS = 60 * 60 * 24 * 180;

const MAC_PARAMS = ['mac', 'id', 'clientmac', 'client_mac'];
// MikroTik sends `link-login-only` (the auth POST URL) and `link-orig` (originally
// requested page). We keep the former as the controller callback.
const CALLBACK_PARAMS = [
	'link-login-only',
	'link-login',
	'url',
	'loginurl',
	'redirecturl',
	'redirect_url'
];
const ORIG_PARAMS = ['link-orig', 'link_orig'];
const AP_PARAMS = ['ap', 'apmac', 'ap_mac'];

export interface PortalContext {
	mac: string;
	/** MikroTik `link-login-only`: the URL to POST the hotspot login to. */
	callbackUrl?: string;
	/** MikroTik `link-orig`: the page the device originally tried to load. */
	origUrl?: string;
	ap?: string;
	ssid?: string;
}

/** Canonical MAC: 12 hex chars → `AA:BB:CC:DD:EE:FF`; otherwise returned trimmed. */
export function normalizeMac(raw: string): string {
	const hex = raw.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
	const groups = hex.length === 12 ? hex.match(/.{2}/g) : null;
	return groups ? groups.join(':') : raw.trim();
}

/** First query value whose (case-insensitive) key is in `keys`. */
function firstParam(sp: URLSearchParams, keys: string[]): string | null {
	for (const [key, value] of sp) {
		if (value && keys.includes(key.toLowerCase())) return value;
	}
	return null;
}

function fromParams(sp: URLSearchParams): PortalContext | null {
	const rawMac = firstParam(sp, MAC_PARAMS);
	if (!rawMac) return null;
	return {
		mac: normalizeMac(rawMac),
		callbackUrl: firstParam(sp, CALLBACK_PARAMS) ?? undefined,
		origUrl: firstParam(sp, ORIG_PARAMS) ?? undefined,
		ap: firstParam(sp, AP_PARAMS) ?? undefined,
		ssid: sp.get('ssid') ?? undefined
	};
}

/** Capture portal context from the query string into a cookie (no-op if absent). */
export function capturePortalContext(event: RequestEvent): void {
	const ctx = fromParams(event.url.searchParams);
	if (!ctx) return;
	event.cookies.set(PORTAL_COOKIE, JSON.stringify(ctx), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: PORTAL_TTL_SECONDS
	});
	// Also stamp the device-scoped memory so a later second account on this browser can recover it.
	rememberDeviceMac(event, ctx.mac);
}

/**
 * Remember a MAC in the account-independent, long-lived device cookie. Called from every point
 * that learns this browser's device MAC (`?mac=` capture and IP→MAC resolution) so MAC resolution
 * survives a sign-out + fresh-account login on the same device. Best-effort; no-op for empty MAC.
 */
export function rememberDeviceMac(event: RequestEvent, mac: string): void {
	if (!mac) return;
	try {
		event.cookies.set(DEVICE_COOKIE, mac, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: DEVICE_TTL_SECONDS
		});
	} catch {
		// Best-effort cache only (e.g. headers already sent) — never break the request over it.
	}
}

/** Read the device-scoped MAC hint (`veent_device`), independent of any logged-in account. */
export function getDeviceMac(event: RequestEvent): string | null {
	return event.cookies.get(DEVICE_COOKIE) || null;
}

/**
 * Persist a MAC we resolved out-of-band (router IP→MAC) into the portal cookie.
 *
 * Portal entry stashes the MAC from `?mac=` (capturePortalContext), but that cookie
 * lives in the OS captive popup's (CNA) jar — the real browser that returns from the
 * Maya checkout never has it, so it falls back to an IP→MAC lookup every load. Caching
 * that result here means a later request in THIS browser survives a transient IP change
 * (cellular flip, DHCP renew) within the TTL instead of resolving to nothing. Merges
 * into any existing context; no-op for an empty MAC.
 */
export function persistResolvedMac(event: RequestEvent, mac: string): void {
	if (!mac) return;
	let ctx: PortalContext = { mac };
	const raw = event.cookies.get(PORTAL_COOKIE);
	if (raw) {
		try {
			ctx = { ...(JSON.parse(raw) as PortalContext), mac };
		} catch {
			ctx = { mac };
		}
	}
	try {
		event.cookies.set(PORTAL_COOKIE, JSON.stringify(ctx), {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			maxAge: PORTAL_TTL_SECONDS
		});
	} catch {
		// Best-effort cache only (e.g. headers already sent in a streaming response) —
		// never let a failed cookie write knock out a validly-resolved MAC.
	}
	// Mirror into the long-lived device cookie so a later second account recovers it.
	rememberDeviceMac(event, mac);
}

/** Read portal context: fresh query params win, else the captured cookie. */
export function getPortalContext(event: RequestEvent): PortalContext | null {
	const fromQuery = fromParams(event.url.searchParams);
	if (fromQuery) return fromQuery;

	const raw = event.cookies.get(PORTAL_COOKIE);
	if (!raw) return null;
	try {
		return JSON.parse(raw) as PortalContext;
	} catch {
		return null;
	}
}
