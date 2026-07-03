import { dev, building } from '$app/environment';
import { env } from '$env/dynamic/private';
import { env as pub } from '$env/dynamic/public';

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
	// Issue 2b/C1: the portal mints session cookies; on open guest WiFi they SHOULD ride HTTPS or
	// they're sniffable off the air (sidejacking) — and the cookie `Secure` flag itself keys off
	// the ORIGIN protocol (see auth.ts `useSecureCookies`). So in prod a PUBLIC ORIGIN must be
	// https. A LAN-appliance deploy (`node build` served on a private-IP/.lan host, no public TLS)
	// is the documented exception: http is allowed there but warned, since the trade-off is local
	// and deliberate. In dev we only warn (below), so http://localhost keeps working.
	const origin = env.ORIGIN ?? '';
	if (!origin) {
		missing.push('ORIGIN');
	} else if (!dev && origin.startsWith('http://')) {
		if (isPrivateLanOrigin(origin)) {
			console.warn(
				`[env] ORIGIN is http:// on a LAN host ("${origin}") — session cookies are NOT Secure and are ` +
					'sniffable on open WiFi. Acceptable for a LAN appliance; put TLS in front for a public portal.'
			);
		} else {
			throw new Error(
				`ORIGIN must be https:// for a public portal — session cookies require TLS to be Secure (got "${origin}"). ` +
					'Only a private-LAN host (RFC1918 IP / .lan / localhost) may use http.'
			);
		}
	}

	// Observability degrades to off, so warn (don't fail) when the Sentry DSN is unset in prod.
	if (!dev && !pub.PUBLIC_SENTRY_DSN) {
		console.warn('[env] PUBLIC_SENTRY_DSN unset — error tracking & performance tracing are disabled.');
	}

	if (missing.length === 0) return;

	const msg = `Missing required environment variable(s): ${missing.join(', ')}`;
	if (!dev) throw new Error(msg);
	console.warn(`[env] ${msg} — required before production.`);
}

/**
 * True when ORIGIN's host is a private-LAN address (loopback, RFC1918 IPv4, or a `.lan`/`.local`
 * name) — the only hosts allowed to serve the portal over plain http in production. Anything
 * public (a real domain / routable IP) must use https. Mirrors `isPrivateLanHost` in
 * scripts/setup-prod.ts, which writes the LAN ORIGIN this validates.
 */
function isPrivateLanOrigin(origin: string): boolean {
	let host: string;
	try {
		host = new URL(origin).hostname;
	} catch {
		return false;
	}
	if (host === 'localhost' || host === '127.0.0.1') return true;
	if (host.endsWith('.lan') || host.endsWith('.local')) return true;
	const m = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(host);
	if (!m) return false;
	const [a, b] = [Number(m[1]), Number(m[2])];
	return a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}
