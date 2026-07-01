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

/** All three server credentials present → the dashboard can call Sentry. */
export function isSentryConfigured(): boolean {
	return Boolean(token() && org() && project());
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
// ponytail: naive whole-response TTL cache keyed by call; swap for per-key/LRU if reads grow.
const TTL_MS = 60_000;
const cache = new Map<string, { at: number; data: unknown }>();

async function cached(key: string, fetcher: () => Promise<unknown>): Promise<unknown> {
	const hit = cache.get(key);
	if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
	const data = await fetcher();
	cache.set(key, { at: Date.now(), data });
	return data;
}

/** Drop cached reads so a just-applied mutation shows on the next load instead of 60s later. */
export function invalidate(): void {
	cache.clear();
}

// --- Endpoints (raw JSON out) ----------------------------------------------

/** Unresolved issues for the project, most-frequent first, over the last 14 days. */
export function fetchIssuesRaw(): Promise<unknown> {
	return cached('issues', () =>
		sentryGet(`/organizations/${org()}/issues/`, {
			project: project() as string,
			query: 'is:unresolved',
			statsPeriod: '14d',
			sort: 'freq',
			limit: '25'
		})
	);
}

/** Daily accepted-error event counts for the project over the last 14 days (trend chart). */
export function fetchStatsRaw(): Promise<unknown> {
	return cached('stats', () =>
		sentryGet(`/organizations/${org()}/stats_v2/`, {
			project: project() as string,
			field: 'sum(times_seen)',
			category: 'error',
			groupBy: 'outcome',
			statsPeriod: '14d',
			interval: '1d'
		})
	);
}

/** Set a single issue's status (resolve / ignore). Caller invalidates the read cache after. */
export function putIssueStatus(id: string, status: IssueStatus): Promise<void> {
	return sentryPut(`/organizations/${org()}/issues/${encodeURIComponent(id)}/`, { status });
}
