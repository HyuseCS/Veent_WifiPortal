import { redirect, fail } from '@sveltejs/kit';
import { and, eq, asc } from 'drizzle-orm';
import { packages, paymentCheckouts, customerProfile } from '@veent/db';
import { getAccount, getLatestLedgerId, captureHandled, openCheckoutAccess } from '@veent/core';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { network } from '$lib/server/network';
import { payments } from '$lib/server/payments';
import { resolveCheckoutNetworkId, resolveMacForUser } from '$lib/server/network-location';
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

	// Keep the device MAC on the "Dashboard" link so it survives back into the dashboard even
	// when the captive/system-browser cookie jar dropped it. resolveMacForUser adds the
	// last-known-device fallback so this still works behind a NAT'ing hotspot (where IP→MAC
	// can't see the device) and after the cookie is gone.
	const mac = await resolveMacForUser(event, user.id);
	const portalQuery = mac ? `?mac=${encodeURIComponent(mac)}` : '';

	// Prefill the buyer form (Maya/Kount requires name + email) from the details the buyer chose
	// to save last time. A saved row (firstName present) also pre-checks "save my details".
	const [profile] = await db
		.select({
			firstName: customerProfile.firstName,
			lastName: customerProfile.lastName,
			contactEmail: customerProfile.contactEmail
		})
		.from(customerProfile)
		.where(eq(customerProfile.userId, user.id))
		.limit(1);
	const buyer = {
		firstName: profile?.firstName ?? '',
		lastName: profile?.lastName ?? '',
		email: profile?.contactEmail ?? ''
	};

	return {
		user,
		balance: account?.balance ?? 0,
		bundles,
		portalQuery,
		buyer,
		savedDetails: !!profile?.firstName
	};
};

/** A permissive email check — the buyer email Maya/Kount requires. Not RFC-exhaustive; just
 * rejects obviously-invalid input before we hand it to the gateway. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const actions: Actions = {
	checkout: async (event) => {
		const user = event.locals.user;
		if (!user) return redirect(302, '/login');

		const form = await event.request.formData();
		const packageId = Number(form.get('packageId'));

		// Buyer details for Maya's Kount fraud protection — required on every checkout. Echo them
		// back (with the save toggle) on any validation failure so the form doesn't lose input.
		const firstName = String(form.get('firstName') ?? '').trim();
		const lastName = String(form.get('lastName') ?? '').trim();
		const email = String(form.get('email') ?? '').trim();
		const saveDetails = form.get('saveDetails') === 'on';
		const values = { firstName, lastName, email, saveDetails };

		if (!Number.isFinite(packageId)) return fail(400, { error: 'Missing package', values });

		const [pkg] = await db.select().from(packages).where(eq(packages.id, packageId)).limit(1);
		if (!pkg || !pkg.isActive) return fail(404, { error: 'Bundle not found', values });

		if (!firstName || !lastName) {
			return fail(400, { error: 'Enter your first and last name.', values });
		}
		if (!EMAIL_RE.test(email)) {
			return fail(400, { error: 'Enter a valid email address.', values });
		}

		// Honour the save toggle: persist the details when ticked, clear them when not (so a buyer
		// can withdraw consent). Best-effort — a storage hiccup must not block a checkout.
		try {
			await db
				.update(customerProfile)
				.set(
					saveDetails
						? { firstName, lastName, contactEmail: email }
						: { firstName: null, lastName: null, contactEmail: null }
				)
				.where(eq(customerProfile.userId, user.id));
		} catch (e) {
			console.warn('[topup] failed to persist buyer details:', (e as Error).message);
			// Low-priority: buyer can re-enter; the checkout proceeds. Rate matters, not the single event.
			captureHandled(e, { level: 'warning', tags: { area: 'payment', scope: 'buyer-persist' } });
		}

		// The site's public tunnel origin (its ngrok URL), for the SERVER-TO-SERVER webhook: the
		// Veent DO forwards the payment webhook to ${webhookOrigin}/api/webhooks/maya/payment-status.
		// Bare origin; blank when TUNNEL_ORIGIN is unset — no LAN fallback, so a misconfigured site
		// fails loudly at Maya / the DO rather than emitting an unreachable URL.
		const webhookOrigin = (env.TUNNEL_ORIGIN?.trim() || '').replace(/\/$/, '');

		// Where the buyer's BROWSER returns after paying. Prefer the origin they actually started on,
		// so a localhost dev session returns to localhost (not the tunnel) and a public-domain deploy
		// returns to that domain. The one case that won't work is a private LAN http origin — the prod
		// captive portal served on the LAN, which Maya rejects and the browser can't reach publicly on
		// return — so those fall back to the public tunnel. Independent of the webhook originUrl above.
		const requestOrigin = event.url.origin.replace(/\/$/, '');
		const returnHost = new URL(requestOrigin).hostname;
		const returnReachable =
			requestOrigin.startsWith('https://') || /^(localhost|127\.0\.0\.1|\[?::1\]?)$/.test(returnHost);
		const origin = returnReachable ? requestOrigin : webhookOrigin;
		// Thread the device MAC through the gateway round-trip. Maya bounces the buyer to
		// the system browser (not the captive CNA popup), which has a DIFFERENT cookie jar —
		// so the `veent_portal` cookie holding the MAC is GONE on return, and the dashboard
		// can't detect the device ("can't detect device" warning) even on a cancel. Carrying
		// the MAC in the return URLs lets `capturePortalContext` (hooks) re-stash it in
		// whichever browser the buyer lands back in, success or cancel. resolveMacForUser adds
		// the last-known-device fallback so the round-trip carries a MAC even when the cookie is
		// already gone and IP→MAC can't help (NAT'ing hotspot).
		const mac = await resolveMacForUser(event, user.id);
		const macQuery = mac ? `&mac=${encodeURIComponent(mac)}` : '';
		const cancelMacQuery = mac ? `?mac=${encodeURIComponent(mac)}` : '';

		// Open Maya's reCAPTCHA hosts (google.com/gstatic.com) for THIS device only, scoped to
		// its LAN IP, so the captcha renders on the gateway page WITHOUT a global walled-garden
		// allow — the global allow is what let Android's /generate_204 probe pass pre-auth and
		// made every connecting guest flash "connected" then fall back to "Sign in to network".
		// Best-effort: never block a checkout the buyer initiated; swept on a TTL by the revoke
		// cron. No-ops on the stub controller and when the router can't resolve the device IP.
		if (mac) {
			try {
				await openCheckoutAccess(network, { macAddress: mac });
			} catch (e) {
				console.warn('[topup] openCheckoutAccess failed', (e as Error).message);
				// Low-priority: best-effort captcha pre-auth (already a failed router span). Watch the volume.
				captureHandled(e, { level: 'warning', tags: { area: 'network', scope: 'checkout-access' } });
			}
		}
		// Watermark the ledger now; the processing page polls for a topup row above
		// this id to know THIS payment's credit landed (gateway txn id is unknown here).
		const since = await getLatestLedgerId(db, user.id);
		// Short per-attempt token as the gateway reference (Maya caps requestReferenceNumber
		// at 36 chars — a 32-char user id leaves no room to also embed ids/a nonce). The
		// buyer is resolved from the payment_checkouts row we store below, not from the
		// reference string. Unique per checkout → the claim maps to exactly one row.
		const referenceId = crypto.randomUUID().replace(/-/g, ''); // 32 hex chars
		// Attribute this payment to the AP the buyer is on now, while we still have the
		// captive-portal context / live session — the webhook (server-to-server, no device)
		// can't, and a failed payment never reaches a grant. Best-effort: null is fine.
		const networkId = await resolveCheckoutNetworkId(event, user.id);
		let redirectUrl: string;
		try {
			const checkout = await payments.createCheckout({
				referenceId,
				amountMinor: Math.round((pkg.fiatCost ?? 0) * 100),
				currency: 'PHP',
				description: pkg.name,
				successUrl: `${origin}/top-up/processing?since=${since}&pkg=${pkg.id}&attempt=${referenceId}${macQuery}`,
				cancelUrl: `${origin}/top-up${cancelMacQuery}`,
				// Carried in Maya's metadata so the Veent DO relay forwards the server-to-server
				// webhook back here (to /api/webhooks/maya/payment-status). Always the public tunnel
				// origin — independent of where the buyer's browser returns (`origin` above).
				originUrl: webhookOrigin,
				// Real buyer details from the form — Maya's Kount fraud protection requires
				// firstName + lastName + email. Phone comes from the verified account.
				buyer: {
					firstName,
					lastName,
					email,
					phone: (user as { phoneNumber?: string | null }).phoneNumber ?? undefined
				}
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
					amount: String(pkg.fiatCost ?? 0),
					networkId
				});
			} catch (e) {
				console.warn('[topup] failed to record pending checkout:', (e as Error).message);
				// The pending row is the reconcile safety net; losing it means a missed webhook
				// can't self-heal. Capture (grouped) but continue — the gateway already accepted.
				captureHandled(e, { level: 'warning', tags: { area: 'payment', scope: 'pending-write' } });
			}
		} catch (e) {
			// Gateway call failed (network, bad keys, Maya 4xx/5xx) — surface it.
			captureHandled(e, { level: 'error', tags: { area: 'payment', scope: 'createCheckout' } });
			return fail(503, { error: `Checkout unavailable: ${(e as Error).message}`, values });
		}
		// Outside the try: redirect() throws, and we must not catch that throw.
		return redirect(303, redirectUrl);
	}
};
