/**
 * Sentry observability helpers shared by every app (admin, customer).
 *
 * Two things live here so there's ONE implementation instead of copies per app:
 *  - `scrubEvent` — the strict PII redactor wired into each app's `beforeSend` /
 *    `beforeSendTransaction`. This system holds phone numbers, emails, MAC addresses and
 *    payment data; none of it may leave for Sentry. `sendDefaultPii: false` in the app init
 *    stops IP/cookie/user attachment; this redactor is the safety net for anything that leaks
 *    into a message, breadcrumb, request payload or stack frame.
 *  - `traceMethods` — wraps every async method of an integration provider/controller in a
 *    performance span, so payment (Maya), network (MikroTik) and email (Resend) call latency
 *    shows up in Sentry transaction waterfalls WITHOUT editing each method. Applied once at the
 *    factory seam. Uses `@sentry/core`'s `startSpan`, which is a safe no-op when Sentry isn't
 *    initialised (dev, tests, no-DSN) — so this package stays framework-agnostic and boot never
 *    depends on telemetry.
 */
import { captureException, startSpan } from '@sentry/core';
import type { ErrorEvent, EventHint, TransactionEvent } from '@sentry/core';

type AnyEvent = ErrorEvent | TransactionEvent;

// --- PII redaction ---------------------------------------------------------

/** Object keys whose VALUE is dropped outright — secrets & auth material, never useful in Sentry. */
const DROP_KEY_RE =
	/pass(word)?|secret|token|otp|^code$|authorization|cookie|api[-_]?key|session[-_]?id|totp/i;

const EMAIL_RE = /([\w.+-])[\w.+-]*(@[\w.-]+)/g;
const MAC_RE = /\b([0-9A-Fa-f]{2}:){2}([0-9A-Fa-f]{2}:){3}[0-9A-Fa-f]{2}\b/g;
// PH phone shapes: +63XXXXXXXXXX or 09XXXXXXXXX (and generic 8+ digit runs with separators).
const PHONE_RE = /\+?\d[\d ()-]{7,}\d/g;

/** Mask PII patterns inside a free-text string (messages, breadcrumbs, stack frames). */
function maskString(s: string): string {
	return s
		.replace(EMAIL_RE, '$1•••$2')
		.replace(MAC_RE, (m) => `${m.slice(0, 8)}•••`)
		.replace(PHONE_RE, (m) => {
			const digits = m.replace(/\D/g, '');
			if (digits.length < 9) return m; // too short to be a phone — leave (avoids nuking amounts/ids)
			return `${m.slice(0, 3)}•••${m.slice(-2)}`;
		});
}

/**
 * Recursively redact an object in place: drop secret-keyed values, mask PII in every string.
 * Depth- and cycle-guarded so a pathological event can't hang the redactor.
 */
function scrub(value: unknown, seen: WeakSet<object>, depth = 0): unknown {
	if (depth > 8 || value == null) return value;
	if (typeof value === 'string') return maskString(value);
	if (typeof value !== 'object') return value;
	if (seen.has(value as object)) return value;
	seen.add(value as object);

	if (Array.isArray(value)) {
		for (let i = 0; i < value.length; i++) value[i] = scrub(value[i], seen, depth + 1);
		return value;
	}
	for (const key of Object.keys(value as Record<string, unknown>)) {
		if (DROP_KEY_RE.test(key)) {
			(value as Record<string, unknown>)[key] = '[Filtered]';
			continue;
		}
		(value as Record<string, unknown>)[key] = scrub(
			(value as Record<string, unknown>)[key],
			seen,
			depth + 1
		);
	}
	return value;
}

/**
 * `beforeSend` / `beforeSendTransaction` hook. Strips request cookies/headers, drops the user's
 * IP, and masks any PII that reached the message/breadcrumbs/request/contexts. User identity is
 * kept to `{ id }` only (set at the hook call site) — this never re-adds it.
 */
export function scrubEvent<T extends AnyEvent>(event: T, _hint?: EventHint): T {
	// Hard-strip the request envelope — cookies & auth headers carry session material.
	if (event.request) {
		delete event.request.cookies;
		if (event.request.headers) {
			for (const h of Object.keys(event.request.headers)) {
				if (/cookie|authorization/i.test(h)) delete event.request.headers[h];
			}
		}
		delete event.request.data; // form/JSON bodies can hold email/phone/MAC
	}
	// Never ship an IP even if some integration attached one.
	if (event.user) {
		delete event.user.ip_address;
		delete event.user.email;
		delete event.user.username;
	}
	scrub(event.message, new WeakSet());
	scrub(event.breadcrumbs, new WeakSet());
	scrub(event.exception, new WeakSet());
	scrub(event.extra, new WeakSet());
	scrub(event.contexts, new WeakSet());
	if (typeof event.message === 'string') event.message = maskString(event.message);
	return event;
}

// --- handled-error capture -------------------------------------------------

export interface CaptureHandledOptions {
	/** Sentry severity. Default 'warning' — these are caught/degraded, not crashes. */
	level?: 'warning' | 'error';
	/** Extra tags to group/filter by, e.g. `{ area: 'reconcile' }`. */
	tags?: Record<string, string>;
	/** Non-PII structured context (ids/status only — scrubEvent still runs on send). */
	extra?: Record<string, unknown>;
}

/**
 * Report a CAUGHT error to Sentry. Sentry only auto-captures *uncaught* errors; failures the app
 * handles gracefully (router unreachable, failed Maya verify, unsent email, rolled-back grant) are
 * invisible without this. Call it at the catch site, alongside the existing degrade/`fail()` path —
 * it changes no control flow. Tagged `handled=true` so these are filterable and distinct from
 * crashes. No-op safe when Sentry isn't initialised (dev/tests/no-DSN); never throws.
 *
 * Constant failures (e.g. a router-down poll) collapse into ONE Sentry Issue with a rising count —
 * grouping handles the volume, so we deliberately don't throttle.
 */
export function captureHandled(error: unknown, opts: CaptureHandledOptions = {}): void {
	try {
		const err =
			error instanceof Error
				? error
				: new Error(typeof error === 'string' ? error : JSON.stringify(error));
		captureException(err, {
			level: opts.level ?? 'warning',
			tags: { handled: 'true', ...opts.tags },
			extra: opts.extra
		});
	} catch {
		// Telemetry must never take down the caller. Swallow anything the SDK throws.
	}
}

// --- integration latency spans ---------------------------------------------

/**
 * Wrap every function-valued property of an integration provider/controller so each call opens a
 * Sentry span `${name}.${method}` under op `op`. Non-function props (e.g. `name`) pass through.
 * `startSpan` runs the wrapped call inside the span and no-ops cleanly when Sentry is off, so the
 * provider behaves identically with or without telemetry.
 *
 * Applied at the factory seam (createPaymentProvider / createNetworkController /
 * createEmailProvider), so a slow Maya checkout, a hung router grant, or a laggy email send all
 * appear as timed spans in the request's transaction — the "where are the delays" view.
 */
// --- shared Sentry.init options -------------------------------------------

export interface SentryInitInput {
	/** PUBLIC_SENTRY_DSN — same value client & server. Undefined disables telemetry. */
	dsn?: string;
	/** `production` / `staging` / `development`. */
	environment?: string;
	/** Git SHA or app version (optional). */
	release?: string;
	/** Which app this is, attached as the `app` tag on every event. */
	app: 'admin' | 'customer';
	/** 0–1. Fraction of requests traced for performance. */
	tracesSampleRate: number;
}

/**
 * Build the options object passed to `Sentry.init` — identical shape client & server, both apps,
 * so PII scrubbing and the `app` tag are defined ONCE here. Callers add environment-specific
 * integrations (e.g. `browserTracingIntegration` on the client) by spreading the result.
 *
 * `sendDefaultPii: false` + `scrubEvent` on both send hooks is the non-negotiable privacy baseline.
 */
export function sentryOptions(input: SentryInitInput) {
	return {
		dsn: input.dsn,
		environment: input.environment,
		release: input.release,
		tracesSampleRate: input.tracesSampleRate,
		sendDefaultPii: false,
		initialScope: { tags: { app: input.app } },
		beforeSend: (event: ErrorEvent, hint: EventHint) => scrubEvent(event, hint),
		beforeSendTransaction: (event: TransactionEvent) => scrubEvent(event)
	};
}

export function traceMethods<T extends object>(target: T, name: string, op: string): T {
	const wrapped: Record<string, unknown> = {};
	for (const key of Object.keys(target) as (keyof T & string)[]) {
		const value = target[key];
		if (typeof value === 'function') {
			wrapped[key] = (...args: unknown[]) =>
				startSpan({ name: `${name}.${key}`, op }, () =>
					(value as (...a: unknown[]) => unknown).apply(target, args)
				);
		} else {
			wrapped[key] = value;
		}
	}
	return wrapped as T;
}
