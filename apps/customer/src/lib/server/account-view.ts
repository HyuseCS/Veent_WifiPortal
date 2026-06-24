import {
	getAccount,
	getActiveAccess,
	getFreeTimeStatus,
	MAX_DEVICES_PER_ACCOUNT,
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

/** Shape the account's device registry for the client, flagging the current device. */
export function shapeDevices(access: ActiveAccess | null, thisMac: string | null) {
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

	const thisDeviceBound = list.some((d) => d.thisDevice);
	const oldest = [...list].sort((a, b) => a.lastSeenAt.localeCompare(b.lastSeenAt))[0] ?? null;

	return {
		cap: MAX_DEVICES_PER_ACCOUNT,
		count: list.length,
		thisDeviceBound,
		atCap: list.length >= MAX_DEVICES_PER_ACCOUNT && !thisDeviceBound,
		oldest: oldest ? { id: oldest.id, macTail: oldest.macTail } : null,
		list
	};
}

export type AccountView = Awaited<ReturnType<typeof buildAccountView>>;

/** Read the live account slice for `userId`, shaped for the current device (`thisMac`). */
export async function buildAccountView(db: DB, userId: string, thisMac: string | null) {
	const account = await getAccount(db, userId);
	const access = await getActiveAccess(db, userId);

	return {
		balance: account?.balance ?? 0,
		blocked: account?.blocked ?? false,
		freeTime: getFreeTimeStatus(account?.lastFreeSessionAt ?? null),
		access: {
			active: !!access,
			isFree: access?.isFree ?? false,
			paused: access?.paused ?? false,
			// Frozen hold while paused; live remaining otherwise (client shows it directly
			// when paused, falls back to expiresAt − now when running).
			remainingMs: access?.remainingMs ?? 0,
			label: access ? (access.isFree ? 'Free Time' : access.name) : null,
			startedAt: access?.startedAt.toISOString() ?? null,
			expiresAt: access?.expiresAt.toISOString() ?? null
		},
		devices: shapeDevices(access, thisMac)
	};
}
