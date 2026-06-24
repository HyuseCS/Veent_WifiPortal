import { dev, building } from '$app/environment';
import { env } from '$env/dynamic/private';

/**
 * Boot-time environment check (called once from hooks.server.ts). Fails fast on a
 * misconfigured production deploy — surfacing ALL missing required vars at startup, instead
 * of a confusing 500 on the first request that needs one. Mirrors the loud-in-prod /
 * forgiving-in-dev pattern used for BETTER_AUTH_SECRET.
 *
 * Hard-required (prod): the DB, auth secret, and ORIGIN (better-auth baseURL). A live router
 * (NETWORK_CONTROLLER=mikrotik) additionally needs its connection vars. Transactional email
 * (RESEND_API_KEY + EMAIL_FROM) only warns when unset — the mailer falls back to a dev stub.
 */
const REQUIRED = ['DATABASE_URL', 'BETTER_AUTH_SECRET', 'ORIGIN'] as const;

export function validateEnv(): void {
	if (building) return; // env isn't populated during build/prerender

	const missing: string[] = REQUIRED.filter((k) => !env[k]);
	if (env.NETWORK_CONTROLLER === 'mikrotik') {
		for (const k of ['MIKROTIK_HOST', 'MIKROTIK_USER', 'MIKROTIK_PASSWORD'] as const) {
			if (!env[k]) missing.push(k);
		}
	}

	if (missing.length > 0) {
		const msg = `Missing required environment variable(s): ${missing.join(', ')}`;
		if (!dev) throw new Error(msg);
		console.warn(`[env] ${msg} — required before production.`);
	}

	// Email is degrade-to-stub, so warn (don't fail) when unconfigured in production.
	if (!dev && (!env.RESEND_API_KEY || !env.EMAIL_FROM)) {
		console.warn('[env] RESEND_API_KEY / EMAIL_FROM unset — staff invites & wipe codes will not send real email.');
	}
}
