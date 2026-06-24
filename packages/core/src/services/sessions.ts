import { and, desc, eq, gt, lte } from 'drizzle-orm';
import { type DB, customerProfile, networkHealth, networkSessions, packages } from '@veent/db';
import type { NetworkController } from '../integrations/network';
import { SESSION_STATUS } from '../config';
import { getFreeTimeStatus } from './freeTime';
import { spendCreditsTx, type Tx } from './credits';

function expiry(durationMinutes: number, now: Date) {
	return new Date(now.getTime() + durationMinutes * 60 * 1000);
}

export interface StartSessionInput {
	userId: string;
	macAddress: string;
	durationMinutes: number;
	packageId?: number;
	bandwidthMbps?: number;
}

/**
 * Creates an active network session and grants access on the controller. Records
 * the row first (source of truth for the revoke cron), then drops the firewall;
 * if the grant throws, the session is marked revoked so we never report access
 * that wasn't actually opened.
 */
export async function startSession(
	db: DB | Tx,
	network: NetworkController,
	input: StartSessionInput
) {
	const now = new Date();

	// Stack onto a running session for the SAME device instead of opening a parallel
	// one: bought time ACCUMULATES (new expiry = current remaining + this duration).
	// Parallel sessions per MAC would each run their own clock and — worse — the revoke
	// cron would re-block the shared MAC the moment the FIRST expires, cutting access the
	// others still cover. One row per device keeps both the countdown and the cron correct.
	const [existing] = await db
		.select({ id: networkSessions.id, expiresAt: networkSessions.expiresAt })
		.from(networkSessions)
		.where(
			and(
				eq(networkSessions.userId, input.userId),
				eq(networkSessions.macAddress, input.macAddress),
				eq(networkSessions.status, SESSION_STATUS.active),
				gt(networkSessions.expiresAt, now)
			)
		)
		.orderBy(desc(networkSessions.expiresAt))
		.limit(1);

	const previousExpiry = existing?.expiresAt ?? null;
	let session;
	if (existing && previousExpiry) {
		// Extend from the current expiry so no remaining time is lost. packageId tracks
		// the latest grant so the dashboard names the most recent tier.
		[session] = await db
			.update(networkSessions)
			.set({ expiresAt: expiry(input.durationMinutes, previousExpiry), packageId: input.packageId })
			.where(eq(networkSessions.id, existing.id))
			.returning();
	} else {
		[session] = await db
			.insert(networkSessions)
			.values({
				userId: input.userId,
				macAddress: input.macAddress,
				packageId: input.packageId,
				status: SESSION_STATUS.active,
				startedAt: now,
				expiresAt: expiry(input.durationMinutes, now)
			})
			.returning();
	}

	try {
		await network.grant({
			macAddress: input.macAddress,
			durationMinutes: input.durationMinutes,
			bandwidthMbps: input.bandwidthMbps
		});
	} catch (err) {
		if (previousExpiry) {
			// Restore the prior expiry — a failed extend must not forfeit already-granted time.
			await db
				.update(networkSessions)
				.set({ expiresAt: previousExpiry })
				.where(eq(networkSessions.id, session.id));
		} else {
			await db
				.update(networkSessions)
				.set({ status: SESSION_STATUS.revoked })
				.where(eq(networkSessions.id, session.id));
		}
		throw err;
	}

	// Best-effort: tag the session with the AP the device is on, so the Networks
	// view can count active users per AP. Never fails the grant — attribution is
	// a reporting nicety, and many setups (wired clients, stub/dev) can't resolve it.
	if (network.resolveApForMac) {
		try {
			const apName = await network.resolveApForMac(input.macAddress);
			if (apName) {
				// Prefer an explicit pin→interface binding (set on the Networks page);
				// fall back to a name match for the auto-discovered interface row.
				const [bound] = await db
					.select({ id: networkHealth.id })
					.from(networkHealth)
					.where(eq(networkHealth.interfaceName, apName))
					.limit(1);
				const ap =
					bound ??
					(
						await db
							.select({ id: networkHealth.id })
							.from(networkHealth)
							.where(eq(networkHealth.name, apName))
							.limit(1)
					)[0];
				if (ap) {
					await db
						.update(networkSessions)
						.set({ networkId: ap.id })
						.where(eq(networkSessions.id, session.id));
					session.networkId = ap.id;
				}
			}
		} catch {
			// Non-critical: leave networkId null.
		}
	}

	return session;
}

export interface StartPaidSessionResult {
	ok: boolean;
	/** Set when ok=false. */
	reason?: 'insufficient_balance';
	balance: number;
	session?: Awaited<ReturnType<typeof startSession>>;
}

/**
 * Atomically spend an access tier's credits AND open the session — including the router
 * grant — in ONE transaction. If the grant (or anything after the spend) throws, the whole
 * transaction rolls back, so a charged user is never left without access (business rule #1).
 * Replaces the old spend-then-grant, where the spend committed before the grant could fail.
 *
 * Returns `{ ok: false }` only for insufficient balance (a committed no-op — nothing was
 * deducted). A grant failure rejects: the caller surfaces it, and the spend has rolled back.
 *
 * ponytail: holds the DB transaction open across the router grant call — fine at captive-
 * portal volume; if grant latency ever starves the connection pool, switch to a
 * reserve→grant→confirm saga.
 */
export async function startPaidSession(
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
): Promise<StartPaidSessionResult> {
	return db.transaction(async (tx) => {
		const spend = await spendCreditsTx(tx, {
			userId: input.userId,
			amount: input.amount,
			packageId: input.packageId
		});
		if (!spend.ok) return { ok: false, reason: 'insufficient_balance', balance: spend.balance };

		const session = await startSession(tx, network, {
			userId: input.userId,
			macAddress: input.macAddress,
			packageId: input.packageId,
			durationMinutes: input.durationMinutes,
			bandwidthMbps: input.bandwidthMbps
		});
		return { ok: true, balance: spend.balance, session };
	});
}

export interface ActiveSession {
	id: number;
	/** null for a Free Time session; set for a bought tier. */
	packageId: number | null;
	/** Tier name (e.g. "3 Hours"); null for Free Time. */
	name: string | null;
	startedAt: Date;
	expiresAt: Date;
	/** Convenience flag for the UI's free-vs-paid band styling. */
	isFree: boolean;
}

/**
 * The user's currently-running session, if any. `status = active` AND
 * `expiresAt > now` — the time guard hides a session the revoke cron hasn't swept
 * to `expired` yet, so the dashboard never shows a stale "active" band. Joins
 * `packages` for the tier name; a null packageId means Free Time. Newest first.
 */
export async function getActiveSession(
	db: DB,
	userId: string,
	now: Date = new Date()
): Promise<ActiveSession | null> {
	const [row] = await db
		.select({
			id: networkSessions.id,
			packageId: networkSessions.packageId,
			name: packages.name,
			startedAt: networkSessions.startedAt,
			expiresAt: networkSessions.expiresAt
		})
		.from(networkSessions)
		.leftJoin(packages, eq(networkSessions.packageId, packages.id))
		.where(
			and(
				eq(networkSessions.userId, userId),
				eq(networkSessions.status, SESSION_STATUS.active),
				gt(networkSessions.expiresAt, now)
			)
		)
		.orderBy(desc(networkSessions.startedAt))
		.limit(1);

	if (!row?.expiresAt) return null;
	return {
		id: row.id,
		packageId: row.packageId ?? null,
		name: row.name ?? null,
		startedAt: row.startedAt,
		expiresAt: row.expiresAt,
		isFree: row.packageId == null
	};
}

export interface StartFreeSessionResult {
	ok: boolean;
	reason?: 'not_eligible';
	nextEligibleAt?: Date | null;
	session?: Awaited<ReturnType<typeof startSession>>;
}

/**
 * Starts a Free Time session if eligible. Stamps `last_free_session_at` inside a
 * conditional update so two concurrent requests can't both claim the free window.
 */
export async function startFreeSession(
	db: DB,
	network: NetworkController,
	input: { userId: string; macAddress: string }
): Promise<StartFreeSessionResult> {
	const now = new Date();

	const claimed = await db.transaction(async (tx) => {
		const [profile] = await tx
			.select({ lastFreeSessionAt: customerProfile.lastFreeSessionAt })
			.from(customerProfile)
			.where(eq(customerProfile.userId, input.userId))
			.limit(1);

		const status = getFreeTimeStatus(profile?.lastFreeSessionAt ?? null, now);
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

	const session = await startSession(db, network, {
		userId: input.userId,
		macAddress: input.macAddress,
		durationMinutes: claimed.durationMinutes
	});
	return { ok: true, session };
}

/**
 * Revokes every active session whose time is up: re-blocks the MAC on the
 * controller and flips the row to `expired`. Drives /api/network/revoke (cron).
 * Returns the count revoked.
 */
export async function expireDueSessions(
	db: DB,
	network: NetworkController,
	now: Date = new Date()
): Promise<number> {
	const due = await db
		.select({ id: networkSessions.id, macAddress: networkSessions.macAddress })
		.from(networkSessions)
		.where(
			and(eq(networkSessions.status, SESSION_STATUS.active), lte(networkSessions.expiresAt, now))
		);

	let revoked = 0;
	for (const s of due) {
		if (s.macAddress) await network.revoke(s.macAddress);
		await db
			.update(networkSessions)
			.set({ status: SESSION_STATUS.expired })
			.where(eq(networkSessions.id, s.id));
		revoked++;
	}
	return revoked;
}

/**
 * Removes guest bypass bindings on the router that no longer map to an active
 * session — self-heals DB↔router drift the row-based revoke cron can't catch:
 * customer wipes (which cascade-delete sessions), crashed grants, or a manual DB
 * delete. Without this, such a binding grants internet forever with no DB trace.
 *
 * Only touches our guest-tagged bindings; admin bypasses and operator-added
 * bindings are left alone. Safe against live grants: startSession inserts the
 * (active) session row *before* it creates the binding, so a binding the router
 * reports always has its session row already committed. Returns the count removed.
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
			await network.revoke(macAddress);
			revoked++;
		}
	}
	return revoked;
}

/**
 * Immediately revokes all active sessions for one user (admin kick / block).
 * Re-blocks each MAC and marks the rows `revoked`. Returns the count.
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
