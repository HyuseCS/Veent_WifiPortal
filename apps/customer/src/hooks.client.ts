import { dev } from '$app/environment';
import { env } from '$env/dynamic/public';
import * as Sentry from '@sentry/sveltekit';
// Import from the browser-safe subpath, NOT the '@veent/core' barrel — the barrel re-exports the
// server-only integrations (maya/mikrotik/postgres) which reference Node globals like `Buffer`.
import { sentryOptions, nonEmptyEnv } from '@veent/core/observability';

// Sentry (browser). Fail-open: no PUBLIC_SENTRY_DSN → no init → portal runs normally. Same PII
// scrubbing as the server via sentryOptions. Only PUBLIC_ env is readable here — the DSN is public
// by design.
//
// ERROR CAPTURE ONLY — no browserTracingIntegration. The portal runs on low-end phones inside
// captive mini-browsers: perf tracing bloats the bundle and beacons every fetch/navigation to
// ingest.sentry.io, a host a pre-auth trapped device can't even reach (not walled-gardened), so
// those beacons just fail and retry. tracesSampleRate: 0 keeps tracing off entirely.
const dsn = env.PUBLIC_SENTRY_DSN;
if (dsn) {
	// Error capture only — no browserTracingIntegration (rate 0). Keep the env-tunable environment
	// + release plumbing from the base (helps tie errors to a deploy) but NOT browser perf tracing.
	Sentry.init(
		sentryOptions({
			dsn,
			app: 'customer',
			environment: nonEmptyEnv(env.PUBLIC_SENTRY_ENVIRONMENT) ?? (dev ? 'development' : 'production'),
			release: nonEmptyEnv(env.PUBLIC_SENTRY_RELEASE),
			tracesSampleRate: 0
		})
	);
}

// Report client-side errors to Sentry, then fall through to SvelteKit's default handler.
export const handleError = Sentry.handleErrorWithSentry();
