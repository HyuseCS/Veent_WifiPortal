import { env } from '$env/dynamic/private';
import type { IssueStatus } from './types';

/**
 * Sentry REST transport — the ONLY module that talks HTTP to Sentry or reads its credentials.
 * It knows nothing about dashboards or view models; it returns raw JSON. The auth token is a
 * server-only secret (event:read + event:write + org:read) and never leaves this file's process
 * boundary: it goes out only in the Authorization header, and is never logged or returned.
 *
 * Bounded by an AbortController timeout (mirrors the Maya client) so a hung Sentry API can't pin
 * a request — and by a short read cache so page reloads don't hammer Sentry's rate limit.
 */

const TIMEOUT_MS = 8_000;
// DSN host is `ingest.de.sentry.io` → the org lives in Sentry's DE region. Overridable via env
// for other regions / self-hosted. Trailing slash trimmed so path concatenation is clean.
const DEFAULT_API_BASE = 'https://de.sentry.io/api/0';

const token = () => env.SENTRY_AUTH_TOKEN;
const org = () => env.SENTRY_ORG_SLUG;
const project = () => env.SENTRY_PROJECT_ID;
const apiBase = () => (env.SENTRY_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '');

/** The private env vars that must ALL be set for the /sentry dashboard to reach Sentry. */
export const SENTRY_CREDENTIAL_KEYS = ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG_SLUG', 'SENTRY_PROJECT_ID'] as const;

/** All three server credentials present → the dashboard can call Sentry. */
export function isSentryConfigured(): boolean {
	return SENTRY_CREDENTIAL_KEYS.every((k) => env[k]);
}

/** A single fetch bounded by a timeout — a slow Sentry API can't hold the request open forever. */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
	return { authorization: `Bearer ${token()}`, ...extra };
}

/** Normalized error whose message carries the path + status but NEVER the token or request body. */
async function fail(method: string, path: string, res: Response): Promise<never> {
	const detail = await res.text().catch(() => '');
	throw new Error(`sentry ${method} ${path} → ${res.status} ${detail.slice(0, 200)}`);
}

async function sentryGet(path: string, query: Record<string, string>): Promise<unknown> {
	const url = new URL(`${apiBase()}${path}`);
	for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
	const res = await fetchWithTimeout(url.href, { headers: authHeaders() });
	if (!res.ok) return fail('GET', path, res);
	return res.json();
}

async function sentryPut(path: string, body: unknown): Promise<void> {
	const res = await fetchWithTimeout(`${apiBase()}${path}`, {
		method: 'PUT',
		headers: authHeaders({ 'content-type': 'application/json' }),
		body: JSON.stringify(body)
	});
	if (!res.ok) await fail('PUT', path, res);
}

// --- Read cache -------------------------------------------------------------
// Caches the in-flight PROMISE, not the resolved data: concurrent misses share one fetch
// (no double-call), and a failed fetch is remembered only briefly (FAIL_TTL) so a Sentry
// outage costs one timeout per 10s rather than two on every dashboard load. Size-capped so
// per-issue `event:${id}` keys can't accumulate unbounded.
// ponytail: Map with insertion-order eviction; swap for a real LRU only if reads ever grow.
const TTL_MS = 60_000;
const FAIL_TTL_MS = 10_000;
const MAX_ENTRIES = 100;
const cache = new Map<string, { until: number; promise: Promise<unknown> }>();

// Exported for unit testing (client.test.ts). Carries no credentials — safe to expose.
export function cached(key: string, fetcher: () => Promise<unknown>): Promise<unknown> {
	const hit = cache.get(key);
	if (hit && Date.now() < hit.until) return hit.promise;
	if (cache.size >= MAX_ENTRIES) {
		const now = Date.now();
		for (const [k, v] of cache) if (now >= v.until) cache.delete(k); // drop expired first
		while (cache.size >= MAX_ENTRIES) {
			const oldest = cache.keys().next().value; // still full → evict oldest-inserted
			if (oldest === undefined) break;
			cache.delete(oldest);
		}
	}
	const promise = fetcher();
	cache.set(key, { until: Date.now() + TTL_MS, promise });
	// A rejected fetch expires fast (FAIL_TTL) AND this handler prevents an unhandled-rejection
	// warning if no caller happens to await the cached failure. The identity check avoids a
	// late-settling old promise clobbering a newer entry (e.g. after invalidate() + re-fetch).
	promise.catch(() => {
		const cur = cache.get(key);
		if (cur?.promise === promise) cache.set(key, { until: Date.now() + FAIL_TTL_MS, promise });
	});
	return promise;
}

/** Drop cached reads so a just-applied mutation shows on the next load instead of 60s later. */
export function invalidate(): void {
	cache.clear();
}

// --- Endpoints (raw JSON out) ----------------------------------------------

/**
 * Unresolved issues for the project, most-frequent first, over the last 14 days. `trendPeriod`
 * picks the per-issue `stats` sparkline granularity (14d → daily, 24h → hourly): the org endpoint
 * controls that via `groupStatsPeriod`, SEPARATELY from `statsPeriod` (which is the query window —
 * `statsPeriod` alone always yields a 24h sparkline). The window stays 14d for both periods so the
 * 24h call returns the same issue set, letting the facade merge each issue's 24h trend in by id.
 */
export function fetchIssuesRaw(trendPeriod: '24h' | '14d' = '14d'): Promise<unknown> {
	return cached(`issues:${trendPeriod}`, () =>
		sentryGet(`/organizations/${org()}/issues/`, {
			project: project() as string,
			query: 'is:unresolved',
			statsPeriod: '14d',
			groupStatsPeriod: trendPeriod,
			sort: 'freq',
			limit: '25'
		})
	);
}

/** The most recent event for an issue — carries the exception + stacktrace the list omits. */
export function fetchLatestEventRaw(id: string): Promise<unknown> {
	return cached(`event:${id}`, () =>
		sentryGet(`/organizations/${org()}/issues/${encodeURIComponent(id)}/events/latest/`, {})
	);
}

/** Set a single issue's status (resolve / ignore). Caller invalidates the read cache after. */
export function putIssueStatus(id: string, status: IssueStatus): Promise<void> {
	return sentryPut(`/organizations/${org()}/issues/${encodeURIComponent(id)}/`, { status });
}
