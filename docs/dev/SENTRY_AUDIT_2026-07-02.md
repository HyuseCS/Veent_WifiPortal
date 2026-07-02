# Sentry Integration Audit — 2026-07-02

Scope: the full Sentry surface across the monorepo — the admin `/sentry` module
(transport / facade / mappers / routes / components), both apps' hooks, the shared
`@veent/core/observability` layer, the traced integration factories, the cron
endpoints, and the standalone scripts.

**Verdict:** the implementation is in good shape. Layering is clean (transport →
facade → mappers → route; the route never touches raw payloads) and the security
posture is genuinely solid. The real findings are **coverage gaps** — places where
errors happen but never reach Sentry.

---

## 1. Security review — strong, three nits

### Already right (verified)

- The auth token never leaves `apps/admin/src/lib/server/sentry/client.ts` — it goes
  out only in the Authorization header and is stripped from error messages.
- The browser only ever receives narrowed view models, never raw Sentry payloads.
- The event endpoint (`routes/(app)/sentry/event/+server.ts`) and both mutations
  (`routes/(app)/sentry/+page.server.ts`) re-assert active-staff auth themselves
  (correct — endpoints/actions skip page loads) and are rate-limited.
- Stack traces ship with `cache-control: no-store`.
- Issue ids are `encodeURIComponent`-ed into API paths (no path injection).
- The dev test route (`routes/sentry-test/`) is 404-gated in `load` AND every action.
- PII scrubbing is layered: `sendDefaultPii: false` + `scrubEvent` on both send
  hooks; users identified by id only; cookies/auth headers/request bodies stripped.
- Permalinks open with `noopener noreferrer`.
- A missing DSN fails open — boot never depends on telemetry.

### Nits (priority order)

| # | Finding | Location | Fix size |
|---|---------|----------|----------|
| S1 | `permalink` rendered as `href` with only `str()` coercion. Trusted source (authenticated Sentry API), but a compromised org response could inject a `javascript:` URL into an admin page. | `map.ts:45` | 1 line: `permalink.startsWith('https://') ? permalink : ''` |
| S2 | Read cache is an unbounded `Map` — `event:${id}` keys accumulate; stale entries never evicted (only overwritten or cleared by `invalidate()`). Rate limit bounds growth in practice: slow leak, not a hole. | `client.ts:73` | ~3 lines: size-capped sweep |
| S3 | Any active staff member can resolve/ignore issues. Code comments say this is deliberate — confirming intent only. If triage should be owner-only, the gate is one role check in `mutate()`. | `+page.server.ts:16` | 1 line if wanted |

---

## 2. Implementation improvements

| # | Finding | Location | Notes |
|---|---------|----------|-------|
| I1 | No failure caching / no in-flight dedup. During a Sentry outage every dashboard load waits out two 8s timeouts; concurrent cache misses double-fetch (cache stores resolved data, not the promise). | `client.ts` `cached()` | Cache the in-flight promise instead of the result — ~2 lines, fixes both |
| I2 | Client-side trace sampling hardcoded at `0.2` in both apps' `hooks.client.ts` while servers read `SENTRY_TRACES_SAMPLE_RATE`. Changing prod browser sampling requires a rebuild. Related: admin's client hooks respect `PUBLIC_SENTRY_ENVIRONMENT`, customer's don't. | `apps/{admin,customer}/src/hooks.client.ts` | Add `PUBLIC_SENTRY_TRACES_SAMPLE_RATE` fallback, mirror env handling |
| I3 | No `release` on client inits — server passes `SENTRY_RELEASE`, browsers send nothing. Client errors can't be tied to a deploy; the deferred source-maps work requires this anyway. | `apps/{admin,customer}/src/hooks.client.ts` | Needs a `PUBLIC_` release var (client can't read private env) |
| I4 | MAC scrub regex only matches colon-separated MACs; hyphenated (`AA-BB-…`) and bare 12-hex forms pass unmasked. MikroTik uses colons so exposure is low, but router log lines are where odd formats show up. | `observability.ts:29` | Broaden regex |

---

## 3. Where Sentry can be extended (system-wide)

Ranked by value:

### E1 — Customer grant/bind path (biggest gap)

`apps/customer/src/routes/dashboard/+page.server.ts` has **8 `console.error` catch
sites** — free-time grant failed, auto-bind failed, device bind/unbind failed,
pause/resume failed — plus one in admin's `networks/+page.server.ts:119`
(`applyInterfaceLimit`). These are the core business failures: a router that
silently stops granting access is invisible to Sentry today. The `logger` seam was
built exactly for this — switching each `console.error` to `log.error` is a
mechanical ~9-line change and they all start reporting as handled warnings.

### E2 — Locator app has zero telemetry

`apps/locator` has no hooks files at all. It's a deployed public-facing app; a
crash there is invisible. Mirror the two-file hooks pattern from the other apps
(`sentryOptions`'s `app` union needs `'locator'` added). **Outside `/admin` — needs
explicit go-ahead per project rule.**

### E3 — Sentry Cron Monitors for revoke + reconcile

The cron endpoints themselves are covered (they run inside the customer app), but a
dead scheduler — systemd timer not firing — fails silently and paid time stops
expiring. Sentry check-ins (`Sentry.captureCheckIn` in the cron handlers) detect
"the cron didn't run," which nothing detects today.

### E4 — DB query tracing (known deferred item)

Sentry's `postgresIntegration`, or a `traceMethods`-style wrap at the `createDb`
seam in `@veent/db`, adds query spans next to the existing Maya/MikroTik/Resend
spans and completes the request waterfall.

### E5 — Source maps upload (known deferred item)

Depends on the release wiring from I3.

### Not worth it

Standalone maintenance scripts (`cleanup-stuck-sessions`, `setup-prod`, …) lack
Sentry but are human-run throwaways — instrumenting them adds nothing.

---

## 4. Suggested action plan

**Bundle A — small, high value (~15 lines, all within current scope):**
1. S1 — `permalink` https guard
2. I1 — promise-caching in `client.ts`
3. E1 — the 9 `console.error → log.error` migrations
   (customer dashboard sites are outside `/admin` — flag before touching)

**Bundle B — config consistency (small):**
4. I2 + I3 — client sampling/environment/release env wiring
5. I4 — MAC regex broaden
6. S2 — cache size cap (optional)

**Bundle C — new surfaces (each its own task, needs go-ahead):**
7. E2 — locator hooks
8. E3 — cron check-ins
9. E4/E5 — DB tracing + source maps (previously deferred)

---

*Audit context note: the graphify knowledge graph (`graphify-out/`) is stale — built
from commit `7e8f08fe`, it still references the deleted `SentryVolumeChart` /
`mapVolume`. Consistent with the known `graphify --update` misfire issue; re-build
before relying on it.*
