import { and, count, eq, gt, isNotNull, isNull, lte, or } from 'drizzle-orm';
import { type DB, networkHealth, networkSessions, customerProfile } from '@veent/db';
import type { NetworkController } from '../integrations/network';
import { SESSION_STATUS } from '../config';
import { pauseAccountAccess, resumeAccountAccess } from './sessions';
import { resolveNetworkIdForMac } from './networkHealth';

/**
 * Per-AP outage auto-pause. So a guest doesn't lose paid time when the WiFi is down "because of
 * us", this sweep freezes the PAID window of every account whose AP is down, and restores it when
 * the AP recovers. It reuses the existing per-account pause/resume (`pauseAccountAccess` /
 * `resumeAccountAccess`), which the revoke cron already skips while paused — so held time survives.
 *
 * Run it from the per-minute revoke cron (it reads shared `network_health`, written by the admin
 * health-refresh cron). Two phases:
 *   PAUSE  — APs NOT serving (link down OR uplink/WAN unreachable) for ≥ `downMs` (debounced via
 *            `network_health.offline_since`) → pause each account with an ACTIVE, PAID session on that
 *            AP, tagged reason='outage' + the AP id. A device that has since roamed onto a fully
 *            serving AP is skipped (re-checked live) so its working internet isn't cut on a stale
 *            bind-time `network_id`.
 *   RESUME — an outage-paused account is resumed once its AP is confirmed back UP for ≥ `upMs` (the
 *            symmetric debounce, via `network_health.online_since`), or its AP row was pruned, or the
 *            pause has been held past `maxPauseMs` (the dead-AP safety cap) → restore the held time.
 *
 * KNOWN LIMITATIONS (to reinforce later):
 *  - Free Time isn't protected (paid windows only — pausing free would game the 12h cooldown).
 *  - Sessions with a NULL `network_id` (the AP couldn't be resolved at bind, sessions.ts) can't be
 *    matched to a down AP, so those guests aren't paused. This is the per-AP precision/coverage
 *    trade-off vs. a global "pause everyone on any outage".
 *  - The roamer re-check needs a controller MAC→AP lookup (`resolveApForMac`); on the stub/dev
 *    controller it's a no-op and we fall back to the stored bind-time `network_id`.
 *  - Detection keys on link state AND a shared uplink probe (`online` && `wan_ok`), so a WAN outage
 *    on an up-link AP now pauses too. The probe is a single router ping (see mikrotik `sampleHealth`)
 *    debounced by `downMs`/`upMs`; a multi-target prober (to rule out one probe host being down) is
 *    the remaining hardening.
 */

/** An AP must be continuously offline at least this long before its guests are auto-paused. */
export const DEFAULT_OUTAGE_DOWN_MS = 3 * 60 * 1000;

/** And confirmed back online at least this long before a held guest is auto-resumed — the symmetric
 *  RESUME debounce, so a flapping AP can't un-freeze paid time on the first "online" sample. */
export const DEFAULT_OUTAGE_UP_MS = 2 * 60 * 1000;

/** Dead-AP safety cap: an outage pause held longer than this is released regardless of AP state, so
 *  a permanently-dead AP can't strand a guest's paid time forever. 6h ≫ any real transient outage. */
export const DEFAULT_MAX_OUTAGE_PAUSE_MS = 6 * 60 * 60 * 1000;

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
	opts: { downMs?: number; upMs?: number; maxPauseMs?: number } = {}
): Promise<OutageSweepResult> {
	const downMs = opts.downMs ?? DEFAULT_OUTAGE_DOWN_MS;
	const upMs = opts.upMs ?? DEFAULT_OUTAGE_UP_MS;
	const maxPauseMs = opts.maxPauseMs ?? DEFAULT_MAX_OUTAGE_PAUSE_MS;
	let paused = 0;
	let resumed = 0;
	const pausedApIds = new Set<number>();

	// ── PAUSE ──────────────────────────────────────────────────────────────────
	// APs NOT serving (link down OR uplink/WAN unreachable) long enough to clear the debounce.
	const downThreshold = new Date(now.getTime() - downMs);
	const downAps = await db
		.select({ id: networkHealth.id })
		.from(networkHealth)
		.where(
			and(
				or(eq(networkHealth.online, false), eq(networkHealth.wanOk, false)),
				isNotNull(networkHealth.offlineSince),
				lte(networkHealth.offlineSince, downThreshold)
			)
		);

	// Roamer guard (live controllers only): before pausing we re-check each device's CURRENT AP, so
	// an account that roamed onto a HEALTHY AP isn't paused+unbound (which would cut its working
	// internet) just because its stale bind-time `network_id` still points at the down AP. On the
	// stub/dev controller (`resolveApForMac` absent) this is a no-op and we fall back to the stored id.
	const canResolve = typeof network.resolveApForMac === 'function';
	const onlineApIds = canResolve
		? new Set(
				// A roamed device only "has service elsewhere" if that AP is fully SERVING (link up AND
				// uplink reachable) — an AP with a dead WAN is no refuge during a WAN outage.
				(
					await db
						.select({ id: networkHealth.id })
						.from(networkHealth)
						.where(and(eq(networkHealth.online, true), eq(networkHealth.wanOk, true)))
				).map((a) => a.id)
			)
		: new Set<number>();

	for (const ap of downAps) {
		// Accounts with a live PAID window and an ACTIVE session on this AP that aren't already
		// paused (skipping a manual pause — their time is already held). Pull the MAC too for the
		// roamer re-check; group per account since the pause is account-wide.
		const rows = await db
			.selectDistinct({ userId: networkSessions.userId, macAddress: networkSessions.macAddress })
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
		const macsByUser = new Map<string, string[]>();
		for (const r of rows) {
			const list = macsByUser.get(r.userId) ?? [];
			if (r.macAddress) list.push(r.macAddress);
			macsByUser.set(r.userId, list);
		}

		for (const [userId, macs] of macsByUser) {
			if (canResolve) {
				// If ANY of this account's devices is currently on a different, ONLINE AP, it still has
				// working service — don't pause/unbind it.
				let hasServiceElsewhere = false;
				for (const mac of macs) {
					const currentAp = await resolveNetworkIdForMac(db, network, mac);
					if (currentAp != null && currentAp !== ap.id && onlineApIds.has(currentAp)) {
						hasServiceElsewhere = true;
						break;
					}
				}
				if (hasServiceElsewhere) continue;
			}
			const res = await pauseAccountAccess(db, network, userId, now, {
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
	// Keep an outage-pause while its AP is NOT yet confirmed recovered — either still offline, or
	// online but not for `upMs` yet (the symmetric debounce, so a flap doesn't burn held time). An AP
	// whose row was pruned isn't in the table, so it's treated as recovered (we can't confirm it down).
	// Manual ('user') pauses are never touched — the reason filter guarantees that.
	const upThreshold = new Date(now.getTime() - upMs);
	const notRecovered = new Set(
		(
			await db
				.select({ id: networkHealth.id })
				.from(networkHealth)
				.where(
					or(
						eq(networkHealth.online, false),
						eq(networkHealth.wanOk, false),
						isNull(networkHealth.onlineSince),
						gt(networkHealth.onlineSince, upThreshold)
					)
				)
		).map((a) => a.id)
	);

	const maxPauseThreshold = new Date(now.getTime() - maxPauseMs);
	const outagePaused = await db
		.select({
			userId: customerProfile.userId,
			apId: customerProfile.accessPausedNetworkId,
			pausedAt: customerProfile.accessPausedAt
		})
		.from(customerProfile)
		.where(eq(customerProfile.accessPausedReason, 'outage'));

	for (const r of outagePaused) {
		// Dead-AP safety cap: a pause held longer than maxPauseMs is released no matter what the AP
		// looks like, so a permanently-dead AP can't strand paid time forever.
		const stranded = r.pausedAt != null && r.pausedAt <= maxPauseThreshold;
		if (!stranded && r.apId != null && notRecovered.has(r.apId)) continue; // AP not recovered → keep
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
