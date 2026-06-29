import { and, asc, desc, eq, inArray, isNotNull, isNull, lte } from 'drizzle-orm';
import { type DB, customerProfile, networkSessions, packages } from '@veent/db';
import type { NetworkController } from '../integrations/network';
import { SESSION_STATUS } from '../config';
import { getFreeTimeStatus } from './freeTime';
import { getSessionLimits } from './settings';
import { spendCreditsTx, type Tx } from './credits';
import { resolveNetworkIdForMac } from './networkHealth';

function expiry(durationMinutes: number, now: Date) {
	return new Date(now.getTime() + durationMinutes * 60 * 1000);
}

/**
 * ACCOUNT-OWNED ACCESS MODEL
 *
 * Internet time belongs to the ACCOUNT (`customer_profile.access_expires_at`), not to a
 * device. Devices are MACs bound under that window via `network_sessions` (one active row
 * per (user, MAC)); they all share the account's expiry. The router still enforces by
 * MAC-bypass — binding writes a bypass, expiry/revoke removes it — but the authoritative
 * "is this account online and until when" is the profile window.
 *
 * A per-account device cap (MAX_DEVICES_PER_ACCOUNT) with least-recently-seen eviction keeps
 * Apple per-SSID MAC rotation from locking users out: a rotated MAC just evicts the stalest
 * binding instead of being refused.
 *
 * Atomicity (business rule #1): the router grant runs INSIDE the DB transaction, so a failed
 * grant rolls back the window extension, the binding row, AND any credit spend together — a
 * charged user is never left without access. (ponytail: holds the tx open across the grant
 * call — fine at captive-portal volume; if grant latency ever starves the pool, switch to a
 * reserve→grant→confirm saga.)
 */

export interface BindResult {
	ok: boolean;
	/** 'no_access' when a pure bind was attempted but the account has no live window. */
	reason?: 'no_access';
	accessExpiresAt: Date | null;
	/** MACs evicted to make room (already revoked on the router). */
	evicted: string[];
}

type BindPlan =
	| { skip: true }
	| { skip: false; prevWindow: Date | null; newWindow: Date; rowId: number; evicted: string[] };

/**
 * DB-only part of binding a MAC under the account window, run inside a caller's transaction.
 * Locks the profile row `FOR UPDATE` (serializes concurrent binds/buys for the account so the
 * cap check + LRU eviction can't race), extends the window if `addMinutes > 0`, upserts the
 * device row, evicts least-recently-seen bindings over the cap (marked revoked — their router
 * revoke happens after commit), and mirrors the window onto all the account's active rows.
 */
async function bindMacTx(
	tx: Tx,
	now: Date,
	opts: {
		userId: string;
		macAddress: string;
		addMinutes: number;
		requireLiveWindow: boolean;
		packageId?: number;
		/** Per-account device cap (operator-tunable; fetched by the caller via getSessionLimits). */
		maxDevices: number;
	}
): Promise<BindPlan> {
	const [profile] = await tx
		.select({ accessExpiresAt: customerProfile.accessExpiresAt })
		.from(customerProfile)
		.where(eq(customerProfile.userId, opts.userId))
		.for('update')
		.limit(1);

	const prevWindow = profile?.accessExpiresAt ?? null;
	const liveWindow = prevWindow && prevWindow > now ? prevWindow : null;
	if (opts.requireLiveWindow && !liveWindow) return { skip: true };

	const base = liveWindow ?? now;
	const newWindow = expiry(opts.addMinutes, base);

	if (opts.addMinutes > 0) {
		// The window AND its package are account-level: the most recent extend sets both, so
		// every bound device reads one consistent package (paid tier, or null = Free Time).
		// Clear any pause: adding time resumes the account (a fresh window can't be "frozen").
		await tx
			.update(customerProfile)
			.set({
				accessExpiresAt: newWindow,
				accessPackageId: opts.packageId ?? null,
				accessPausedAt: null
			})
			.where(eq(customerProfile.userId, opts.userId));
	}

	// Upsert the binding row for this (user, MAC).
	const [existing] = await tx
		.select({ id: networkSessions.id })
		.from(networkSessions)
		.where(
			and(
				eq(networkSessions.userId, opts.userId),
				eq(networkSessions.macAddress, opts.macAddress),
				eq(networkSessions.status, SESSION_STATUS.active)
			)
		)
		.limit(1);

	const evicted: string[] = [];
	let rowId: number;

	if (existing) {
		await tx
			.update(networkSessions)
			.set({
				expiresAt: newWindow,
				lastSeenAt: now,
				...(opts.packageId !== undefined ? { packageId: opts.packageId } : {})
			})
			.where(eq(networkSessions.id, existing.id));
		rowId = existing.id;
	} else {
		// Make room for the new device: evict least-recently-seen bindings over the cap.
		const activeRows = await tx
			.select({ id: networkSessions.id, macAddress: networkSessions.macAddress })
			.from(networkSessions)
			.where(
				and(
					eq(networkSessions.userId, opts.userId),
					eq(networkSessions.status, SESSION_STATUS.active)
				)
			)
			.orderBy(asc(networkSessions.lastSeenAt));

		const overBy = activeRows.length - (opts.maxDevices - 1);
		for (let i = 0; i < overBy; i++) {
			const e = activeRows[i];
			await tx
				.update(networkSessions)
				.set({ status: SESSION_STATUS.revoked })
				.where(eq(networkSessions.id, e.id));
			if (e.macAddress) evicted.push(e.macAddress);
		}

		const [row] = await tx
			.insert(networkSessions)
			.values({
				userId: opts.userId,
				macAddress: opts.macAddress,
				packageId: opts.packageId,
				status: SESSION_STATUS.active,
				startedAt: now,
				boundAt: now,
				lastSeenAt: now,
				expiresAt: newWindow
			})
			.returning({ id: networkSessions.id });
		rowId = row.id;
	}

	// Mirror the window onto every active binding so all of the account's devices share it.
	await tx
		.update(networkSessions)
		.set({ expiresAt: newWindow })
		.where(
			and(
				eq(networkSessions.userId, opts.userId),
				eq(networkSessions.status, SESSION_STATUS.active)
			)
		);

	return { skip: false, prevWindow, newWindow, rowId, evicted };
}

/**
 * Post-commit side effects shared by every bind path: revoke evicted MACs on the router
 * (idempotent — reconcileGuestBindings sweeps any miss) and best-effort AP attribution.
 */
async function afterBind(
	db: DB,
	network: NetworkController,
	userId: string,
	rowId: number,
	macAddress: string,
	evicted: string[]
): Promise<void> {
	for (const mac of evicted) {
		try {
			await network.revoke(mac);
		} catch {
			// reconcileGuestBindings will drop an orphaned binding on the next cron.
		}
	}
	await attributeAp(db, network, userId, rowId, macAddress);

	// Proactively log the device into the hotspot so the OS captive "Sign in to network" banner
	// clears immediately (Issue 2). This is a UX layer ON TOP of the durable grant — best-effort,
	// so a failure here must never undo the access we just granted. Optional: only the MikroTik
	// controller with a hotspot login user configured implements it.
	if (network.activateSession) {
		try {
			await network.activateSession({ macAddress });
		} catch (err) {
			console.warn('[sessions] activateSession failed (access still granted):', (err as Error).message);
		}
	}
}

/**
 * Ensure the account window, bind one MAC under it, grant on the router — all atomically.
 * Used by free time, the dashboard auto-bind / reconnect, and the admin comp (no credit
 * spend). For the paid path use `startPaidAccessAndBindDevice` (adds the spend in the same tx).
 */
async function bindMacToAccount(
	db: DB,
	network: NetworkController,
	opts: {
		userId: string;
		macAddress: string;
		addMinutes: number;
		requireLiveWindow: boolean;
		packageId?: number;
		bandwidthMbps?: number;
	}
): Promise<BindResult> {
	const now = new Date();
	const { maxDevicesPerAccount } = await getSessionLimits(db);

	const plan = await db.transaction(async (tx) => {
		const p = await bindMacTx(tx, now, { ...opts, maxDevices: maxDevicesPerAccount });
		if (p.skip) return p;
		// Grant INSIDE the tx: a failed grant rolls the window + binding back.
		await network.grant({
			macAddress: opts.macAddress,
			durationMinutes: opts.addMinutes,
			bandwidthMbps: opts.bandwidthMbps
		});
		return p;
	});

	if (plan.skip) return { ok: false, reason: 'no_access', accessExpiresAt: null, evicted: [] };

	await afterBind(db, network, opts.userId, plan.rowId, opts.macAddress, plan.evicted);
	return { ok: true, accessExpiresAt: plan.newWindow, evicted: plan.evicted };
}

/**
 * Best-effort: tag the binding row with the AP the device is on, so the Networks view can
 * count active users per AP, and remember it on the account as `last_network_id` so a later
 * checkout can attribute a payment to a location even after the portal context is gone. Never
 * throws — attribution is a reporting nicety and many setups (wired clients, stub/dev) can't
 * resolve it.
 */
async function attributeAp(
	db: DB,
	network: NetworkController,
	userId: string,
	rowId: number,
	macAddress: string
): Promise<void> {
	try {
		const networkId = await resolveNetworkIdForMac(db, network, macAddress);
		if (networkId === null) return;
		await db.update(networkSessions).set({ networkId }).where(eq(networkSessions.id, rowId));
		await db
			.update(customerProfile)
			.set({ lastNetworkId: networkId })
			.where(eq(customerProfile.userId, userId));
	} catch {
		// Non-critical: leave networkId null.
	}
}

export interface ExtendAccessInput {
	userId: string;
	macAddress: string;
	durationMinutes: number;
	packageId?: number;
	bandwidthMbps?: number;
}

/**
 * Extend the ACCOUNT's access window by `durationMinutes` and bind the calling device, WITHOUT
 * spending credits (free time after the eligibility claim, and the dev admin comp). For a paid
 * tier use `startPaidAccessAndBindDevice`, which spends + extends + grants in one transaction.
 */
export async function extendAccessAndBindDevice(
	db: DB,
	network: NetworkController,
	input: ExtendAccessInput
): Promise<BindResult> {
	return bindMacToAccount(db, network, {
		userId: input.userId,
		macAddress: input.macAddress,
		addMinutes: input.durationMinutes,
		requireLiveWindow: false,
		packageId: input.packageId,
		bandwidthMbps: input.bandwidthMbps
	});
}

export interface StartPaidAccessResult {
	ok: boolean;
	/** Set when ok=false. */
	reason?: 'insufficient_balance';
	balance: number;
	accessExpiresAt?: Date | null;
	evicted?: string[];
}

/**
 * Buy a tier: spend its credits, extend the ACCOUNT window, bind the device, and grant — all in
 * ONE transaction. If the grant (or anything after the spend) throws, the whole transaction
 * rolls back, so a charged user is never left without access (business rule #1). Returns
 * `{ ok: false, reason: 'insufficient_balance' }` for a committed no-op (nothing deducted).
 */
export async function startPaidAccessAndBindDevice(
	db: DB,
	network: NetworkController,
	input: {
		userId: string;
		macAddress: string;
		packageId: number;
		amount: number;
		durationMinutes: number;
		bandwidthMbps?: number;
	}
): Promise<StartPaidAccessResult> {
	const now = new Date();
	const { maxDevicesPerAccount } = await getSessionLimits(db);

	const outcome = await db.transaction(async (tx) => {
		const spend = await spendCreditsTx(tx, {
			userId: input.userId,
			amount: input.amount,
			packageId: input.packageId
		});
		if (!spend.ok) return { ok: false as const, balance: spend.balance };

		const plan = await bindMacTx(tx, now, {
			userId: input.userId,
			macAddress: input.macAddress,
			addMinutes: input.durationMinutes,
			requireLiveWindow: false,
			packageId: input.packageId,
			maxDevices: maxDevicesPerAccount
		});
		// requireLiveWindow is false, so plan is never `skip`.
		if (plan.skip) throw new Error('startPaidAccessAndBindDevice: unexpected skip');

		// Grant INSIDE the tx — a failed grant rolls back the spend too.
		await network.grant({
			macAddress: input.macAddress,
			durationMinutes: input.durationMinutes,
			bandwidthMbps: input.bandwidthMbps
		});

		return {
			ok: true as const,
			balance: spend.balance,
			newWindow: plan.newWindow,
			rowId: plan.rowId,
			evicted: plan.evicted
		};
	});

	if (!outcome.ok) return { ok: false, reason: 'insufficient_balance', balance: outcome.balance };

	await afterBind(db, network, input.userId, outcome.rowId, input.macAddress, outcome.evicted);
	return {
		ok: true,
		balance: outcome.balance,
		accessExpiresAt: outcome.newWindow,
		evicted: outcome.evicted
	};
}

/**
 * Bind a device to the account's EXISTING live window without adding time. Returns
 * `{ ok: false, reason: 'no_access' }` if the account has no live window (so we never grant a
 * MAC for an account with no time). Used by the dashboard auto-bind / explicit reconnect /
 * "replace oldest device".
 */
export async function bindDevice(
	db: DB,
	network: NetworkController,
	input: { userId: string; macAddress: string }
): Promise<BindResult> {
	return bindMacToAccount(db, network, {
		userId: input.userId,
		macAddress: input.macAddress,
		addMinutes: 0,
		requireLiveWindow: true
	});
}

export interface AccountDevice {
	id: number;
	macAddress: string | null;
	boundAt: Date;
	lastSeenAt: Date;
}

export interface ActiveAccess {
	/** The account's access window end. While paused this is the FROZEN end captured at
	 * pause time (so it may be in the past); read `remainingMs` for the held time instead. */
	expiresAt: Date;
	/** Earliest bound device's start, for the progress bar. */
	startedAt: Date;
	/** Most-recent binding's tier (null = Free Time). */
	packageId: number | null;
	name: string | null;
	isFree: boolean;
	/** True when the window is paused (frozen, devices unbound). */
	paused: boolean;
	/** Time left on the window: live (`expiresAt − now`) or, when paused, the frozen hold. */
	remainingMs: number;
	/** Devices currently bound under this window (empty while paused — pause unbinds all). */
	devices: AccountDevice[];
}

/**
 * The account's live (or paused) access window + its bound devices, or null if no time left.
 * The authoritative gate is `customer_profile.access_expires_at`; device rows are the registry.
 * A paused window is still "active" — its remaining time is frozen as `expiresAt − pausedAt`
 * and reported via `remainingMs`, so it survives even after the original expiry instant passes.
 */
export async function getActiveAccess(
	db: DB,
	userId: string,
	now: Date = new Date()
): Promise<ActiveAccess | null> {
	// Account-level window + its package (one tier for the whole account, shared by every
	// device — not derived per device row).
	const [profile] = await db
		.select({
			accessExpiresAt: customerProfile.accessExpiresAt,
			accessPausedAt: customerProfile.accessPausedAt,
			accessPackageId: customerProfile.accessPackageId,
			packageName: packages.name
		})
		.from(customerProfile)
		.leftJoin(packages, eq(packages.id, customerProfile.accessPackageId))
		.where(eq(customerProfile.userId, userId))
		.limit(1);

	const window = profile?.accessExpiresAt ?? null;
	if (!window) return null;
	const pausedAt = profile?.accessPausedAt ?? null;
	const paused = !!pausedAt;
	// Paused → remaining is frozen (ignores wall-clock); live → counts down to `window`.
	const remainingMs = paused ? window.getTime() - pausedAt.getTime() : window.getTime() - now.getTime();
	if (remainingMs <= 0) return null;

	const devices = await db
		.select({
			id: networkSessions.id,
			macAddress: networkSessions.macAddress,
			boundAt: networkSessions.boundAt,
			lastSeenAt: networkSessions.lastSeenAt,
			startedAt: networkSessions.startedAt
		})
		.from(networkSessions)
		.where(
			and(eq(networkSessions.userId, userId), eq(networkSessions.status, SESSION_STATUS.active))
		)
		.orderBy(desc(networkSessions.startedAt));

	// Earliest bound device's start drives the progress bar.
	const startedAt = devices.reduce(
		(min, d) => (d.startedAt < min ? d.startedAt : min),
		devices[0]?.startedAt ?? now
	);

	return {
		expiresAt: window,
		startedAt,
		packageId: profile.accessPackageId ?? null,
		name: profile.packageName ?? null,
		isFree: (profile.accessPackageId ?? null) == null,
		paused,
		remainingMs,
		devices: devices.map((d) => ({
			id: d.id,
			macAddress: d.macAddress,
			boundAt: d.boundAt,
			lastSeenAt: d.lastSeenAt
		}))
	};
}

export interface PauseAccessResult {
	ok: boolean;
	/** 'no_access' = no live window; 'free_not_pausable' = Free Time can't be paused. */
	reason?: 'no_access' | 'free_not_pausable';
	/** Held time on success (frozen window remaining). */
	remainingMs?: number;
}

/**
 * Pause the ACCOUNT's PAID access window: stamp `access_paused_at` (freezes the remaining
 * time) and unbind every device so no internet flows while paused. The revoke cron skips
 * paused accounts (see `expireDueAccounts`), so the held time is preserved indefinitely until
 * resume. Free Time can't be paused (it would just game the 12h cooldown). Idempotent: pausing
 * an already-paused account re-reports the held time without changing it.
 */
export async function pauseAccountAccess(
	db: DB,
	network: NetworkController,
	userId: string,
	now: Date = new Date()
): Promise<PauseAccessResult> {
	const outcome = await db.transaction(async (tx) => {
		const [p] = await tx
			.select({
				accessExpiresAt: customerProfile.accessExpiresAt,
				accessPausedAt: customerProfile.accessPausedAt,
				accessPackageId: customerProfile.accessPackageId
			})
			.from(customerProfile)
			.where(eq(customerProfile.userId, userId))
			.for('update')
			.limit(1);

		const window = p?.accessExpiresAt ?? null;
		// Already paused → idempotent success with the frozen remaining.
		if (p?.accessPausedAt) {
			return { ok: true as const, remainingMs: (window?.getTime() ?? 0) - p.accessPausedAt.getTime() };
		}
		if (!window || window <= now) return { ok: false as const, reason: 'no_access' as const };
		if (p.accessPackageId == null) return { ok: false as const, reason: 'free_not_pausable' as const };

		await tx
			.update(customerProfile)
			.set({ accessPausedAt: now })
			.where(eq(customerProfile.userId, userId));
		return { ok: true as const, remainingMs: window.getTime() - now.getTime() };
	});

	if (!outcome.ok) return outcome;
	// Drop every device (revokes the router bypass) so paused time isn't consumed. Idempotent;
	// reconcileGuestBindings sweeps any miss.
	await unbindAllDevices(db, network, userId);
	return { ok: true, remainingMs: outcome.remainingMs };
}

export interface ResumeAccessResult {
	ok: boolean;
	/** 'not_paused' = nothing to resume; 'no_remaining' = held time was already used up. */
	reason?: 'not_paused' | 'no_remaining';
	accessExpiresAt?: Date | null;
}

/**
 * Resume a paused account: restore the held time into a fresh window
 * (`access_expires_at = now + held`) and clear the pause. Does NOT bind a device — the
 * dashboard auto-bind reconnects the current device on the next load (same as after
 * "disconnect all devices"). If the held time was somehow ≤ 0, the window is simply cleared.
 */
export async function resumeAccountAccess(
	db: DB,
	userId: string,
	now: Date = new Date()
): Promise<ResumeAccessResult> {
	return db.transaction(async (tx) => {
		const [p] = await tx
			.select({
				accessExpiresAt: customerProfile.accessExpiresAt,
				accessPausedAt: customerProfile.accessPausedAt
			})
			.from(customerProfile)
			.where(eq(customerProfile.userId, userId))
			.for('update')
			.limit(1);

		if (!p?.accessPausedAt) return { ok: false as const, reason: 'not_paused' as const };

		const window = p.accessExpiresAt ?? null;
		const remainingMs = window ? window.getTime() - p.accessPausedAt.getTime() : 0;
		if (remainingMs <= 0) {
			await tx
				.update(customerProfile)
				.set({ accessExpiresAt: null, accessPausedAt: null })
				.where(eq(customerProfile.userId, userId));
			return { ok: false as const, reason: 'no_remaining' as const };
		}

		const newWindow = new Date(now.getTime() + remainingMs);
		await tx
			.update(customerProfile)
			.set({ accessExpiresAt: newWindow, accessPausedAt: null })
			.where(eq(customerProfile.userId, userId));
		return { ok: true as const, accessExpiresAt: newWindow };
	});
}

export interface StartFreeSessionResult {
	ok: boolean;
	reason?: 'not_eligible';
	nextEligibleAt?: Date | null;
	accessExpiresAt?: Date | null;
}

/**
 * Claim the account's free window if eligible, then bind the calling device. Free time is now
 * ONE account-wide 15-min window (all the account's devices share it), gated by the existing
 * account-scoped 12h cooldown. The conditional `last_free_session_at` stamp prevents two
 * concurrent requests from both claiming.
 */
export async function startFreeAccessAndBindDevice(
	db: DB,
	network: NetworkController,
	input: { userId: string; macAddress: string }
): Promise<StartFreeSessionResult> {
	const now = new Date();

	const limits = await getSessionLimits(db);
	const claimed = await db.transaction(async (tx) => {
		const [profile] = await tx
			.select({ lastFreeSessionAt: customerProfile.lastFreeSessionAt })
			.from(customerProfile)
			.where(eq(customerProfile.userId, input.userId))
			.limit(1);

		const status = getFreeTimeStatus(profile?.lastFreeSessionAt ?? null, now, limits);
		if (!status.eligible) return { eligible: false as const, nextEligibleAt: status.nextEligibleAt };

		await tx
			.update(customerProfile)
			.set({ lastFreeSessionAt: now })
			.where(eq(customerProfile.userId, input.userId));

		return { eligible: true as const, durationMinutes: status.durationMinutes };
	});

	if (!claimed.eligible) {
		return { ok: false, reason: 'not_eligible', nextEligibleAt: claimed.nextEligibleAt };
	}

	const result = await extendAccessAndBindDevice(db, network, {
		userId: input.userId,
		macAddress: input.macAddress,
		durationMinutes: claimed.durationMinutes
	});
	return { ok: true, accessExpiresAt: result.accessExpiresAt };
}

/**
 * Revoke every device of any account whose access window has lapsed, then clear the window.
 * Drives /api/network/revoke (cron). Account-level now: one lapsed window drops ALL its
 * devices. Nulls `access_expires_at` so a lapsed account isn't re-selected every minute.
 * Returns the count of device MACs revoked.
 */
export async function expireDueAccounts(
	db: DB,
	network: NetworkController,
	now: Date = new Date()
): Promise<number> {
	const due = await db
		.select({ userId: customerProfile.userId })
		.from(customerProfile)
		.where(
			and(
				isNotNull(customerProfile.accessExpiresAt),
				lte(customerProfile.accessExpiresAt, now),
				// Skip paused accounts: their window is frozen (expiresAt may be in the past), and
				// the held time must survive until resume — never swept by the cron.
				isNull(customerProfile.accessPausedAt)
			)
		);

	let revoked = 0;
	for (const { userId } of due) {
		const rows = await db
			.select({ id: networkSessions.id, macAddress: networkSessions.macAddress })
			.from(networkSessions)
			.where(
				and(eq(networkSessions.userId, userId), eq(networkSessions.status, SESSION_STATUS.active))
			);
		// Revoke each MAC best-effort: a single router error must not strand the rest of this
		// account's devices (or later accounts) as active. A missed revoke is swept next pass by
		// reconcileGuestBindings, which drops router bindings no longer backed by an active row —
		// so we still mark the rows expired here regardless. One batched UPDATE per account.
		const ids: number[] = [];
		for (const s of rows) {
			if (s.macAddress) {
				try {
					await network.revoke(s.macAddress);
				} catch {
					// reconcileGuestBindings drops the orphaned router binding on the next cron.
				}
			}
			ids.push(s.id);
		}
		if (ids.length) {
			await db
				.update(networkSessions)
				.set({ status: SESSION_STATUS.expired })
				.where(inArray(networkSessions.id, ids));
			revoked += ids.length;
		}
		await db
			.update(customerProfile)
			.set({ accessExpiresAt: null })
			.where(eq(customerProfile.userId, userId));
	}
	return revoked;
}

/**
 * Removes guest bypass bindings on the router that no longer map to an active binding row —
 * self-heals DB↔router drift the cron can't catch (customer wipes that cascade-delete rows,
 * crashed grants, manual deletes, a failed eviction revoke). Only touches guest-tagged
 * bindings; admin bypasses and operator-added bindings are left alone. Returns the count.
 */
export async function reconcileGuestBindings(
	db: DB,
	network: NetworkController
): Promise<number> {
	if (!network.listGuestBindings) return 0;
	const bindings = await network.listGuestBindings();
	if (bindings.length === 0) return 0;

	const activeRows = await db
		.select({ mac: networkSessions.macAddress })
		.from(networkSessions)
		.where(eq(networkSessions.status, SESSION_STATUS.active));
	const activeMacs = new Set(
		activeRows.map((r) => r.mac?.toUpperCase()).filter((m): m is string => Boolean(m))
	);

	let revoked = 0;
	for (const { macAddress } of bindings) {
		if (!activeMacs.has(macAddress.toUpperCase())) {
			try {
				await network.revoke(macAddress);
				revoked++;
			} catch {
				// One stubborn binding must not abort the sweep — the next pass retries it.
			}
		}
	}
	return revoked;
}

/**
 * Immediately disconnect ALL of a user's devices AND end their access window (admin kick /
 * block, or account logout-everywhere with revoke). Nulls `access_expires_at` so the dashboard
 * auto-bind can't silently re-grant a kicked account. Returns the count of devices dropped.
 */
export async function revokeUserSessions(
	db: DB,
	network: NetworkController,
	userId: string
): Promise<number> {
	const active = await db
		.select({ id: networkSessions.id, macAddress: networkSessions.macAddress })
		.from(networkSessions)
		.where(
			and(eq(networkSessions.userId, userId), eq(networkSessions.status, SESSION_STATUS.active))
		);

	// Best-effort per-MAC revoke (see expireDueAccounts): one router error must not leave the
	// rest of a kicked account's devices marked active. Mark all rows revoked in one UPDATE;
	// reconcileGuestBindings sweeps any router binding a failed revoke left behind.
	const ids: number[] = [];
	for (const s of active) {
		if (s.macAddress) {
			try {
				await network.revoke(s.macAddress);
			} catch {
				// reconcileGuestBindings drops the orphaned router binding on the next cron.
			}
		}
		ids.push(s.id);
	}
	if (ids.length) {
		await db
			.update(networkSessions)
			.set({ status: SESSION_STATUS.revoked })
			.where(inArray(networkSessions.id, ids));
	}
	const revoked = ids.length;

	// Clear the window AND any pause so a kicked/blocked account can't be silently resumed.
	await db
		.update(customerProfile)
		.set({ accessExpiresAt: null, accessPausedAt: null })
		.where(eq(customerProfile.userId, userId));

	return revoked;
}

/**
 * Unbind ONE device (customer "remove this device"). Verifies the row belongs to the user
 * (never trust a client-supplied id), revokes its MAC, marks it revoked. Leaves the account
 * window intact so other devices stay online. Returns the unbound MAC, or null if not found.
 */
export async function unbindDevice(
	db: DB,
	network: NetworkController,
	input: { userId: string; sessionId: number }
): Promise<{ ok: boolean; macAddress?: string | null }> {
	const [row] = await db
		.select({ id: networkSessions.id, macAddress: networkSessions.macAddress })
		.from(networkSessions)
		.where(
			and(
				eq(networkSessions.id, input.sessionId),
				eq(networkSessions.userId, input.userId),
				eq(networkSessions.status, SESSION_STATUS.active)
			)
		)
		.limit(1);
	if (!row) return { ok: false };

	if (row.macAddress) await network.revoke(row.macAddress);
	await db
		.update(networkSessions)
		.set({ status: SESSION_STATUS.revoked })
		.where(eq(networkSessions.id, row.id));
	return { ok: true, macAddress: row.macAddress };
}

/**
 * Disconnect ALL of the account's devices but KEEP the access window (customer "disconnect all
 * devices" — the lever for a lost/spoofed device). The user can immediately rebind their
 * current device via auto-bind. Returns the count dropped.
 */
export async function unbindAllDevices(
	db: DB,
	network: NetworkController,
	userId: string
): Promise<number> {
	const active = await db
		.select({ id: networkSessions.id, macAddress: networkSessions.macAddress })
		.from(networkSessions)
		.where(
			and(eq(networkSessions.userId, userId), eq(networkSessions.status, SESSION_STATUS.active))
		);

	let revoked = 0;
	for (const s of active) {
		if (s.macAddress) await network.revoke(s.macAddress);
		await db
			.update(networkSessions)
			.set({ status: SESSION_STATUS.revoked })
			.where(eq(networkSessions.id, s.id));
		revoked++;
	}
	return revoked;
}
