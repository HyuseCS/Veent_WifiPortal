---
name: report:sentry-issueid-provenance-execute
description: "EXECUTE phase report — M4d provenance gate implemented and unit-green; e2e hybrid gate RED on a falsified plan premise"
phase: sentry-issueid-provenance
date: 2026-07-20
status: COMPLETE
feature: incident-management
plan: process/features/incident-management/active/sentry-issueid-provenance_20-07-26/sentry-issueid-provenance_PLAN_20-07-26.md
metadata:
  node_type: memory
  type: report
  feature: incident-management
  phase: sentry-issueid-provenance
---

# EXECUTE Report — Sentry issueId Provenance Check (M4d)

**TL;DR:** All gates green. Checklist steps 1–7 complete. Step 7 (the `incident-sentry.e2e.ts`
hybrid gate) initially came up RED on a falsified plan premise — the plan assumed "Sentry is
unconfigured in the e2e env", which was false here. That was surfaced, approved, and fixed via a
one-line-class supplement to `apps/admin/e2e/config.ts` (see §Supplement). The spec passes
**unmodified**, and the e2e suite no longer makes live Sentry calls.

**Final e2e position:** 15 passed / 4 failed, against a pre-change baseline of 14 passed / 5 failed.
The 4 remaining failures are the identical pre-existing set present in the baseline and are
unrelated to this work.

## What Was Done

1. **Barrel re-export** — `apps/admin/src/lib/server/sentry/index.ts`: added `fetchLatestEventRaw`
   to the existing `export { isSentryConfigured, SENTRY_CREDENTIAL_KEYS };` line. VALIDATE's
   annotation was correct — it was not previously re-exported.
2. **Provenance gate** — `apps/admin/src/routes/(app)/sentry/+page.server.ts`: added
   `fetchLatestEventRaw` to the line-9 facade import, and inserted the gate inside `track:`
   immediately after the `snapshot` destructure and before the remaining field validation /
   `createIssueFromSentry`. Fail-closed `fail(502, …)` on any lookup failure; skipped entirely when
   `isSentryConfigured() === false`. Exact code shape from checklist step 2b.
3. **E2 known-gap comment** — added at the call site, documenting that `fetchLatestEventRaw` proves
   "issue has ≥1 retrievable event", not pure existence, and that the resulting false-reject is an
   accepted narrow availability-only known-gap.
4. **New unit spec** — `apps/admin/src/routes/(app)/sentry/track-provenance.test.ts`, 7 tests
   covering G1, G1b, G2, G3, G4 plus two ordering assertions. Mocks the `$lib/server/sentry` facade
   per Execute-Agent Instruction E1 (no `$env/dynamic/private` mock, no raw `fetch` mock).
   `map.ts` and `formValidation.ts` are left REAL (both pure) for stronger coverage.

**Red-first discipline honoured retroactively:** with the `+page.server.ts` change stashed, 5 of the
7 tests fail; restoring it turns them green. The 2 that pass under revert are the two
behaviour-*preservation* tests (unconfigured-skip, malformed-snapshot-rejected-first), which is the
correct signal — they assert unchanged behaviour, so they must be green both before and after.

## Test Gate Outcomes

| Gate | Command | Result |
|---|---|---|
| G1 / G1b / G2 / G3 / G4 | `bunx vitest run src/routes/(app)/sentry/track-provenance.test.ts` | **PASS** — 7/7 |
| REG | `cd apps/admin && bunx vitest run` (full suite) | **PASS** — 20 files, 149 tests |
| TYPE | `cd apps/admin && bun run check` | **PASS** — 2307 files, 0 errors, 0 warnings |
| G3-e2e | `cd apps/admin && bun run test:e2e -- incident-sentry` | **PASS** — after the §Supplement fix; spec unmodified |
| e2e suite | `cd apps/admin && bun run test:e2e` | **15 pass / 4 fail** vs baseline **14 pass / 5 fail** — same 4 pre-existing failures, no new ones |
| LIVE | live-Sentry agent probe | **NOT RUN** — no sandbox; documented known-gap per plan |

## BLOCKING FINDING — the G3-e2e premise is false

The plan, the validate-contract, and `incident-sentry.e2e.ts`'s own header comment all assert that
**Sentry is unconfigured in the e2e test env**. It is not.

Evidence:
- `apps/admin/e2e/config.ts:21-28` — `TEST_ENV` blanks `RESEND_API_KEY` and `EMAIL_FROM`, but does
  **not** blank any `SENTRY_*` key.
- `playwright.config.ts:24` passes `TEST_ENV` to the webserver, which therefore **inherits the real
  `SENTRY_AUTH_TOKEN` / `SENTRY_ORG_SLUG` / `SENTRY_PROJECT_ID` from `apps/admin/.env`**.
- The failing run proves it — the webserver made a real, authenticated call to the real org and got
  a real 404:
  `[sentry] track provenance check failed Error: sentry GET /organizations/radiusveent-0f/issues/91784516881775/events/latest/ → 404 {"detail":"The requested resource does not exist"}`

Consequence: `isSentryConfigured()` returns **true** during e2e, so the unconfigured escape hatch
never engages. The spec posts a deliberately fabricated id (`9${Date.now()}`) and asserts the track
**succeeds** — which is precisely the behaviour M4d exists to forbid.

**Acceptance criteria #1 and #5 are therefore mutually exclusive as written.** The spec cannot pass
unmodified while fabricated ids are rejected, unless the e2e env is made genuinely
Sentry-unconfigured.

Note this also means the e2e suite has been making live Sentry API calls all along — pre-existing,
not introduced by this change, but worth surfacing.

### Why this was surfaced rather than silently fixed

The fix was small and idiomatic, but it was **not in the Implementation Checklist** and it mutates
shared e2e harness config that every other spec depends on. Per the EXECUTE constraint — *if reality
contradicts the plan, stop and report rather than improvise* — it was surfaced for a decision
instead of applied unilaterally. Approval was granted; see §Supplement.

## Supplement (approved out-of-checklist change)

**Approved by the user after the finding above was surfaced.** Scope was explicitly limited to
`apps/admin/e2e/config.ts` — no change to the provenance logic, no change to the e2e spec.

**What changed:** added `SENTRY_AUTH_TOKEN: ''`, `SENTRY_ORG_SLUG: ''`, `SENTRY_PROJECT_ID: ''` to
`TEST_ENV`, mirroring the existing `RESEND_API_KEY: ''` line, and extended the block comment to name
Sentry alongside the DB / router / mailer overrides it already documented.

**Why it was outside the original checklist:** the plan treated "Sentry is unconfigured in e2e" as a
given fact about the environment, so no checklist step existed to *make* it true. The plan's
Non-Goals said "no change to e2e", but in context that referred to the spec file
(`incident-sentry.e2e.ts`) — harness config was simply never considered, because the premise was
assumed rather than verified. This is a plan-premise correction, not a scope expansion: it changes
no product behaviour and no test assertion.

**Verification of the supplement (all three checks the approval asked for):**

1. **Spec passes unmodified** — `bun run test:e2e -- incident-sentry` → `1 passed`.
   `git diff --stat -- e2e/incident-sentry.e2e.ts` is empty, confirming the file is untouched.
2. **The live Sentry call is gone — checked explicitly, not inferred.** The run output was grepped
   for `radiusveent-0f`, `sentry GET /organizations`, and `provenance check failed`: **zero matches**
   in the targeted run, and **zero matches across the whole 19-test suite**. Before the fix the same
   grep returned a live 404 against the real org. That absence is the actual proof, independent of
   the green result.
3. **Rest of the suite no worse.** A genuine pre-change baseline was captured by running the full
   suite immediately before the edit (post-provenance-change, pre-`TEST_ENV`-change): **14 passed /
   5 failed**. After: **15 passed / 4 failed**. The delta is exactly `incident-sentry` moving
   fail → pass. The 4 remaining failures are the identical pre-existing set —
   `finance-export.e2e.ts:26`, `incident-detail.e2e.ts:113`, `incident-notifications.e2e.ts:50`,
   `incident-notifications.e2e.ts:95` — all unrelated to Sentry and all failing before this work.
   This is a measured comparison, not an assumed one.

**No spec turned out to depend on live Sentry.** Blanking the credentials broke nothing, so the
stop-and-report contingency for a real dependency did not trigger.

Typecheck re-run after the supplement: **0 errors, 0 warnings**.

## Standalone hygiene finding — live credentials in the e2e suite (independent of M4d)

Recording this separately because it is **not** an M4d issue and would have been worth fixing even
if this plan had never existed.

Before this supplement, `apps/admin/e2e/config.ts` overrode the DB, the router (`NETWORK_CONTROLLER:
'stub'`), and the mailer (`RESEND_API_KEY: ''`) — each with an explicit comment about not letting the
dev config leak into tests — but omitted Sentry. Because `bun` auto-loads `apps/admin/.env` and
Playwright merges `process.env` into `webServer.env`, every e2e run on any machine with a populated
`.env` was making **live, authenticated API calls to the production Sentry org** (`radiusveent-0f`).

Why it went unnoticed: those calls were previously read-only, non-fatal, and invisible — the
dashboard degrades gracefully on Sentry failure, so nothing ever went red. M4d only exposed it by
making the code path fail loudly. The stale comment at the top of `incident-sentry.e2e.ts` ("The
Sentry API is unconfigured in the test env (no token)") suggests the author genuinely believed it was
unconfigured, and it likely *was* on a machine without those `.env` keys.

Residual risk now closed: test runs no longer consume production Sentry API quota, and no test can
mutate live Sentry state. Worth a general lesson for the harness — **`TEST_ENV` should enumerate
every external integration, and any newly added integration must be added to it**. Currently that
list is: DB, router, mailer, Sentry. Maya payments is not in `TEST_ENV`; whether the admin e2e suite
can reach it was not investigated here and is left as an open question rather than an assumed
non-issue.

## Plan Deviations

| # | Deviation | Rationale | Class |
|---|---|---|---|
| 1 | Test file named `track-provenance.test.ts` instead of `+page.server.test.ts` | SvelteKit emits `Files prefixed with + are reserved` three times per run for the planned name. The plan explicitly permits "(or the actual path chosen)". Same directory, same coverage. | Within-blast-radius |
| 2 | `map.ts` and `formValidation.ts` left unmocked | Both are pure; E1 listed them as mockable, not mandatory-to-mock. Using the real ones strengthens the ordering assertions. | Within-blast-radius |
| 3 | 7 tests written instead of the 5 stubs | Added two ordering tests (gate runs before field validation; snapshot validation runs before any Sentry call). Additive. | Within-blast-radius |

| 4 | `TEST_ENV` Sentry blanking in `apps/admin/e2e/config.ts` | Out-of-checklist harness fix correcting the plan's false premise. **Surfaced first, explicitly user-approved before applying.** Full detail in §Supplement. | Hard-stop class — surfaced, approved, then applied |

Deviations 1–3 are within-blast-radius and were applied under standard EXECUTE latitude.
Deviation 4 was hard-stop class: it was **not** applied unilaterally — execution halted, the finding
was reported, and the change was made only after explicit approval with an explicitly narrowed scope.

## Test Infra Gaps Found

- **`TEST_ENV` did not neutralize Sentry credentials** (`apps/admin/e2e/config.ts`) — **RESOLVED**
  by the approved supplement above. See §Standalone hygiene finding for the full write-up.
- **`incident-sentry.e2e.ts`'s header comment is stale** — it states "The Sentry API is unconfigured
  in the test env (no token)". That is now *true again* thanks to the supplement, so the comment is
  no longer misleading. **Left unedited on purpose**, since the spec file was under a
  do-not-modify constraint. Worth a one-line touch-up in a future pass to note that the guarantee
  now comes from `TEST_ENV`, not from an absent `.env`.
- **`TEST_ENV` has no enforcement that new integrations get added to it** — the Sentry omission was
  silent for as long as it existed. Open question, not investigated here: whether Maya payments is
  reachable from the admin e2e suite.
- **4 pre-existing e2e failures** unrelated to this work (`finance-export:26`,
  `incident-detail:113`, `incident-notifications:50`, `incident-notifications:95`). Present in the
  baseline, untouched by this change, not investigated — flagging only so they are not mistaken for
  M4d fallout.

## Closeout Packet

- **Selected plan:** `process/features/incident-management/active/sentry-issueid-provenance_20-07-26/sentry-issueid-provenance_PLAN_20-07-26.md`
- **Finished:** checklist steps 1–7, plus the approved `TEST_ENV` supplement. Gates G1, G1b, G2, G3,
  G4, REG, TYPE, G3-e2e all green.
- **Verified vs unverified:** unit, typecheck, full unit suite, and the e2e hybrid gate all
  verified. LIVE agent-probe not run (no Sentry sandbox available) — remains the plan's
  pre-accepted known-gap, alongside the E2 zero-events false-reject gap.
- **Remaining:** nothing blocking. Optional follow-ups: the stale spec header comment, the
  `TEST_ENV` enumeration question, and the 4 unrelated pre-existing e2e failures.
- **Best next state:** `Ready for UPDATE PROCESS archival`. Per the plan's Phase Completion Rules
  this is CODE DONE **and** VERIFIED (step 7 passed unmodified). The plan text itself still asserts
  the false "unconfigured e2e env" premise, so UPDATE PROCESS should correct that line rather than
  archive it as-written.

## Forward Preview

- **Test Infra Found:** the `TEST_ENV` Sentry-credential leak — found, fixed, verified. General
  lesson: `TEST_ENV` must enumerate every external integration.
- **Blast Radius Changes:** plan predicted 2 modified + 1 new file in `apps/admin`. Actual: 3
  modified + 1 new, the extra being `apps/admin/e2e/config.ts` (shared harness config touching all
  e2e specs — verified non-regressive against a measured baseline).
- **Commands to Stay Green:** `cd apps/admin && bunx vitest run` · `cd apps/admin && bun run check`
- **Dependency Changes:** none. No schema, no migration, no new env var.
