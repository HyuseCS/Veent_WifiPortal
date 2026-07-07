import { redirect, fail } from '@sveltejs/kit';
import { and, asc, eq } from 'drizzle-orm';
import { packages } from '@veent/db';
import {
	getAccount,
	getActiveAccess,
	startFreeAccessAndBindDevice,
	startPaidAccessAndBindDevice,
	pauseAccountAccess,
	resumeAccountAccess,
	bindDevice,
	unbindDevice,
	unbindAllDevices,
	getSessionLimits
} from '@veent/core';
import { db } from '$lib/server/db';
import { network } from '$lib/server/network';
import { rateLimit } from '$lib/server/rateLimit';
import { buildAccountView } from '$lib/server/account-view';
import { resolveMacForUser } from '$lib/server/network-location';
import { maskPhone } from '$lib/server/otp';
import { logger } from '$lib/server/logger';
import type { Actions, PageServerLoad } from './$types';
import { auth } from '$lib/server/auth';

const log = logger('dashboard');

/** Re-grant a known device on the router at most this often during dashboard loads. */
const REBIND_REFRESH_MS = 60 * 1000;

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
	// resolveMacForUser falls back to the account's last-known device MAC when the portal
	// cookie is gone (CNA/system-browser split, Maya hop) AND the router IP→MAC lookup can't
	// help — which it can't behind a hotspot that NATs client traffic to its own IP (we'd see
	// the router's address, not the device). Without this fallback the dashboard shows the
	// "device not detected" warning on every return-to-dashboard in those setups.
	const mac = await resolveMacForUser(event, user.id);

	const tiers = await db
		.select()
		.from(packages)
		.where(and(eq(packages.type, 'tier'), eq(packages.isActive, true)))
		// Ascending by access length so the shortest tier shows first (5 min → 30 min → 1 hour).
		// Without an explicit order Postgres returns heap order, which shifts after any row UPDATE.
		.orderBy(asc(packages.durationMinutes));

	let access = await getActiveAccess(db, user.id);

	// Auto-bind: a returning device with live account time should get online with zero
	// taps. Best-effort — a router hiccup must never break the dashboard render. Skipped while
	// PAUSED: auto-binding would re-grant internet and defeat the pause (devices stay off until
	// the user resumes).
	if (access && !access.paused && mac && !blocked) {
		const { maxDevicesPerAccount } = await getSessionLimits(db);
		const macU = mac.toUpperCase();
		const bound = access.devices.find((d) => d.macAddress?.toUpperCase() === macU);
		const underCap = access.devices.length < maxDevicesPerAccount;
		const stale = bound && Date.now() - bound.lastSeenAt.getTime() > REBIND_REFRESH_MS;
		if ((!bound && underCap) || stale) {
			try {
				const r = await bindDevice(db, network, { userId: user.id, macAddress: mac });
				if (r.ok) access = await getActiveAccess(db, user.id);
			} catch (err) {
				log.error('auto-bind failed:', err);
			}
		}
		// !bound && at cap → leave the device unbound; the UI offers "replace oldest".
	}

	const phone = (user as { phoneNumber?: string | null }).phoneNumber ?? null;

	// The live, per-account slice (balance, free-time, access window, devices) — same shape
	// the SSE feed pushes (`$lib/server/account-view`), so cross-device updates merge cleanly.
	const view = await buildAccountView(db, user.id, mac);
	// TEMP DIAGNOSTIC: every dashboard load logs the resolved MAC + bound state. After a buy,
	// `update()` should re-run this load and log a SECOND line with thisBound=true. Remove once
	// the "needs a refresh to show connected" bug is understood.
	console.info(
		`[dash-load] mac=${mac ?? 'null'} active=${view.access.active} thisBound=${view.devices.thisDeviceBound} devices=${view.devices.count}`
	);

	// Issue 2b/B: mint a CNA→browser handoff token for THIS session so the page can offer an
	// "Open in your browser to manage credits" link. The token is short-TTL + single-use
	// (auth.ts oneTimeToken); opening the link in the system browser mints a session there
	// (see /auth/handoff) so the guest skips a second OTP. Best-effort — a token hiccup must
	// never break the dashboard render; the link is simply omitted then.
	let handoffUrl: string | null = null;
	try {
		const r = await auth.api.generateOneTimeToken({ headers: event.request.headers });
		if (r?.token) handoffUrl = `${event.url.origin}/auth/handoff?token=${encodeURIComponent(r.token)}`;
	} catch (err) {
		// Low-priority: the link is simply omitted; the dashboard still renders. log.error routes
		// through the seam → Sentry at warning level, so it's the rate that matters, not one miss.
		log.error('[handoff] token generation failed:', err);
	}

	return {
		maskedPhone: phone ? maskPhone(phone) : null,
		mac,
		hasMac: !!mac,
		tiers,
		handoffUrl,
		...view
	};
};

/** A real device MAC: six colon-separated hex octets. Rejects the dev placeholder
 * and anything the captive portal didn't actually populate, so we never hand the
 * router an invalid MAC (which it rejects → an opaque 500). */
const MAC_RE = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/;
const NO_DEVICE =
	'Could not detect your device. Reconnect through the WiFi portal and try again.';

// Per-user grant throttle (L-4): the grant/bind actions share the JSON endpoint's `grant_user`
// budget so a user can't sidestep it via the dashboard form. `bindThisDevice` in particular can
// churn arbitrary MAC binds/unbinds against the router, so it must be throttled like the rest.
const TOO_MANY = fail(429, { error: 'Too many requests. Please slow down and try again.' });

export const actions: Actions = {
	startFreeTime: async (event) => {
		const user = event.locals.user;
		if (!user) return redirect(302, '/login');
		if (!(await rateLimit('grant_user', user.id, 20)).allowed) return TOO_MANY;

		const form = await event.request.formData();
		const mac = String(form.get('mac') ?? '') || (await resolveMacForUser(event, user.id)) || '';
		if (!MAC_RE.test(mac)) return fail(400, { error: NO_DEVICE });

		const account = await getAccount(db, user.id);
		if (account?.blocked) return fail(403, { error: 'Account is blocked' });

		let result;
		try {
			result = await startFreeAccessAndBindDevice(db, network, { userId: user.id, macAddress: mac });
		} catch (err) {
			log.error('startFreeTime grant failed:', err);
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
		if (!(await rateLimit('grant_user', user.id, 20)).allowed) return TOO_MANY;

		const form = await event.request.formData();
		const mac = String(form.get('mac') ?? '') || (await resolveMacForUser(event, user.id)) || '';
		const packageId = Number(form.get('packageId'));
		// Which wallet to pay from — the buy sheet offers both. Default credits (back-compat).
		const currency = form.get('currency') === 'points' ? 'points' : 'credits';
		if (!Number.isFinite(packageId)) return fail(400, { error: 'Missing package' });
		// Validate the device BEFORE spending — otherwise a bad MAC debits the user and then
		// fails to grant, leaving them charged with no access.
		if (!MAC_RE.test(mac)) return fail(400, { error: NO_DEVICE });

		const account = await getAccount(db, user.id);
		if (account?.blocked) return fail(403, { error: 'Account is blocked' });

		const [pkg] = await db.select().from(packages).where(eq(packages.id, packageId)).limit(1);
		if (!pkg || !pkg.isActive) return fail(404, { error: 'Package not found' });

		// A tier is redeemable with points only if the admin set a points price.
		if (currency === 'points' && pkg.pointsCost == null) {
			return fail(400, { error: 'This tier can’t be redeemed with points.' });
		}
		const amount = currency === 'points' ? (pkg.pointsCost ?? 0) : (pkg.creditCost ?? 0);

		// Spend + grant atomically: a failed grant rolls back the spend, so a failed grant
		// never leaves the user charged without access (business rule #1).
		let result;
		try {
			result = await startPaidAccessAndBindDevice(db, network, {
				userId: user.id,
				macAddress: mac,
				packageId: pkg.id,
				amount,
				durationMinutes: pkg.durationMinutes ?? 0,
				currency
			});
		} catch (err) {
			log.error('buyTier grant failed (rolled back, not charged):', err);
			const w = currency === 'points' ? 'points were' : 'credits were';
			return fail(502, {
				error: `The network grant failed — your ${w} not charged. Please try again.`
			});
		}
		if (!result.ok) {
			return fail(402, {
				error:
					currency === 'points' ? 'Insufficient points balance' : 'Insufficient credit balance'
			});
		}
		return { connected: true };
	},

	// Bind THIS device to the account's existing window — used by "reconnect" after an
	// auto-bind hiccup, and by "replace oldest" (the cap eviction is automatic).
	bindThisDevice: async (event) => {
		const user = event.locals.user;
		if (!user) return redirect(302, '/login');
		if (!(await rateLimit('grant_user', user.id, 20)).allowed) return TOO_MANY;

		const form = await event.request.formData();
		const mac = String(form.get('mac') ?? '') || (await resolveMacForUser(event, user.id)) || '';
		if (!MAC_RE.test(mac)) return fail(400, { error: NO_DEVICE });

		const account = await getAccount(db, user.id);
		if (account?.blocked) return fail(403, { error: 'Account is blocked' });

		let result;
		try {
			result = await bindDevice(db, network, { userId: user.id, macAddress: mac });
		} catch (err) {
			log.error('bindThisDevice grant failed:', err);
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
			log.error('unbindDevice failed:', err);
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
			log.error('unbindAll failed:', err);
			return fail(502, { error: 'Could not reach the network controller. Please try again.' });
		}
		return { removed: true };
	},

	// Pause the account's PAID access window: freeze the remaining time and disconnect every
	// device. The held time survives until resume (the revoke cron skips paused accounts).
	pauseAccess: async (event) => {
		const user = event.locals.user;
		if (!user) return redirect(302, '/login');

		let result;
		try {
			result = await pauseAccountAccess(db, network, user.id);
		} catch (err) {
			log.error('pauseAccess failed:', err);
			return fail(502, { error: 'Could not reach the network controller. Please try again.' });
		}
		if (!result.ok) {
			const error =
				result.reason === 'free_not_pausable'
					? 'Free Time can’t be paused.'
					: 'No active access to pause.';
			return fail(409, { error });
		}
		return { paused: true };
	},

	// Resume a paused window: restore the held time into a fresh window. The current device
	// reconnects via the dashboard auto-bind on the resulting reload.
	resumeAccess: async (event) => {
		const user = event.locals.user;
		if (!user) return redirect(302, '/login');

		let result;
		try {
			// onlyReason:'user' — a guest can resume only their own manual pause; outage pauses are
			// released by the outage sweep alone (guard is enforced in the service, under lock).
			result = await resumeAccountAccess(db, user.id, undefined, { onlyReason: 'user' });
		} catch (err) {
			log.error('resumeAccess failed:', err);
			return fail(502, { error: 'Could not resume access. Please try again.' });
		}
		if (!result.ok) {
			const error =
				result.reason === 'no_remaining'
					? 'No held time left to resume.'
					: 'Nothing to resume.';
			return fail(409, { error });
		}
		return { resumed: true };
	},

	signOut: async (event) => {
		// Re-thread this device's MAC across the logout→login boundary so the NEXT account's login
		// re-captures it (into veent_portal + the pending cookie) even in the same browser. The
		// device cookie already survives sign-out and covers this, but the explicit ?mac= also
		// refreshes the short-lived portal cookie for the incoming account. Resolve BEFORE signing
		// out (needs the user id for the per-user fallbacks); cheap and best-effort.
		const user = event.locals.user;
		const mac = user ? await resolveMacForUser(event, user.id) : null;
		await auth.api.signOut({ headers: event.request.headers });
		return redirect(302, mac ? `/login?mac=${encodeURIComponent(mac)}` : '/login');
	}
};
