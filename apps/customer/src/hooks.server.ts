import type { Handle } from '@sveltejs/kit';
import { building, dev } from '$app/environment';
import { sentryOptions, nonEmptyEnv } from '@veent/core';
import * as Sentry from '@sentry/sveltekit';
import { sequence } from '@sveltejs/kit/hooks';
import { env as pub } from '$env/dynamic/public';
import { env as priv } from '$env/dynamic/private';
import { auth } from '$lib/server/auth';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { capturePortalContext } from '$lib/server/portal';
import { validateEnv } from '$lib/server/validateEnv';

// Fail fast at boot on a misconfigured production deploy (no-op during build; warns in dev).
validateEnv();

// Sentry (server). Fail-open: no DSN → no init → portal runs normally. Errors + sampled tracing;
// PII scrubbed centrally. Payment (Maya) / network (MikroTik) latency spans come from @veent/core.
const SENTRY_DSN = pub.PUBLIC_SENTRY_DSN;
if (SENTRY_DSN && !building) {
	Sentry.init(
		sentryOptions({
			dsn: SENTRY_DSN,
			app: 'customer',
			environment: nonEmptyEnv(priv.SENTRY_ENVIRONMENT) ?? (dev ? 'development' : 'production'),
			release: nonEmptyEnv(priv.SENTRY_RELEASE),
			tracesSampleRate: dev ? 1.0 : Number(nonEmptyEnv(priv.SENTRY_TRACES_SAMPLE_RATE) ?? '0.2')
		})
	);
}

/**
 * Baseline security headers for the captive portal. `frame-ancestors 'self'` / SAMEORIGIN blocks
 * cross-origin framing (clickjacking) without breaking the OS captive popup (which renders the
 * page top-level, not framed). `nosniff` blocks MIME-confusion. HSTS is set only over HTTPS — the
 * portal frequently runs plain HTTP on the LAN, where HSTS would be wrong. A full script/style CSP
 * is out of scope (needs nonce wiring); this is the framing + sniff baseline the audit flagged.
 */
function setSecurityHeaders(event: Parameters<Handle>[0]['event'], response: Response) {
	const h = response.headers;
	h.set('X-Frame-Options', 'SAMEORIGIN');
	h.set('Content-Security-Policy', "frame-ancestors 'self'");
	h.set('X-Content-Type-Options', 'nosniff');
	h.set('Referrer-Policy', 'same-origin');
	if (event.url.protocol === 'https:') {
		h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}
}

// better-auth mounts /phone-number/verify as a public HTTP endpoint. The portal only ever
// verifies via the in-process `auth.api.verifyPhoneNumber` call in the /auth/verify action
// (throttled by enforceOtpVerifyLimit) — nothing legitimate hits this route directly. Blocking
// external POSTs here closes the same bypass the send limiter guards against: an attacker skipping
// the throttled form action to brute-force the OTP straight against the raw endpoint (H-1).
const AUTH_VERIFY_PATH = '/api/auth/phone-number/verify';

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	if (event.url.pathname === AUTH_VERIFY_PATH && event.request.method === 'POST') {
		return new Response('Not found', { status: 404 });
	}

	// Stash the device MAC / callback from the captive-portal redirect before the
	// auth flow's redirects drop the query string.
	capturePortalContext(event);

	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
		// Identify by id ONLY — the portal holds phone/email/MAC, none of which may reach Sentry.
		Sentry.setUser({ id: session.user.id });
	}

	const response = await svelteKitHandler({ event, resolve, auth, building });
	setSecurityHeaders(event, response);
	return response;
};

// sentryHandle FIRST so it wraps portal context + auth in the request transaction.
export const handle: Handle = sequence(Sentry.sentryHandle(), handleBetterAuth);

// Report server-side (load/action/render) errors to Sentry, then fall through to SvelteKit's default.
export const handleError = Sentry.handleErrorWithSentry();
