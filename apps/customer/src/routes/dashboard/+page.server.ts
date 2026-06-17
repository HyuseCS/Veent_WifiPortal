import { redirect, fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { packages } from '@veent/db';
import { getAccount, getFreeTimeStatus, startFreeSession, startSession, spendCredits } from '@veent/core';
import { db } from '$lib/server/db';
import { network } from '$lib/server/network';
import type { Actions, PageServerLoad } from './$types';

/**
 * The Hub. Renders balance, Free Time eligibility, and the access tiers. The
 * device MAC arrives as a query param from the captive-portal redirect (`?mac=`)
 * and is carried through the action forms as a hidden field.
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
		mac: event.url.searchParams.get('mac'),
		balance: account?.balance ?? 0,
		blocked: account?.blocked ?? false,
		freeTime: getFreeTimeStatus(account?.lastFreeSessionAt ?? null),
		tiers
	};
};

export const actions: Actions = {
	startFreeTime: async (event) => {
		const user = event.locals.user;
		if (!user) return redirect(302, '/login');

		const form = await event.request.formData();
		const mac = String(form.get('mac') ?? '');
		if (!mac) return fail(400, { error: 'Missing device MAC' });

		const account = await getAccount(db, user.id);
		if (account?.blocked) return fail(403, { error: 'Account is blocked' });

		const result = await startFreeSession(db, network, { userId: user.id, macAddress: mac });
		if (!result.ok) {
			return fail(429, { error: 'Free time not available yet', nextEligibleAt: result.nextEligibleAt });
		}
		return redirect(303, '/connected');
	},

	buyTier: async (event) => {
		const user = event.locals.user;
		if (!user) return redirect(302, '/login');

		const form = await event.request.formData();
		const mac = String(form.get('mac') ?? '');
		const packageId = Number(form.get('packageId'));
		if (!mac || !Number.isFinite(packageId)) return fail(400, { error: 'Missing device MAC or package' });

		const account = await getAccount(db, user.id);
		if (account?.blocked) return fail(403, { error: 'Account is blocked' });

		const [pkg] = await db.select().from(packages).where(eq(packages.id, packageId)).limit(1);
		if (!pkg || !pkg.isActive) return fail(404, { error: 'Package not found' });

		const spend = await spendCredits(db, { userId: user.id, amount: pkg.creditCost ?? 0, packageId: pkg.id });
		if (!spend.ok) return fail(402, { error: 'Insufficient credit balance' });

		await startSession(db, network, {
			userId: user.id,
			macAddress: mac,
			packageId: pkg.id,
			durationMinutes: pkg.durationMinutes ?? 0
		});
		return redirect(303, '/connected');
	}
};
