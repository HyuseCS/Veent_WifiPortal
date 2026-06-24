import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { packages } from '@veent/db';
import { getAccount, startFreeSession, startPaidSession } from '@veent/core';
import { db } from '$lib/server/db';
import { network } from '$lib/server/network';
import type { RequestHandler } from './$types';

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
	if (!body.macAddress) error(400, 'macAddress is required');

	const account = await getAccount(db, user.id);
	if (account?.blocked) error(403, 'Account is blocked');

	// Free Time
	if (!body.packageId) {
		const result = await startFreeSession(db, network, {
			userId: user.id,
			macAddress: body.macAddress
		});
		if (!result.ok) error(429, `Free time not available. Next eligible: ${result.nextEligibleAt}`);
		return json({ ok: true, mode: 'free', session: result.session });
	}

	// Paid tier — spend credits, then grant
	const [pkg] = await db.select().from(packages).where(eq(packages.id, body.packageId)).limit(1);
	if (!pkg || !pkg.isActive) error(404, 'Package not found');

	// Spend + grant atomically: a failed grant rolls back the spend, so the user is never
	// charged without getting access (business rule #1).
	let result;
	try {
		result = await startPaidSession(db, network, {
			userId: user.id,
			macAddress: body.macAddress,
			packageId: pkg.id,
			amount: pkg.creditCost ?? 0,
			durationMinutes: pkg.durationMinutes ?? 0
		});
	} catch (err) {
		console.error('[grant] paid session failed (rolled back, not charged):', err);
		error(503, 'Could not open access — your credits were not charged. Please try again.');
	}
	if (!result.ok) error(402, 'Insufficient credit balance');
	return json({ ok: true, mode: 'tier', session: result.session, balance: result.balance });
};
