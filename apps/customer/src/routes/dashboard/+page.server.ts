import { redirect, fail } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { and, eq } from 'drizzle-orm';
import { packages } from '@veent/db';
import {
	getAccount,
	getActiveAccess,
	getFreeTimeStatus,
	startFreeAccessAndBindDevice,
	startPaidAccessAndBindDevice,
	bindDevice,
	unbindDevice,
	unbindAllDevices,
	resolveDeviceMac,
	MAX_DEVICES_PER_ACCOUNT,
	type ActiveAccess
} from '@veent/core';
import { db } from '$lib/server/db';
import { network } from '$lib/server/network';
import { getPortalContext } from '$lib/server/portal';
import type { RequestEvent } from '@sveltejs/kit';
import { maskPhone } from '$lib/server/otp';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '$lib/server/auth';

/** Re-grant a known device on the router at most this often during dashboard loads. */
const REBIND_REFRESH_MS = 60 * 1000;

/**
 * Resolve the device MAC. The captive-portal redirect (`?mac=`) is preferred, but
 * the OS captive popup (CNA) is a separate browser with its own cookie jar — so the
 * stashed MAC often doesn't survive into the user's real browser. As a fallback we
 * ask the router to map the device's current LAN IP → MAC (resolveMacByIp). Returns
 * null only when neither path knows the device (e.g. dev stub, or off-LAN).
 */
async function resolveMac(event: RequestEvent): Promise<string | null> {
	const fromPortal = getPortalContext(event)?.mac;
	if (fromPortal) return fromPortal;
	// The dev placeholder is ONLY safe with the stub controller, whose grant() just
	// logs. When a real router is configured (NETWORK_CONTROLLER=mikrotik) — e.g.
	// dev-testing through an actual hotspot — fall through to the real IP→MAC lookup.
	if (dev && env.NETWORK_CONTROLLER !== 'mikrotik') return '02:00:00:00:00:01';
	try {
		const ip = event.getClientAddress().replace(/^::ffff:/, '');
		return await resolveDeviceMac(network, ip);
	} catch {
		return null;
	}
}

/** Last three octets of a MAC — a recognizable, low-PII device label for guests. */
function macTail(mac: string | null): string | null {
	if (!mac) return null;
	const parts = mac.split(':');
	return parts.length >= 3 ? parts.slice(-3).join(':') : mac;
}

/** Shape the account access + device registry for the client. */
function shapeDevices(access: ActiveAccess | null, thisMac: string | null) {
	const macU = thisMac?.toUpperCase() ?? null;
	const list = (access?.devices ?? [])
		.map((d) => ({
			id: d.id,
			macTail: macTail(d.macAddress),
			thisDevice: !!macU && d.macAddress?.toUpperCase() === macU,
			boundAt: d.boundAt.toISOString(),
			lastSeenAt: d.lastSeenAt.toISOString()
		}))
		// Most-recently-seen first; the current device floats to the top.
		.sort((a, b) => (a.thisDevice ? -1 : b.thisDevice ? 1 : b.lastSeenAt.localeCompare(a.lastSeenAt)));

	const thisDeviceBound = list.some((d) => d.thisDevice);
	const oldest = [...list].sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt))[0] ?? null;

	return {
		cap: MAX_DEVICES_PER_ACCOUNT,
		count: list.length,
		thisDeviceBound,
		atCap: list.length >= MAX_DEVICES_PER_ACCOUNT && !thisDeviceBound,
		oldest: oldest ? { id: oldest.id, macTail: oldest.macTail } : null,
		list
	};
}

/**
 * The Hub. Renders the ACCOUNT's access window (one countdown shared across the
 * account's devices), the bound-device list, balance, Free Time eligibility, and
 * tiers. Auto-binds the current device transparently when the account has live time
 * and there's headroom under the device cap (keeps "online in under a minute").
 */
export const load: PageServerLoad = async (event) => {
	const user = event.locals.user;
	if (!user) return redirect(302, '/login');

	const account = await getAccount(db, user.id);
	const blocked = account?.blocked ?? false;
	const mac = await resolveMac(event);

	const tiers = await db
		.select()
		.from(packages)
		.where(and(eq(packages.type, 'tier'), eq(packages.isActive, true)));

	let access = await getActiveAccess(db, user.id);

	// Auto-bind: a returning device with live account time should get online with zero
	// taps. Best-effort — a router hiccup must never break the dashboard render.
	if (access && mac && !blocked) {
		const macU = mac.toUpperCase();
		const bound = access.devices.find((d) => d.macAddress?.toUpperCase() === macU);
		const underCap = access.devices.length < MAX_DEVICES_PER_ACCOUNT;
		const stale = bound && Date.now() - bound.lastSeenAt.getTime() > REBIND_REFRESH_MS;
		if ((!bound && underCap) || stale) {
			try {
				const r = await bindDevice(db, network, { userId: user.id, macAddress: mac });
				if (r.ok) access = await getActiveAccess(db, user.id);
			} catch (err) {
				console.error('[customer] auto-bind failed:', err);
			}
		}
		// !bound && at cap → leave the device unbound; the UI offers "replace oldest".
	}

	const phone = (user as { phoneNumber?: string | null }).phoneNumber ?? null;

	return {
		maskedPhone: phone ? maskPhone(phone) : null,
		mac,
		hasMac: !!mac,
		balance: account?.balance ?? 0,
		blocked,
		freeTime: getFreeTimeStatus(account?.lastFreeSessionAt ?? null),
		access: {
			active: !!access,
			isFree: access?.isFree ?? false,
			label: access ? (access.isFree ? 'Free Time' : access.name) : null,
			startedAt: access?.startedAt.toISOString() ?? null,
			expiresAt: access?.expiresAt.toISOString() ?? null
		},
		devices: shapeDevices(access, mac),
		tiers
	};
};

/** A real device MAC: six colon-separated hex octets. Rejects the dev placeholder
 * and anything the captive portal didn't actually populate, so we never hand the
 * router an invalid MAC (which it rejects → an opaque 500). */
const MAC_RE = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/;
const NO_DEVICE =
	'Could not detect your device. Reconnect through the WiFi portal and try again.';

export const actions: Actions = {
	startFreeTime: async (event) => {
		const user = event.locals.user;
		if (!user) return redirect(302, '/login');

		const form = await event.request.formData();
		const mac = String(form.get('mac') ?? '') || (await resolveMac(event)) || '';
		if (!MAC_RE.test(mac)) return fail(400, { error: NO_DEVICE });

		const account = await getAccount(db, user.id);
		if (account?.blocked) return fail(403, { error: 'Account is blocked' });

		let result;
		try {
			result = await startFreeAccessAndBindDevice(db, network, { userId: user.id, macAddress: mac });
		} catch (err) {
			console.error('[customer] startFreeTime grant failed:', err);
			return fail(502, { error: 'Could not reach the network controller. Please try again.' });
		}
		if (!result.ok) {
			return fail(429, { error: 'Free time not available yet', nextEligibleAt: result.nextEligibleAt });
		}
		return { connected: true };
	},

	buyTier: async (event) => {
		const user = event.locals.user;
		if (!user) return redirect(302, '/login');

		const form = await event.request.formData();
		const mac = String(form.get('mac') ?? '') || (await resolveMac(event)) || '';
		const packageId = Number(form.get('packageId'));
		if (!Number.isFinite(packageId)) return fail(400, { error: 'Missing package' });
		// Validate the device BEFORE spending credits — otherwise a bad MAC debits the
		// user and then fails to grant, leaving them charged with no access.
		if (!MAC_RE.test(mac)) return fail(400, { error: NO_DEVICE });

		const account = await getAccount(db, user.id);
		if (account?.blocked) return fail(403, { error: 'Account is blocked' });

		const [pkg] = await db.select().from(packages).where(eq(packages.id, packageId)).limit(1);
		if (!pkg || !pkg.isActive) return fail(404, { error: 'Package not found' });

		// Spend + grant atomically: a failed grant rolls back the spend, so a failed grant
		// never leaves the user charged without access (business rule #1).
		let result;
		try {
			result = await startPaidAccessAndBindDevice(db, network, {
				userId: user.id,
				macAddress: mac,
				packageId: pkg.id,
				amount: pkg.creditCost ?? 0,
				durationMinutes: pkg.durationMinutes ?? 0
			});
		} catch (err) {
			console.error('[customer] buyTier grant failed (rolled back, not charged):', err);
			return fail(502, {
				error: 'The network grant failed — your credits were not charged. Please try again.'
			});
		}
		if (!result.ok) return fail(402, { error: 'Insufficient credit balance' });
		return { connected: true };
	},

	// Bind THIS device to the account's existing window — used by "reconnect" after an
	// auto-bind hiccup, and by "replace oldest" (the cap eviction is automatic).
	bindThisDevice: async (event) => {
		const user = event.locals.user;
		if (!user) return redirect(302, '/login');

		const form = await event.request.formData();
		const mac = String(form.get('mac') ?? '') || (await resolveMac(event)) || '';
		if (!MAC_RE.test(mac)) return fail(400, { error: NO_DEVICE });

		const account = await getAccount(db, user.id);
		if (account?.blocked) return fail(403, { error: 'Account is blocked' });

		let result;
		try {
			result = await bindDevice(db, network, { userId: user.id, macAddress: mac });
		} catch (err) {
			console.error('[customer] bindThisDevice grant failed:', err);
			return fail(502, { error: 'Could not reach the network controller. Please try again.' });
		}
		if (!result.ok) return fail(409, { error: 'No active account time to connect to.' });
		return { connected: true };
	},

	// Remove one device (its MAC is revoked immediately). Service verifies ownership.
	unbindDevice: async (event) => {
		const user = event.locals.user;
		if (!user) return redirect(302, '/login');

		const form = await event.request.formData();
		const sessionId = Number(form.get('deviceId'));
		if (!Number.isFinite(sessionId)) return fail(400, { error: 'Missing device' });

		try {
			const r = await unbindDevice(db, network, { userId: user.id, sessionId });
			if (!r.ok) return fail(404, { error: 'Device not found' });
		} catch (err) {
			console.error('[customer] unbindDevice failed:', err);
			return fail(502, { error: 'Could not reach the network controller. Please try again.' });
		}
		return { removed: true };
	},

	// Disconnect every device but keep the account's time (lost/spoofed-device lever).
	unbindAll: async (event) => {
		const user = event.locals.user;
		if (!user) return redirect(302, '/login');

		try {
			await unbindAllDevices(db, network, user.id);
		} catch (err) {
			console.error('[customer] unbindAll failed:', err);
			return fail(502, { error: 'Could not reach the network controller. Please try again.' });
		}
		return { removed: true };
	},

	signOut: async (event) => {
		await auth.api.signOut({ headers: event.request.headers });
		return redirect(302, '/login');
	}
};
