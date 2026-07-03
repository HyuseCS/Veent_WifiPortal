import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { packages } from '@veent/db';
import { getTopupSince, reconcileCheckout, getSessionLimits } from '@veent/core';
import { db } from '$lib/server/db';
import { payments } from '$lib/server/payments';
import { resolveMacForUser } from '$lib/server/network-location';
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
	const attempt = event.url.searchParams.get('attempt');

	// On-return safety net: if the webhook hasn't credited yet, ask Maya directly for
	// THIS checkout's status and credit on the spot (throttled + idempotent). Means a
	// missed webhook self-heals while the buyer waits, instead of spinning forever.
	// `attempt` IS the checkout's referenceId token.
	if (attempt) {
		try {
			await reconcileCheckout(db, payments, attempt);
		} catch {
			// best-effort — the cron and webhook still cover it
		}
	}

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

	// Keep the device MAC on the dashboard/try-again links so it survives back into the
	// dashboard even when the system-browser cookie jar dropped it after the gateway hop.
	// resolveMacForUser: portal cookie → router IP→MAC → the account's last-known device MAC.
	// After the Maya hop the system browser has no portal cookie, and behind a NAT'ing hotspot
	// the IP→MAC lookup sees the router's IP, not the device — so without the last-known
	// fallback this returned '' and "Back to dashboard" landed on "device not detected".
	const mac = await resolveMacForUser(event, user.id);
	const portalQuery = mac ? `?mac=${encodeURIComponent(mac)}` : '';

	// Points earned on this top-up, mirroring the server's earn formula (floor(pesos × rate%)).
	// Computed from the bundle's peso price — equals the amount actually credited to points_ledger
	// in the SAME transaction as the credit, so no extra query/watermark is needed to display it.
	const { pointsEarnRate } = await getSessionLimits(db);
	const pointsEarned = Math.floor(((fiatCost ?? 0) * pointsEarnRate) / 100);

	return { settled, balance, creditsAdded, expectedCredits, fiatCost, portalQuery, pointsEarned };
};
