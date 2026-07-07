import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { packages } from '@veent/db';
import {
	getAccount,
	isValidMac,
	startFreeAccessAndBindDevice,
	startPaidAccessAndBindDevice
} from '@veent/core';
import { db } from '$lib/server/db';
import { network } from '$lib/server/network';
import { rateLimit } from '$lib/server/rateLimit';
import { resolveMacTrusted } from '$lib/server/network-location';
import { logger } from '$lib/server/logger';
import type { RequestHandler } from './$types';

const log = logger('grant');

/**
 * POST /api/network/grant — start an access session for the authenticated user
 * and drop the firewall for their device.
 *
 * Body: { macAddress?: string, packageId?: number }
 *   - no packageId  → Free Time session (15 min, subject to the 12h cooldown)
 *   - with packageId → spend the tier's credit cost, then grant for its duration
 *
 * The device MAC is resolved SERVER-SIDE (M-1/L-1): a body `macAddress` is only a diagnostic hint,
 * never authoritative — trusting it would let an authenticated caller grant internet to an arbitrary
 * device. A body MAC that disagrees with the server-resolved one is logged as a tamper signal.
 *
 * Thin wrapper over @veent/core services (same logic the dashboard form actions
 * use); exists for the captive-portal / programmatic path.
 */
export const POST: RequestHandler = async (event) => {
	const user = event.locals.user;
	if (!user) error(401, 'Not authenticated');

	const body = (await event.request.json().catch(() => ({}))) as {
		macAddress?: string;
		packageId?: number;
	};
	// Throttle FIRST — before the expensive/side-effectful MAC resolution (router IP→MAC lookup +
	// durable fallback persistence in resolveMacForUser) — so a client can't hammer that path or the
	// spend→grant behind it.
	const rl = await rateLimit('grant_user', user.id, 20);
	if (!rl.allowed) error(429, 'Too many access requests. Please wait a moment and try again.');

	// Resolve the device MAC SERVER-SIDE — never trust `body.macAddress` (M-1/L-1). resolveMacTrusted
	// layers portal cookie → router IP→MAC → durable per-account fallbacks (so a legit caller resolves
	// without supplying a MAC) and logs a masked tamper signal if the body MAC disagrees. A null result
	// means we genuinely can't identify the device.
	const mac = await resolveMacTrusted(event, user.id, body.macAddress);
	if (!isValidMac(mac)) {
		error(400, 'Could not detect your device. Reconnect through the WiFi portal and try again.');
	}

	const account = await getAccount(db, user.id);
	if (account?.blocked) error(403, 'Account is blocked');

	// Free Time
	if (!body.packageId) {
		const result = await startFreeAccessAndBindDevice(db, network, {
			userId: user.id,
			macAddress: mac
		});
		if (!result.ok) error(429, `Free time not available. Next eligible: ${result.nextEligibleAt}`);
		return json({ ok: true, mode: 'free', accessExpiresAt: result.accessExpiresAt });
	}

	// Paid tier — spend credits, then grant
	const [pkg] = await db.select().from(packages).where(eq(packages.id, body.packageId)).limit(1);
	if (!pkg || !pkg.isActive) error(404, 'Package not found');

	// Spend + extend the account window + bind the device + grant atomically: a failed grant
	// rolls back the spend, so the user is never charged without getting access (rule #1).
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
		log.error('paid access failed (rolled back, not charged):', err);
		error(503, 'Could not open access — your credits were not charged. Please try again.');
	}
	if (!result.ok) error(402, 'Insufficient credit balance');
	return json({ ok: true, mode: 'tier', accessExpiresAt: result.accessExpiresAt, balance: result.balance });
};
