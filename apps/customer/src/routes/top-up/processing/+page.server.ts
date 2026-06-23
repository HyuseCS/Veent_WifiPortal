import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { packages } from '@veent/db';
import { getTopupSince } from '@veent/core';
import { db } from '$lib/server/db';
import type { PageServerLoad } from './$types';

/**
 * Payment waiting room. The gateway returns the user here (successUrl) with a
 * `since` ledger watermark + `pkg` id. Credits are added only by the verified
 * webhook (business rule #3), which may land before or after this page loads —
 * so the client polls (`invalidate('topup:status')`) and `getTopupSince` flips
 * `settled` true the moment the topup row appears above the watermark.
 */
export const load: PageServerLoad = async (event) => {
	event.depends('topup:status');

	const user = event.locals.user;
	if (!user) return redirect(302, '/login');

	const since = Number(event.url.searchParams.get('since') ?? 0);
	const pkgId = Number(event.url.searchParams.get('pkg') ?? 0);

	const { settled, creditsAdded, balance } = await getTopupSince(db, user.id, since);

	// Bundle details drive the "pending" chip (₱100 · 350 credits). Once settled we
	// show the ledger's actual credited amount instead of the expected one.
	let fiatCost: number | null = null;
	let expectedCredits = 0;
	if (pkgId) {
		const [pkg] = await db
			.select({ fiatCost: packages.fiatCost, creditsProvided: packages.creditsProvided })
			.from(packages)
			.where(eq(packages.id, pkgId))
			.limit(1);
		fiatCost = pkg?.fiatCost ?? null;
		expectedCredits = pkg?.creditsProvided ?? 0;
	}

	return { settled, balance, creditsAdded, expectedCredits, fiatCost };
};
