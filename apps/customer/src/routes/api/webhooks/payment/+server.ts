import { json, error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { packages } from '@veent/db';
import { addCredits, LEDGER_TYPE } from '@veent/core';
import { db } from '$lib/server/db';
import { payments } from '$lib/server/payments';
import type { RequestHandler } from './$types';

/**
 * POST /api/webhooks/payment — the source of truth for adding credits.
 *
 * Verifies the gateway signature (provider.verifyWebhook throws if invalid),
 * then credits the buyer's balance EXACTLY ONCE — addCredits is idempotent on
 * the gateway transaction id, so retried webhooks can't double-credit
 * (business rule #3).
 *
 * `referenceId` is the value we set at checkout: `${userId}:${packageId}`.
 */
export const POST: RequestHandler = async (event) => {
	const raw = await event.request.text();

	let evt;
	try {
		evt = await payments.verifyWebhook(raw, event.request.headers);
	} catch (e) {
		error(400, `Webhook verification failed: ${(e as Error).message}`);
	}

	// Only successful payments add credits; others are acknowledged and ignored.
	if (evt.status !== 'paid') return json({ ok: true, ignored: true, status: evt.status });

	const [userId, packageIdStr] = evt.referenceId.split(':');
	const packageId = Number(packageIdStr);
	if (!userId || !Number.isFinite(packageId)) error(400, 'Malformed referenceId');

	const [pkg] = await db.select().from(packages).where(eq(packages.id, packageId)).limit(1);
	if (!pkg) error(404, 'Package not found');

	const result = await addCredits(db, {
		userId,
		amount: pkg.creditsProvided ?? 0,
		type: LEDGER_TYPE.topup,
		packageId: pkg.id,
		externalTransactionId: evt.externalTransactionId
	});

	return json({ ok: true, credited: result.credited, balance: result.balance });
};
