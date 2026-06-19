import { and, desc, eq, gt, lte } from 'drizzle-orm';
import { type DB, customerProfile, networkHealth, networkSessions, packages } from '@veent/db';
import type { NetworkController } from '../integrations/network';
import { SESSION_STATUS } from '../config';
import { getFreeTimeStatus } from './freeTime';

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
export async function startSession(db: DB, network: NetworkController, input: StartSessionInput) {
	const now = new Date();
	const [session] = await db
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

	try {
		await network.grant({
			macAddress: input.macAddress,
			durationMinutes: input.durationMinutes,
			bandwidthMbps: input.bandwidthMbps
		});
	} catch (err) {
		await db
			.update(networkSessions)
			.set({ status: SESSION_STATUS.revoked })
			.where(eq(networkSessions.id, session.id));
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
