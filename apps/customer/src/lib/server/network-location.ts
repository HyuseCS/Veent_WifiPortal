import type { RequestEvent } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { and, asc, desc, eq, isNotNull } from 'drizzle-orm';
import { customerProfile, networkHealth, networkSessions } from '@veent/db';
import { SESSION_STATUS, resolveDeviceMac, resolveNetworkIdByApName } from '@veent/core';
import { db } from '$lib/server/db';
import { network } from '$lib/server/network';
import { getPortalContext, persistResolvedMac } from '$lib/server/portal';

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
		if (mac) persistResolvedMac(event, mac);
		return mac;
	} catch {
		return null;
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
		if (byMac !== null) return logResolved('device-mac', { mac, apName }, byMac);
		console.warn('[topup] MAC→AP unresolved', { mac, apName });
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
	return null;
}
