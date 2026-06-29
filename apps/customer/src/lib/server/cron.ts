import { timingSafeEqual } from 'node:crypto';
import { error, type RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { cronIpAllowed } from '$lib/server/rateLimit';

/** Constant-time string compare (length-checked first so it never leaks length via timing). */
function safeEqual(a: string, b: string): boolean {
	const ab = Buffer.from(a);
	const bb = Buffer.from(b);
	return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Authenticate a cron-callable request: optional source-IP allowlist (`CRON_IP_ALLOWLIST`)
 * + a TIMING-SAFE `x-cron-secret` check against `CRON_SECRET`. Throws a SvelteKit error
 * (403/401) on failure; returns normally on success. Fail-closed: an unset `CRON_SECRET`
 * rejects every request (`validateEnv` already hard-fails on it in prod).
 *
 * Replaces the per-endpoint `secret !== env.CRON_SECRET` checks, which compared in
 * non-constant time (a remote attacker could in principle byte-time the secret).
 */
export function requireCron(event: RequestEvent): void {
	if (!cronIpAllowed(event, env.CRON_IP_ALLOWLIST)) error(403, 'Forbidden');
	const expected = env.CRON_SECRET;
	const provided = event.request.headers.get('x-cron-secret') ?? '';
	if (!expected || !safeEqual(provided, expected)) error(401, 'Unauthorized');
}
