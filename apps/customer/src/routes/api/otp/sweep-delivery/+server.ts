import { json } from '@sveltejs/kit';
import * as Sentry from '@sentry/sveltekit';
import { and, eq, gt, lt, lte } from 'drizzle-orm';
import { captureHandled } from '@veent/core';
import { customerOtpDeliveryLog } from '@veent/db/schema';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { requireCron } from '$lib/server/cron';
import type { RequestHandler } from './$types';

/**
 * POST /api/otp/sweep-delivery — cron-callable OTP delivery-status sweep.
 *
 * A gateway ACCEPT is not a DELIVERY. Cast accepts every OTP and the carrier can still reject
 * 100% of them, leaving the guest told "code sent" with nothing arriving and every dashboard
 * green. This sweep re-checks Cast's DLR status endpoint for recently-accepted `pending` rows and
 * turns a confirmed carrier rejection into a Sentry warning.
 *
 * Cast-only: it is the sole provider with a DLR status endpoint. Other providers' rows are
 * written by the send seam but never swept.
 *
 * Classification is deliberately CONSERVATIVE (only a confirmed rejection alerts):
 *   - `dlr_status: "REJECTD"` or `status: "undelivered"` → `rejected`, alert once.
 *   - non-2xx / network error / unknown status string → TRANSIENT. Leave `pending`, no alert,
 *     retry next sweep. Repeated check failures alone never raise an alarm.
 *   - still `pending` 30 minutes after send → terminal `unknown`, NO alert. We stop guessing.
 *
 * Auth: shared secret in the `x-cron-secret` header — same `requireCron` guard as the revoke and
 * reconcile crons. Every 5 minutes (not the 1-minute cadence those two use):
 *   *\/5 * * * * curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" http://127.0.0.1:5173/api/otp/sweep-delivery
 */

/** Stop chasing a message this long after send. Independent of the 5-minute OTP expiry. */
const GIVE_UP_MS = 30 * 60 * 1000;
/** Retention bound. Rows hold masked phones, so they are pruned aggressively. */
const RETENTION_MS = 48 * 60 * 60 * 1000;

export const POST: RequestHandler = async (event) => {
	requireCron(event);

	// Sentry cron check-in: makes a DEAD scheduler detectable ("the sweep never ran"), which the
	// endpoint's own error coverage can't see. No-op passthrough when Sentry isn't initialised; a
	// throw still fails the check-in AND bubbles to handleError (deliberately no swallowing catch).
	return Sentry.withMonitor(
		'customer-otp-sweep',
		async () => {
			const now = Date.now();
			const sweepCutoff = new Date(now - GIVE_UP_MS);
			const pruneCutoff = new Date(now - RETENTION_MS);

			let checked = 0;
			let rejected = 0;
			let unknown = 0;

			// NOTE: this SELECT is deliberately NOT wrapped. A total DB outage should fail the whole
			// handler (and the cron check-in) rather than report a silent, meaningless success.
			const pending = await db
				.select()
				.from(customerOtpDeliveryLog)
				.where(
					and(
						eq(customerOtpDeliveryLog.provider, 'cast'),
						eq(customerOtpDeliveryLog.status, 'pending'),
						gt(customerOtpDeliveryLog.createdAt, sweepCutoff)
					)
				);

			// Sweep loop, guarded so a per-row or loop-level failure can never skip the prune below.
			try {
				for (const row of pending) {
					// Cast rows always carry a message id; guard defensively rather than build a
					// status URL ending in "undefined".
					if (!row.providerMessageId) continue;
					try {
						checked++;
						const res = await fetch(
							`https://api.cast.ph/api/v1/sms/status/${row.providerMessageId}`,
							{
								headers: { 'x-api-key': env.CAST_API_KEY ?? '' },
								signal: AbortSignal.timeout(10_000)
							}
						);
						// Transient: the status endpoint is unhappy, not the carrier. Retry next sweep.
						if (!res.ok) continue;
						const body = (await res.json().catch(() => null)) as {
							dlr_status?: string;
							status?: string;
						} | null;

						// The ONLY alerting branch. Anything else (delivered, pending, an unrecognized
						// string, a missing field) is "not yet known-failed" — keep sweeping.
						if (body?.dlr_status === 'REJECTD' || body?.status === 'undelivered') {
							await db
								.update(customerOtpDeliveryLog)
								.set({ status: 'rejected' })
								.where(eq(customerOtpDeliveryLog.id, row.id));
							rejected++;
							// FINGERPRINT STABILITY: the Error message is a CONSTANT. During a total
							// carrier outage this fires once per rejected message — interpolating the
							// message id or phone here would split one Sentry issue into thousands and
							// bury the alert exactly when it matters. Variable data goes in `extra` only.
							captureHandled(new Error('OTP delivery rejected by carrier'), {
								level: 'warning',
								tags: { area: 'otp-delivery' },
								extra: {
									providerMessageId: row.providerMessageId,
									phoneMasked: row.phoneMasked
								}
							});
						}
					} catch (err) {
						// One bad row must not abort the sweep.
						captureHandled(err, { level: 'warning', tags: { area: 'otp-delivery-sweep' } });
					}
				}

				// Aged out of the sweep window without a verdict: terminal `unknown`, no alert.
				const aged = await db
					.update(customerOtpDeliveryLog)
					.set({ status: 'unknown' })
					.where(
						and(
							eq(customerOtpDeliveryLog.provider, 'cast'),
							eq(customerOtpDeliveryLog.status, 'pending'),
							lte(customerOtpDeliveryLog.createdAt, sweepCutoff)
						)
					)
					.returning({ id: customerOtpDeliveryLog.id });
				unknown = aged.length;
			} catch (err) {
				captureHandled(err, { level: 'warning', tags: { area: 'otp-delivery-sweep' } });
			}

			// Retention prune — UNCONDITIONAL and always the last statement. Never gated on the Cast
			// calls succeeding: otherwise masked-phone rows would accumulate precisely when the sweep
			// is failing.
			const purged = await db
				.delete(customerOtpDeliveryLog)
				.where(lt(customerOtpDeliveryLog.createdAt, pruneCutoff))
				.returning({ id: customerOtpDeliveryLog.id });

			return json({ ok: true, checked, rejected, unknown, pruned: purged.length });
		},
		{
			schedule: { type: 'crontab', value: '*/5 * * * *' },
			checkinMargin: 5,
			maxRuntime: 5,
			timezone: 'UTC'
		}
	);
};
