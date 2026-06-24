import { fail } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { refreshNetworkHealth, getAdminRole, STAFF_ROLE } from '@veent/core';
import { db } from '$lib/server/db';
import { network } from '$lib/server/network';
import { mailer } from '$lib/server/email';
import { checkAdminEmailLimit } from '$lib/server/emailRateLimit';
import { wipeCodeEmail } from '$lib/server/emails/wipe-code';
import { issueWipeCode, consumeWipeCode } from '$lib/server/wipe-verification';
import {
	listNetworkHealth,
	setNetworkInterface,
	wipeNetworks,
	deleteNetworkPlace
} from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';

/** Step-up key namespace: keeps the network-wipe code from clobbering the customer-wipe
 * code for the same owner (both share the in-memory wipe-verification store, keyed by id). */
const wipeKey = (userId: string) => `network:${userId}`;

/** Re-asserts owner from the DB (never trust client state) for the destructive actions. */
async function requireOwner(userId: string | undefined) {
	if (!userId || (await getAdminRole(db, userId)) !== STAFF_ROLE.owner) {
		return fail(403, { error: 'Only the owner can modify the network database.' });
	}
	return null;
}

/** Per-interface health for the Networks page. Pulls a live sample from the router
 * (link/users/throughput) into `network_health` on view, then reads it back. The
 * refresh is best-effort: on the stub controller or a router error it's a no-op and
 * we show the last-known rows. (The (app) layout already guards auth.) */
export const load: PageServerLoad = async (event) => {
	const { user } = await event.parent();
	try {
		await refreshNetworkHealth(db, network);
	} catch (err) {
		console.error('[admin] network health refresh failed:', err);
	}
	return { networks: await listNetworkHealth(db), isOwner: user.role === STAFF_ROLE.owner };
};

export const actions: Actions = {
	/** Bind this pin to a router AP/interface (or clear it) for user attribution. */
	setInterface: async ({ request }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!Number.isInteger(id)) return fail(400, { error: 'Invalid access point.' });

		const interfaceName = String(form.get('interfaceName') ?? '').trim() || null;
		await setNetworkInterface(db, id, interfaceName);
		return { id, boundInterface: true };
	},

	/** Delete a single access point. Owner-only (a stray-pin cleanup is still destructive —
	 *  it drops the AP's health + location). Safe: network_sessions.network_id is a loose
	 *  link (no FK), so attributed sessions just stop matching — no constraint to violate. */
	deleteNetwork: async (event) => {
		const denied = await requireOwner(event.locals.user?.id);
		if (denied) return denied;

		const id = Number((await event.request.formData()).get('id'));
		if (!Number.isInteger(id)) return fail(400, { error: 'Invalid access point.' });

		await deleteNetworkPlace(db, id);
		return { ok: true, action: 'deleteNetwork', id };
	},

	/** Step 1 of the network wipe: owner requests a one-time code emailed to their own
	 *  address. Proves inbox control before an irreversible destruction. */
	requestWipeCode: async (event) => {
		const denied = await requireOwner(event.locals.user?.id);
		if (denied) return denied;

		const owner = event.locals.user!;

		// Cap wipe-code emails so the owner's inbox can't be flooded with codes.
		const limited = await checkAdminEmailLimit(owner.email, owner.id);
		if (limited) {
			return fail(429, { error: 'Too many verification codes requested. Try again later.' });
		}

		const code = issueWipeCode(wipeKey(owner.id));
		const { subject, html, text } = wipeCodeEmail({
			code,
			name: owner.name,
			target: 'network database'
		});
		// Dev affordance: the stub mailer never logs bodies, so surface the code here.
		if (dev) console.log(`[wipe] network verification code for ${owner.email}: ${code}`);
		try {
			await mailer.send({ to: owner.email, subject, html, text });
		} catch (err) {
			console.warn('[email] network wipe code send failed:', (err as Error)?.message);
			return fail(502, { error: "Couldn't send the verification code. Please try again." });
		}
		return { ok: true, action: 'requestWipeCode' };
	},

	/** Step 2: wipe every access point. Owner-only, gated on the emailed one-time code
	 *  (single-use, expires in 10 min). */
	wipe: async (event) => {
		const denied = await requireOwner(event.locals.user?.id);
		if (denied) return denied;

		const code = String((await event.request.formData()).get('code') ?? '').trim();
		if (!consumeWipeCode(wipeKey(event.locals.user!.id), code)) {
			return fail(400, { error: 'Invalid or expired code.' });
		}
		const removed = await wipeNetworks(db);
		return { ok: true, action: 'wipe', removed };
	}
};
