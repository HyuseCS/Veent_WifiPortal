import type { RequestEvent } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { and, asc, desc, eq, isNotNull, isNull, ne, or } from 'drizzle-orm';
import { customerProfile, networkHealth, networkSessions } from '@veent/db';
import { SESSION_STATUS, resolveDeviceMac, resolveNetworkIdByApName, captureHandled } from '@veent/core';
import { db } from '$lib/server/db';
import { network } from '$lib/server/network';
import { getDeviceMac, getPortalContext, persistResolvedMac } from '$lib/server/portal';

// Device MAC and client IP are PII. observability.ts scrubs them from Sentry events, but that hook
// doesn't touch console.* — so mask them here before they reach stdout/log files (L-8). Keep enough
// tail/head to correlate a session without persisting the full identifier.
function maskMac(mac: string | null | undefined): string | null {
	if (!mac) return mac ?? null;
	return mac.replace(/^(?:[0-9A-Fa-f]{2}:){4}/, '**:**:**:**:'); // keep the last two octets
}
function maskIp(ip: string | null | undefined): string | null {
	if (!ip) return ip ?? null;
	const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
	return v4 ? `${v4[1]}.${v4[2]}.*.*` : ip.replace(/[^:]+(?=:[^:]*$)/, '*'); // v4: keep /16; else mask tail
}

/**
 * Resolve the device MAC. The captive-portal redirect (`?mac=`) is preferred, but the OS
 * captive popup (CNA) is a separate browser with its own cookie jar — so the stashed MAC
 * often doesn't survive into the user's real browser. As a fallback we ask the router to map
 * the device's current LAN IP → MAC (resolveMacByIp). Returns null only when neither path
 * knows the device (e.g. dev stub, or off-LAN). Shared by the dashboard grant paths and the
 * checkout location resolver below.
 */
export async function resolveMac(event: RequestEvent): Promise<string | null> {
	const fromPortal = getPortalContext(event)?.mac;
	if (fromPortal) return fromPortal;
	// The dev placeholder is ONLY safe with the stub controller, whose grant() just logs.
	// When a real router is configured (NETWORK_CONTROLLER=mikrotik) — e.g. dev-testing
	// through an actual hotspot — fall through to the real IP→MAC lookup.
	if (dev && env.NETWORK_CONTROLLER !== 'mikrotik') return '02:00:00:00:00:01';
	try {
		const ip = event.getClientAddress().replace(/^::ffff:/, '');
		const mac = await resolveDeviceMac(network, ip);
		// Cache a fresh IP→MAC result in the portal cookie so the next load in this
		// browser survives a transient IP change (cellular flip) without re-resolving.
		if (mac) {
			persistResolvedMac(event, mac);
		} else {
			// "Device not detected" lands here: no portal cookie (e.g. the system browser
			// after the Maya hop) AND the router couldn't map this client IP → MAC. The IP it
			// saw is the key clue — if it isn't the device's LAN IP (e.g. it's the router/NAT
			// address, or the phone fell back to cellular so it's a WAN IP), the lookup can't win.
			console.warn('[mac] unresolved — no portal cookie; router IP→MAC returned null', {
				ip: maskIp(ip)
			});
		}
		return mac;
	} catch (e) {
		console.warn('[mac] IP→MAC lookup threw', { msg: (e as Error).message });
		// Warning, not error: resolution degrades gracefully (returns null → last-resort fallbacks).
		// Actionable at VOLUME only — a router that starts throwing on every lookup shows as a spike.
		captureHandled(e, { level: 'warning', tags: { area: 'network', scope: 'ip-mac-lookup' } });
		return null;
	}
}

/**
 * The MAC this account most recently connected with — the last-resort device identity.
 * The user authenticated through the captive portal ON this device (the OTP flow binds it),
 * so a `network_sessions` row carries its MAC even after the access window lapsed. Most-recent
 * row regardless of status: it's the same physical device on a reconnect in nearly all cases.
 */
export async function lastKnownMac(userId: string): Promise<string | null> {
	const [row] = await db
		.select({ mac: networkSessions.macAddress })
		.from(networkSessions)
		.where(and(eq(networkSessions.userId, userId), isNotNull(networkSessions.macAddress)))
		.orderBy(desc(networkSessions.startedAt))
		.limit(1);
	return row?.mac ?? null;
}

/**
 * MAC resolution with a per-user last resort. `resolveMac` (portal cookie → router IP→MAC) is
 * the live detector; when BOTH miss it falls back to `lastKnownMac`. Both miss exactly in the
 * cases that produce the "device not detected" warning: the portal cookie is gone (the CNA and
 * the system browser have separate cookie jars — so it's absent after the Maya hop, or whenever
 * the buyer isn't in the browser that hit the `?mac=` redirect), AND the IP→MAC lookup can't
 * help because the hotspot NATs client traffic to its OWN address (we then see the router's IP,
 * e.g. 10.210.0.1, not the device). A fresh portal entry (new `?mac=` cookie) always wins, so the
 * fallback only fills the gap; a user who genuinely switched devices reconnects through the
 * portal to refresh it.
 */
export async function resolveMacForUser(event: RequestEvent, userId: string): Promise<string | null> {
	const live = await resolveMac(event);
	if (live) {
		// Durably remember the freshly-seen MAC on the account (keyed by userId, NOT a cookie) so a
		// later cross-browser hop — the Maya return lands in the system browser with no portal
		// cookie — can still recover it without making the buyer reconnect through the portal.
		await rememberAccountMac(userId, live);
		return live;
	}
	// Live detection missed (no portal cookie + IP→MAC defeated by the hotspot NAT). Try the
	// device-scoped cookie next: it's account-independent and survives sign-out, so a SECOND account
	// logging in on the same browser recovers this device's MAC even though its per-user fallbacks
	// are empty (docs/problems/second-account-mac-not-captured.md). Seed it onto the new account so
	// subsequent cross-browser hops (e.g. the Maya return) have the durable per-user signal too.
	const device = getDeviceMac(event);
	if (device) {
		await rememberAccountMac(userId, device);
		return device;
	}
	// Last resort: the durable account MAC — covers a buyer seen earlier but with no session row yet
	// (e.g. topped up before ever binding a device) — then the most-recent session's MAC.
	return (await accountMac(userId)) ?? (await lastKnownMac(userId));
}

/** Read the durable per-account MAC (`customer_profile.last_known_mac`). */
async function accountMac(userId: string): Promise<string | null> {
	const [row] = await db
		.select({ mac: customerProfile.lastKnownMac })
		.from(customerProfile)
		.where(eq(customerProfile.userId, userId))
		.limit(1);
	return row?.mac ?? null;
}

/**
 * Persist a freshly-resolved MAC onto the account as the durable, cookie-independent fallback.
 * Conditional (only when missing or changed) so a stable device doesn't churn the row on every
 * load; best-effort so a write hiccup never breaks MAC resolution.
 */
async function rememberAccountMac(userId: string, mac: string): Promise<void> {
	try {
		await db
			.update(customerProfile)
			.set({ lastKnownMac: mac })
			.where(
				and(
					eq(customerProfile.userId, userId),
					or(isNull(customerProfile.lastKnownMac), ne(customerProfile.lastKnownMac, mac))
				)
			);
	} catch (e) {
		console.warn('[mac] failed to persist account MAC', { msg: (e as Error).message });
		// Low-priority: best-effort write, self-heals on the next resolution. Watch the rate, not the event.
		captureHandled(e, { level: 'warning', tags: { area: 'network', scope: 'mac-persist' } });
	}
}

/** One structured success line per resolution, tagged with the branch that won — feeds the
 * "why is AP null?" investigation on a real router. Returns the id so call sites stay terse. */
function logResolved(via: string, detail: Record<string, unknown>, networkId: number): number {
	console.info('[topup] AP resolved', { via, ...detail, networkId });
	return networkId;
}

/**
 * Resolve which AP/network (network_health.id) a checkout should be attributed to, so the
 * payment can be reported by location even if it later fails — the value is stamped on the
 * payment_checkouts row at creation and copied onto every resulting payment_transactions
 * event by the webhook. Tries, in order:
 *   1. the AP name the captive portal handed us (router-supplied `ap` param). MikroTik's
 *      hotspot does NOT send this by default — to use this most-reliable path, customize the
 *      hotspot login redirect to append `?ap=$(interface-name)`.
 *   2. the device MAC (portal cookie or IP→MAC) → its current AP via the controller,
 *   3. the buyer's most recent active session's AP,
 *   4. the AP the account was last granted on (customer_profile.last_network_id),
 *   5. (dev only) the first seeded network_health row, so the Finance-by-location flow is
 *      exercisable locally where the stub controller has no MAC→AP lookup.
 * Returns null only for a buyer we have no location signal for at all (foreign device, or a
 * real-router setup where none of 1–4 resolved — the logs below identify which link broke).
 */
export async function resolveCheckoutNetworkId(
	event: RequestEvent,
	userId: string
): Promise<number | null> {
	const ctx = getPortalContext(event);

	if (ctx?.ap) {
		const byAp = await resolveNetworkIdByApName(db, ctx.ap);
		if (byAp !== null) return logResolved('ap-param', { ap: ctx.ap }, byAp);
		console.warn('[topup] portal ap-param matched no network_health row', { ap: ctx.ap });
	}

	// Resolve resolveApForMac inline (rather than via resolveNetworkIdForMac) so the diagnostic
	// can show the interface name the router returned vs. whether it matched a row — the usual
	// real-router culprit (e.g. a CAPsMAN cap interface that differs from the hotspot interface
	// stored in network_health.name).
	const mac = await resolveMac(event);
	if (mac) {
		let apName: string | null;
		try {
			apName = network.resolveApForMac ? await network.resolveApForMac(mac) : null;
		} catch {
			apName = null;
		}
		const byMac = apName ? await resolveNetworkIdByApName(db, apName) : null;
		if (byMac !== null) return logResolved('device-mac', { mac: maskMac(mac), apName }, byMac);
		console.warn('[topup] MAC→AP unresolved', { mac: maskMac(mac), apName });
	}

	const [active] = await db
		.select({ networkId: networkSessions.networkId })
		.from(networkSessions)
		.where(
			and(
				eq(networkSessions.userId, userId),
				eq(networkSessions.status, SESSION_STATUS.active),
				isNotNull(networkSessions.networkId)
			)
		)
		.orderBy(desc(networkSessions.startedAt))
		.limit(1);
	if (active?.networkId != null) return logResolved('active-session', {}, active.networkId);

	const [profile] = await db
		.select({ lastNetworkId: customerProfile.lastNetworkId })
		.from(customerProfile)
		.where(eq(customerProfile.userId, userId))
		.limit(1);
	if (profile?.lastNetworkId != null) return logResolved('last-known', {}, profile.lastNetworkId);

	if (dev) {
		const [anyAp] = await db
			.select({ id: networkHealth.id })
			.from(networkHealth)
			.orderBy(asc(networkHealth.id))
			.limit(1);
		if (anyAp) return logResolved('dev-fallback', {}, anyAp.id);
	}

	console.warn('[topup] AP unresolved — payment will be unattributed by location', { userId });
	// Warning, not error: expected for foreign devices. The COUNT is the signal — a sustained spike
	// means location attribution is broken (Finance-by-location goes blind), not any single miss.
	captureHandled('checkout AP unresolved — payment unattributed by location', {
		level: 'warning',
		tags: { area: 'payment', scope: 'attribution-miss' },
		extra: { userId }
	});
	return null;
}
