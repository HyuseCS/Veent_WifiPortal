import { dev, building } from '$app/environment';
import { env } from '$env/dynamic/private';

/**
 * Boot-time environment check (called once from hooks.server.ts). Fails fast on a
 * misconfigured production deploy — surfacing ALL missing required vars at startup, instead
 * of a confusing 500 on the first request that happens to need one. Mirrors the loud-in-prod /
 * forgiving-in-dev pattern used for BETTER_AUTH_SECRET in otp.ts.
 *
 * Hard-required (prod): the DB, auth secret, cron secret, and Maya keys — a real portal needs
 * all of them. A live router (NETWORK_CONTROLLER=mikrotik) additionally needs its connection
 * vars. SMS (ITEXMO_*) is the OTP teammate's config and validated in their path.
 */
const REQUIRED = [
	'DATABASE_URL',
	'BETTER_AUTH_SECRET',
	'CRON_SECRET',
	'MAYA_PUBLIC_KEY',
	'MAYA_SECRET_KEY'
] as const;

export function validateEnv(): void {
	if (building) return; // env isn't populated during build/prerender

	const missing: string[] = REQUIRED.filter((k) => !env[k]);
	if (env.NETWORK_CONTROLLER === 'mikrotik') {
		for (const k of ['MIKROTIK_HOST', 'MIKROTIK_USER', 'MIKROTIK_PASSWORD'] as const) {
			if (!env[k]) missing.push(k);
		}
	}
	if (missing.length === 0) return;

	const msg = `Missing required environment variable(s): ${missing.join(', ')}`;
	if (!dev) throw new Error(msg);
	console.warn(`[env] ${msg} — required before production.`);
}
