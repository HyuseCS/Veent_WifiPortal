import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * Step-up verification for the owner-only "wipe customer database" action: a
 * short-lived, single-use numeric code emailed to the owner, proving inbox
 * control at the moment of an irreversible destruction.
 *
 * ponytail: in-memory store, keyed by owner userId. Lost on process restart and
 * not shared across admin instances — fine for the single-process admin app and
 * a flow completed in minutes. Move to a DB verification-token table if admin
 * ever runs multi-process.
 */

const TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;

interface Pending {
	hash: string;
	expiresAt: number;
	attempts: number;
}

const pending = new Map<string, Pending>();

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** Issue (and store) a 6-digit code for this user; returns the plaintext to email. */
export function issueWipeCode(userId: string, now: number = Date.now()): string {
	const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
	pending.set(userId, { hash: sha256(code), expiresAt: now + TTL_MS, attempts: 0 });
	return code;
}

/**
 * Verify a code for this user. Single-use: a correct code is consumed, and the
 * record is also dropped once expired or the attempt cap is hit. Returns true
 * only on an exact, in-time, in-budget match.
 */
export function consumeWipeCode(userId: string, code: string, now: number = Date.now()): boolean {
	const rec = pending.get(userId);
	if (!rec) return false;
	if (now > rec.expiresAt || rec.attempts >= MAX_ATTEMPTS) {
		pending.delete(userId);
		return false;
	}
	rec.attempts++;

	// Constant-time compare over fixed-length sha256 hex — avoids leaking how many
	// leading digits matched, and sidesteps length-based early exit.
	const got = Buffer.from(sha256(code));
	const want = Buffer.from(rec.hash);
	const ok = got.length === want.length && timingSafeEqual(got, want);
	if (ok) pending.delete(userId);
	return ok;
}

// ponytail: one runnable self-check for the load-bearing verify logic.
// Run with `npx tsx apps/admin/src/lib/server/wipe-verification.ts`.
function demo() {
	const assert = (c: boolean, m: string) => {
		if (!c) throw new Error('FAIL: ' + m);
	};
	const t0 = 1_000_000;

	// wrong code is rejected, right code passes exactly once (single-use)
	const code = issueWipeCode('u1', t0);
	assert(
		!consumeWipeCode('u1', '000000' === code ? '111111' : '000000', t0),
		'wrong code rejected'
	);
	assert(consumeWipeCode('u1', code, t0), 'right code passes');
	assert(!consumeWipeCode('u1', code, t0), 'code is single-use');

	// expiry
	const c2 = issueWipeCode('u2', t0);
	assert(!consumeWipeCode('u2', c2, t0 + TTL_MS + 1), 'expired code rejected');

	// attempt cap
	const c3 = issueWipeCode('u3', t0);
	for (let i = 0; i < MAX_ATTEMPTS; i++) consumeWipeCode('u3', '999999', t0);
	assert(!consumeWipeCode('u3', c3, t0), 'over-cap rejects even the right code');

	console.log('wipe-verification: all checks passed');
}

if (import.meta.url === `file://${process.argv[1]}`) demo();
