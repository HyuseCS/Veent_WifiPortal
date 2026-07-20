---
name: plan:ims-e2e-spec-modernization
description: "Fix 2 broken e2e assertions (notifications ARIA/modal, finance-export redirect-follow) and add net-new coverage for the self-report tile's forced-unassigned security property"
date: 20-07-26
feature: incident-management
---

# IMS e2e spec modernization — PLAN

**Date**: 20-07-26
**Status**: ✅ VERIFIED — EXECUTE + EVL complete, archived 20-07-26
**Complexity**: SIMPLE — single package (`apps/admin/e2e/`), test-files-only, no schema/auth/API/
billing surface touched, no new dependencies. 3 well-bounded pieces, each independently gated.

## Archival Note (UPDATE PROCESS, 20-07-26)

- **Gate history:** PVL cycle 0 CONDITIONAL (3 CONCERNs) → cycle 1 supplement closed all 3 →
  cycle 2 `Gate: PASS`. EXECUTE: all 3 pieces done, zero changes under `apps/admin/src/**`. EVL:
  full admin e2e suite 23/23 passed (12 spec files, up from 11).
- **EVL negative control (closes the EXECUTE report's one "not proven" item):** the CSRF
  Origin-header pre-assertion in `incident-self-report.e2e.ts` (item 3.3) was empirically proven
  non-vacuous — removing the `Origin` header from the raw tamper POST made the test fail at the
  pre-assertion (403), and restoring the header made it pass again. This confirms the tamper test
  genuinely exercises `+page.server.ts:184`, not merely a CSRF-rejected request that happens to
  also produce zero assignee rows.
- **Deviations from plan (both within blast radius, test-file only):**
  1. Piece 1 (`incident-notifications.e2e.ts`): the button-role query required explicit panel
     scoping (`getByRole('region', { name: 'Notifications' })`) — an unscoped query matched 3
     elements (notification entry + manager-board `Edit <title>`/`Delete <title>` icon buttons),
     which the plan anticipated as a fallback but which turned out to be required, not optional.
  2. Piece 1 item 1.5: one extra line was needed before the untouched `:91-92` "Mark all read"
     block — closing the notification preview modal is itself a read event
     (`NotificationBell.svelte:53-59`), so the feed had to be re-armed with a fresh event before
     the pre-existing assertions could run meaningfully. The `:91-92` assertions themselves are
     unchanged.
  3. Execute-agent's self-report understated the diff size in `incident-notifications.e2e.ts`
     (claimed `:91-92 unchanged`, actually a larger legitimate rewrite of ~86-129) — cosmetic
     misreport in the phase report, not a defect; verified against the actual diff during UPDATE
     PROCESS.
- **Next state:** archived to `completed/`; backlog item closed (see
  `backlog/ims-e2e-spec-modernization_NOTE_10-07-26.md`); `process/context/tests/all-tests.md`
  updated to reflect 12 spec files / 23 tests, all green.

## Origin

Closes the open backlog item `process/features/incident-management/backlog/
ims-e2e-spec-modernization_NOTE_10-07-26.md`. Superseded by fresh RESEARCH in this session (the
backlog note's `loginNonManager` timeout theory is disproven — see Decision Log).

## Overview

Three independent pieces, all confined to `apps/admin/e2e/`:

1. **Fix** `incident-notifications.e2e.ts` — stale `menuitem` ARIA queries + stale
   navigate-on-click assumption (notification click now opens a preview modal, not a page nav).
2. **Fix** `finance-export.e2e.ts` — two assertions expect status codes the app can never return
   through `(app)` layout hook redirects, because Playwright's `request.get()` follows redirects
   by default.
3. **Add** a new spec for the "Report an issue" self-report tile — currently ZERO e2e coverage.
   Highest-value piece: it is the only one that can catch a real regression (the forced-unassigned
   security invariant in `+page.server.ts:184`).

Pieces 1 and 2 make previously-wrong assertions honest; they were never proving anything
correct, so fixing them finds no new product bugs — this is test-debt cleanup, not bug-fixing.
Piece 3 is the only piece with genuine bug-finding upside.

## Goals

- All 3 specs pass green against the throwaway `radius_admin_test` DB.
- The self-report forced-unassigned security property is now under regression protection.
- No test flakes introduced into the shared, non-isolated (`workers: 1, fullyParallel: false`) suite.

## Non-Goals / Out of Scope

- Any change to `apps/admin/src/**`. If a source change looks necessary, that is a STOP condition
  (see Constraints) — pieces 1 and 2 are regressions in the tests, not the product.
- Building a banked non-manager storageState fixture (considered and rejected — see Decision Log).
- Live-tracing intermittent DB-timing flake theories beyond what's needed to make these 3 specs
  deterministic.
- Any of the other 3 backlog items (`manager-board-pagination`, `repo-wide-lint-prettier-drift`,
  `test-env-integration-coverage-gap` — the last already moved to general-plans/backlog).

## Acceptance Criteria

- [ ] `incident-notifications.e2e.ts` test 1 passes with button/dialog-role queries (no `menuitem` references remain in the file).
- [ ] `incident-notifications.e2e.ts` test 2 passes unmodified (its `:113` "2 unread" assertion is untouched — leak was in test 1, not test 2).
- [ ] `finance-export.e2e.ts` both tests pass using `{ maxRedirects: 0 }` + `302` + `location`-header assertions; no `.toBe(401)`/`.toBe(403)` assertions remain against this endpoint.
- [ ] New file `incident-self-report.e2e.ts` exists and passes, covering: forced-unassigned tamper defense, audit-trail (exactly 1 `created` event), `canAssign={false}` DOM contract, and validation failure.
- [ ] Zero changes to any file under `apps/admin/src/**` (test-only plan — a source change is a stop-and-report condition, not a checklist item).
- [ ] Full `bun run test:e2e` run (all specs, not just the 3 touched) shows no new failures beyond pre-existing known gaps.

## Phase Completion Rules

This is a SIMPLE (non-phased) plan — there is a single completion state, not phase-by-phase status:

- **CODE DONE**: all 3 pieces implemented per the Implementation Checklist, each spec file syntactically valid and runnable.
- **VERIFIED**: CODE DONE, plus every row in Verification Evidence is green via an actual `bun run test:e2e` run against the throwaway `radius_admin_test` DB (not merely inspected/reasoned about), plus the full-suite cross-check (checklist 3.8) shows no new failures.
- Do not mark this plan VERIFIED on code-only completion — the Hybrid tier requires the harness precondition (built preview + throwaway DB) to actually run.

## Decision Log

| Decision | Why | Rejected |
|---|---|---|
| Reuse `loginNonManager` pattern as-is (no new fixture) | Disproven today: the backlog note's "≈60s timeout" was actually caused by a storageState leak (missing empty `storageState` override), not slowness. Once that leak is fixed the same helper measures ~4.0s. | A banked non-manager storageState fixture — optimizes a cost (slow re-enrollment) that doesn't exist; added complexity for zero benefit. |
| Query notification items by `getByRole('button', { name: /TITLE/ })` scoped to exclude the "mark as read" sibling, not `menuitem` | Matches current DOM: `NotificationBell.svelte:135-200` — `role="region"` wrapping `<ul><li><button>`, no `role="menu"`/`menuitem` since the L6a a11y change. | Keeping `menuitem` queries — they never match, hard-fail every run. |
| Assert `page.locator('dialog[open]')` visibility instead of a URL change after notification click | Click now opens `NotificationModal.svelte` in a native `<dialog>` (`selected = n; modalOpen = true`) — does not navigate. | Asserting `toHaveURL(/\/issues\/\d+$/)` — the app no longer does this on click. |
| Pass `{ maxRedirects: 0 }` to both `context.request.get()` calls in finance-export and assert `302` + `location` header | The real gate is `hooks.server.ts:80-90` `handleBetterAuth`, which 302s BEFORE the route handler's own 401/403 checks run. Playwright follows redirects by default, silently converting the true 302 into a followed 200 with login/enroll HTML — masking what the test claims to prove. | Leaving `expect(status).toBe(401/403)` — asserts a status the app never actually returns at this layer; not a real auth-leak, just an assertion that tests the wrong hop. |
| New spec drives the tile through the UI (click → fill → submit `?/selfReport`), then asserts via direct DB queries (`admin_issue_assignee`, `admin_issue_event`) | Matches the existing spec pattern (`incident-notifications.e2e.ts`'s `withSql`/`userIdByEmail` helpers) — DB assertions are the established way this suite proves server-side invariants that aren't visible in the DOM. | Asserting only DOM state (e.g. "incident appears in Open pool") — insufficient to prove the assignee list is actually empty in the DB; a UI-only assertion could pass even if the tamper-defense regressed to leaking one assignee that happens to not render. |
| Do NOT delete `finance/export/+server.ts:17-18`'s own 401/403 checks | Defense-in-depth, not dead code — if the layout hook is ever bypassed or restructured, these are the second line of defense. | Removing "unreachable" code — out of scope; these lines are not touched by this plan at all. |

## Touchpoints

| File | Change | Lines (current) |
|---|---|---|
| `apps/admin/e2e/incident-notifications.e2e.ts` | Rewrite ARIA queries + click-assertion in test 1; verify test 2 still green after the fix (no direct edit expected, see Piece 1 detail) | `:80`, `:84`, `:85`, `:88` (test 1); `:113` (test 2, read-only verification) |
| `apps/admin/e2e/finance-export.e2e.ts` | Add `{ maxRedirects: 0 }`, change status + add `location` header assertions | `:28-29`, `:40-41` |
| `apps/admin/e2e/incident-self-report.e2e.ts` (NEW FILE) | New spec, ~4 tests per Piece 3 priority list | n/a — new file |

No other files are modified. `apps/admin/src/**`, `packages/**`, `apps/customer/**`,
`apps/locator/**` are entirely out of blast radius.

## Public Contracts

None. This plan touches only test files (`apps/admin/e2e/*.e2e.ts`). No public API, schema, or
runtime behavior changes. The "contract" being verified is the EXISTING behavior of:
- `hooks.server.ts:80-90` `handleBetterAuth` redirect gate (read-only verification, not changed)
- `+page.server.ts:174-186` `selfReport` action, specifically the `parsed.input.assigneeIds = []`
  forced-overwrite at `:184` (read-only verification, not changed)
- `NotificationBell.svelte` / `NotificationModal.svelte` DOM shape (read-only verification)

## Blast Radius

**Risk class: none of the high-risk classes** (no auth/billing/schema/migration/API/secrets
source change — these specs OBSERVE those surfaces, they do not modify them).

- 3 files total: 2 edited, 1 new.
- Single package: `apps/admin/`.
- Zero runtime/production impact — `apps/admin/e2e/` is never bundled or deployed.
- Shared-state risk: the suite runs `workers: 1, fullyParallel: false` with no per-test DB
  reset. The new spec (Piece 3) and the notification spec (Piece 1) both create incidents and
  must not leave state that breaks a later-running spec in the same file or a sibling file. See
  Piece 3 checklist item 3.4 for the specific mitigation.

## Implementation Checklist

### Piece 1 — `incident-notifications.e2e.ts` (fix stale ARIA + click assumption)

1.1. In test `'assignee is notified of others' activity; own action is silent; mark-all-read
clears it'` (`:50-93`), replace the `:80` query:
```
await expect(page.getByRole('menuitem', { name: new RegExp(TITLE) })).toBeVisible();
```
with a button-role query scoped to exclude the "Mark this notification as read" sibling button
(that button's accessible name is a fixed string `'Mark this notification as read'`, distinct
from `TITLE`, so a `getByRole('button', { name: new RegExp(TITLE) })` query is already
unambiguous — confirm this holds before assuming extra scoping is needed; if `NotificationBell`
renders the title inside a nested element such that the outer `<li>` also matches, add
`.locator('li').filter({ hasText: TITLE })` scoping instead).

1.2. Replace the `:84-85` click-and-navigate block:
```
await page.getByRole('menuitem', { name: new RegExp(TITLE) }).click();
await expect(page).toHaveURL(/\/issues\/\d+$/);
```
with: click the item button, then assert `page.locator('dialog[open]')` becomes visible, then
assert the modal's `<h2>` contains `TITLE` (per `NotificationModal.svelte:99-101`). Do NOT assert
a URL change — the app does not navigate on this click.

1.3. Since the modal opens in-place (no navigation to `/issues/[id]`), the subsequent `:86-88`
block (which re-checks the bell "still works on the detail page") no longer has a natural home —
the test never leaves `/issues`. Close the modal (find its close control — likely an `Escape` key
press or a close button inside `BaseDialog`; confirm via `vc-docs-seeker`/inspection during
EXECUTE, do not guess the exact selector here) and re-assert the bell button is still queryable
in its current unread state on the SAME page, preserving the spirit of "the bell still works
after interacting with the modal" without inventing a navigation that doesn't happen.

1.4. Replace the `:88` duplicate `menuitem` query (post-navigation re-check) with the equivalent
button-role query, adjusted per 1.3's flow.

1.5. Leave `:91-92` (Mark all read → bell clears) unchanged — no ARIA drift there.

1.5a. **Mandatory resilience wrap (closes Gap 1 / E1):** wrap the entire 1.1-1.5 modal-interaction
block (from the initial button query through the "Mark all read" click at `:91-92`) so that "Mark
all read" always executes even if an earlier assertion in that block throws — e.g.
`try { ...1.1-1.5 body... } finally { await page.getByRole('button', { name: 'Mark all read' })
.click().catch(() => {}); }`, or an equivalent `test.afterEach` that unconditionally clears all of
the current test's unread notifications for the owner regardless of pass/fail. This is required,
not optional — without it, any future edit or regression that throws before `:91` silently
reintroduces test 2's cascade failure (documented in 1.6). Document which approach was taken in
the phase report.

1.6. **Do NOT touch test 2** (`'mark a single notification done...'`, `:95-131`) directly. Its
`:113` `"Notifications (2 unread)"` assertion is currently correct in isolation; it only fails
today because test 1 aborts at its old `:80` before reaching "Mark all read" at `:91`, leaving 1
stray unread notification that inflates test 2's count from 2→3. Fixing test 1 so it completes
its `Mark all read` step removes the cross-test leak. After 1.1-1.5, re-run the full file and
confirm test 2 passes with its EXISTING `:113` assertion unmodified. If test 2 still fails after
test 1 is fixed, STOP and report — do not loosen test 2's assertion to compensate; that would
mask a real interaction, not fix a stale selector.

**Validate note (E1 — see Validate Contract):** the 1.1-1.5 rewrite does not add any
try/finally-style resilience around the "Mark all read" step at `:91`. If a future edit to
1.1-1.5 introduces an assertion that throws before `:91` is reached, test 1 aborts early again
and test 2's cascade failure (documented in 1.6) silently returns. See Execute-Agent
Instructions E1 for the required mitigation.

### Piece 2 — `finance-export.e2e.ts` (fix redirect-following)

2.1. At `:28-29` (anonymous request), change:
```
const unauthed = await context.request.get(EXPORT_PATH);
expect(unauthed.status()).toBe(401);
```
to:
```
const unauthed = await context.request.get(EXPORT_PATH, { maxRedirects: 0 });
expect(unauthed.status()).toBe(302);
expect(unauthed.headers()['location']).toBe('/login');
```
Confirm the exact redirect target string by reading `hooks.server.ts:80-90` during EXECUTE (the
plan states `/login` per RESEARCH; verify the literal path/query before hardcoding the string —
some SvelteKit redirect() calls append a `?redirectTo=` query param, which would make an exact
`.toBe()` match brittle; prefer `.toMatch(/^\/login/)` unless the exact string is confirmed static).

**Validate note:** confirmed during VALIDATE — `hooks.server.ts:83-90` returns a raw
`new Response(null, { status: 302, headers: { location: '/login' } })` / `'/enroll-2fa'`
directly (not a SvelteKit `redirect()` helper), so both targets are literal static strings with
no `?redirectTo=` query param. The exact `.toBe('/login')` / `.toBe('/enroll-2fa')` match the
plan already prefers is safe as written — no further hedging needed.

2.2. At `:40-41` (authenticated-but-unenrolled request), change:
```
const gated = await context.request.get(EXPORT_PATH);
expect(gated.status()).toBe(403);
```
to the same `{ maxRedirects: 0 }` + `302` + location-header pattern, expecting `/enroll-2fa` (or
`.toMatch(/^\/enroll-2fa/)` per the same brittleness caveat).

2.3. Do not modify `finance/export/+server.ts:17-18`'s own 401/403 checks (out of blast radius —
this plan is test-only; noted here only so EXECUTE does not "helpfully" simplify them as
apparently-dead code).

### Piece 3 — NEW `incident-self-report.e2e.ts` (net-new coverage)

3.1. Create the file following the existing spec conventions: import `test`/`expect` from
`@playwright/test`, `postgres` + `TEST_DATABASE_URL` from `./config`, reuse the `withSql` /
`userIdByEmail` helper pattern from `incident-notifications.e2e.ts` (either import if exported,
or duplicate the small helper — check whether `incident-notifications.e2e.ts` exports these
first; if not, duplicate locally rather than introducing a new shared-helpers module, to keep
this plan's blast radius to one new file).

**Validate note:** confirmed during VALIDATE — neither `withSql`/`userIdByEmail`
(`incident-notifications.e2e.ts`) nor `loginNonManager` (`incident-detail.e2e.ts`) are exported
(both are plain unexported `function`/`const` declarations). EXECUTE must duplicate both locally;
this resolves 3.1/3.2's open "check whether exported" question — the answer is no.

3.2. Non-manager login: reuse `loginNonManager` from `incident-detail.e2e.ts` if it's exported;
if not exported, duplicate the ~15-line helper locally (same reasoning as 3.1 — do not introduce
a new shared module as part of this plan; a shared-helpers extraction is a separate, larger
refactor out of scope here). **Use `cleo@veent.test` as the non-manager login fixture (closes E4,
non-blocking recommendation)** — `bea@veent.test` is the exact fixture `finance-export.e2e.ts`
depends on remaining un-enrolled in 2FA; driving it through `loginNonManager` would permanently
enroll it and could break that spec if file execution order ever changes. `cleo@veent.test` is
seeded, active, admin role, and confirmed untouched by every other spec in the suite.

3.3. Test — **forced-unassigned security property (highest priority, write first):**
   - Log in as a non-manager (`cleo@veent.test`, per 3.2 — per the `STAFF_PASSWORD` fixture used
     elsewhere in the suite).
   - Navigate to `/issues`, click the "Report an issue" tile (`MyIssuesList.svelte:165-173`).
   - **Sole create action (closes Gap 3 / E3):** do NOT also fill-and-submit the honest UI form
     for this test — `canAssign={false}` means no UI-driven POST can ever include an `assigneeId`
     field, so an honest submission adds no proof value, burns a second incident and a second
     `admin_issue_selfreport` rate-limit slot, and muddies which incident id 3.4's audit-trail
     assertions should target. The RAW TAMPER POST below is the ONLY create action for this test.
   - **Tamper POST (closes Gap 2 / E2):** issue a raw `page.request.post()` (or
     `context.request.post()`) directly against the `?/selfReport` form action with an
     `assigneeId` field manually appended to the FormData, bypassing the UI entirely — this is the
     only way to prove `+page.server.ts:184`'s `parsed.input.assigneeIds = []` override actually
     fires against a hostile client, not just an honest one. The request MUST explicitly pass
     `headers: { origin: TEST_ORIGIN }` (import `TEST_ORIGIN` from `./config`) — SvelteKit's CSRF
     guard 403s any form-content-type POST with a missing/mismatched `Origin` header, and
     Playwright's raw `request.post()` does not auto-attach one the way a real form submit does.
   - **Mandatory pre-assertion (closes Gap 2 / E2):** before asserting anything about the assignee
     list, assert the tamper POST's response is NOT a CSRF rejection — e.g. assert the response
     status is not `403`, or (if the body is inspectable) that it does not contain the CSRF
     "Cross-site POST form submissions are forbidden" text. If this assertion is skipped, a
     regression that reintroduces a missing Origin header would still show "zero assignee rows"
     for the wrong reason (request never reached the action) and the test would be silently
     worthless. Only after confirming the request reached the `selfReport` action should the
     following assertions run.
   - Assert: `SELECT * FROM admin_issue_assignee WHERE issue_id = [id]` returns ZERO rows.
   - Assert: the incident is NOT visible in that user's "My Issues" list, but IS visible in the
     manager's/owner's shared Open pool view (confirms it landed unassigned, not silently
     assigned to the attempted target).

**Validate note (E2, E3 — see Validate Contract, load-bearing):** two concrete gaps found during
VALIDATE that put this test's proof value at risk — see Execute-Agent Instructions E2 (CSRF
Origin-header requirement on the raw tamper POST) and E3 (resolve the ambiguous "submit via DOM
AND raw POST" phrasing to a single raw-POST-only create action). Do not treat 3.3 as correctly
implemented until both are applied.

3.4. Test — **audit trail:** for the incident created in 3.3 (or a fresh one — decide during
EXECUTE based on whether reusing 3.3's incident keeps the spec simpler), assert exactly ONE
`admin_issue_event` row of type `created` exists for that `issue_id`, with `actor_id` equal to
the reporting non-manager's `admin_user.id`. Assert NO `assigned`-type event exists for that
issue (confirms the `:447-461` branch in `createIssue` never fires when `assigneeIds` is empty).

3.5. Test — **`canAssign={false}` contract:** on the self-report form (opened via the tile), assert
the "Assign to" fieldset/legend (`IssueForm.svelte:330` renders `<legend>Assign to</legend>` only
when `canAssign`) is ABSENT from the DOM. Use a negative assertion
(`await expect(page.getByText('Assign to')).toHaveCount(0)` or equivalent) scoped to the open
dialog, not the whole page (avoid false negatives from unrelated "Assign to" text elsewhere).

3.6. Test — **validation failure path:** submit the self-report form with the title field left
empty (or an otherwise-invalid payload per `parseIssueInput`'s known validation rule — confirm
the exact failure condition by reading `parseIssueInput` during EXECUTE if not already known).
Assert the form action returns a failure (visible as a `fail(400, ...)` response — assert either
the redirect does NOT occur / an error message renders in the dialog, per how other `fail()` paths
render in this app's existing specs). Prefer this over exhausting the 30-per-15-min rate limit
(`admin_issue_selfreport`), which would be slow (would require ~30 submissions) and flaky.

3.7. **Shared-state hygiene:** ensure incidents created by this new spec use a `Date.now()`-suffixed
title (matching the `TITLE`/`TITLE2` pattern in `incident-notifications.e2e.ts`) so re-runs and
adjacent specs never collide on title uniqueness. Since `workers: 1, fullyParallel: false` means
this file runs in the same shared DB as every other spec, do not assume a clean slate — query by
this spec's own generated title/id, never by "the most recent incident" or similar ambient state.

### Cross-cutting

3.8. After all 3 pieces are complete, run the FULL `apps/admin` e2e suite once (not just the 3
touched files) to confirm no cross-file leakage was introduced — particularly checking that the
new self-report spec's created incidents don't perturb notification-count assertions in
`incident-notifications.e2e.ts` if execution order ever changes.

## Verification Evidence

| Gate / Scenario | Strategy | Proves SPEC criterion |
|---|---|---|
| `incident-notifications.e2e.ts` test 1 green (modal opens, no menuitem queries) | Hybrid (requires built `apps/admin` preview + throwaway `radius_admin_test` DB) | All 3 specs pass green against the throwaway DB |
| `incident-notifications.e2e.ts` test 2 green WITHOUT modifying its `:113` assertion | Hybrid | Confirms cross-test leak from test 1 is the sole cause; assertion itself was never wrong |
| `finance-export.e2e.ts` both tests green with `302` + `location` assertions | Hybrid | Proves the actual `handleBetterAuth` redirect gate, not a status the app can't return here |
| `incident-self-report.e2e.ts` — forced-unassigned tamper test | Hybrid | Self-report forced-unassigned security property is now under regression protection |
| `incident-self-report.e2e.ts` — audit trail (exactly 1 `created` event, correct `actor_id`) | Hybrid | Standard audit-trail pattern (per `all-context.md`) holds for the self-report path specifically |
| `incident-self-report.e2e.ts` — `canAssign={false}` DOM contract | Hybrid | UI hides assignment from non-managers, consistent with the server-side guarantee |
| `incident-self-report.e2e.ts` — validation failure path | Hybrid | `parseIssueInput` validation applies identically on the self-report path |
| Full suite run (`bun run test:e2e`) after all 3 pieces, no new failures beyond pre-existing gaps | Hybrid | No regression introduced into the shared, non-isolated test DB across all specs |

All rows are Hybrid — every gate requires the built `apps/admin` preview server plus the
throwaway `radius_admin_test` Postgres DB (via `global-setup.ts`), which is not guaranteed
available in every environment without explicit setup. No row is Fully-Automated because none of
these tests can run without that precondition. No row is Agent-Probe or Known-Gap — every stated
scenario is proven mechanically once the harness precondition is met.

### Failing stubs (TDD red-first for the one NEW-behavior area — Piece 3)

Piece 3 is net-new coverage of EXISTING app behavior (not new app behavior), so there is no
red→green code change expected — the stub below exists to anchor EXECUTE's starting point for the
highest-value scenario:

```
Failing stub:
test("self-report POST tamper attempt with assigneeId is force-cleared server-side", async () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: forced-unassigned security property (3.3)")
})
```

## Hard Safety Notes

- **`TEST_DATABASE_URL` MUST resolve to `radius_admin_test`, never the dev DB.** `global-setup.ts`
  runs a **`DROP SCHEMA`** against whatever it's pointed at. Confirm the env var before any local
  run: `apps/admin/e2e/config.ts:11` defaults it to `postgres://root:root@localhost:5432/
  radius_admin_test` — do not override this default when running these gates.
- Suite is `workers: 1, fullyParallel: false` — the 3 pieces above must be run together
  (`bun run test:e2e` for the full file set, or explicitly naming all 3 files) to catch
  cross-test state leakage; running any single file in isolation is insufficient final proof.
- `playwright.config.ts:17` merges `storageState: OWNER_STORAGE_STATE` into EVERY context by
  default, including `browser.newContext()` calls inside a test body. Piece 3's `loginNonManager`
  reuse and any raw tamper-POST in 3.3 MUST explicitly pass empty `storageState: { cookies: [],
  origins: [] }` (imperative `newContext({...})` form) or `test.use({...})` (declarative form) —
  never rely on the default, or the "non-manager" session will silently be the banked owner.

## Test Infra Improvement Notes

(none identified yet)

## Resume and Execution Handoff

1. **Selected plan file path:** `process/features/incident-management/active/
ims-e2e-spec-modernization_20-07-26/ims-e2e-spec-modernization_PLAN_20-07-26.md`
2. **Last completed phase or step:** VALIDATE complete — Gate: PASS after 1 PVL supplement cycle
   (see Validate Contract below). Not yet EXECUTEd.
3. **Validate-contract status:** written 20-07-26 (cycle 2, supersedes the cycle-1 CONDITIONAL) —
   see below.
4. **Supporting context files loaded:** `process/context/all-context.md`,
   `process/context/tests/all-tests.md`, `process/context/planning/all-planning.md`,
   `process/development-protocols/{orchestration,implementation-standards,plan-lifecycle}.md`;
   plus direct reads of `apps/admin/e2e/{incident-notifications,finance-export,
   incident-detail}.e2e.ts`, `apps/admin/e2e/{config,global-setup}.ts`,
   `apps/admin/playwright.config.ts`,
   `apps/admin/src/lib/components/feature/{NotificationBell,NotificationModal,MyIssuesList,
   IssueForm}.svelte`, `apps/admin/src/lib/components/ui/BaseDialog.svelte`,
   `apps/admin/src/routes/(app)/issues/+page.server.ts`,
   `apps/admin/src/routes/(app)/finance/export/+server.ts`, `apps/admin/src/hooks.server.ts`,
   `apps/admin/src/lib/server/issues.ts`, `apps/admin/scripts/seed-test-data.ts`; plus a direct
   read of `@sveltejs/kit`'s `respond.js` to confirm CSRF/Origin-check behavior (re-confirmed
   again this cycle, see Validate Contract Section C).
5. **Next step for a fresh agent:** Gate is PASS — proceed straight to EXECUTE per the checklist
   above. Piece 1 and 2 first (fast, mechanical), Piece 3 last (new file, more judgment calls
   flagged inline for EXECUTE to resolve — e.g. the exact modal-close selector in 1.3).

## Validate Contract

Status: PASS
Date: 20-07-26
date: 2026-07-20
generated-by: outer-pvl
supersedes: 2026-07-20 (outer-pvl) — PVL cycle 1 supplement closed all 3 CONCERNs from the
baseline (2026-07-20) contract; this cycle-2 pass re-verifies each fix directly against the
amended checklist and the live source files it depends on.

Parallel strategy: sequential
Rationale: 7-signal score 1/7 (LOW) — single package (`apps/admin/e2e/`), 3 files, no
schema/auth/API/billing surface change, not a phase program. Only signal present is S5 (the
re-validate brief requested itemized re-verification of each closed gap plus a regression
check). A single sequential deep-read pass (this session) was sufficient — parallel Layer
1/Layer 2 fan-out remains disproportionate overhead for a 3-file, single-package plan.

Test gates (C3 5-column table — ADDITIVE; existing consumers still parse the legacy line form below it):

| criterion id | behavior | strategy | proving test | gap-resolution |
|---|---|---|---|---|
| AC1 | `incident-notifications.e2e.ts` test 1 passes with button/dialog-role queries, no `menuitem` refs remain | Hybrid | `bun run test:e2e -- incident-notifications` (requires built preview + throwaway DB) | B |
| AC2 | `incident-notifications.e2e.ts` test 2 passes unmodified (`:113` "2 unread" assertion untouched) | Hybrid | same run as AC1 | B |
| AC3 | `finance-export.e2e.ts` both tests pass with `302` + `location` header assertions, no stale `401`/`403` assertions remain | Hybrid | `bun run test:e2e -- finance-export` | B |
| AC4a | `incident-self-report.e2e.ts` — forced-unassigned tamper POST discarded server-side (zero `admin_issue_assignee` rows, lands in shared Open pool), with the CSRF-Origin pre-assertion (item 3.3) proving the request actually reached `selfReport` | Hybrid | `bun run test:e2e -- incident-self-report` | B — E2 (Origin header + not-a-403 pre-assertion) and E3 (sole raw-POST create action) are now checklist body (3.3), not merely execute-agent instructions |
| AC4b | `incident-self-report.e2e.ts` — audit trail: exactly 1 `created` event, correct `actor_id`, zero `assigned` events | Hybrid | same run as AC4a | B |
| AC4c | `incident-self-report.e2e.ts` — `canAssign={false}` hides the "Assign to" fieldset in the DOM | Hybrid | same run as AC4a | B |
| AC4d | `incident-self-report.e2e.ts` — validation failure path (`fail(400, ...)` on empty title) | Hybrid | same run as AC4a | B |
| AC5 | Zero changes to any file under `apps/admin/src/**` | Fully-Automated | `git diff --stat apps/admin/src/ \| wc -l` (expect `0`) — run at EXECUTE close, before EVL | A — mechanically checkable now, no precondition |
| AC6 | Full `bun run test:e2e` (all specs) shows no new failures beyond pre-existing known gaps | Hybrid | `bun run test:e2e` (full suite, from `apps/admin/`) | B |

gap-resolution legend:
- A — proven now (gate passes in this cycle)
- B — fixed in this plan (gate added by this plan's checklist)
- C — deferred to a named later phase/plan
- D — backlog test-building stub (named residual; keep-active; continue)

C-4 reconciliation: the `strategy:` column carries ONLY the 3 proving strategies (Fully-Automated / Hybrid / Agent-Probe). Known-Gap is NEVER a `strategy:` value — it is a named residual row carried via gap-resolution D, never a strategy that proves a behavior. (No Known-Gap rows in this plan — every criterion has a live gate.)

Legacy line form (retained so existing validate-contract consumers still parse):
- `apps/admin/e2e/incident-notifications.e2e.ts`: Hybrid: `bun run test:e2e -- incident-notifications` (requires built preview + throwaway `radius_admin_test` DB)
- `apps/admin/e2e/finance-export.e2e.ts`: Hybrid: `bun run test:e2e -- finance-export`
- `apps/admin/e2e/incident-self-report.e2e.ts` (new): Hybrid: `bun run test:e2e -- incident-self-report`
- `apps/admin/src/**` diff check: Fully-automated: `git diff --stat apps/admin/src/ | wc -l` (expect `0`)
- Full suite: Hybrid: `bun run test:e2e` (all 11 specs, from `apps/admin/`)

**AC5 — Failing stub (Fully-Automated row):**
```
Failing stub:
test("should confirm zero changes under apps/admin/src/** after EXECUTE", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub: run `git diff --stat apps/admin/src/ | wc -l` (expect 0) and `git status --porcelain apps/admin/src/` (expect empty, to also catch untracked new files) after EXECUTE closes, before EVL")
})
```

Dimension findings:
- Infra fit: PASS — existing Playwright/vitest harness reused as-is, no new dependencies, no new runtime surfaces. No open concerns.
- Test coverage: PASS — tier assignment correct (all Hybrid, matching the e2e harness's real precondition). The plan's single highest-value gate (AC4a, the tamper-defense test) had two implementation gaps (E2, E3) in the cycle-0 baseline; both are now mandatory checklist body in item 3.3 (see Section C re-check below), closing the "pass/fail for the wrong reason" risk.
- Breaking changes: PASS — confirmed test-file-only, unchanged from cycle 0. Direct reads of every file the plan claims is "read-only verification" confirm none require a source change.
- Security surface: PASS — no source changes; the security property under test (`+page.server.ts:184` forced `assigneeIds = []`, confirmed to gate `createIssue`'s `admin_issue_assignee` insert + `assigned` events at `issues.ts:447-462`) is real and correctly understood. The CSRF/Origin delivery risk (cycle-0 C2) is closed — item 3.3 now mandates the `Origin` header AND an explicit not-a-403 pre-assertion, in the correct order, before any discard assertion runs.

Layer 1 dimensions:

| Layer 1 dimensions | Status |
|---|---|
| Infra fit | PASS |
| Test coverage | PASS |
| Breaking changes | PASS |
| Security surface | PASS |

Layer 2 sections:

| Layer 2 sections | Status |
|---|---|
| Section A — Piece 1 (`incident-notifications.e2e.ts` fix) | PASS |
| Section B — Piece 2 (`finance-export.e2e.ts` fix) | PASS |
| Section C — Piece 3 (`incident-self-report.e2e.ts`, new) | PASS |
| Section D — Cross-cutting (3.7 hygiene, 3.8 full-suite check) | PASS |

**Totals: 0 FAILs / 0 CONCERNs / 8 PASSes (4 dimensions + 4 sections)**

**→ Net Gate: PASS**

### Section A — Piece 1 re-check (cycle-0 Gap 1 / C1)

- Mechanical feasibility: unchanged from cycle 0 — confirmed. `getByRole('button', { name: new
  RegExp(TITLE) })` is unambiguous against `NotificationBell.svelte`; the modal-close control
  exists both natively (`<dialog>` Escape) and via the explicit `IconButton label="Close"` at
  `NotificationModal.svelte:109`.
- Gap 1 / C1 closure verified: item **1.5a** now mandates wrapping the entire 1.1-1.5
  modal-interaction block (button query through the "Mark all read" click at `:91-92`) in a
  `try/finally` (or equivalent unconditional `afterEach` cleanup) so "Mark all read" always
  executes even if an earlier assertion in that block throws. This is written as "required, not
  optional" with an explicit statement of the exact failure mode it prevents (test 2's `:113`
  cascade returning). Standard JS `try/finally` semantics mean an uncaught exception in `try`
  still propagates after `finally` runs, so the test's own pass/fail signal is preserved — the
  wrap only guarantees cleanup runs, it does not swallow the failure. Closed.
- Regression check: 1.5a is scoped entirely to test 1 (1.1-1.5); test 2's `:113` "2 unread"
  assertion is untouched by this addition — confirmed no wording changed in the 1.6 block.
- Conflicts found: none.
- Highest-risk edit + mitigation: unchanged from cycle 0 — 1.2's click+modal-open replacement.
  Mitigation (run `incident-notifications.e2e.ts` alone before the 3.8 full-suite pass) still
  applies and is unaffected by 1.5a.

### Section B — Piece 2 re-check (no change this cycle)

- Not touched by the cycle-1 supplement. Re-confirmed unchanged: both redirect targets
  (`hooks.server.ts:83` `/login`, `:86` `/enroll-2fa`) are literal static strings on a raw
  `Response`, not SvelteKit's `redirect()` helper — no `?redirectTo=` query param risk. Exact
  `.toBe()` matches remain safe. `:113` in `incident-notifications.e2e.ts` (test 2) also
  independently confirmed untouched by this plan's diff.
- Gaps found: none. Conflicts found: none.
- Highest-risk edit + mitigation: unchanged — low risk, `{ maxRedirects: 0 }` is a documented
  option shared by both call sites.

### Section C — Piece 3 re-check (highest-value piece — cycle-0 Gaps 2 & 3 / C2, C3 — read carefully)

- Mechanical feasibility: re-confirmed by direct source read this cycle. `+page.server.ts:184`
  (`parsed.input.assigneeIds = []`) and `issues.ts:447-462` (`createIssue` only inserts
  `admin_issue_assignee` rows / `assigned` events when `assigneeIds.length > 0`) are exactly as
  characterized. `MyIssuesList.svelte:165-173` (the tile), `IssueForm.svelte:328-329` (the
  `canAssign`-gated `<legend>Assign to</legend>`), and `NotificationModal.svelte:99-109`
  (`<h2>` + close `IconButton`) all confirmed unchanged and matching the checklist's citations.
- **Gap 2 / C2 closure verified (load-bearing — this is the item the re-validate brief
  specifically asked to stress-test).** Item 3.3 now reads, in order: (1) issue the raw tamper
  POST with `headers: { origin: TEST_ORIGIN }` explicitly required (`TEST_ORIGIN` confirmed
  exported from `apps/admin/e2e/config.ts` as `'http://localhost:4173'`, matching
  `playwright.config.ts`'s `baseURL`/webServer port); (2) a **mandatory pre-assertion** — before
  any assignee-list assertion — that the response is NOT a CSRF rejection (not-403, or absent
  the CSRF-shaped body text); only then do the `admin_issue_assignee`/pool-visibility assertions
  run. Direct read of the installed `@sveltejs/kit@2.65.1` `respond.js` confirms the exact
  mechanics: `csrf_check_origin` is on by default (`apps/admin/vite.config.ts` sets no
  `kit.csrf.trustedOrigins`), the guard runs whenever `!DEV` (true for the built-preview harness
  this suite requires), and `forbidden = is_form_content_type(request) && [POST/PUT/PATCH/
  DELETE] && request_origin !== url.origin && (!request_origin || not in trustedOrigins)` — a
  missing `Origin` header trips `!request_origin` and 403s before the handler runs, exactly as
  the checklist describes. The ordering requirement is the load-bearing part: without it, a CSRF
  403 (zero rows because the action never ran) and a correct discard (zero rows because the
  action ran and discarded) are indistinguishable from the "zero assignee rows" assertion alone
  — the mandatory not-a-403 pre-assertion is what makes "zero rows" mean what the test claims.
  This checklist text makes it structurally impossible to satisfy 3.3 as written while skipping
  the reached-the-action proof — a green test now cannot exist without exercising
  `+page.server.ts:184`. Closed at PASS strength, not merely CONCERN-mitigated.
- **Gap 3 / C3 closure verified.** 3.3 now states the raw tamper POST is "the ONLY create action
  for this test," with an explicit rationale (an honest UI submit adds no proof value under
  `canAssign={false}` and burns a rate-limit slot). No wording in 3.3 retains the old dual-action
  phrasing. Note: 3.4 (a separate test) says it may reuse 3.3's incident "or a fresh one — decide
  during EXECUTE" — this is 3.4's own independent create decision for the audit-trail test, not a
  second create action inside 3.3, so it does not reopen C3. Non-blocking observation only.
- **C4 (confirmed again this cycle, informational):** neither `withSql`/`userIdByEmail`
  (`incident-notifications.e2e.ts`) nor `loginNonManager` (`incident-detail.e2e.ts`) are
  exported — re-confirmed by direct read. No action needed.
- **E4 / C5 closure verified.** Items 3.2 and 3.3 consistently use `cleo@veent.test`; no stray
  `bea@veent.test` reference remains anywhere in Piece 3. Grep-confirmed: `cleo@veent.test` does
  not appear in any of the 11 existing `apps/admin/e2e/*.e2e.ts` files (only in
  `seed-test-data.ts`'s staff table, seeded active/admin) — genuinely untouched by every other
  spec, exactly as the plan claims. `bea@veent.test` remains scoped to `finance-export.e2e.ts`
  only, so Piece 3 no longer shares a fixture with — or risks permanently 2FA-enrolling — the
  fixture `finance-export.e2e.ts` depends on staying un-enrolled.
- Conflicts found: none.
- Highest-risk edit + mitigation: 3.3 (the raw tamper POST) remains the highest-risk edit in the
  plan and the one gate with genuine bug-finding value — both gaps that put its proof value at
  risk are now closed in the checklist body itself, not deferred to execute-agent discretion.

### Section D — Cross-cutting re-check (no change this cycle)

- Not touched by the cycle-1 supplement. Re-confirmed unchanged: `Date.now()`-suffixed titles,
  querying by generated title/id rather than ambient state, `workers: 1, fullyParallel: false`
  suite semantics, `playwright.config.ts:17` default `storageState: OWNER_STORAGE_STATE`
  requiring explicit empty-`storageState` overrides for non-owner sessions, and
  `TEST_DATABASE_URL`/`DROP SCHEMA` safety (`config.ts:11` default `radius_admin_test`) all
  re-verified against current source.
- Gaps found: none. Conflicts found: none.
- Highest-risk edit + mitigation: n/a — verification-only, no new edit surface.

### Execute-Agent Instructions

All four (E1-E4) are now checklist body (items 1.5a, 3.2, 3.3) rather than standalone
execute-agent instructions — retained here only as a cross-reference, not as outstanding work:

| # | Instruction | Now lives at | Status |
|---|---|---|---|
| E1 | try/finally (or equivalent) around 1.1-1.5's "Mark all read" cleanup | Checklist 1.5a | Applied |
| E2 | `headers: { origin: TEST_ORIGIN }` + not-a-403 pre-assertion, ordered before discard assertions | Checklist 3.3 | Applied |
| E3 | Raw tamper POST is the sole create action for 3.3 | Checklist 3.3 | Applied |
| E4 | `cleo@veent.test` instead of `bea@veent.test` | Checklist 3.2/3.3 | Applied |

What this coverage does NOT prove:
- AC1/AC2 (Hybrid, `bun run test:e2e -- incident-notifications`): does not prove the notification
  feed's read-model correctness under concurrent writers (two staff acting on the same incident
  simultaneously) — only the single-actor sequence this suite already exercises.
- AC3 (Hybrid, `bun run test:e2e -- finance-export`): does not prove the CSV export's row-level
  content correctness (masking, PII redaction) — only the auth/2FA gate at the endpoint boundary.
- AC4a-d (Hybrid, `bun run test:e2e -- incident-self-report`): does not prove the tamper defense
  holds against a POST that omits the `Origin` header entirely while ALSO spoofing a valid session
  cookie from a genuinely different origin (a real cross-site attacker) — the checklist's
  3.3-mandated test proves the server discards the assignee list for an authenticated,
  same-origin-headed request; it does not independently re-verify that SvelteKit's CSRF guard
  itself is correctly configured (framework-level behavior, out of this plan's scope, confirmed
  by direct source read during VALIDATE, not by a new test).
- AC5 (Fully-Automated, `git diff --stat`): proves no *file content* changed under
  `apps/admin/src/**`; does not prove no *new file* was added there (a `wc -l` on `git diff
  --stat` output would still show `0` for an added-then-untracked file — the AC5 failing stub
  above recommends EXECUTE also run `git status --porcelain apps/admin/src/` before closing).
- AC6 (Hybrid, full suite): proves no *new* failure relative to the pre-existing 3-spec known-flaky
  baseline documented in `all-tests.md` §Known Gaps; does not re-verify those pre-existing gaps
  are still exactly the same 3 specs (that comparison is a manual read of the run output, not
  automated by this gate).
(No remaining "required until" caveat — C2/C3 are now closed in the checklist body, not
deferred to a future implementation step.)

Open gaps: none. All 3 cycle-0 CONCERNs (C1, C2, C3) and the 1 non-blocking recommendation (C5/
E4) are closed in the checklist body and independently re-verified this cycle against live
source. No FAILs found in this pass or the prior pass.

Gate: PASS (0 FAILs, 0 CONCERNs — all cycle-0 gaps closed and re-verified against current
source; supersedes the 20-07-26 CONDITIONAL baseline after 1 completed PVL supplement cycle)
Accepted by: N/A — Gate is PASS; no outstanding CONCERNs require explicit user acceptance.

## Autonomous Goal Block

```
SESSION GOAL: Modernize 2 broken IMS e2e assertions + add self-report tamper-defense coverage
Charter + umbrella plan: N/A — single plan (no phase program, no umbrella)
Autonomy: standard RIPER-5 gates apply — no standing /goal for this plan. EXECUTE requires
explicit "ENTER EXECUTE MODE". VALIDATE gate is now PASS (cycle 2) — no CONCERNs remain to
accept; the prior CONDITIONAL gate's acceptance requirement no longer applies.
Hard stop conditions / safety constraints:
- Any edit to a file under apps/admin/src/** is a STOP-and-report condition, not a checklist
  item (plan is test-only; a source change means the plan's own premise — these are test
  regressions, not product bugs — was wrong).
- TEST_DATABASE_URL must resolve to radius_admin_test (config.ts default) — never point
  E2E_DATABASE_URL at the dev DB; global-setup.ts runs DROP SCHEMA against whatever it's given.
- Item 3.3 (the tamper-defense test) MUST include the Origin header AND the not-a-403
  pre-assertion, ordered before the discard assertions — this is now checklist body, not merely
  a recommendation; see Validate Contract Section C for why the ordering is load-bearing.
Next phase: EXECUTE (unblocked — Gate: PASS)
Validate contract: inline in this plan file, section "## Validate Contract" above
Execute start: bun run test:e2e -- incident-notifications | bun run test:e2e -- finance-export |
bun run test:e2e -- incident-self-report | bun run test:e2e (full suite, checklist 3.8) |
git diff --stat apps/admin/src/ | wc -l (expect 0, checklist AC5) | high-risk pack: no
```
