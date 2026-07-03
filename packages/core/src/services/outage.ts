import { and, count, eq, isNotNull, isNull, lte } from 'drizzle-orm';
import { type DB, networkHealth, networkSessions, customerProfile } from '@veent/db';
import type { NetworkController } from '../integrations/network';
import { SESSION_STATUS } from '../config';
import { pauseAccountAccess, resumeAccountAccess } from './sessions';

/**
 * Per-AP outage auto-pause. So a guest doesn't lose paid time when the WiFi is down "because of
 * us", this sweep freezes the PAID window of every account whose AP is down, and restores it when
 * the AP recovers. It reuses the existing per-account pause/resume (`pauseAccountAccess` /
 * `resumeAccountAccess`), which the revoke cron already skips while paused — so held time survives.
 *
 * Run it from the per-minute revoke cron (it reads shared `network_health`, written by the admin
 * health-refresh cron). Two phases:
 *   PAUSE  — APs offline for ≥ `downMs` (debounced via `network_health.offline_since`) → pause each
 *            account with an ACTIVE, PAID session on that AP, tagged reason='outage' + the AP id.
 *   RESUME — any outage-paused account whose AP is no longer confirmed-offline (recovered, or the AP
 *            row was pruned) → resume, restoring the held time.
 *
 * KNOWN LIMITATIONS (to reinforce later):
 *  - Free Time isn't protected (paid windows only — pausing free would game the 12h cooldown).
 *  - Sessions with a NULL `network_id` (the AP couldn't be resolved at bind, sessions.ts) can't be
 *    matched to a down AP, so those guests aren't paused. This is the per-AP precision/coverage
 *    trade-off vs. a global "pause everyone on any outage".
 *  - Detection keys on the router LINK state (`network_health.online`). A "false down" (link flaps
 *    but service is fine) would pause guests unnecessarily; a "false up" (link up but the WAN/
 *    internet is actually dead) would resume them while they still have no internet. The debounce
 *    dampens brief flaps, but the link-vs-internet gap is the main thing to harden.
 */

/** An AP must be continuously offline at least this long before its guests are auto-paused. */
export const DEFAULT_OUTAGE_DOWN_MS = 3 * 60 * 1000;

export interface OutageSweepResult {
	/** Distinct down APs that triggered at least one pause this run. */
	pausedAps: number;
	/** Accounts auto-paused this run. */
	paused: number;
	/** Accounts auto-resumed this run (AP recovered). */
	resumed: number;
}

export async function sweepOutagePauses(
	db: DB,
	network: NetworkController,
	now: Date = new Date(),
	opts: { downMs?: number } = {}
): Promise<OutageSweepResult> {
	const downMs = opts.downMs ?? DEFAULT_OUTAGE_DOWN_MS;
	let paused = 0;
	let resumed = 0;
	const pausedApIds = new Set<number>();

	// ── PAUSE ──────────────────────────────────────────────────────────────────
	// APs down long enough to clear the debounce.
	const downThreshold = new Date(now.getTime() - downMs);
	const downAps = await db
		.select({ id: networkHealth.id })
		.from(networkHealth)
		.where(
			and(
				eq(networkHealth.online, false),
				isNotNull(networkHealth.offlineSince),
				lte(networkHealth.offlineSince, downThreshold)
			)
		);

	for (const ap of downAps) {
		// Accounts with a live PAID window and an ACTIVE session on this AP that aren't already
		// paused (skipping a manual pause — their time is already held).
		const victims = await db
			.selectDistinct({ userId: networkSessions.userId })
			.from(networkSessions)
			.innerJoin(customerProfile, eq(customerProfile.userId, networkSessions.userId))
			.where(
				and(
					eq(networkSessions.networkId, ap.id),
					eq(networkSessions.status, SESSION_STATUS.active),
					isNull(customerProfile.accessPausedAt),
					isNotNull(customerProfile.accessExpiresAt),
					isNotNull(customerProfile.accessPackageId)
				)
			);
		for (const v of victims) {
			const res = await pauseAccountAccess(db, network, v.userId, now, {
				reason: 'outage',
				networkId: ap.id
			});
			if (res.ok) {
				paused++;
				pausedApIds.add(ap.id);
			}
		}
	}

	// ── RESUME ─────────────────────────────────────────────────────────────────
	// Keep an outage-pause ONLY while its AP is still confirmed offline; resume otherwise (AP
	// recovered, or its row was pruned so we can't confirm it's down). Manual ('user') pauses are
	// never touched — the reason filter guarantees that.
	const stillDown = new Set(
		(
			await db
				.select({ id: networkHealth.id })
				.from(networkHealth)
				.where(eq(networkHealth.online, false))
		).map((a) => a.id)
	);

	const outagePaused = await db
		.select({ userId: customerProfile.userId, apId: customerProfile.accessPausedNetworkId })
		.from(customerProfile)
		.where(eq(customerProfile.accessPausedReason, 'outage'));

	for (const r of outagePaused) {
		if (r.apId != null && stillDown.has(r.apId)) continue; // its AP is still down → keep paused
		const res = await resumeAccountAccess(db, r.userId, now);
		if (res.ok) resumed++;
	}

	return { pausedAps: pausedApIds.size, paused, resumed };
}

/** How many accounts are currently auto-paused by an outage — for the admin outage indicator. */
export async function countOutagePausedAccounts(db: DB): Promise<number> {
	const [row] = await db
		.select({ n: count() })
		.from(customerProfile)
		.where(eq(customerProfile.accessPausedReason, 'outage'));
	return row?.n ?? 0;
}
