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
import { logger } from '$lib/server/logger';
import type { RequestHandler } from './$types';

const log = logger('grant');

/**
 * POST /api/network/grant — start an access session for the authenticated user
 * and drop the firewall for their device.
 *
 * Body: { macAddress: string, packageId?: number }
 *   - no packageId  → Free Time session (15 min, subject to the 12h cooldown)
 *   - with packageId → spend the tier's credit cost, then grant for its duration
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
	// Validate the MAC shape (six hex octets) — same guard the dashboard action applies.
	// An unchecked value would let a caller grant access for an arbitrary device and would
	// flow junk/oversized input into the DB and the router controller (500 / binding-table
	// pollution). Format-validating here doesn't bind the MAC to the caller's own device,
	// but it closes the malformed-input vector and matches the captive-portal path.
	if (!isValidMac(body.macAddress)) error(400, 'A valid macAddress is required');

	// Throttle grant attempts per user so a client can't hammer the spend→grant path.
	const rl = await rateLimit('grant_user', user.id, 20);
	if (!rl.allowed) error(429, 'Too many access requests. Please wait a moment and try again.');

	const account = await getAccount(db, user.id);
	if (account?.blocked) error(403, 'Account is blocked');

	// Free Time
	if (!body.packageId) {
		const result = await startFreeAccessAndBindDevice(db, network, {
			userId: user.id,
			macAddress: body.macAddress
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
			macAddress: body.macAddress,
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
