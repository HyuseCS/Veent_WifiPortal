import { redirect, fail } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { packages } from '@veent/db';
import { getAccount } from '@veent/core';
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
		.where(and(eq(packages.type, 'bundle'), eq(packages.isActive, true)));

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
		let redirectUrl: string;
		try {
			const checkout = await payments.createCheckout({
				// Webhook splits this back into userId + packageId.
				referenceId: `${user.id}:${pkg.id}`,
				amountMinor: Math.round((pkg.fiatCost ?? 0) * 100),
				currency: 'PHP',
				description: pkg.name,
				successUrl: `${origin}/top-up/processing`,
				cancelUrl: `${origin}/top-up`,
				buyer: { name: user.name, email: user.email }
			});
			redirectUrl = checkout.redirectUrl;
		} catch (e) {
			// Maya is stubbed — surface a clear message until it's wired.
			return fail(503, { error: `Checkout unavailable: ${(e as Error).message}` });
		}
		// Outside the try: redirect() throws, and we must not catch that throw.
		return redirect(303, redirectUrl);
	}
};
