import {
	getAccount,
	getActiveAccess,
	getFreeTimeStatus,
	getSessionLimits,
	type ActiveAccess
} from '@veent/core';
import type { DB } from '@veent/db';

/**
 * The live, per-account slice of the dashboard — everything that can change while the
 * page is open (balance, block status, free-time eligibility, the access window, and the
 * bound-device registry). Shared by the page `load` and the SSE feed so both emit the
 * EXACT same shape; the static bits (maskedPhone, mac, tiers) live only in `load`.
 */

/** Last three octets of a MAC — a recognizable, low-PII device label for guests. */
export function macTail(mac: string | null): string | null {
	if (!mac) return null;
	const parts = mac.split(':');
	return parts.length >= 3 ? parts.slice(-3).join(':') : mac;
}

/** Shape the account's device registry for the client, flagging the current device. `cap`
 * is the operator-tunable per-account device limit (from getSessionLimits). `verified` = the
 * `thisMac` came from a LIVE resolution (not a fallback guess); when false, a MAC-tail match is
 * NOT treated as proof this device is bound — it's surfaced as `thisDeviceUnverified` so the UI can
 * prompt a reconnect instead of falsely claiming "connected" (loop-break, AC2/AC3). */
export function shapeDevices(
	access: ActiveAccess | null,
	thisMac: string | null,
	cap: number,
	verified = true
) {
	const macU = thisMac?.toUpperCase() ?? null;
	const list = (access?.devices ?? [])
		.map((d) => ({
			id: d.id,
			macTail: macTail(d.macAddress),
			thisDevice: !!macU && d.macAddress?.toUpperCase() === macU,
			boundAt: d.boundAt.toISOString(),
			lastSeenAt: d.lastSeenAt.toISOString()
		}))
		// Most-recently-seen first; the current device floats to the top.
		.sort((a, b) => (a.thisDevice ? -1 : b.thisDevice ? 1 : b.lastSeenAt.localeCompare(a.lastSeenAt)));

	const matched = list.some((d) => d.thisDevice);
	// A fallback (unverified) MAC that matches a bound device is NOT proof of connection — the match
	// may be a stale/wrong MAC. Only a verified match asserts "bound"; an unverified match drives the
	// "reconnect" recovery UX instead.
	const thisDeviceBound = matched && verified;
	const thisDeviceUnverified = matched && !verified;
	const oldest = [...list].sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt))[0] ?? null;

	return {
		cap,
		count: list.length,
		thisDeviceBound,
		thisDeviceUnverified,
		atCap: list.length >= cap && !thisDeviceBound,
		oldest: oldest ? { id: oldest.id, macTail: oldest.macTail } : null,
		list
	};
}

export type AccountView = Awaited<ReturnType<typeof buildAccountView>>;

/** Read the live account slice for `userId`, shaped for the current device (`thisMac`). `verified`
 * defaults to true so the SSE feed and root `+page` callers (which pass a connect-time MAC) keep
 * their current behavior; the dashboard load passes the live-provenance flag. */
export async function buildAccountView(
	db: DB,
	userId: string,
	thisMac: string | null,
	verified = true
) {
	const account = await getAccount(db, userId);
	const access = await getActiveAccess(db, userId);
	const limits = await getSessionLimits(db);

	return {
		balance: account?.balance ?? 0,
		points: account?.points ?? 0,
		blocked: account?.blocked ?? false,
		freeTime: getFreeTimeStatus(account?.lastFreeSessionAt ?? null, undefined, limits),
		access: {
			active: !!access,
			isFree: access?.isFree ?? false,
			paused: access?.paused ?? false,
			pausedReason: access?.pausedReason ?? null,
			// Frozen hold while paused; live remaining otherwise (client shows it directly
			// when paused, falls back to expiresAt − now when running).
			remainingMs: access?.remainingMs ?? 0,
			label: access ? (access.isFree ? 'Free Time' : access.name) : null,
			startedAt: access?.startedAt.toISOString() ?? null,
			expiresAt: access?.expiresAt.toISOString() ?? null
		},
		devices: shapeDevices(access, thisMac, limits.maxDevicesPerAccount, verified)
	};
}
