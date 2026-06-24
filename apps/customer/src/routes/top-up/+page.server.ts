import { redirect, fail } from '@sveltejs/kit';
import { and, eq, asc } from 'drizzle-orm';
import { packages, paymentCheckouts } from '@veent/db';
import { getAccount, getLatestLedgerId } from '@veent/core';
import { db } from '$lib/server/db';
import { payments } from '$lib/server/payments';
import type { Actions, PageServerLoad } from './$types';

/**
 * The Storefront. Lists credit bundles. Selecting one creates a Maya checkout
 * and redirects the user to the gateway. Credits are NOT added here — only the
 * verified webhook adds them (business rule #3).
 */
export const load: PageServerLoad = async (event) => {
	const user = event.locals.user;
	if (!user) return redirect(302, '/login');

	const account = await getAccount(db, user.id);
	const bundles = await db
		.select()
		.from(packages)
		.where(and(eq(packages.type, 'bundle'), eq(packages.isActive, true)))
		.orderBy(asc(packages.fiatCost));

	return { user, balance: account?.balance ?? 0, bundles };
};

export const actions: Actions = {
	checkout: async (event) => {
		const user = event.locals.user;
		if (!user) return redirect(302, '/login');

		const form = await event.request.formData();
		const packageId = Number(form.get('packageId'));
		if (!Number.isFinite(packageId)) return fail(400, { error: 'Missing package' });

		const [pkg] = await db.select().from(packages).where(eq(packages.id, packageId)).limit(1);
		if (!pkg || !pkg.isActive) return fail(404, { error: 'Bundle not found' });

		const origin = event.url.origin;
		// Watermark the ledger now; the processing page polls for a topup row above
		// this id to know THIS payment's credit landed (gateway txn id is unknown here).
		const since = await getLatestLedgerId(db, user.id);
		// Short per-attempt token as the gateway reference (Maya caps requestReferenceNumber
		// at 36 chars — a 32-char user id leaves no room to also embed ids/a nonce). The
		// buyer is resolved from the payment_checkouts row we store below, not from the
		// reference string. Unique per checkout → the claim maps to exactly one row.
		const referenceId = crypto.randomUUID().replace(/-/g, ''); // 32 hex chars
		let redirectUrl: string;
		try {
			const checkout = await payments.createCheckout({
				referenceId,
				amountMinor: Math.round((pkg.fiatCost ?? 0) * 100),
				currency: 'PHP',
				description: pkg.name,
				successUrl: `${origin}/top-up/processing?since=${since}&pkg=${pkg.id}&attempt=${referenceId}`,
				cancelUrl: `${origin}/top-up`,
				buyer: { name: user.name, email: user.email }
			});
			redirectUrl = checkout.redirectUrl;

			// Record the pending checkout — the safety net. If the webhook never lands, the
			// reconcile cron / on-return poll uses this row to ask Maya the truth and credit.
			// Best-effort: a bookkeeping hiccup must not block a checkout the gateway accepted.
			try {
				await db.insert(paymentCheckouts).values({
					id: checkout.checkoutId,
					userId: user.id,
					packageId: pkg.id,
					referenceId,
					amount: String(pkg.fiatCost ?? 0)
				});
			} catch (e) {
				console.warn('[topup] failed to record pending checkout:', (e as Error).message);
			}
		} catch (e) {
			// Gateway call failed (network, bad keys, Maya 4xx/5xx) — surface it.
			return fail(503, { error: `Checkout unavailable: ${(e as Error).message}` });
		}
		// Outside the try: redirect() throws, and we must not catch that throw.
		return redirect(303, redirectUrl);
	}
};
