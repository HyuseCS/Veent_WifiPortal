import type { Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { building, dev } from '$app/environment';
import * as Sentry from '@sentry/sveltekit';
// Import from the browser-safe subpath (also server-safe: it only pulls in @sentry/core), NOT the
// '@veent/core' barrel — the locator needs none of the barrel's payment/network/email providers.
import { sentryOptions, nonEmptyEnv } from '@veent/core/observability';
import { env as pub } from '$env/dynamic/public';
import { env as priv } from '$env/dynamic/private';

// Sentry (server). Fail-open: no DSN → no init → the locator runs normally. Errors + sampled
// tracing; PII scrubbed centrally via sentryOptions. The locator has no auth, so no user identity
// is ever set (nothing to identify, and nothing that could leak PII).
const SENTRY_DSN = pub.PUBLIC_SENTRY_DSN;
if (SENTRY_DSN && !building) {
	Sentry.init(
		sentryOptions({
			dsn: SENTRY_DSN,
			app: 'locator',
			environment: nonEmptyEnv(priv.SENTRY_ENVIRONMENT) ?? (dev ? 'development' : 'production'),
			release: nonEmptyEnv(priv.SENTRY_RELEASE),
			tracesSampleRate: dev ? 1.0 : Number(nonEmptyEnv(priv.SENTRY_TRACES_SAMPLE_RATE) ?? '0.2')
		})
	);
}

// Baseline security headers, matching the admin/customer apps (L-6). The locator is public and
// read-only, but framing (clickjacking) + MIME-sniffing protection should be consistent across all
// three apps. `frame-ancestors 'self'` / SAMEORIGIN blocks cross-origin framing; a full script/style
// CSP is out of scope here (needs nonce wiring), same as the other two apps. HSTS only over HTTPS.
const securityHeaders: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	const h = response.headers;
	h.set('X-Frame-Options', 'SAMEORIGIN');
	h.set('Content-Security-Policy', "frame-ancestors 'self'");
	h.set('X-Content-Type-Options', 'nosniff');
	h.set('Referrer-Policy', 'same-origin');
	if (event.url.protocol === 'https:') {
		h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
	}
	return response;
};

// sentryHandle FIRST so it wraps the request transaction; security headers set on the way out.
export const handle = sequence(Sentry.sentryHandle(), securityHeaders);

// Report server-side (load/render) errors to Sentry, then fall through to SvelteKit's default.
export const handleError = Sentry.handleErrorWithSentry();
