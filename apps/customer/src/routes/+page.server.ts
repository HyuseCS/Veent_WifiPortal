import { and, eq } from 'drizzle-orm';
import { packages } from '@veent/db';
import { getAccount } from '@veent/core';
import { db } from '$lib/server/db';
import { maskPhone } from '$lib/server/otp';
import { getPortalContext } from '$lib/server/portal';
import type { PageServerLoad } from './$types';

/**
 * Landing. Pricing (bundles + tiers) is loaded for EVERYONE so logged-out guests
 * can see what access costs before authenticating — it's view-only here, every
 * CTA routes to /login. When a guest is already signed in we also surface their
 * balance + masked phone for the "you're good to go" variant.
 */
export const load: PageServerLoad = async (event) => {
	const user = event.locals.user;

	// Keep the captive-portal device MAC on every CTA so it threads into the
	// login → OTP → dashboard flow even if the captive browser drops our cookie.
	const ctx = getPortalContext(event);
	const portalQuery = ctx?.mac ? `?mac=${encodeURIComponent(ctx.mac)}` : '';

	const [bundles, tiers] = await Promise.all([
		db
			.select()
			.from(packages)
			.where(and(eq(packages.type, 'bundle'), eq(packages.isActive, true))),
		db
			.select()
			.from(packages)
			.where(and(eq(packages.type, 'tier'), eq(packages.isActive, true)))
	]);

	if (!user) {
		return { loggedIn: false as const, bundles, tiers, portalQuery };
	}

	const account = await getAccount(db, user.id);
	const phone = (user as { phoneNumber?: string | null }).phoneNumber ?? null;

	return {
		loggedIn: true as const,
		maskedPhone: phone ? maskPhone(phone) : null,
		balance: account?.balance ?? 0,
		bundles,
		tiers,
		portalQuery
	};
};
