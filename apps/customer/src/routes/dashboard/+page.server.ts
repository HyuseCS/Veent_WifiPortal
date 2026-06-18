import { redirect, fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { packages } from '@veent/db';
import {
	getAccount,
	getFreeTimeStatus,
	startFreeSession,
	startSession,
	spendCredits,
	resolveDeviceMac
} from '@veent/core';
import { db } from '$lib/server/db';
import { network } from '$lib/server/network';
import { getPortalContext } from '$lib/server/portal';
import type { RequestEvent } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '$lib/server/auth';

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
	try {
		// Strip the IPv4-mapped-IPv6 prefix (`::ffff:10.0.0.5`) so the router's
		// `?address=` lookup matches the plain IPv4 the hotspot host table stores.
		const ip = event.getClientAddress().replace(/^::ffff:/, '');
		return await resolveDeviceMac(network, ip);
	} catch {
		return null;
	}
}

/**
 * The Hub. Renders balance, Free Time eligibility, and the access tiers. The
 * device MAC comes from the captive-portal redirect (`?mac=`) or, failing that, a
 * router IP→MAC lookup; it's carried through the action forms as a hidden field.
 */
export const load: PageServerLoad = async (event) => {
	const user = event.locals.user;
	if (!user) return redirect(302, '/login');

	const account = await getAccount(db, user.id);
	const tiers = await db
		.select()
		.from(packages)
		.where(and(eq(packages.type, 'tier'), eq(packages.isActive, true)));

	return {
		user,
		mac: await resolveMac(event),
		balance: account?.balance ?? 0,
		blocked: account?.blocked ?? false,
		freeTime: getFreeTimeStatus(account?.lastFreeSessionAt ?? null),
		tiers
	};
};

/** A real device MAC: six colon-separated hex octets. Rejects the dev placeholder
 * (`DEV:00:…`) and anything the captive portal didn't actually populate, so we
 * never hand the router an invalid MAC (which it rejects → an opaque 500). */
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
			result = await startFreeSession(db, network, { userId: user.id, macAddress: mac });
		} catch (err) {
			console.error('[customer] startFreeSession grant failed:', err);
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

		const spend = await spendCredits(db, { userId: user.id, amount: pkg.creditCost ?? 0, packageId: pkg.id });
		if (!spend.ok) return fail(402, { error: 'Insufficient credit balance' });

		try {
			await startSession(db, network, {
				userId: user.id,
				macAddress: mac,
				packageId: pkg.id,
				durationMinutes: pkg.durationMinutes ?? 0
			});
		} catch (err) {
			console.error('[customer] buyTier grant failed:', err);
			return fail(502, {
				error: 'Payment succeeded but the network grant failed. Contact support — your credits are safe.'
			});
		}
		return { connected: true };
	},

	signOut: async (event) => {
		await auth.api.signOut({ headers: event.request.headers });
		return redirect(302, '/login');
	}
};
