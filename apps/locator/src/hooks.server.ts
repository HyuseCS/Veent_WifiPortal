import { building, dev } from '$app/environment';
import * as Sentry from '@sentry/sveltekit';
// Import from the browser-safe subpath (also server-safe: it only pulls in @sentry/core), NOT the
// '@veent/core' barrel — the locator needs none of the barrel's payment/network/email providers.
import { sentryOptions } from '@veent/core/observability';
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
			environment: priv.SENTRY_ENVIRONMENT ?? (dev ? 'development' : 'production'),
			release: priv.SENTRY_RELEASE,
			tracesSampleRate: dev ? 1.0 : Number(priv.SENTRY_TRACES_SAMPLE_RATE ?? '0.2')
		})
	);
}

// Wrap requests in the Sentry request transaction (no-op passthrough when Sentry isn't initialised).
export const handle = Sentry.sentryHandle();

// Report server-side (load/render) errors to Sentry, then fall through to SvelteKit's default.
export const handleError = Sentry.handleErrorWithSentry();
