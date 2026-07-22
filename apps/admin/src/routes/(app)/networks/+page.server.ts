import { fail } from '@sveltejs/kit';
import { dev } from '$app/environment';
import {
	refreshNetworkHealth,
	countOutagePausedAccounts,
	STAFF_ROLE,
	MANAGER_ROLES,
	type StaffRole
} from '@veent/core';
import { db } from '$lib/server/db';
import { requireOwner as ownerGate, requireManager } from '$lib/server/auth-guard';
import { network } from '$lib/server/network';
import { mailer } from '$lib/server/email';
import { checkAdminEmailLimit } from '$lib/server/emailRateLimit';
import { wipeCodeEmail } from '$lib/server/emails/wipe-code';
import { issueWipeCode, consumeWipeCode } from '$lib/server/wipe-verification';
import { logger } from '$lib/server/logger';
import {
	listNetworkHealth,
	setNetworkInterface,
	setApRouterConfig,
	setApDisplayName,
	wipeNetworks,
	deleteNetworkPlace
} from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';

const log = logger('networks');

/** Step-up key namespace: keeps the network-wipe code from clobbering the customer-wipe
 * code for the same owner (both share the in-memory wipe-verification store, keyed by id). */
const wipeKey = (userId: string) => `network:${userId}`;

/** Re-asserts owner from the DB (never trust client state) for the destructive actions. */
const requireOwner = (userId: string | undefined) =>
	ownerGate(userId, 'Only the owner can modify the network database.');

/** Parse an optional Mbps speed-cap field into integer Kbps for storage. Blank/missing →
 * null (uncapped). Rejects non-numeric, non-positive, or absurd values. 10 Gbps ceiling is
 * a sanity bound — well above any real AP uplink. */
function parseCapMbps(raw: FormDataEntryValue | null): { kbps: number | null } | { error: string } {
	const s = String(raw ?? '').trim();
	if (!s) return { kbps: null };
	const mbps = Number(s);
	if (!Number.isFinite(mbps) || mbps <= 0) return { error: 'Speed caps must be positive numbers.' };
	if (mbps > 10_000) return { error: 'Speed cap is unrealistically high (max 10000 Mbps).' };
	return { kbps: Math.round(mbps * 1000) };
}

/** Per-interface health for the Networks page. Pulls a live sample from the router
 * (link/users/throughput) into `network_health` on view, then reads it back. The
 * refresh is best-effort: on the stub controller or a router error it's a no-op and
 * we show the last-known rows. (The (app) layout already guards auth.) */
export const load: PageServerLoad = async (event) => {
	const { user } = await event.parent();
	// STREAM the router-backed health instead of awaiting it: the slow part is the live
	// router refresh (api-ssl round-trip), and awaiting it here blocks the whole tab
	// switch. Returning the promise un-awaited lets SvelteKit navigate immediately and
	// render a skeleton while the refresh + read resolve in the background.
	const networks = (async () => {
		try {
			await refreshNetworkHealth(db, network);
		} catch (err) {
			// Router/controller down → capture (grouped) and fall back to last-known rows.
			log.error('network health refresh failed:', err);
		}
		return listNetworkHealth(db);
	})();
	// Guests whose paid time is currently frozen because their AP is down (the outage auto-pause).
	// Cheap count — awaited directly so the outage banner renders with the page shell.
	const outagePausedGuests = await countOutagePausedAccounts(db);
	return {
		networks,
		outagePausedGuests,
		isOwner: user.role === STAFF_ROLE.owner,
		// Managers (owner + system_admin — the same roles that manage Sentry issues) may rename APs.
		canManage: MANAGER_ROLES.includes(user.role as StaffRole)
	};
};

export const actions: Actions = {
	/** Bind this pin to a router AP/interface (or clear it) for user attribution.
	 *  Owner-only, like every other network-config mutation — the `(app)` layout guards only
	 *  auth + 2FA, not role, so this must assert `requireOwner` itself. (Superseded in the UI by
	 *  `setApConfig`; the gate closes the leftover direct-POST path.) */
	setInterface: async (event) => {
		const denied = await requireOwner(event.locals.user?.id);
		if (denied) return denied;

		const form = await event.request.formData();
		const id = Number(form.get('id'));
		if (!Number.isInteger(id)) return fail(400, { error: 'Invalid access point.' });

		const interfaceName = String(form.get('interfaceName') ?? '').trim() || null;
		await setNetworkInterface(db, id, interfaceName);
		return { id, boundInterface: true };
	},

	/** Owner-only: set an AP's router-side config — the interface binding and the aggregate
	 *  up/down bandwidth caps — then push the caps to the router. Caps are entered in Mbps
	 *  and stored as Kbps; blank = uncapped. Enforcement is best-effort: the DB is the source
	 *  of truth and a router hiccup surfaces as a warning without losing the saved config. */
	setApConfig: async (event) => {
		const denied = await requireOwner(event.locals.user?.id);
		if (denied) return denied;

		const form = await event.request.formData();
		const raw = form.get('id');
		const id = Number(raw);
		if (typeof raw !== 'string' || !Number.isInteger(id) || id <= 0) {
			return fail(400, { action: 'setApConfig', error: 'Invalid access point.' });
		}

		const interfaceName = String(form.get('interfaceName') ?? '').trim() || null;
		const down = parseCapMbps(form.get('maxDownMbps'));
		const up = parseCapMbps(form.get('maxUpMbps'));
		if ('error' in down) return fail(400, { action: 'setApConfig', id, error: down.error });
		if ('error' in up) return fail(400, { action: 'setApConfig', id, error: up.error });

		const row = await setApRouterConfig(db, id, {
			interfaceName,
			maxDownKbps: down.kbps,
			maxUpKbps: up.kbps
		});
		if (!row) return fail(404, { action: 'setApConfig', id, error: 'Access point not found.' });

		// Enforce on the router (best-effort — config is already persisted). Target the bound
		// interface, or the AP's own name when unbound (auto-discovered rows are named after
		// their interface). A failure here must not fail the save.
		const iface = interfaceName ?? row.name;
		let warning: string | undefined;
		if (network.applyInterfaceLimit && iface) {
			try {
				await network.applyInterfaceLimit({
					apName: row.name,
					interfaceName: iface,
					downKbps: down.kbps,
					upKbps: up.kbps
				});
			} catch (err) {
				log.error('applyInterfaceLimit failed:', err);
				warning =
					'Caps saved, but the router did not accept them — check the interface binding, then re-save to retry.';
			}
		}
		return { ok: true, action: 'setApConfig', id, warning };
	},

	/** Manager-only (owner + system_admin): set an AP's operator display name. Writes only the
	 *  `display_name` override — the sweep-managed `name` is left alone so the label survives every
	 *  router refresh. Blank clears the override (revert to the router-derived name). */
	setApName: async (event) => {
		const denied = await requireManager(event.locals.user?.id, 'You do not have permission to rename access points.');
		if (denied) return denied;

		const form = await event.request.formData();
		const raw = form.get('id');
		const id = Number(raw);
		if (typeof raw !== 'string' || !Number.isInteger(id) || id <= 0) {
			return fail(400, { action: 'setApName', error: 'Invalid access point.' });
		}

		const name = String(form.get('displayName') ?? '').trim();
		if (name.length > 120) {
			return fail(400, { action: 'setApName', id, error: 'Name is too long (max 120 characters).' });
		}
		await setApDisplayName(db, id, name || null);
		return { ok: true, action: 'setApName', id };
	},

	/** Delete a single access point. Owner-only (a stray-pin cleanup is still destructive —
	 *  it drops the AP's health + location). Safe: network_sessions.network_id is a loose
	 *  link (no FK), so attributed sessions just stop matching — no constraint to violate. */
	deleteNetwork: async (event) => {
		const denied = await requireOwner(event.locals.user?.id);
		if (denied) return denied;

		// Number(null)/Number('') both coerce to 0 and pass Number.isInteger, so a missing id
		// would run a destructive delete against AP 0 — validate the raw value, require a real id.
		const raw = (await event.request.formData()).get('id');
		const id = Number(raw);
		if (typeof raw !== 'string' || !Number.isInteger(id) || id <= 0) {
			return fail(400, { error: 'Invalid access point.' });
		}

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
			return fail(429, {
				action: 'requestWipeCode',
				error: 'Too many verification codes requested. Try again later.'
			});
		}

		const code = issueWipeCode(wipeKey(owner.id));
		const { subject, html, text } = wipeCodeEmail({
			code,
			name: owner.name,
			target: 'network database'
		});
		// Dev affordance: the stub mailer never logs bodies, so surface the code here.
		if (dev) console.log(`[wipe] network verification code: ${code}`);
		try {
			await mailer.send({ to: owner.email, subject, html, text });
		} catch (err) {
			log.error('network wipe code send failed:', err);
			return fail(502, {
				action: 'requestWipeCode',
				error: "Couldn't send the verification code. Please try again."
			});
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
			return fail(400, { action: 'wipe', error: 'Invalid or expired code.' });
		}
		const removed = await wipeNetworks(db);
		return { ok: true, action: 'wipe', removed };
	}
};
