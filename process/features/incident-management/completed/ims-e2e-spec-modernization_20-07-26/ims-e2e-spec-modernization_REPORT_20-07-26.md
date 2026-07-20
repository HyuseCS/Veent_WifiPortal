---
phase: ims-e2e-spec-modernization
date: 2026-07-20
status: COMPLETE
feature: incident-management
plan: process/features/incident-management/active/ims-e2e-spec-modernization_20-07-26/ims-e2e-spec-modernization_PLAN_20-07-26.md
---

# EXECUTE report — IMS e2e spec modernization

All 3 pieces implemented, test-only. Full admin e2e suite: **23/23 passed**. Zero changes under
`apps/admin/src/**`.

## What Was Done

### Piece 1 — `apps/admin/e2e/incident-notifications.e2e.ts`
- Replaced both stale `getByRole('menuitem', ...)` queries with a button-role query **scoped to the
  panel region** (`getByRole('region', { name: 'Notifications' })`). Panel scoping was required, not
  optional: an unscoped title query hit 3 elements (the notification entry plus the manager board's
  `Edit <title>` / `Delete <title>` icon buttons) and failed Playwright strict mode. Plan item 1.1
  anticipated this ("add scoping instead").
- Replaced the click→`toHaveURL(/\/issues\/\d+$/)` navigate assertion with: click entry → assert
  `dialog[open]` visible → assert the modal heading contains `TITLE` → close via the modal's
  `Close` `IconButton` → assert the modal is hidden and the bell is queryable in its post-close
  state (items 1.2–1.4).
- **Item 1.5a (mandatory resilience wrap): implemented as `try/finally`.** The `finally` calls a new
  local `markEverythingRead(ownerId)` helper — a single idempotent
  `INSERT ... SELECT ... ON CONFLICT DO NOTHING` that parks a read row on every existing event for
  the owner. This is the "equivalent unconditional cleanup" 1.5a permits, chosen over a UI click
  because it cannot itself throw or time out on a missing element. It runs on pass *and* fail, so a
  future throw before the cleanup can never re-open test 2's cascade.
- **Item 1.6 honoured: test 2 was not touched.** Its `:113` `"Notifications (2 unread)"` assertion is
  byte-identical and passes.

### Piece 2 — `apps/admin/e2e/finance-export.e2e.ts`
- Both `context.request.get()` calls now pass `{ maxRedirects: 0 }` and assert `302` +
  `location` (`/login`, `/enroll-2fa`). Exact `.toBe()` matches are safe as the VALIDATE note
  confirmed — `hooks.server.ts:83-90` returns a raw `Response` with a literal static `location`, not
  a SvelteKit `redirect()` helper, so there is no `?redirectTo=` query param.
- Updated the file docblock and the test name to describe the hop actually being pinned.
- **Item 2.3 honoured:** `finance/export/+server.ts:17-18`'s own 401/403 checks were not touched.

### Piece 3 — `apps/admin/e2e/incident-self-report.e2e.ts` (NEW, 4 tests)
- `withSql` / `userIdByEmail` / `loginNonManager` duplicated locally (VALIDATE confirmed none are
  exported); no new shared-helpers module introduced.
- Uses `cleo@veent.test` (item 3.2 / E4). `bea@veent.test` untouched, so `finance-export.e2e.ts`'s
  dependency on bea staying un-enrolled is intact.
- **Test 1 — forced-unassigned tamper defence (AC4a, the load-bearing gate).** A single raw
  `page.request.post('/issues?/selfReport')` with `assigneeId` appended is the **sole create action**
  (item 3.3 / E3). It carries `headers: { origin: TEST_ORIGIN }` (E2). The
  **CSRF pre-assertion runs first**: `expect(res.status()).not.toBe(403)` followed by
  `expect(body.type).toBe('success')` — only then do the discard assertions run
  (zero `admin_issue_assignee` rows; absent from the reporter's "My Issues"; present in the pool tab
  and on the manager board). Ordering is exactly as the plan mandates.
- Test 2 — audit trail: exactly 1 `created` event with `actor_id` = reporter, zero `assigned` events.
- Test 3 — `canAssign={false}`: `Assign to` has count 0 **scoped to the open dialog**; the
  unassigned-hint text is present; the form posts to `?/selfReport`.
- Test 4 — validation failure: raw POST with a blank title returns an action-JSON
  `{ type: 'failure', status: 400 }` containing `Title is required.` (a DOM submit cannot produce
  this — the title input is `required`).
- Item 3.7 honoured: `Date.now()`-suffixed title, all DB lookups keyed by that generated title.

## What Was Skipped or Deferred

Nothing. All checklist items 1.1–3.8 plus AC5 completed.

## Test Gate Outcomes

| Gate | Command | Result |
|---|---|---|
| AC1/AC2/AC3/AC4a-d | `bun run test:e2e -- incident-notifications finance-export incident-self-report` | **8 passed (51.5s)** |
| AC5 | `git diff --stat apps/admin/src/ \| wc -l` | **0** |
| AC5 (untracked-file check) | `git status --porcelain apps/admin/src/` | **empty** |
| AC6 | `bun run test:e2e` (full suite) | **23 passed (1.1m)** |

Pre-existing known-flaky baseline (`incident-detail`, `incident-notifications`, `incident-timeline`
per `all-tests.md` §Known Gaps): **all three now green**. No new failures anywhere.

DB safety verified before any run: `E2E_DATABASE_URL` unset → `config.ts:11` default
`postgres://root:root@localhost:5432/radius_admin_test`; the dev DB in `apps/admin/.env` is
`.../local`. Distinct databases — `global-setup.ts`'s `DROP SCHEMA` never pointed at dev.

## Plan Deviations

**One, within blast radius (test file only), reported per hard-safety-constraint discipline:**

- **Item 1.5 — one line added before the untouched `:91-92` block.** Closing the notification
  preview modal is itself a read event (`NotificationBell.svelte:53-59` fires `markOne` +
  `invalidateAll` on close), so by the time control reached the "Mark all read" step the owner's
  unread count was already 0 and the panel's `Mark all read` form is not rendered when
  `notifications.length === 0`. Rather than weaken or drop the step, I re-arm the feed with one
  extra `insertEvent(id, adrianId, 'priority_changed', ...)` + reload, then run the **unchanged**
  `Mark all read` click and its `Notifications` exact-name assertion. Net effect: `:91-92`'s
  assertions are preserved verbatim and still prove what they claimed; nothing was loosened.

No source change was needed anywhere — the plan's premise (these were test regressions, not product
bugs) held for all three pieces.

## Test Infra Gaps Found

- `incident-notifications.e2e.ts`'s panel-scoping requirement is a general trap in this suite:
  incident titles appear on the manager board as a link **and** inside `Edit <title>` /
  `Delete <title>` icon-button labels, so any page-wide `getByRole('button'|'link', { name: title })`
  is at risk of strict-mode ambiguity. Worth remembering when writing future incident specs.
- Not proven (out of scope, no gate added): that removing the `Origin` header from the tamper POST
  would actually produce a 403. The CSRF guard's behaviour was confirmed by direct source read of
  `@sveltejs/kit@2.65.1` `respond.js` during VALIDATE, not by a live negative-control run. The
  pre-assertion is structurally present and correctly ordered, which is what the plan required.

## Closeout Packet

- **Selected plan:** `process/features/incident-management/active/ims-e2e-spec-modernization_20-07-26/ims-e2e-spec-modernization_PLAN_20-07-26.md`
- **Finished:** all 3 pieces, all 8 acceptance criteria.
- **Verified:** every Hybrid gate ran for real against the throwaway DB (not reasoned about); AC5 ran
  mechanically. Full-suite cross-check green.
- **Still unverified:** the CSRF negative control noted above.
- **Remaining cleanup:** archive the plan; update `process/context/tests/all-tests.md` (the "3/10
  admin E2E specs have known-flaky residuals" Known Gap is now stale — all resolved; spec count is
  now 12 files / 23 tests, not 10); close the
  `backlog/ims-e2e-spec-modernization_NOTE_10-07-26.md` backlog item.
- **Best next state:** `Ready for UPDATE PROCESS archival`.
- **Not committed** — changes left in the working tree per instruction.

## Forward Preview

- **Test Infra Found:** admin e2e suite is 12 spec files / 23 tests, all green, ~1.1 min end-to-end
  including build + seed + 2FA enrollment.
- **Blast Radius Changes:** `apps/admin/e2e/` only — 2 files modified, 1 added. No source, schema,
  auth, or API surface touched.
- **Commands to Stay Green:** `cd apps/admin && bun run test:e2e`
- **Dependency Changes:** none.
