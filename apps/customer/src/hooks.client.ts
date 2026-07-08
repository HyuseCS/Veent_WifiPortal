import { dev } from '$app/environment';
import { env } from '$env/dynamic/public';
import * as Sentry from '@sentry/sveltekit';
// Import from the browser-safe subpath, NOT the '@veent/core' barrel — the barrel re-exports the
// server-only integrations (maya/mikrotik/postgres) which reference Node globals like `Buffer`.
import { sentryOptions, nonEmptyEnv } from '@veent/core/observability';

// Sentry (browser). Fail-open: no PUBLIC_SENTRY_DSN → no init → portal runs normally. Captures
// client-side errors + browser performance (page loads, navigations). Same PII scrubbing as the
// server via sentryOptions. Only PUBLIC_ env is readable here — the DSN is public by design.
const dsn = env.PUBLIC_SENTRY_DSN;
if (dsn) {
	// Browser trace sampling is env-tunable so prod sampling can change without a rebuild; a
	// missing/garbage value degrades to the previous hardcoded 0.2 rather than breaking tracing.
	const rate = Number(nonEmptyEnv(env.PUBLIC_SENTRY_TRACES_SAMPLE_RATE) ?? '0.2');
	Sentry.init({
		...sentryOptions({
			dsn,
			app: 'customer',
			environment: nonEmptyEnv(env.PUBLIC_SENTRY_ENVIRONMENT) ?? (dev ? 'development' : 'production'),
			release: nonEmptyEnv(env.PUBLIC_SENTRY_RELEASE),
			tracesSampleRate: dev ? 1.0 : Number.isFinite(rate) ? rate : 0.2
		}),
		integrations: [Sentry.browserTracingIntegration()]
	});
}

// Report client-side errors to Sentry, then fall through to SvelteKit's default handler.
export const handleError = Sentry.handleErrorWithSentry();
