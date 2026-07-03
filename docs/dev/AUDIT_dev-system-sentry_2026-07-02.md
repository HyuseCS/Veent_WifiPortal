# Audit Report — `dev/system-sentry`

**Date:** 2026-07-02
**Scope:** `origin/main...HEAD` — 134 files, ~11,000 insertions (Sentry observability integration for admin + customer + locator, plus merged `dev/customer` work and load-test tooling).
**Method:** security review (finder agent + independent adversarial verifier) and a multi-agent code review (45 agents; every candidate finding independently verified against the actual code). Every finding was then re-checked against `origin/main` to separate *introduced by this branch* from *pre-existing*. No changes were made as part of this audit.

## Verdict

The branch-introduced code is in good shape: no exploitable vulnerability (no auth bypass, injection, XSS, or token leak), new endpoints are correctly gated, and the merge resolutions are clean. **Two defects are introduced by this branch**, one of which is a real PII-egress gap in the very scrubber the branch built. The audit also **confirmed eight pre-existing bugs** in the payment/network code this branch instruments — several are severe (silent payment loss, a 2FA-enrollment bypass on a PII export) and worth fixing before this observability work ships, since they're exactly the failures it's meant to catch.

---

## A. Introduced by this branch

### A1. PII egress: `scrubEvent` never scrubs `event.spans` — guest MACs ship to Sentry

`packages/core/src/observability.ts:81-108` · **Severity: Medium (security)** · verified true-positive, confidence 8/10

- `scrubEvent` visits `request`, `user`, `message`, `breadcrumbs`, `exception`, `extra`, `contexts` — but not `event.spans` or `event.transaction`. `beforeSendTransaction` routes through the same function (`observability.ts:190`), so transaction events — whose payload *is* the span array — go out unredacted.
- The leak is concretely reachable: tracing is on (1.0 dev / 0.2 prod, `browserTracingIntegration` in `apps/customer/src/hooks.client.ts:16-25`), the customer app threads the device MAC through query strings everywhere (`/login?mac=`, `/top-up?mac=`, Maya success/cancel URLs in `top-up/+page.server.ts:120-121`, `goto('/dashboard'+portalQuery)` in `top-up/processing/+page.svelte:24`), and the installed `@sentry/core@10.62.0` fetch instrumentation sets `http.url`/`http.query` span attributes with the **full query string** on SvelteKit's `__data.json` fetches. Every sampled client navigation in the login → dashboard → top-up loop ships the MAC.
- **Aggravator:** the app percent-encodes the MAC (`AA%3ABB%3A…`), which `MAC_RE` (`observability.ts:31`) doesn't match — so the encoded form would slip through even in the fields that *are* scrubbed.
- **Fix:** scrub `event.spans` (the existing recursive `scrub`/`maskString` handles them once visited), mask `event.transaction`, and handle percent-encoded PII (decode-then-match or add encoded-form patterns). Add a test asserting a MAC in a span's data is masked — current tests (`observability.test.ts`) cover message/extra/request/user only.

### A2. `PHONE_RE` over-masks long numeric runs in Sentry events

`packages/core/src/observability.ts:39` · **Severity: Low (diagnostics quality)** · verified

`/\+?\d[\d ()-]{7,}\d/g` fires on any ≥9-digit run — epoch-ms timestamps, centavo amounts, external numeric IDs — rewriting them to `first3•••last2` in every outbound message/breadcrumb/exception. Errors arrive in Sentry with garbled identifiers, making triage harder. Consider anchoring the pattern (word boundaries + PH phone shapes) or a digit-count ceiling.

---

## B. Pre-existing bugs confirmed at HEAD (not from this branch, but real and verified)

These surfaced because the review's baseline included older history; each was confirmed to exist identically on `origin/main`. Ranked by severity.

### B1. Finance CSV export skips auth + mandatory-2FA gate → full buyer PII

`apps/admin/src/routes/(app)/finance/export/+server.ts:17-18` · **High**

The handler does `event.locals.user!.id` and nothing else. Its own comment claims "(The (app) layout already guarantees an authenticated staff user)" — but layout `load` doesn't run for `+server.ts` requests, which the sibling endpoint `api/router-log/+server.ts:16-20` explicitly documents and guards against (`!user → 401`, `!twoFactorEnabled → 403`). Result: an active staff session that has **not** completed mandatory TOTP enrollment can `GET /finance/export?period=all` and download every buyer's name, email, receipt, and payment history. (Unauthenticated requests crash 500 on the `!` dereference rather than 401 — no data leak, but wrong.) Fix: copy the two guard lines from the sibling endpoints.

### B2. Three silent-payment-loss paths in the payment pipeline

*(This branch only added Sentry captures to these files — the logic pre-dates it.)*

- **Blind-expire locks out late credits** — `packages/core/src/services/reconcilePayments.ts:288-291`: the reconcile cron flips aged `pending` checkouts to `expired` without asking the gateway. When a delayed *paid* webhook later arrives, `creditCheckoutIfUnsettled` sees status ≠ pending, returns `credited:false`, and the webhook acks **200** (logged as "idempotent replay") — Maya stops retrying. Buyer charged, credits never granted, nothing alerts.
- **Unattributed paid events acked 200** — `apps/customer/src/routes/api/webhooks/payment/+server.ts:146`: a verified paid event whose package/checkout/user row is gone (admin deletes package or wipes customers mid-flight) is recorded-not-credited and acked 200 with only a `console.warn`. Directly relevant to this branch: this money-path warn is *not* routed through `captureHandled`, unlike the six paths commit `f9e8bef` covered — worth adding while in here.
- **Dead 23505 collapse → webhook 500 retry loop** — `reconcilePayments.ts:98`: the unique-violation check reads `.code` on the raw error, but drizzle-orm 0.45.x wraps driver errors in `DrizzleQueryError` (SQLSTATE lives on `.cause.code`), so the intended collapse-onto-existing-row never runs and the second insert path throws. On the webhook route that's a 500 → indefinite gateway retries. The unit test masks it by rejecting with a bare `{code: '23505'}` instead of the wrapped shape.

### B3. Network/session lifecycle defects

- **Pause strands live bypasses** — `packages/core/src/services/sessions.ts:538-548, 922`: `pauseAccountAccess` commits the pause, then `unbindAllDevices` may throw on `network.revoke` (uniquely uncaught on this path). The account ends paused with time frozen but router bypasses intact; `expireDueAccounts` skips paused accounts and `reconcileGuestBindings` keeps bindings backed by active rows — unmetered free internet indefinitely.
- **Guest grant consumes admin bypasses** — `packages/core/src/integrations/network/mikrotik.ts:318-323`: `grant()` re-comments any existing ip-binding for the MAC, including a standing `veent-admin` bypass, which the guest lifecycle later revokes. Notably, this branch's own `docs/mikrotik/hotspot-activation.md` documents a variant of this as a known bug.
- **Stale IP→MAC cache misbinds purchases** — `packages/core/src/services/adminAccess.ts:90`: the error path returns cached mappings with no age bound; after DHCP reuse + a router-API timeout, guest B's purchase can grant guest A's MAC, and the wrong MAC is persisted to `last_known_mac`, making it sticky.
- **Zero-minute tier = charged, permanent bypass** — `sessions.ts:87` + the packages form accepting `durationMinutes = 0`: credits are deducted, an active session row and router bypass are created, but no expiry window is set — so no sweeper ever revokes it.
- **Frozen network health** — `mikrotik.ts:553`: `sampleHealth` returns `[]` when no hotspot server is bound, and `refreshNetworkHealth` skips both upsert and prune on empty samples — a dead AP shows "Healthy" forever on the Networks page and public locator.

---

## C. Security checks that passed (branch-introduced surface)

- **`/sentry` dashboard + `/sentry/event` endpoint**: re-assert `locals.user` server-side (closing the layout-guard gap that B1 suffers from), issue IDs are `encodeURIComponent`'d (no SSRF/path injection), rate-limited, `Cache-Control: no-store`, narrowed view models only.
- **`SENTRY_AUTH_TOKEN`**: read only via `$env/dynamic/private` in server-only code, sent only as an Authorization header, never logged or returned; the build-time source-map token stays in `process.env` and maps are deleted post-upload. No DSN tunnel endpoint exists.
- **XSS**: all Sentry issue/event fields render via Svelte auto-escaped interpolation; permalinks guarded to absolute `https://`.
- **MikroTik writes** (walled-garden, `/queue/simple`): parameters go through the RouterOS structured word protocol, not a shell — no injection; caps are owner-gated and range-validated.
- **Auth flows** (reset/forgot password, step-up, 2FA): non-enumerating responses, TOTP still mandatory at sign-in, HTML-escaped email fields, tokens URL-encoded.
- Opening `/sentry` to all active staff is a deliberate, documented privilege change within the trusted 2FA'd boundary.

## D. Notes

- Local `main` is 296 commits behind `origin/main` — worth a `git fetch && git branch -f main origin/main` so future diffs/reviews baseline correctly.
- The review also produced ~20 lower-priority cleanup findings, dominated by cross-app duplication of plumbing (cron auth, rate limiting, Sentry init, loggers, `escapeHtml`) — omitted here as non-bugs.

**Bottom line:** ship-blockers for this branch are A1 (spans PII gap) and arguably A2; B1 and B2 are the highest-value fixes in the surrounding code and are small, well-localized changes.
