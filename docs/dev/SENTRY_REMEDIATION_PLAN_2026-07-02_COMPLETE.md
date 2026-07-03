# Sentry Remediation & Extension Plan

Source audit: `docs/dev/SENTRY_AUDIT_2026-07-02_COMPLETE.md` (findings S1–S3, I1–I4, E1–E5).
Written 2026-07-02. Every step below was verified against the current code — file
paths, line numbers, and quoted snippets reflect the tree as of branch `dev/sentry`
(HEAD `59d2c54`).

Corrections to the audit discovered while drafting this plan:

- The customer dashboard has **7** raw `console.error` sites, not 8 — `buyTier`
  (line 174) already uses `log.error` and reaches Sentry. (The draft prose earlier
  said 6; the actual count migrated was 7 — see the status table below.)
- `apps/customer/src/lib/server/logger.ts` already exists (mirrors admin's, minus
  the `detail` extra) — no logger needs to be created for A3.
- Neither app's `.env.example` documents **any** Sentry variable — added as step B4.
- **S3 is closed**: the user confirmed (2026-07-02) that all-staff resolve/ignore is
  the intended triage model. No role gate will be added.

---

## Implementation status — COMPLETE (implemented + verified 2026-07-02)

All of Phase A, B, and C are implemented on branch `dev/sentry`. **Verification:**
`svelte-check` clean on all three apps (0 errors / 0 warnings), 108 unit tests green
(admin 71, customer 31, locator 6) plus `packages/core` observability 7, and all three
apps build with no Sentry env (0 leaked client source maps). Not yet committed.

| Step | Status | Notes |
|------|--------|-------|
| A1 permalink https guard | ✅ done | `httpsUrl()` in `map.ts`; +tests. Components already gated `{#if permalink}`. |
| A2 promise cache | ✅ done | in-flight dedup + 10s `FAIL_TTL` + 100-entry cap; new `client.test.ts` (4 cases). |
| A3 `console.error` → `log.error` | ✅ done | **7** customer-dashboard sites + 1 admin `networks` (`applyInterfaceLimit`). |
| B1 client sampling + env | ✅ done | `PUBLIC_SENTRY_TRACES_SAMPLE_RATE` (NaN-safe) + customer `PUBLIC_SENTRY_ENVIRONMENT` mirror. |
| B2 client release | ✅ done | `PUBLIC_SENTRY_RELEASE` on both client inits. |
| B3 MAC regex | ✅ done | colon / hyphen / bare-12-hex; +tests in `observability.test.ts`. |
| B4 `.env.example` docs | ✅ done | admin (11 vars incl. server-only) + customer + locator. |
| C1 locator telemetry | ✅ done | `app` union widened; dep added (lockfile +2 lines); two hooks; env doc. |
| C2 cron monitors | ✅ done | `Sentry.withMonitor` on revoke / reconcile / health-refresh, schedule `* * * * *`. |
| C3 DB query tracing | ✅ resolved — **no code** | `postgresJsIntegration` already a default when tracing is on (see §C3). |
| C4 source-maps upload | ✅ done | `sentrySvelteKit` gated on full upload config; token-less builds unchanged. |
| S3 triage perms | ⛔ closed | all-staff confirmed intended; no change. |

**Deviations from the plan as written, discovered during implementation:**

- **A3 count:** the customer dashboard had **7** raw `console.error` catch sites, not 6
  (the plan's own step-A3 table already listed all 7; only the prose said 6). All 7 migrated.
- **C4 source-map leak fix (important):** `filesToDeleteAfterUpload` only runs *after* a
  successful upload, so a token-less build would have generated **and shipped** client `.map`
  files (verified: 47 admin / 18 customer). Fixed by gating the whole `sentrySvelteKit` plugin
  on `SENTRY_AUTH_TOKEN` + `SENTRY_ORG_SLUG` + `SENTRY_PROJECT_ID` all being present, so
  token-less builds generate **no** maps (byte-identical to before C4). Additionally, in the
  installed SDK `filesToDeleteAfterUpload` lives at the **root-level** `sourcemaps` key (the
  `sourceMapsUploadOptions` container is deprecated), and `autoInstrument: false` keeps the
  plugin source-maps-only (no load-function wrapping / runtime change).
- **C4 token hygiene doc:** the distinct build-time `project:releases` token is documented in
  `docs/DEPLOYMENT.md` §4 ("Sentry source maps").

---

## §0 Ground rules — invariants every step MUST preserve

An implementer who is unsure whether a change violates one of these must stop and ask.

1. **Token containment.** `SENTRY_AUTH_TOKEN` never leaves
   `apps/admin/src/lib/server/sentry/client.ts`. It goes out only in the
   `Authorization` header; it is never logged, never included in an error message
   (see the `fail()` helper), never returned to a route, never sent to the browser.
2. **View-model narrowing.** The browser receives only the narrowed shapes produced
   by `apps/admin/src/lib/server/sentry/map.ts` — never raw Sentry payloads.
3. **PII scrub layering.** `sendDefaultPii: false` plus `scrubEvent` on both
   `beforeSend` and `beforeSendTransaction` (in `packages/core/src/observability.ts`)
   must not be weakened. Users are identified by id only.
4. **Fail open.** A missing DSN or missing dashboard credentials must never break
   boot or a page load. Telemetry is always optional at runtime.
5. **Scope.** Files outside `apps/admin/` are touched only where this plan explicitly
   lists them (the plan's approval covers those specific files, nothing more).
6. **One step, one diff.** Each lettered step is independently commitable and
   revertible. Do not batch steps into one commit. Commit only when the user asks.
7. **Tests accompany logic.** Every step that adds a branch or a regex ships its
   unit test in the same diff.

---

## §1 Phase A — small, high value

### A1 — Permalink https guard (audit S1)

**File:** `apps/admin/src/lib/server/sentry/map.ts`

`mapIssue` currently emits `permalink: str(r.permalink)` (line 45). `str()` only
coerces to string, so a compromised/poisoned Sentry API response could put a
`javascript:` URL into an `href` on an admin page.

1. Add a helper next to `str()` (lines 10–12):

   ```ts
   /** Coerce to string, but only pass through absolute https URLs — anything else becomes ''. */
   function httpsUrl(v: unknown): string {
   	const s = str(v);
   	return s.startsWith('https://') ? s : '';
   }
   ```

2. Change line 45: `permalink: str(r.permalink)` → `permalink: httpsUrl(r.permalink)`.
   If `mapEventDetail` also maps a permalink/url field, apply the same helper there.

3. **UI guard:** in `SentryIssuesTable.svelte` and `SentryIssueDialog.svelte`
   (under `apps/admin/src/lib/components/feature/sentry/`), the external permalink
   link must render only when `permalink` is non-empty. If the anchor is not already
   inside an `{#if issue.permalink}` block, add one — an empty-string `href` links to
   the current page, which is a confusing dead control.

4. **Tests** (`map.test.ts`): `permalink: 'javascript:alert(1)'` → `''`;
   `'http://evil.example'` → `''`; a real `'https://…sentry.io/…'` value passes
   through unchanged; missing/non-string permalink → `''`.

**Acceptance:** tests pass; with a normal API response the "Open in Sentry" links
behave exactly as before.

### A2 — Promise cache: in-flight dedup + failure TTL + size cap (audit I1 + S2)

**File:** `apps/admin/src/lib/server/sentry/client.ts` (lines 70–86)

Today `cached()` stores resolved data. Three consequences: concurrent cache misses
double-fetch; a Sentry outage costs two full 8s timeouts on every dashboard load
(failures are never cached); and `event:${id}` keys accumulate in the `Map` forever.

Replace the cache block with an in-flight-promise cache:

```ts
// --- Read cache -------------------------------------------------------------
// Caches the in-flight promise, not the resolved data: concurrent misses share one
// fetch, and failures are remembered briefly (FAIL_TTL) so an outage costs one 8s
// timeout per 10s instead of two per page load. Size-capped so event:${id} keys
// can't accumulate unbounded.
const TTL_MS = 60_000;
const FAIL_TTL_MS = 10_000;
const MAX_ENTRIES = 100;
const cache = new Map<string, { until: number; promise: Promise<unknown> }>();

function cached(key: string, fetcher: () => Promise<unknown>): Promise<unknown> {
	const hit = cache.get(key);
	if (hit && Date.now() < hit.until) return hit.promise;
	if (cache.size >= MAX_ENTRIES) {
		for (const [k, v] of cache) if (Date.now() >= v.until) cache.delete(k);
		while (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value!);
	}
	const promise = fetcher();
	cache.set(key, { until: Date.now() + TTL_MS, promise });
	promise.catch(() => {
		const cur = cache.get(key);
		if (cur?.promise === promise) cache.set(key, { until: Date.now() + FAIL_TTL_MS, promise });
	});
	return promise;
}
```

Notes for the implementer:

- `cached()` is no longer `async` — it returns the shared promise directly. Callers
  (`fetchIssuesRaw`, `fetchLatestEventRaw`) already return its result, so no caller
  changes are needed.
- The `.catch` serves double duty: it shortens the TTL for failed fetches AND
  attaches a rejection handler so an abandoned cached failure never surfaces as an
  unhandled-rejection warning. Do not remove it.
- The identity check (`cur?.promise === promise`) prevents a late-settling old
  promise from clobbering a newer entry after `invalidate()` or re-fetch.
- `invalidate()` stays exactly as is (`cache.clear()`).

**Tests** (new `apps/admin/src/lib/server/sentry/client.test.ts`, mirroring the
vitest setup of `map.test.ts`; stub `Date.now` with `vi.spyOn` / `vi.setSystemTime`):

- Two concurrent `cached('k', fetcher)` calls → `fetcher` invoked once, both get the
  same result.
- A rejecting fetcher: call, advance time past `FAIL_TTL_MS`, call again → fetcher
  invoked twice (failure retried); within `FAIL_TTL_MS` → invoked once.
- A resolving fetcher is NOT re-invoked before `TTL_MS`, and IS after.
- Inserting > `MAX_ENTRIES` distinct keys keeps `cache.size <= MAX_ENTRIES` (verify
  indirectly: oldest key re-fetches, newest doesn't).

*Testability note:* `cached` is module-private. Either export it (plainest), or test
through `fetchLatestEventRaw` with a mocked `fetch`. Exporting is fine — it carries
no credentials.

**Acceptance:** tests pass; `/sentry` loads normally; with `SENTRY_API_BASE` pointed
at a dead address the dashboard shows its degraded state after ~8s once, then
instantly for the next 10s (no stacked timeouts).

### A3 — Route the 7 remaining `console.error` sites to Sentry (audit E1)

The `logger(scope).error(...)` seam already forwards to `captureHandled` (handled
warning, `scope` tag) in BOTH apps. These catch sites predate it and still use raw
`console.error`, so the core business failures — grants, binds, revokes — are
invisible to Sentry.

**File 1:** `apps/customer/src/routes/dashboard/+page.server.ts` *(outside `/admin`
— explicitly approved by this plan)*. `const log = logger('dashboard')` already
exists at line 25. Replace all 6 sites; drop the `[customer]` prefix (the logger's
scope tag already carries it):

| Line | Before | After |
|---|---|---|
| 71 | `console.error('[customer] auto-bind failed:', err);` | `log.error('auto-bind failed:', err);` |
| 135 | `console.error('[customer] startFreeTime grant failed:', err);` | `log.error('startFreeTime grant failed:', err);` |
| 200 | `console.error('[customer] bindThisDevice grant failed:', err);` | `log.error('bindThisDevice grant failed:', err);` |
| 220 | `console.error('[customer] unbindDevice failed:', err);` | `log.error('unbindDevice failed:', err);` |
| 234 | `console.error('[customer] unbindAll failed:', err);` | `log.error('unbindAll failed:', err);` |
| 250 | `console.error('[customer] pauseAccess failed:', err);` | `log.error('pauseAccess failed:', err);` |
| 273 | `console.error('[customer] resumeAccess failed:', err);` | `log.error('resumeAccess failed:', err);` |

Do NOT touch line 99 (`console.warn` for handoff-token generation — warn-level noise,
deliberately not escalated) or line 174 (`buyTier`, already `log.error`).

**File 2:** `apps/admin/src/routes/(app)/networks/+page.server.ts` (line 119). Add at
module scope if not present:

```ts
import { logger } from '$lib/server/logger';
const log = logger('networks');
```

then `console.error('[admin] applyInterfaceLimit failed:', err);` →
`log.error('applyInterfaceLimit failed:', err);`.

**Must not change:** the user-facing `fail(...)` responses in every catch block stay
byte-identical. This step only adds telemetry.

**Acceptance:** `bun run check` clean in both apps; hitting one failure path in dev
(e.g. stop the MikroTik mock and trigger a bind) produces a console line AND a
Sentry handled-warning event tagged `scope: dashboard`.

---

## §2 Phase B — config consistency

### B1 — Client trace sampling + environment from env (audit I2)

**Files:** `apps/admin/src/hooks.client.ts`, `apps/customer/src/hooks.client.ts`

Both currently hardcode `tracesSampleRate: dev ? 1.0 : 0.2` (line 18) while the
server hooks read `SENTRY_TRACES_SAMPLE_RATE`. Changing production browser sampling
should not require a rebuild of intent — only an env change.

In **both** files, above the `Sentry.init` call:

```ts
const rate = Number(env.PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? '0.2');
```

and in the `sentryOptions({...})` input:

```ts
tracesSampleRate: dev ? 1.0 : Number.isFinite(rate) ? rate : 0.2
```

The `Number.isFinite` guard matters: `Number('abc')` is `NaN`, and a garbage env
value must degrade to the current default, not disable/break tracing.

**Customer only** (line 17): mirror admin's environment handling —
`environment: dev ? 'development' : 'production'` →
`environment: env.PUBLIC_SENTRY_ENVIRONMENT ?? (dev ? 'development' : 'production')`.
(`env` here is `$env/dynamic/public`, same import both files already use for the DSN.)

### B2 — Client `release` (audit I3)

**Files:** same two `hooks.client.ts`

The server inits pass `release: priv.SENTRY_RELEASE`; the browser inits pass nothing,
so client errors can't be tied to a deploy — and the deferred source-maps work (C4)
requires a client release. Clients can't read private env, so this needs a `PUBLIC_`
var. Add to both `sentryOptions({...})` inputs:

```ts
release: env.PUBLIC_SENTRY_RELEASE
```

`undefined` is fine — behavior is identical to today when the var is unset. At deploy
time, set `PUBLIC_SENTRY_RELEASE` and `SENTRY_RELEASE` to the same value (e.g. the
git SHA) so client and server events land in one release.

### B3 — Broaden the MAC scrub regex (audit I4)

**File:** `packages/core/src/observability.ts` (line 29)

Current pattern only matches colon-separated MACs; hyphenated (`AA-BB-CC-DD-EE-FF`)
and bare 12-hex (`AABBCCDDEEFF`) forms pass unmasked. MikroTik emits colons, but
router log lines are exactly where odd formats appear.

```ts
const MAC_RE = /\b(?:[0-9A-Fa-f]{2}([:-])(?:[0-9A-Fa-f]{2}\1){4}[0-9A-Fa-f]{2}|[0-9A-Fa-f]{12})\b/g;
```

The backreference `\1` forces a consistent separator (rejects mixed `AA:BB-CC…`).
Update the replacement in `maskString` so each form keeps only its vendor prefix
(3 octets):

```ts
.replace(MAC_RE, (m) => `${m.slice(0, m.includes(':') || m.includes('-') ? 8 : 6)}•••`)
```

Over-masking an unrelated 12-hex token is an accepted trade-off — a scrubber should
err toward redaction.

**Tests** (extend the existing observability tests in `packages/core`, or create
`observability.test.ts` beside the source if none cover `maskString`):
`AA:BB:CC:DD:EE:FF` → `AA:BB:CC•••`; `AA-BB-CC-DD-EE-FF` → `AA-BB-CC•••`;
`AABBCCDDEEFF` → `AABBCC•••`; 11-hex and 13-hex strings unchanged; mixed-separator
`AA:BB-CC:DD-EE:FF` unchanged; existing email/phone cases still pass.

### B4 — Document every Sentry env var in `.env.example`

Discovered while drafting: neither example file mentions Sentry at all, yet the
hooks and the admin dashboard read eleven different vars. Docs-only step.

**`apps/admin/.env.example`** — add a Sentry block:

```dotenv
# --- Sentry (all optional — leave unset to disable telemetry) ---
# Error/trace ingestion (browser + server). From Sentry: Settings → Client Keys.
PUBLIC_SENTRY_DSN=""
# Environment tag; server may override with SENTRY_ENVIRONMENT. Defaults: development/production.
PUBLIC_SENTRY_ENVIRONMENT=""
SENTRY_ENVIRONMENT=""
# Browser/server trace sampling in production (0–1). Default 0.2.
PUBLIC_SENTRY_TRACES_SAMPLE_RATE=""
SENTRY_TRACES_SAMPLE_RATE=""
# Deploy identifier (e.g. git SHA) — set BOTH to the same value.
PUBLIC_SENTRY_RELEASE=""
SENTRY_RELEASE=""
# /sentry dashboard API access. SERVER-ONLY SECRET — never expose or log.
# Token scopes: event:read + event:write + org:read.
SENTRY_AUTH_TOKEN=""
SENTRY_ORG_SLUG=""
SENTRY_PROJECT_ID=""
# API region base; default https://de.sentry.io/api/0 (org is in the DE region).
# SENTRY_API_BASE=""
```

**`apps/customer/.env.example`** — same block minus the four dashboard vars
(`SENTRY_AUTH_TOKEN`, `SENTRY_ORG_SLUG`, `SENTRY_PROJECT_ID`, `SENTRY_API_BASE`) —
the customer app only ingests, it has no Sentry-API dashboard.

---

## §3 Phase C — new surfaces

Each C-step needs its own explicit go-ahead at execution time; they touch new apps
or build tooling. They are independent of each other except C4 → depends on B2.

### C1 — Locator app telemetry (audit E2) *(outside `/admin`)*

`apps/locator` is a deployed public-facing app with zero telemetry — no hooks files,
no Sentry dependency, not even `@veent/core` in its `package.json` (though its vite
`ssr.noExternal` already lists it).

1. `packages/core/src/observability.ts` line 167: widen the union —
   `app: 'admin' | 'customer'` → `app: 'admin' | 'customer' | 'locator'`.
2. `apps/locator/package.json`: add `"@sentry/sveltekit": "^10.62.0"` and
   `"@veent/core": "workspace:*"` (match the exact workspace-protocol form the other
   apps use), then refresh the lockfile (`bun install`).
3. New `apps/locator/src/hooks.client.ts` and `hooks.server.ts`, copied from the
   customer app's pattern with three deltas: `app: 'locator'`; **no**
   better-auth handle (server: `export const handle = Sentry.sentryHandle();`, or
   `sequence(...)` around any existing handles — locator currently has none); **no**
   `Sentry.setUser` (locator has no auth). Keep: fail-open on missing DSN, `!building`
   guard, `handleError = Sentry.handleErrorWithSentry()`, the same env-var reads as
   B1/B2 established.
4. `apps/locator/.env.example`: append the customer-shaped Sentry block from B4.
   Reusing the same DSN as the other apps is fine — the `app: 'locator'` tag
   separates the streams.

**Acceptance:** `bun run --filter veent-locator build` succeeds; with a DSN set in
dev, throwing inside `+page.server.ts` produces a Sentry event tagged
`app: locator`; with no DSN the app boots exactly as today.

### C2 — Sentry Cron Monitors for the scheduled jobs (audit E3)

The cron *endpoints* are already Sentry-covered (they run inside the apps); a dead
*scheduler* — the systemd timer that pokes them — fails silently, and paid time
stops expiring. Check-ins detect "the job didn't run", which nothing detects today.

Wrap each handler body **after** `requireCron(event)` — an unauthorized probe must
never produce a check-in:

```ts
export const POST: RequestHandler = async (event) => {
	requireCron(event);
	return await Sentry.withMonitor(
		'customer-network-revoke',
		async () => {
			/* existing body, unchanged */
		},
		{
			schedule: { type: 'crontab', value: '* * * * *' },
			checkinMargin: 5, // minutes late before "missed" alert
			maxRuntime: 5,
			timezone: 'UTC'
		}
	);
};
```

Targets and slugs:

| Route | Slug |
|---|---|
| `apps/customer/src/routes/api/network/revoke/+server.ts` | `customer-network-revoke` |
| `apps/customer/src/routes/api/payments/reconcile/+server.ts` | `customer-payments-reconcile` |
| admin `POST /api/network/health/refresh` (verify exact route path in the tree first) | `admin-network-health-refresh` |

Implementer notes:

- `import * as Sentry from '@sentry/sveltekit';` — `withMonitor` is a safe no-op when
  the SDK was never initialized, so the fail-open invariant holds.
- The `crontab` value MUST match the real production cadence — confirm against
  `docs/DEPLOYMENT.md` / the systemd timer units before setting; `* * * * *` assumes
  every-minute. A wrong value causes false "missed check-in" alerts.
- A thrown error inside the callback marks the check-in failed AND still bubbles to
  `handleError` — do not add a swallowing try/catch.
- Errors from `requireCron` (401/403) intentionally happen outside the monitor.
- In Sentry, `upsert` from these configs creates the monitors on first check-in; set
  alert rules on "missed" in the Sentry UI afterwards.

**Acceptance:** `curl -X POST -H "x-cron-secret: …"` against each endpoint → Sentry
Crons UI shows an `ok` check-in; stopping the dev cron for > checkinMargin flags the
monitor missed. Without a DSN, endpoints behave exactly as today.

### C3 — DB query tracing (audit E4) — investigate, then implement

Goal: query spans in the same transaction waterfall as the existing
`payment.maya.*` / `network.mikrotik.*` / `email.resend.*` spans.

**RESOLVED 2026-07-02 — no code change needed.** Verified against the installed
`@sentry/node@10.62.0` (bundled by `@sentry/sveltekit`): `postgresJsIntegration()` is
part of `getAutoPerformanceIntegrations()`, and `getDefaultIntegrations(options)`
spreads that set in whenever `hasSpansEnabled(options)` is true. Both server hooks
init with `tracesSampleRate > 0`, so **postgres.js query spans are already emitted by
default** — adding the integration explicitly would be redundant. `@sentry/sveltekit`
also re-exports `postgresJsIntegration`, so the explicit form remains available if
needed. Caveat: OpenTelemetry patching depends on load order under Bun/adapter-node;
if a live trace ever shows postgres.js spans missing, apply the step-3 fallback below.
The steps 1–3 below are retained as the original decision record.

1. **Investigate first:** with tracing on in dev, open a DB-heavy admin page and
   check the transaction in Sentry. Sentry's Node auto-instrumentation may already
   emit `postgres` (postgres.js) spans. If spans are present → step done; record that
   in this file.
2. Else add the explicit integration to **both** server hooks' `Sentry.init`:
   `integrations: [Sentry.postgresJsIntegration()]` (verify the exact export name
   against the installed `@sentry/sveltekit@10.x` — consult its docs; do not guess).
3. **Fallback only** (if the SDK can't instrument postgres.js under Bun): a
   drizzle-`logger` → `startSpan` bridge at the `createDb` seam
   (`packages/db/src/client.ts:18-22`), passed in from the apps. Constraint: do NOT
   add any `@sentry/*` dependency to `packages/db` — inject the hook from the app
   layer, mirroring how `traceMethods` wraps the integration factories.

**Acceptance:** a dashboard-load transaction shows `db` spans with statement
summaries (postgres.js integration parameterizes statements — verify no literal
values/PII appear in span descriptions; if they do, scrub or abort the step).

### C4 — Source maps upload (audit E5) — depends on B2

**Files:** `apps/admin/vite.config.ts`, `apps/customer/vite.config.ts`

1. In both, add before `sveltekit()` in `plugins`:

   ```ts
   import { sentrySvelteKit } from '@sentry/sveltekit';
   // …
   plugins: [
   	sentrySvelteKit({
   		sourceMapsUploadOptions: {
   			org: process.env.SENTRY_ORG_SLUG,
   			project: process.env.SENTRY_PROJECT_ID,
   			filesToDeleteAfterUpload: ['./build/**/*.map', '.svelte-kit/**/*.map']
   		}
   	}),
   	tailwindcss(),
   	sveltekit({ /* existing inline config unchanged */ })
   ],
   ```

2. **Token hygiene (critical):** the upload plugin reads `SENTRY_AUTH_TOKEN` from the
   *build* environment and needs `project:releases` scope. That is a **different
   token** from the runtime dashboard one (event:read/write + org:read). Create a
   dedicated releases-scoped token, provide it only in the build/CI environment,
   never in the runtime `.env`, never committed. Because both tokens use the same
   env name, document in `docs/DEPLOYMENT.md` that build-time and runtime
   `SENTRY_AUTH_TOKEN` are distinct credentials.
3. `filesToDeleteAfterUpload` is mandatory — generated maps must never be served to
   clients.
4. Builds without the token must still succeed (the plugin warns and skips upload) —
   verify `bun run build` with no Sentry env at all stays green.

**Acceptance:** a production build with token + `PUBLIC_SENTRY_RELEASE`/`SENTRY_RELEASE`
set uploads maps (visible under the release in Sentry); a client error's stack trace
in Sentry shows original Svelte/TS source; `find build -name '*.map'` is empty.

---

## §4 Verification

Per step: the unit tests listed in that step, plus `bun run check` (svelte-check) and
`bun test` in every touched app/package.

**Phase A behavioral pass:**

1. `/sentry` dashboard loads with real credentials; KPI row, table, sparklines render.
2. Issue dialog opens (event endpoint), resolve/ignore round-trips and the list
   refreshes (cache `invalidate()` still effective after A2).
3. Outage simulation: set `SENTRY_API_BASE` to an unroutable address → dashboard
   shows its degraded state after one ~8s timeout, and repeat loads inside 10s fail
   fast (A2's failure TTL working).
4. One E1 path exercised in dev produces both the console line and the Sentry
   handled-warning event.

**Phase B:** with the new env vars unset, client bundles behave byte-identically to
today (defaults preserved); with `PUBLIC_SENTRY_TRACES_SAMPLE_RATE=0` set, no
browser transactions are sent.

**Phase C:** acceptance criteria inline in each step above.

**Final regression gate (user's standing preference):** any step that changes what
renders in a browser (A1's UI guard, the dashboard after A2) gets BOTH an agent
browser pass (Playwright) AND a human verification handoff checklist before being
called done.

---

## §5 Rollback

Every step is one small isolated diff → `git revert <that step's commit>`. All new
env vars have code-side fallbacks reproducing today's behavior, so unsetting them is
also a rollback. C4 is additionally reversible by removing the vite plugin block
(uploads simply stop).

---

## Closed / rejected items

- **S3 (triage permissions):** all-staff resolve/ignore confirmed as intended by the
  user on 2026-07-02. No role gate.
- **Standalone maintenance scripts** (`cleanup-stuck-sessions`, `setup-prod`, …):
  human-run throwaways; instrumenting them adds nothing.

## File index (everything the full plan touches)

| Phase | Files |
|---|---|
| A | `apps/admin/src/lib/server/sentry/map.ts` (+`map.test.ts`), `apps/admin/src/lib/server/sentry/client.ts` (+new `client.test.ts`), `apps/admin/src/lib/components/feature/sentry/SentryIssuesTable.svelte` + `SentryIssueDialog.svelte` (guard only if missing), `apps/customer/src/routes/dashboard/+page.server.ts`, `apps/admin/src/routes/(app)/networks/+page.server.ts` |
| B | `apps/admin/src/hooks.client.ts`, `apps/customer/src/hooks.client.ts`, `packages/core/src/observability.ts` (+tests), `apps/admin/.env.example`, `apps/customer/.env.example` |
| C | `packages/core/src/observability.ts` (app union), `apps/locator/package.json` + new `src/hooks.{client,server}.ts` + `.env.example`, `apps/customer/src/routes/api/network/revoke/+server.ts`, `apps/customer/src/routes/api/payments/reconcile/+server.ts`, admin health-refresh route, `apps/admin/vite.config.ts`, `apps/customer/vite.config.ts`, `docs/DEPLOYMENT.md` (token-hygiene note) |
