---
name: plan:sentry-issueid-provenance
description: "M4d — verify sentryIssueId against the Sentry API before persisting a Tracked-from-Sentry incident"
date: 20-07-26
feature: incident-management
---

# Sentry issueId Provenance Check (M4d) — Plan

**Date**: 20-07-26
**Status**: DRAFT
**Complexity**: SIMPLE

## Overview

`?/track` in `apps/admin/src/routes/(app)/sentry/+page.server.ts` currently format-checks
`sentryIssueId` (`/^\d{1,32}$/`) but never confirms the id is a real Sentry issue belonging to the
configured org/project. A staff member with `?/track` access could submit a well-formed but
fabricated numeric id plus arbitrary title/permalink and create an incident that displays as
"Tracked from Sentry" without being Sentry-sourced. This closes that gap with a server-side
round-trip to the Sentry API.

**SPEC / INNOVATE skip note:** SPEC and INNOVATE were deliberately skipped for this plan. The
backlog note `process/features/incident-management/backlog/sentry-issue-id-provenance-check_NOTE_10-07-26.md`
serves as the requirements doc (problem, root cause, fix options already enumerated there). The one
real design fork — what to do when the Sentry API can't confirm the id — was resolved by explicit
user decision this session (see Locked Design Decision below), not by an INNOVATE session. The
remaining work is mechanical: wire an existing client function into an existing form action.

## Locked Design Decision (user-approved — do not re-litigate)

When the Sentry API cannot confirm the issue id:

- **Sentry IS configured but the lookup fails** (unreachable / timeout / 5xx / 404 / org mismatch)
  → `fail()` with a clear message. Nothing is persisted. **Fail-closed.**
- **Sentry is NOT configured at all** (`isSentryConfigured() === false`) → skip the provenance
  check entirely and track as today. Preserves existing, deliberate behavior asserted by
  `apps/admin/e2e/incident-sentry.e2e.ts`, which must remain green **without modification**.

Rationale: matches the repo's fail-closed-on-the-request precedent (Maya payment re-fetch,
MikroTik `withTimeout`), while the unconfigured escape hatch keeps unconfigured deploys and the
existing e2e harness working.

## Goals

1. `?/track` rejects a `sentryIssueId` that does not resolve to a real issue in the configured
   Sentry org (nonexistent id, or an id belonging to a different org) — nothing is persisted.
2. `?/track` fails closed (rejects, persists nothing) when Sentry is configured but the provenance
   lookup itself errors (timeout, 5xx, network failure).
3. When Sentry is not configured at all, `?/track`'s behavior is unchanged (skip the check,
   preserving `incident-sentry.e2e.ts` as-is).
4. The happy path (`?/track` with a real, verifiable issue id) is unchanged in outcome and adds
   at most one bounded (8s timeout, cached) Sentry API call.

## Non-Goals

- No schema changes, no new migration.
- No new env vars — reuse `SENTRY_AUTH_TOKEN` / `SENTRY_ORG_SLUG` / `SENTRY_PROJECT_ID` /
  `SENTRY_API_BASE` already validated by `isSentryConfigured()`.
- No new rate-limit scope unless justified (see Design Notes — Rate Limiting below; default is to
  reuse `admin_sentry_track`).
- No change to `apps/admin/e2e/incident-sentry.e2e.ts`.
- No change to `map.ts` (`validateSentrySnapshot`) — it stays pure (no env, no I/O). The
  provenance call does not belong there.

## Design Notes

### Reuse `fetchLatestEventRaw`, do not add a new endpoint

`apps/admin/src/lib/server/sentry/client.ts:134-138` already exports:

```ts
export function fetchLatestEventRaw(id: string): Promise<unknown> {
  return cached(`event:${id}`, () =>
    sentryGet(`/organizations/${org()}/issues/${encodeURIComponent(id)}/events/latest/`, {})
  );
}
```

This call is **org-scoped** (`/organizations/${org()}/issues/${id}/events/latest/`) — Sentry 404s
it both for a fabricated id and for a real id that belongs to a different org, which is exactly the
provenance signal needed (id exists AND belongs to configured org). It already inherits:

- the 8s `fetchWithTimeout` bound (`client.ts:14,33-41`) — no new timeout code needed
- the `cached()` read cache (`client.ts:82-104`, 60s success / 10s failure TTL, 100-entry cap,
  string-keyed by `event:${id}`) — repeat `?/track` submissions for the same id (e.g. retry after a
  transient failure, or two staff racing the same issue) don't double-hit Sentry
- the shared `fail()` error shape (`client.ts:48-51`) — message carries method+path+status+truncated
  body, never the token

**Decision: no new `GET /issues/{id}/` endpoint.** `fetchLatestEventRaw` already gives an
org-scoped existence+ownership check with a single call; adding a second endpoint (e.g.
`/organizations/{org}/issues/{id}/`) would duplicate this signal for no added confidence and cost
an extra round-trip. If a future need arises for issue metadata beyond existence (status, assignee,
etc.), that is out of scope here.

**Note on the cache and duplicate-detection race:** if the DB unique-index guard
(`23505` → `fail(409)`, already handled in `?/track`) fires AFTER the provenance check passes,
behavior is unchanged — the provenance check runs strictly before the `createIssueFromSentry` DB
call, and a 409 from a genuinely-tracked duplicate is orthogonal to provenance.

### Placement in `?/track`

Insert the check in `apps/admin/src/routes/(app)/sentry/+page.server.ts`, inside the `track:`
action, **after** `validateSentrySnapshot()` succeeds (~line 100, format is already known-good) and
**before** `createIssueFromSentry(...)` (~line 123, the DB transaction). This guarantees a failed
provenance check persists nothing — no partial state, no cleanup needed.

```
... snapshot = validateSentrySnapshot(...)      [existing, ~L94-101]
    ↓ (format OK)
NEW: if (isSentryConfigured()) {                [new provenance gate]
       try { await fetchLatestEventRaw(sentryIssueId) }
       catch { return fail(502, ...) }          [fail-closed — configured + lookup failed]
     }
     // else: Sentry not configured → skip check, track as today
... title / description / priority / due-date validation [existing, unchanged order]
... createIssueFromSentry(...)                  [existing, ~L122-128]
```

Note: `fetchLatestEventRaw` throws (via `fail()` in `client.ts:48-51`) on any non-2xx response,
including 404 (nonexistent id) and org-mismatch 404 — a single `try/catch` handles "id doesn't
exist," "id belongs to another org," AND "lookup errored" identically (all are fail-closed
rejections). This is intentional: from the caller's perspective, "the id resolves in the configured
org" is a single boolean outcome (resolved vs not), not three distinct branches.

**Placement relative to other validation:** run the provenance check as early as possible once the
id is known-format-valid, before spending effort validating title/description/priority/due-date —
this avoids doing unnecessary work for a fabricated id and matches "reject early, persist late."

### Rate limiting — reuse `admin_sentry_track`, no new scope

`admin_sentry_track` (30 requests / 15 min per user, `page.server.ts:84`) already gates every
`?/track` submission before the provenance check would run. Since the new Sentry API call only
happens on submissions that already passed this gate, it is already volume-bounded — a malicious or
buggy client cannot exceed 30 provenance-check attempts per 15 minutes per user. A separate
`admin_sentry_verify` rate-limit scope would add complexity (a second `consumeRateLimit` call, a
second Postgres row) for no additional protection, since it would be strictly bounded by the same
ceiling. **Decision: no new rate-limit scope — reuse the existing `admin_sentry_track` consumption.**

### Error message

On provenance failure (both "not found/org mismatch" and "lookup errored"), return:
`fail(502, { action: 'track', error: 'Could not verify this Sentry issue. Try again.' })` — mirrors
the existing `mutate()` helper's error shape (`page.server.ts:53-56`) for the same "Sentry request
failed" class, and gives no information distinguishing "doesn't exist" from "network blip" (avoids
leaking whether an id exists in a different org).

## Touchpoints

| File | Change |
|---|---|
| `apps/admin/src/routes/(app)/sentry/+page.server.ts` | Add provenance check inside `track:` action, after `validateSentrySnapshot()`, before `createIssueFromSentry(...)`. Import `fetchLatestEventRaw` from `$lib/server/sentry`. |
| `apps/admin/src/lib/server/sentry/index.ts` (or wherever the barrel re-exports live — confirm exact path during EXECUTE; `page.server.ts:9` already imports `isSentryConfigured` etc. from `$lib/server/sentry`) | Add `fetchLatestEventRaw` to the barrel export if not already exported there (client.ts already exports it directly; confirm barrel re-export exists before EXECUTE — read the barrel file first). |
| `apps/admin/src/routes/(app)/sentry/+page.server.test.ts` (NEW) | Unit tests for the new provenance branch — see Verification Evidence. |
| `apps/admin/src/lib/server/sentry/client.test.ts` (EXTEND) | Add `fetch` mock coverage for `fetchLatestEventRaw` if the unit tests are more naturally placed here instead of/alongside the page.server test — decide during EXECUTE based on which file can most cleanly mock `fetch` vs mock the client module. Both options are acceptable; prefer whichever avoids re-mocking `$app/*`/SvelteKit internals unnecessarily. |

No other files are touched. No schema, no migration, no new env var.

## Public Contracts

- `?/track` form action: request/response shape unchanged (same fields in, same `fail()`/success
  shape out) — only a new failure mode is added (`fail(502, ...)` for provenance failure), reusing
  the exact shape already used by `mutate()` for Sentry-request failures.
- `fetchLatestEventRaw(id: string): Promise<unknown>` — existing exported function, reused as-is,
  zero signature change.
- No new exported functions with new public contracts. If a new `apps/admin/src/lib/server/sentry/index.ts` export is added (barrel re-export of `fetchLatestEventRaw`), this is an internal
  server-only surface (`$lib/server/**`), not a public API — no external contract impact.

## Blast Radius

- **Risk class:** trust-boundary / provenance-integrity (server-side gate against fabricated
  incident creation) — treat with the same rigor as auth/billing surfaces per repo convention.
- **Files touched:** 1 modified route file (`+page.server.ts`), possibly 1 barrel file (index.ts,
  read-only-likely — export may already exist), 1 new test file, 1 possibly-extended test file.
  **Total: 2-4 files, all within `apps/admin/src/lib/server/sentry/` + `apps/admin/src/routes/(app)/sentry/`.**
- **Packages touched:** `apps/admin` only. No `@veent/core`, no `@veent/db`, no other app.
- **External calls added:** one additional Sentry API call (`GET /organizations/{org}/issues/{id}/events/latest/`) per `?/track` submission when Sentry is configured — already rate-limited, already timeout-bounded, already cached.
- **Behavioral risk:** if the provenance check has a bug that rejects valid ids, staff cannot track
  legitimate Sentry-sourced incidents (availability regression, not a security regression) — this
  is why the fully-automated + hybrid test tiers below explicitly cover the happy path.
- **e2e regression risk:** `apps/admin/e2e/incident-sentry.e2e.ts` MUST remain green unmodified —
  this is the acceptance criterion that proves the unconfigured-Sentry escape hatch is correctly
  wired (see Verification Evidence).

## Implementation Checklist

1. Read `apps/admin/src/lib/server/sentry/index.ts` (or equivalent barrel) to confirm whether
   `fetchLatestEventRaw` is already re-exported alongside `isSentryConfigured`, `getDashboard`,
   `resolveIssue`, `ignoreIssue`. If not exported, add it to the barrel's export list (one line).
   **[VALIDATE confirmed 20-07-26: NOT currently re-exported — `index.ts` only imports it
   internally for `getIssueEvent`. This step is required, not optional. Add
   `fetchLatestEventRaw` to the existing `export { isSentryConfigured, SENTRY_CREDENTIAL_KEYS };`
   line.]**
2. In `apps/admin/src/routes/(app)/sentry/+page.server.ts`:
   a. Add `fetchLatestEventRaw` to the existing `$lib/server/sentry` import on line 9.
   b. Inside `track:` action, immediately after the `snapshot` destructure (~line 101) and before
      the `title` validation (~line 103), insert the provenance gate:
      ```ts
      if (isSentryConfigured()) {
        try {
          await fetchLatestEventRaw(sentryIssueId);
        } catch (err) {
          log.error('track provenance check failed', err);
          return fail(502, { action: 'track', error: 'Could not verify this Sentry issue. Try again.' });
        }
      }
      ```
   c. Confirm `isSentryConfigured` is already imported (it is, line 9) — no new import needed for
      that symbol.
3. Write unit tests (new file `apps/admin/src/routes/(app)/sentry/+page.server.test.ts` OR extend
   `client.test.ts`, per the Touchpoints decision) covering the 5 scenarios in Verification
   Evidence below. Build a `fetch` mock helper if one does not already exist for this module — check
   `client.test.ts` first (currently only mocks `Date.now`, not `fetch`) before writing a new one.
   **[VALIDATE instruction, see Execute-Agent Instructions E1 below: prefer mocking the
   `$lib/server/sentry` facade module directly in the new `+page.server.test.ts`, not raw
   `fetch`/`$env/dynamic/private` — this is the first action-level unit test and the first
   `$env/dynamic/private` mock anywhere in the repo (confirmed 20-07-26: zero existing precedent
   repo-wide); budget it as a new test file, not a one-line extension.]**
4. Run `bunx vitest run apps/admin/src/routes/\(app\)/sentry/+page.server.test.ts` (or the actual
   path chosen) — confirm all new unit tests pass. Use `bunx vitest run <file>`, never
   `bun test <file>` (silently no-ops `vi.setSystemTime` / mocks — see repo test gotcha).
5. Run `cd apps/admin && bun run check` (svelte-check/typecheck) — confirm no type errors from the
   new import/branch.
6. Run `cd apps/admin && bunx vitest run` (full admin unit suite) — confirm no regression in
   existing tests, especially `client.test.ts` (cache behavior unaffected) and any existing
   `map.test.ts` (`validateSentrySnapshot` unaffected, since provenance check runs after it).
7. Run `cd apps/admin && bun run test:e2e -- incident-sentry` (or the project's exact e2e invocation
   for that spec) against a throwaway env with Sentry UNCONFIGURED — confirm
   `apps/admin/e2e/incident-sentry.e2e.ts` is green WITHOUT modification (proves the unconfigured
   escape hatch preserves existing behavior). This is an acceptance criterion, not optional.
8. (Manual/agent-probe, only if a live Sentry sandbox with `SENTRY_AUTH_TOKEN` is available) Verify
   the happy path and the rejection path against a real Sentry org — track a real recent issue id
   (succeeds), then attempt to track a fabricated id (rejects with 502). If no live sandbox is
   available in this environment, document as a known-gap and rely on the mocked-fetch unit tests
   for that behavior instead.

## Verification Evidence

| Gate / Scenario | Strategy | Proves SPEC criterion |
|---|---|---|
| Lookup rejects a nonexistent id (`fetchLatestEventRaw` mock rejects with a 404-shaped error) → `?/track` returns `fail(502, ...)`, `createIssueFromSentry` never called | Fully-Automated (`bunx vitest run`, mocked `fetch`) | Goal 1 |
| Lookup rejects an org-mismatch id (mock rejects, simulating a real id in a different Sentry org) → `?/track` returns `fail(502, ...)`, nothing persisted | Fully-Automated (`bunx vitest run`, mocked `fetch`) | Goal 1 |
| Lookup times out / 5xx / network error while Sentry IS configured → `?/track` fails closed (`fail(502, ...)`), nothing persisted | Fully-Automated (`bunx vitest run`, mocked `fetch` rejecting/throwing) | Goal 2 |
| Sentry NOT configured (`isSentryConfigured()` mocked `false`) → provenance check skipped, `?/track` proceeds to existing behavior unchanged | Fully-Automated (`bunx vitest run`, mocked `isSentryConfigured`) | Goal 3 |
| Happy path: lookup resolves successfully → `?/track` proceeds to `createIssueFromSentry` as before, incident created | Fully-Automated (`bunx vitest run`, mocked `fetch` resolving) | Goal 4 |
| `apps/admin/e2e/incident-sentry.e2e.ts` remains green, unmodified, against unconfigured-Sentry throwaway env | Hybrid (`bun run test:e2e` — throwaway DB + real Chromium, precondition: Sentry env vars unset) | Goal 3 (regression proof) |
| Full admin unit suite has no regression (`client.test.ts`, `map.test.ts`, etc.) | Fully-Automated (`bunx vitest run` full admin suite) | Goals 1-4 (no side-effect regression) |
| Typecheck passes with new import/branch | Fully-Automated (`bun run check`) | Implementation correctness (non-functional) |
| Live-Sentry happy-path + rejection-path smoke, if sandbox available | Agent-Probe (manual, conditional on live `SENTRY_AUTH_TOKEN` sandbox access) | Goal 1 + Goal 4 (real-world confidence, not required for gate PASS) |

**High-risk class table (trust-boundary/provenance surface):**

| Area | High-risk class | Minimum tier | Gap rationale if known-gap accepted |
|---|---|---|---|
| Sentry issueId provenance gate in `?/track` | trust-boundary / provenance-integrity | Hybrid (via the e2e regression proof) — met | — |

## Missing Test Areas

| Area | Why untestable in this plan | Resolution chosen |
|---|---|---|
| Live Sentry API behavior (real 404 shape, real org-mismatch 404 shape) beyond the mocked-`fetch` unit tests | Requires a live `SENTRY_AUTH_TOKEN` + real org access; not guaranteed available in every dev/CI environment | Agent-Probe (checklist step 8), conditional; falls back to known-gap if no sandbox — the mocked unit tests already cover the code path faithfully since `fetchLatestEventRaw` throws identically for 404 and org-mismatch (both are non-2xx → `fail()`) |

## Test Infra Improvement Notes

(none identified yet — a `fetch` mock helper for `apps/admin/src/lib/server/sentry/` may be worth
extracting to a shared test util if a second Sentry-client-calling surface needs the same mock
shape in the future; defer that extraction until it's actually needed twice)

## Dependencies / Risks / Integration Notes

- **Dependency:** none new — reuses `fetchLatestEventRaw`, `isSentryConfigured`, existing rate
  limiter, existing `fail()` shape.
- **Risk:** false-positive rejection (valid id rejected) would block legitimate tracking — mitigated
  by the happy-path unit test (Goal 4 row) and the fact that `fetchLatestEventRaw` is already
  proven-reliable (used by the existing issue-detail view).
- **Risk:** Sentry API latency adds to `?/track` response time — bounded by the existing 8s
  `fetchWithTimeout`; acceptable since `?/track` is already a synchronous form-action round trip and
  users expect a brief wait on submit.
- **Integration note:** the `cached()` read cache means a retried `?/track` submission for the same
  id within 60s of a successful lookup won't re-hit Sentry — fine, since the goal is confirming
  existence/ownership, which doesn't change within that window; a retried submission after a
  *failed* lookup re-hits Sentry after only 10s (FAIL_TTL), which is appropriate for retry UX.
- **Risk (VALIDATE finding, accepted as known-gap — see validate-contract Execute-Agent
  Instruction E2):** `fetchLatestEventRaw` proves "issue has ≥1 retrievable event," not pure
  existence — a real in-org issue with zero retrievable events (e.g. event data purged by a GDPR
  delete request) would false-reject. Narrow in practice: legitimate `sentryIssueId` values reach
  `?/track` via the dashboard's rendered issue list (`fetchIssuesRaw`), which itself requires ≥1
  event in the last 14d to appear — so a same-session track cannot hit this edge case. A stale
  browser tab open past that window could. Failure mode is availability (blocks a legitimate
  track), not a security regression, and is already named generally in this plan's Blast Radius
  "Behavioral risk" row.


## Acceptance Criteria

1. Submitting `?/track` with a `sentryIssueId` that does not resolve in the configured Sentry org (nonexistent or belongs to another org) returns a `fail()` and creates no incident.
2. Submitting `?/track` while Sentry is configured but the lookup errors (timeout/5xx/network) returns a `fail()` and creates no incident (fail-closed).
3. Submitting `?/track` while Sentry is NOT configured (`isSentryConfigured() === false`) skips the provenance check and behaves exactly as before.
4. Submitting `?/track` with a real, resolvable issue id still creates the incident (no behavior change on the happy path).
5. `apps/admin/e2e/incident-sentry.e2e.ts` passes unmodified.
6. `bun run check` (typecheck) and the full admin unit suite (`bunx vitest run`) pass with no regressions.

## Phase Completion Rules

This is a SIMPLE, single-phase plan — no multi-phase status tracking applies. The plan is
considered CODE DONE when Implementation Checklist steps 1-6 are complete and all Fully-Automated
verification-evidence rows pass. It is considered VERIFIED only after checklist step 7 (the
`incident-sentry.e2e.ts` hybrid regression run) also passes unmodified. Step 8 (live-Sentry
agent-probe) is optional / best-effort and does not gate VERIFIED status if no live sandbox is
available — in that case its Missing Test Areas row records it as a documented known-gap.

## Validate Contract

Status: CONDITIONAL
Date: 20-07-26
date: 2026-07-20
generated-by: outer-pvl

Parallel strategy: sequential
Rationale: 1/7 signals present (S6 — high-risk trust-boundary/provenance class only; no
multi-package, no schema/API/auth-flow surface, no 3+ directions, not a phase program, no
explicit depth request, blast radius stays under 5 files). Single self-contained SIMPLE plan —
Layer 1 + Layer 2 validate fan-out was run as one pass (Simple Mode of `vc-validate-findings`;
no need to spawn parallel dimension agents for a scope this size), and EXECUTE itself needs no
fan-out — one sequential `vc-execute-agent` pass covers the full checklist.

Test gates (C3 5-column table):

| criterion id | behavior | strategy | proving test | gap-resolution |
|---|---|---|---|---|
| G1 | Reject a nonexistent `sentryIssueId` (404-shaped rejection) — nothing persisted | Fully-Automated | `bunx vitest run apps/admin/src/routes/\(app\)/sentry/+page.server.test.ts` — scenario: mocked lookup rejects 404 | A |
| G1b | Reject an org-mismatch id (404-shaped rejection) — nothing persisted | Fully-Automated | same file — org-mismatch scenario | A |
| G2 | Fail closed on lookup timeout / 5xx / network error while Sentry IS configured — nothing persisted | Fully-Automated | same file — network-error scenario | A |
| G3 | Sentry NOT configured → provenance check skipped, `?/track` proceeds unchanged | Fully-Automated | same file — `isSentryConfigured()` mocked `false` scenario | A |
| G3-e2e | `incident-sentry.e2e.ts` remains green, unmodified (live regression proof of G3) | Hybrid | `cd apps/admin && bun run test:e2e -- incident-sentry` — precondition: throwaway `radius_admin_test` DB seeded (`bun run test:seed`), Sentry env vars unset | A |
| G4 | Happy path: resolvable id → `?/track` proceeds to `createIssueFromSentry`, incident created, no behavior change | Fully-Automated | same file — mocked lookup resolves scenario | A |
| REG | No regression in the full admin unit suite (`client.test.ts` cache behavior, `map.test.ts`, etc.) | Fully-Automated | `cd apps/admin && bunx vitest run` | A |
| TYPE | No type errors introduced by the new import/branch | Fully-Automated | `cd apps/admin && bun run check` | A |
| LIVE | Live-Sentry happy-path + rejection-path smoke against a real org (optional, best-effort) | Agent-Probe | Manual — conditional on live `SENTRY_AUTH_TOKEN` sandbox access; if unavailable, falls back to the Missing Test Areas known-gap row (mocked unit tests already cover the code path, since `fetchLatestEventRaw` throws identically for 404 and org-mismatch) | D |

gap-resolution legend:
- A — proven now (gate passes in this cycle)
- B — fixed in this plan (gate added by this plan's checklist)
- C — deferred to a named later phase/plan
- D — backlog test-building stub (named residual; keep-active; continue)

C-4 reconciliation: the `strategy:` column above carries ONLY the 3 proving strategies
(Fully-Automated / Hybrid / Agent-Probe). No row uses Known-Gap as a strategy.

Legacy line form (retained so existing validate-contract consumers still parse):
- Provenance rejection (nonexistent / org-mismatch / lookup-error) + happy path + unconfigured-skip: Fully-automated: `bunx vitest run apps/admin/src/routes/\(app\)/sentry/+page.server.test.ts` | Hybrid: `cd apps/admin && bun run test:e2e -- incident-sentry` (precondition: throwaway `radius_admin_test` DB seeded, Sentry env vars unset) | Agent-probe: live-Sentry happy/rejection smoke, conditional on a live `SENTRY_AUTH_TOKEN` sandbox | Regression: `cd apps/admin && bunx vitest run` (full suite) + `cd apps/admin && bun run check` (typecheck)

**Failing stubs (Fully-Automated new-scenario rows — G1, G1b, G2, G3, G4; REG/TYPE are
pre-existing regression/typecheck commands and do not get scenario stubs):**

```
test("should reject a nonexistent sentryIssueId with fail(502) and persist nothing", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: G1 — reject nonexistent id")
})
test("should reject an org-mismatch sentryIssueId with fail(502) and persist nothing", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: G1b — reject org-mismatch id")
})
test("should fail closed (fail(502)) when the provenance lookup times out or errors while Sentry is configured", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: G2 — fail closed on lookup error")
})
test("should skip the provenance check and track unchanged when Sentry is not configured", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: G3 — unconfigured skip")
})
test("should create the incident on a resolvable sentryIssueId (happy path unchanged)", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: G4 — happy path")
})
```

Dimension findings:
- Infra fit: PASS — server-only `+page.server.ts` action inside the existing `$lib/server/sentry`
  facade pattern; no new port, container, deploy, or runtime surface; reuses the existing 8s
  timeout + read cache.
- Test coverage: CONCERN — 5 fully-automated unit scenarios are genuinely automatable, but the
  plan's "one line" / "extend client.test.ts" framing understates the effort: confirmed
  repo-wide (`grep -rl '$env/dynamic/private' **/*.test.ts`) that this would be the FIRST test
  anywhere in the repo to mock `$env/dynamic/private`, and the FIRST `+page.server.ts`
  action-level unit test in any of the 3 apps (zero existing `+page.server.test.ts` files).
  Mitigated via Execute-Agent Instruction E1 below — resolved as CONDITIONAL, not FAIL, since the
  scenarios remain mechanically testable, just costed correctly.
- Breaking changes: PASS — `?/track` request/response shape unchanged; only an additive
  `fail(502, ...)` failure mode, reusing the exact shape `mutate()` already uses for Sentry-request
  failures. `fetchLatestEventRaw` reused with zero signature change. No schema/migration.
- Security surface: PASS — fail-closed on every lookup failure (locked design decision); uniform
  error message on both "doesn't exist" and "network blip" (no org-membership oracle); the
  provenance check runs strictly before the `createIssueFromSentry` DB write (no partial state);
  gated by the pre-existing `admin_sentry_track` rate limit (fires before the provenance check, at
  line 84) and the pre-existing signed-in-staff auth check — no new attack surface.
- Section A — Implementation/Test Plan feasibility: CONCERN — mechanical feasibility confirmed
  (edit targets verified against real file/line content: `+page.server.ts:9` import,
  `~line 101` insertion point before `createIssueFromSentry` at `~line 122`,
  `client.ts:134-138` `fetchLatestEventRaw` signature). Gap found and now flagged in the
  Implementation Checklist above: `index.ts` does NOT currently re-export `fetchLatestEventRaw`
  (confirmed by reading the barrel file) — checklist step 1 correctly anticipated this and is now
  annotated as non-optional. Second gap: `fetchLatestEventRaw` proves "issue has ≥1 event," not
  pure existence — accepted as a known-gap (Execute-Agent Instruction E2). No conflicts found
  against current file state or repo conventions. Highest-risk edit: the provenance gate insertion
  inside `track:` — mitigated by its confirmed placement strictly before the DB write and by the
  fail-closed design.

Open gaps:
- Test-harness cost for the 5 new unit scenarios is higher than the plan's checklist implies
  (first `$env/dynamic/private` mock + first `+page.server.ts` action test in the repo) — resolved
  via Execute-Agent Instruction E1, not a plan rewrite.
- `fetchLatestEventRaw` false-reject edge case (zero-event issue) — accepted known-gap via
  Execute-Agent Instruction E2; narrow, availability-only impact, already named in this plan's
  Blast Radius section.

What this coverage does NOT prove:
- G1/G1b/G2/G3/G4 (mocked-`fetch` unit tests) do NOT prove the real Sentry API actually returns a
  404-shaped response for a fabricated/org-mismatch id, or that its 5xx/timeout shape matches the
  mock — that gap is covered only by the optional LIVE agent-probe (checklist step 8), which is
  best-effort and does not gate PASS if no sandbox is available.
- G3-e2e (the Playwright regression run) proves the unconfigured-Sentry code path is unaffected;
  it does NOT exercise the new provenance branch at all (Sentry is unconfigured in that env by
  design), so it provides zero evidence for G1/G1b/G2/G4.
- REG (full admin unit suite) proves no *existing* test regressed; it does not independently
  re-verify the new branch beyond what G1/G1b/G2/G3/G4 already assert.
- TYPE (typecheck) proves the new code compiles under `svelte-check`; it proves nothing about
  runtime behavior.
- None of the automated/hybrid gates above exercise the zero-retrievable-events edge case named in
  Open Gaps — that risk is accepted, not tested (see Execute-Agent Instruction E2).

Gate: CONDITIONAL (2 CONCERNs — test-coverage cost estimate and the `fetchLatestEventRaw`
existence-check edge case — both resolved via Execute-Agent Instructions below, not plan-goal
changes; 0 FAILs)
Accepted by: session (self-validated, single-pass VALIDATE run per orchestrator instruction —
no interactive user round-trip available in this invocation). Accepted concerns: (1) test-harness
cost underestimate — mitigated by Execute-Agent Instruction E1; (2) `fetchLatestEventRaw`
zero-events false-reject edge case — accepted as a documented, narrow, availability-only known-gap
per Execute-Agent Instruction E2.

**Execute-Agent Instructions:**

| # | Instruction | Trigger condition |
|---|---|---|
| E1 | When writing the new unit tests (Implementation Checklist step 3), mock the `$lib/server/sentry` facade module directly (`vi.mock('$lib/server/sentry', ...)`) inside the new `apps/admin/src/routes/(app)/sentry/+page.server.test.ts` — do NOT extend `client.test.ts` with raw `fetch` + `$env/dynamic/private` mocking. This sidesteps needing to mock `$env/dynamic/private` (no existing repo precedent) and is the simpler of the two Touchpoints-listed options. Budget this as writing a new, first-of-its-kind test file (mocking `db`, `rateLimit`, `listStaff`, `createIssueFromSentry`/`isIssuePriority`, `notifyAssignees`, `validateSentrySnapshot`, `parseDueDate`, plus the sentry facade), not a one-line extension. | Implementation Checklist step 3 |
| E2 | Add a one-line code comment at the provenance-check call site (inside the `if (isSentryConfigured())` block added in checklist step 2b) noting: "fetchLatestEventRaw proves the issue has ≥1 retrievable event, not pure existence — a real issue with zero retrievable events would false-reject; accepted as a narrow, availability-only known-gap (VALIDATE 20-07-26)." No code-behavior change required. | Implementation Checklist step 2b |

## Autonomous Goal Block

```
SESSION GOAL: M4d — verify sentryIssueId against the Sentry API before persisting a
Tracked-from-Sentry incident, closing the fabricated-id gap in `?/track`.
Charter + umbrella plan: N/A — single SIMPLE plan, no phase program.
Autonomy: standard RIPER-5 EXECUTE gate — explicit "ENTER EXECUTE MODE" required before
implementation; no standing /goal autonomy has been granted for this plan.
Hard stop conditions / safety constraints:
- Nothing may persist to `admin_issue` when the Sentry provenance lookup fails or is inconclusive
  (fail-closed is mandatory, not best-effort).
- `apps/admin/e2e/incident-sentry.e2e.ts` MUST remain green WITHOUT modification — do not edit
  this spec to make it pass.
- `map.ts` (`validateSentrySnapshot`) MUST stay pure — no env reads, no I/O added there.
- No schema change, no migration, no new env var — reuse existing Sentry credential/config surface
  only.
- Do not add a new Sentry API endpoint (`GET /issues/{id}/`) — reuse `fetchLatestEventRaw` per the
  Locked Design Decision; do not re-litigate that decision during EXECUTE.
Next phase: EXECUTE — `process/features/incident-management/active/sentry-issueid-provenance_20-07-26/sentry-issueid-provenance_PLAN_20-07-26.md`
Validate contract: inline in plan (`## Validate Contract` section above)
Execute start: fully-auto commands — `bunx vitest run apps/admin/src/routes/\(app\)/sentry/+page.server.test.ts`, `cd apps/admin && bun run check`, `cd apps/admin && bunx vitest run` | e2e spec: `cd apps/admin && bun run test:e2e -- incident-sentry` (precondition: `bun run test:seed`, Sentry env vars unset) | probe scenario: optional live-Sentry happy/rejection smoke (checklist step 8), best-effort | high-risk pack: no (trust-boundary class is present but this SIMPLE plan's evidence is carried inline in the validate-contract Test Gates + Dimension Findings above, not a separate 5-artifact risk-evidence-pack — scope and blast radius are small enough that the inline contract is the proportionate evidence bar; escalate to a full risk-evidence-pack only if EXECUTE discovers the change is larger than currently scoped)
```

## Resume and Execution Handoff

1. **Selected plan file path:** `process/features/incident-management/active/sentry-issueid-provenance_20-07-26/sentry-issueid-provenance_PLAN_20-07-26.md`
2. **Last completed phase or step:** VALIDATE — validate-contract written 20-07-26, Gate: CONDITIONAL (self-accepted, see Validate Contract section). Next: "ENTER EXECUTE MODE" against this plan.
3. **Validate-contract status:** written, Gate: CONDITIONAL — 2 concerns resolved via Execute-Agent Instructions E1 (test-harness approach) and E2 (documented known-gap comment). Not BLOCKED; EXECUTE may proceed once explicitly approved.
4. **Supporting context files loaded:** `process/context/all-context.md`, `process/context/tests/all-tests.md`, backlog note `sentry-issue-id-provenance-check_NOTE_10-07-26.md`, `apps/admin/src/lib/server/sentry/client.ts`, `apps/admin/src/lib/server/sentry/index.ts`, `apps/admin/src/routes/(app)/sentry/+page.server.ts`, `apps/admin/src/lib/server/sentry/client.test.ts`, `apps/admin/e2e/incident-sentry.e2e.ts`, `apps/admin/vite.config.ts`.
5. **Next step for a fresh agent picking up mid-execution:** run `ENTER EXECUTE MODE` against this
   plan file. Follow the Implementation Checklist in order, applying Execute-Agent Instructions E1
   (mock the `$lib/server/sentry` facade, not raw `fetch`/`$env`, in the new
   `+page.server.test.ts`) and E2 (add the one-line known-gap comment at the provenance-check call
   site). Run the Test Gates table commands in the Validate Contract section as the gate sequence.
