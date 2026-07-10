---
name: plan:ims-audit-remediation
description: "Remediate all 13 findings (2H, 5M, 6L) from the PR #74 Incident Management System audit across apps/admin + packages/db, in 5 phases"
date: 10-07-26
feature: incident-management
---

# IMS Audit Remediation (PR #74) — Implementation Plan

**Date**: 10-07-26
**Status**: ✅ COMPLETE — all 5 phases executed, PVL Gate: PASS, EVL confirmed. All 13 findings
remediated. Fully-automated gates green (138/138 admin unit tests, root `check`, `packages/db`
tsc clean). Repo-wide `bun run lint` fails on a pre-existing, unrelated prettier-config path
drift (known-gap, backlog note filed). 4/7 IMS e2e specs pass; 3 residuals are test-side only
(known-gap, backlog note filed) — no app regression. User manually browser-verified H2 (card +
detail note persistence) and the status-dropdown sync fix, and accepted the remaining scenarios.
Work is committed (`5a78dbe`, `dec95bc`, `9fa956a`, `73cef82`) except one file — see
UPDATE PROCESS closeout for a flagged pre-existing-drift item unrelated to this plan's scope.
Archived to `completed/` at UPDATE PROCESS 10-07-26.
**Complexity**: COMPLEX (5 phases, one schema migration, security surface — stored-XSS + auth/notification predicates)
**Feature:** incident-management
**Selected plan path:** `process/features/incident-management/active/ims-audit-remediation_10-07-26/ims-audit-remediation_PLAN_10-07-26.md`
**Audit reference artifact:** `process/features/incident-management/active/ims-audit-remediation_10-07-26/ims-audit-remediation_AUDIT_10-07-26.md` (moved from repo-root `audit.md` via `git mv`)

---

## Overview

Fix all 13 findings from the re-verified PR #74 audit (merge `ccb2e02`, `feat/admin/IMS` → `staging`):
2 High, 5 Medium, 6 Low. RESEARCH is complete — every finding was re-verified against staging on
2026-07-10 with exact `file:line` citations (see the audit reference artifact and the prior-research
fact sheet). This plan structures that verified material into 5 phases in the audit's fix order. It
does NOT re-open research or change locked decisions.

Context routing consulted: `process/context/all-context.md` → `process/context/database/all-database.md`
(migration workflow + journal-drift gotcha, relevant to Phase 1) and `process/context/tests/all-tests.md`
(test commands + throwaway `radius_admin_test` e2e harness quirks).

### Goals

- Close the two severe findings first: H1 stored-XSS via unvalidated `sentryPermalink`, H2 silent
  resolution-note drop.
- Fix the notification/endpoint predicate correctness bugs (M1, L4, M3).
- Remove committed secrets (M2), unify validation (M4), clear design-drift comments (M5), and clean
  up the Lows (L1–L6).
- Every phase leaves the 18 existing IMS unit tests green and adds targeted new tests.

### Scope

- **In scope:** all H + M + L findings. Phases 1–5 below.
- **Out of scope (backlog):** Sentry permalink host pinning (H1 hardening), `sentryIssueId`
  provenance check vs Sentry API (M4d), manager-board pagination + event-history-on-expand (L3
  ships a ceiling comment only, no pagination now). See `## Backlog`.

---

## Locked Design Decisions (user-approved 2026-07-10)

1. **H2 audit trail:** introduce a new `note_edited` event type. This requires ONE small migration
   relaxing the `admin_issue_event_type_ck` CHECK constraint
   (`packages/db/src/schema/admin-issue-event.ts:36,42-45` — the column is `text` + a CHECK list,
   NOT a pg enum). Note editing does NOT become a notifiable event (deliberate — documented in code).
2. **L4:** notify the person who was removed (unassigned). Implemented as an audience exception in the
   notification feed queries, folded into the same predicate restructure as M1.
3. **Scope:** all H + M + L findings, 5 phases in the audit's fix order. **L3 gets a ceiling comment +
   backlog stub only — no pagination now.**

---

## Phase Completion Rules

- A phase is **CODE DONE** when its checklist items are implemented and its per-phase automated gates
  (`cd apps/admin && bun run test`, root `bun run check`, `bun run lint`) pass.
- A phase is **✅ VERIFIED** only after CODE DONE **and** its verification evidence is captured — for
  UI-visible phases this REQUIRES both an agent browser pass and a human verification handoff (user confirmed). Code-only completion is never `VERIFIED`.
- Phase 1 additionally requires the migration DDL to be applied to the local dev DB (push-managed) and
  the generated migration file kept for the prod chain.
- Agents never commit. Each phase ends with staged changes + a suggested conventional-commit message;
  the user commits.

---

## Touchpoints

Files this plan changes or reads (all citations verified in prior research):

**Phase 1 (H1, H2)**
- `apps/admin/src/routes/(app)/sentry/+page.server.ts` — `?/track` action (:85-90; due-date NaN block :99-106)
- `apps/admin/src/lib/server/sentry/map.ts` — `httpsUrl()` (:19-21); export + add snapshot-validation helper
- `apps/admin/src/lib/server/sentry/map.test.ts` — extend
- `packages/db/src/schema/admin-issue-event.ts` — CHECK list (:36, :42-45) + new migration
- `apps/admin/src/lib/server/issues.ts` — `ISSUE_EVENT` (:33-41), `eventSummary()` (:363-388),
  `recordEvent()` (:405-424), `setIssueStatus()` (:621-661; short-circuit :637; comment :635-636)
- `apps/admin/src/routes/(app)/issues/[id]/+page.server.ts` — `?/updateStatus` caller (:72-73)
- `apps/admin/src/routes/(app)/issues/+page.server.ts` — updateStatus caller (:236-237)
- `apps/admin/src/lib/components/feature/Timeline.svelte` — META map (:24-32)
- `apps/admin/src/lib/server/issues.test.ts` — extend

**Phase 2 (M1, L4, M3)**
- `apps/admin/src/lib/server/notifications.ts` — `notifWhere()` (:47-53), innerJoin sites
  unreadCount (:60), listNotifications (:96), markAllNotificationsRead (:137), NOTIFIABLE_EVENTS (:24-30)
- `apps/admin/src/routes/(app)/issues/[id]/detail/+server.ts` — `isPoolItem` (:29-30) + `ISSUE_STATUS` import from `@veent/core` (G2)
- `apps/admin/src/lib/server/notifications.test.ts` — extend

**Phase 3 (M2)**
- `apps/admin/e2e/.auth/owner.json`, `apps/admin/e2e/.auth/owner-totp.txt` — `git rm --cached` (tracked despite gitignore)

**Phase 4 (M4, M5)**
- `apps/admin/src/lib/server/formValidation.ts` — NEW: shared `parseDueDate(raw, existingDueMs?)`
- `apps/admin/src/routes/(app)/issues/+page.server.ts` — `parseIssueInput()` (:106-142); title/description caps
- `apps/admin/src/routes/(app)/sentry/+page.server.ts` — `?/track` due-date, `?/selfReport`, `?/comment` rate limits
- `apps/admin/src/lib/server/rateLimit.ts` — `rateLimit(scope, identifier, max, windowMs)` (:19-21) reused
- `apps/admin/e2e/incident-notifications.e2e.ts` — stale watermark header comment (:1-10)
- new/extended tests for `formValidation.ts`

**Phase 5 (Lows)**
- `apps/admin/src/lib/components/ui/BaseDialog.svelte` — backdrop dismiss (:52-58, onclick :64)
- `apps/admin/src/routes/(app)/issues/+page.server.ts` (:164,:201) + `sentry/+page.server.ts` (:130) — `void notifyAssignees`
- `packages/core/probe.sample.ts` — delete
- `apps/admin/src/lib/components/feature/NotificationBell.svelte` — role/aria (:97,:104-115,:122,:136-153)
- `apps/admin/src/lib/components/.../Sidebar.svelte` (:174-179), `MobileDrawer.svelte` (:173-178) — badge aria
- `apps/admin/src/lib/server/notifications.ts` — `markNotificationRead` comment (:123-129)
- `apps/admin/src/routes/(app)/issues/+page.server.ts` — manager-branch ceiling comment (L3)

---

## Public Contracts

- **`setIssueStatus` return type changes** (H2): `boolean` → `'updated' | 'unchanged' | 'not_found'`.
  Both callers (`issues/[id]/+page.server.ts:72-73`, `issues/+page.server.ts:236-237`) must be
  updated in the same phase — `'not_found'` → `fail(404)`. This is an internal server-module contract
  (module-private consumers only), not a public HTTP API change.
- **New DB event type `note_edited`** (H2): relaxes `admin_issue_event_type_ck`. Additive to the CHECK
  list; forward-compatible; migration file generated for the prod chain.
- **`?/track` action** (H1): now rejects non-`https://` permalinks with `fail(400)` and format-checks
  `sentryIssueId` / `sentryShortId` / caps `sentryTitle`. Legit UI always sends https, so no
  behavioral regression for real clients.
- **New rate-limit scopes** (M4c): `admin_issue_selfreport`, `admin_issue_comment` (30 / 15 min,
  userId-keyed, `fail(429)` same shape as `admin_sentry_track`).
- **New shared helper `parseDueDate`** (M4a) in `apps/admin/src/lib/server/formValidation.ts`.
- Notification feed audience predicate (M1/L4) changes which rows a user sees; read-state is
  event×user scoped so mark-one/mark-all behavior is unchanged.

---

## Blast Radius

- **Packages:** `apps/admin` (all phases), `packages/db` (Phase 1 migration only).
- **File count:** ~20 files across 5 phases; no phase exceeds ~8 files.
- **Risk class:** HIGH — stored-XSS fix (H1, security/trust-boundary), schema migration (H2), auth/
  notification-audience predicate changes (M1/L4/M3), committed-secret removal (M2). Per the
  high-risk execution handoff rule, EXECUTE runs on opus and browser-visible changes require an agent
  browser pass + human verification handoff before closeout.
- **Regression surface:** the 18 existing IMS unit tests (issues.test.ts ×13 + notifications.test.ts ×5)
  and the 4/5 IMS e2e specs (throwaway `radius_admin_test` harness).

---

## Implementation Checklist

### Phase 1 — High severity (H1 + H2)

**H1 — stored XSS via unvalidated `sentryPermalink`**
1. Export `httpsUrl()` from `sentry/map.ts` and add a small exported snapshot-validation helper next
   to it (unit-testable): non-empty `sentryPermalink` failing the `https://` gate → reject; format-check
   `sentryIssueId` against `/^\d{1,32}$/`, `sentryShortId` against `/^[A-Za-z0-9._-]{0,64}$/`, cap
   `sentryTitle` ≤ 500.
2. In `?/track` (`sentry/+page.server.ts`), call the helper; on failure `fail(400)` with
   `'Invalid Sentry permalink.'` (reject loudly — legit UI always sends https from the Sentry API).
3. Extend `sentry/map.test.ts` with `javascript:`/non-https rejection + valid-https pass + format-check cases.

**H2 — resolution-note edits silently dropped**
4. Migration: relax `admin_issue_event_type_ck` CHECK to add `'note_edited'`
   (`packages/db/src/schema/admin-issue-event.ts:36,42-45`). Generate the migration file.
5. Add `ISSUE_EVENT.noteEdited` (`issues.ts:33-41`) + `eventSummary()` case ("updated the resolution
   note") (:363-388).
6. Change `setIssueStatus` (:621-661): return `'updated'|'unchanged'|'not_found'`; add `resolutionNote`
   to the `before` query (currently selects only `status`); same-status branch — when `resolved` AND
   the note differs → update `resolutionNote` + `updatedAt`, `recordEvent(tx, {type: note_edited,
   note: newNote})`, return `'updated'`; unchanged note → `'unchanged'`. Rewrite the :635-636 comment.
7. Update both callers: `'not_found'` → `fail(404)`; add `resolutionNote ≤ 2000` cap (pre-satisfies
   part of M4b). Callers at `issues/[id]/+page.server.ts:72-73` and `issues/+page.server.ts:236-237`.
8. Add Timeline META entry for `note_edited` (`Timeline.svelte:24-32`): `PenLine` icon, `text-ink` tone.
9. Leave `NOTIFIABLE_EVENTS` unchanged — add a code comment explaining note edits are deliberately
   not notifiable.
10. Client flows self-heal (My Issues card + detail page auto-submit) — NO component changes; verify in browser.
11. Tests (`issues.test.ts`): update "records nothing when unchanged" (still true for non-resolved);
    add resolved+changed-note → note_edited, resolved+same-note → no-op, missing-id → `'not_found'`.

**Phase 1 gates:** `cd apps/admin && bun run test` (18 green + new) · root `bun run check` · `bun run lint`
· **`cd packages/db && bunx tsc --noEmit` (G3 — typecheck the `admin-issue-event.ts` schema edit; root `bun run check` fans out to `apps/*` only and does NOT cover `packages/db`; equivalently, assert a clean `db:generate` diff for the CHECK relaxation)**
· apply CHECK DDL directly to local dev DB (push-managed — see database context), keep the generated
migration file. Suggested commit: `fix(admin/issues): validate Sentry permalink and persist resolution-note edits`.

### Phase 2 — Feed/endpoint predicates (M1 + L4 + M3)

12. **M1 + L4** — one restructure in `notifications.ts` across all 3 query sites (unreadCount :60,
    listNotifications :96, markAllNotificationsRead :137): innerJoin → leftJoin with ON
    `(issueId match AND adminUserId = userId AND assignedAt <= event.createdAt)` — the `assignedAt`
    bound IS M1. Audience predicate: `and(inArray(type, NOTIFIABLE), actor ≠ userId,
    or(isNotNull(assignee.adminUserId), and(eq(type,'unassigned'), eq(toValue, userId))))` — the OR
    branch IS L4 (removed person sees their own unassignment). Read-state is event×user scoped —
    markOne/markAll unchanged. Do NOT add an index (`admin_issue_assignee_user_idx` exists).
13. **M3** — `detail/+server.ts:29-30`:
    `isPoolItem = issue.assignees.length === 0 && issue.status === ISSUE_STATUS.open;`
13a. **M3 import (G2)** — `ISSUE_STATUS` is NOT currently imported in
    `apps/admin/src/routes/(app)/issues/[id]/detail/+server.ts`. Its canonical source is `@veent/core`
    (verified cycle-2: `issues.ts` imports it from `@veent/core` and does NOT re-export it). That file
    already imports `getAdminRole, MANAGER_ROLES` from `@veent/core` — add `ISSUE_STATUS` to THAT
    existing `@veent/core` import, NOT to the `$lib/server/issues` import. Without this the M3
    predicate will not typecheck.
13b. **M3 proof (G4)** — the M3 predicate has no dedicated unit test; its automated proof is
    `bun run check` (import + type) plus the admin e2e `incident-detail` spec. Add/name this
    assertion in that spec: **a resolved-and-unassigned incident returns 404 to a non-assignee staff
    member** (and stays readable to an assignee).
14. Tests (`notifications.test.ts`): assert **JS-level shape only** — `NOTIFIABLE_EVENTS` membership,
    predicate/row mapping, and self-action exclusion at the JS layer. NOTE (G1): the `fakeDb` Proxy
    returns canned rows regardless of the WHERE/JOIN predicate, so the unit test CANNOT prove the M1
    `assignedAt` SQL bound or the L4 OR-predicate. Real SQL-filter proof is the admin e2e
    `incident-notifications` spec (Hybrid) + browser scenario 4 (Agent-Probe).

**Phase 2 gates:** test + check + lint. Suggested commit:
`fix(admin/issues): scope notification feed to post-assignment events and open-pool detail`.

### Phase 3 — Committed secrets (M2)

15. Stage `git rm --cached apps/admin/e2e/.auth/owner.json apps/admin/e2e/.auth/owner-totp.txt`
    (STAGE ONLY — user commits). gitignore already covers `e2e/.auth/`.
16. Note in the phase report: throwaway harness regenerates creds (TOTP re-enroll) on next e2e run;
    the committed secret is in history and should be rotated.

**Phase 3 gates:** `git status` shows the two files staged for removal; check + lint unaffected.
Suggested commit: `chore(admin/e2e): stop tracking throwaway auth session + TOTP artifacts`.

### Phase 4 — Validation consistency + comment drift (M4 + M5)

17. **M4a** — extract shared `parseDueDate(raw, existingDueMs?)` into
    `apps/admin/src/lib/server/formValidation.ts` (UTC-midnight + NaN check + past-date rejection with
    grandfathering, mirroring `parseIssueInput` :125-138). Add unit tests.
18. Use `parseDueDate` in `parseIssueInput` AND in `?/track` (`sentry/+page.server.ts:99-106` currently
    NaN-check only, no past-date check).
19. **M4b** — title ≤ 200 + description ≤ 5000 caps in `parseIssueInput` (snapshot + resolutionNote
    caps already landed in Phase 1).
20. **M4c** — `rateLimit('admin_issue_selfreport', userId, 30, 15*60*1000)` on `?/selfReport`;
    `rateLimit('admin_issue_comment', userId, 30, 15*60*1000)` on `?/comment`; `fail(429)` same shape
    as track.
21. **M5** — rewrite the stale watermark header comment in `incident-notifications.e2e.ts:1-10` to the
    per-event read-row model. (Migrations 0042/0043 already merged — no schema action.)

**Phase 4 gates:** test + check + lint. Suggested commit:
`fix(admin/issues): unify due-date + length validation and rate-limit self-report/comment`.

### Phase 5 — Lows (L1, L2, L5, L6; L3 ceiling comment only)

22. **L1** — `BaseDialog.svelte`: on `onpointerdown` record press-started-on-backdrop
    (`e.target === el` + outside rect); click handler dismisses only when pressOnBackdrop AND
    `e.target === el` AND outside rect → `open = false`; reset the flag.
23. **L2** — `await notifyAssignees` → `void notifyAssignees` at the 3 sites
    (`issues/+page.server.ts:164,201`, `sentry/+page.server.ts:130`) — it never throws; node/VPS runtime.
24. **L5** — delete `packages/core/probe.sample.ts` (unreferenced; proper probe-router.ts exists in `packages/core/scripts/`).
25. **L6a** — `NotificationBell.svelte`: drop `role="menu"`/`menuitem` for a labelled panel + list;
    remove `aria-live` from the remounting `<ul>` (:122).
26. **L6b** — fold the unread count into the link's accessible name (sr-only) in `Sidebar.svelte:174-179`
    + `MobileDrawer.svelte:173-178`; remove the `<span>` `aria-label`.
27. **L6c** — one-line comment amendment on `markNotificationRead` (:123-129) covering the
    real-but-invisible-incident case.
28. **L3** — ceiling comment on the manager branch of `/issues` load (upgrade path: paginate + fetch
    event history on expand via existing `/issues/[id]/detail`); add the backlog stub. No pagination now.

**Phase 5 gates:** test + check + lint + Svelte a11y lint clean. Suggested commit:
`fix(admin/issues): dialog dismiss + notification a11y + drop stray probe script`.

### Final (after Phase 5)

29. Run admin e2e (throwaway `radius_admin_test` harness; `TEST_ENV` blanks RESEND) — the 5 IMS specs.
30. Browser verification: agent browser pass + human verification handoff (see `## Verification Evidence`).
31. **High-risk evidence pack (G5)** — before treating the work as ready for closeout, produce the
    `vc-risk-evidence-pack` 5-artifact set under `{task-folder}/harness/`
    (`process/features/incident-management/active/ims-audit-remediation_10-07-26/harness/`) covering the
    HIGH-risk classes present (stored-XSS/trust-boundary H1, schema migration H2, auth/notification
    predicate M1/L4/M3, committed-secret M2). The plan must NOT rely on the browser handoff alone. See
    the `vc-risk-evidence-pack` skill for the 5-artifact schema.

---

## Public Contracts change summary (execute-agent quick reference)

| Change | Phase | Callers to update in same phase |
|---|---|---|
| `setIssueStatus` return `'updated'\|'unchanged'\|'not_found'` | 1 | `issues/[id]/+page.server.ts:72-73`, `issues/+page.server.ts:236-237` |
| new `note_edited` event type + CHECK migration | 1 | Timeline META, eventSummary |
| `?/track` https/format validation | 1 | UI unaffected (always https) |
| notification audience predicate (M1/L4) | 2 | 3 query sites in notifications.ts |
| new rate-limit scopes | 4 | `?/selfReport`, `?/comment` |

---

## Verification Evidence

| Gate / Scenario | Strategy | Proves SPEC criterion |
|---|---|---|
| `cd apps/admin && bun run test` — 18 existing IMS unit tests stay green | Fully-Automated | No regression across all phases |
| `sentry/map.test.ts`: `javascript:`/non-https permalink → reject; valid https → pass; id/shortId format checks | Fully-Automated | H1 stored-XSS closed |
| `issues.test.ts`: resolved+changed-note → `note_edited` + `'updated'`; resolved+same-note → no-op; missing-id → `'not_found'`; unchanged non-resolved records nothing | Fully-Automated | H2 note persistence + audit trail |
| Apply CHECK DDL to local dev DB (push-managed); keep generated migration file | Hybrid (precondition: local dev DB) | H2 migration valid on prod chain |
| `cd packages/db && bunx tsc --noEmit` (or clean `db:generate` diff) — typechecks the `admin-issue-event.ts` schema edit | Fully-Automated | H2 schema edit typechecked (G3 — root `bun run check` excludes `packages/db`) |
| `notifications.test.ts`: `NOTIFIABLE_EVENTS` membership + predicate/row-mapping + self-action exclusion — **JS-shape only** (the `fakeDb` returns canned rows; does NOT exercise the leftJoin/`assignedAt`/OR SQL) | Fully-Automated (JS-shape only) | Partial: M1/L4 unit-shape guard (G1) |
| admin e2e `incident-notifications` spec + browser scenario 4 — M1 `assignedAt` bound + L4 OR-predicate actually filter Postgres rows | Hybrid (e2e) + Agent-Probe (browser scenario 4) | M1 + L4 feed correctness (SQL semantics) (G1) |
| admin e2e `incident-detail` spec: a resolved-and-unassigned incident returns 404 to a non-assignee staff member (readable to an assignee) | Hybrid (precondition: e2e harness) | M3 pool-readability predicate (G4) |
| `formValidation.ts` unit tests: past-date reject, NaN reject, grandfathering, UTC-midnight | Fully-Automated | M4a shared due-date validation |
| `git status` shows `owner.json` + `owner-totp.txt` staged for removal | Fully-Automated | M2 secrets untracked |
| root `bun run check` + `bun run lint` (Svelte a11y) clean | Fully-Automated | M3/M5/L6 correctness + a11y |
| admin e2e: 5 IMS specs on throwaway `radius_admin_test` harness (`TEST_ENV` blanks RESEND) | Hybrid (precondition: e2e harness) | End-to-end IMS flows intact |
| `vc-risk-evidence-pack` 5-artifact set in `{task-folder}/harness/` produced before closeout | Manual-first (human handoff) | G5 — HIGH-risk manual-first evidence |
| (1) resolve from My Issues card with note → persists + `note_edited` in timeline | Agent-Probe + human handoff | H2 client self-heal (UI-visible) |
| (2) edit note on detail page while resolved → persists | Agent-Probe + human handoff | H2 detail-page edit |
| (3) `?/track` POST with `javascript:` permalink → 400 | Agent-Probe + human handoff | H1 in live request path |
| (4) newly assigned user's bell has no pre-assignment backlog; unassigned user sees the unassignment | Agent-Probe + human handoff | M1 + L4 in live feed |
| (5) BaseDialog keyboard-activation (Firefox) + drag-select from input stays open; true backdrop click closes | Agent-Probe + human handoff | L1 dismiss correctness |

---

## Test Infra Improvement Notes

- `notifications.test.ts` uses a `fakeDb` Proxy that returns canned rows regardless of the
  WHERE/JOIN predicate, so notification feed SQL semantics (M1 `assignedAt` bound, L4 OR-predicate)
  are only provable at the e2e/browser tier. A future improvement would add a real-DB integration
  fixture (or pg-mem) so the leftJoin/audience predicate can be asserted at a faster-than-e2e tier.
  (Identified during PVL G1.)

---

## Dependencies and Sequencing

- **Phase order is the audit fix order and is dependency-correct:** Phase 1 lands the `resolutionNote`
  ≤2000 and snapshot caps that Phase 4 (M4b) builds on; run Phase 1 before Phase 4.
- Phases 2, 3, 5 are independent of each other and of Phase 4, but execute in listed order for clean,
  reviewable per-phase commits.
- Phase 1 is the only phase with a schema/migration dependency (`packages/db`).
- No phase depends on a later phase's output.

## Risks

- **H1 over-rejection:** rejecting non-https loudly could break a legitimate flow if any real client
  sends a non-https permalink — verified none do (Sentry API always returns https). Mitigation: browser
  scenario (3) + `map.test.ts` valid-https pass case.
- **H2 migration on push-managed dev DB:** `db:migrate` fails on journal drift (known gotcha). Mitigation:
  apply the CHECK DDL directly to the local dev DB to verify, still generate the migration file for prod.
- **M1/L4 predicate restructure** touches all 3 notification query sites at once — a partial change would
  desync read-state. Mitigation: single restructure + the 3 new predicate tests before moving on.

---

## Constraints

- **Agents never commit.** Each phase produces staged changes + a suggested conventional-commit message
  (e.g. `fix(admin/issues): ...`); the user commits himself.
- **EXECUTE runs on opus** (high-risk classes present: security, schema migration, auth predicates).
- **Browser-visible changes require an agent browser pass + human verification handoff before closeout.**
- Plan/process artifact commits stay separate from execution commits.

---

## Backlog

- **Sentry permalink host pinning** — pin the configured Sentry org host in H1 validation (hardening beyond the https gate).
- **`sentryIssueId` provenance check (M4d)** — verify `sentryIssueId` against the Sentry API so a staff member cannot fabricate a "Tracked from Sentry" incident.
- **Manager-board pagination (L3)** — paginate `/issues` manager load + fetch event history on expand via existing `/issues/[id]/detail`; L3 ships a ceiling comment only in Phase 5.

Record these as backlog stubs under `process/features/incident-management/backlog/` during UPDATE PROCESS.

---

## Acceptance Criteria

1. All 13 audit findings addressed per the locked decisions; L3 = ceiling comment + backlog stub only.
2. 18 existing IMS unit tests green; new tests added for H1, H2, M1/L4, M4a.
3. `bun run check` + `bun run lint` clean at repo root.
4. Phase 1 migration applied to local dev DB and generated migration file kept.
5. 5 IMS e2e specs run on the throwaway harness.
6. 5 browser scenarios verified via agent pass + human handoff before closeout.
7. Committed secrets (`owner.json`, `owner-totp.txt`) staged for removal.
8. Each phase leaves staged changes + a suggested conventional-commit message (no agent commits).

---

## Resume and Execution Handoff

1. **Selected plan file path:** `process/features/incident-management/active/ims-audit-remediation_10-07-26/ims-audit-remediation_PLAN_10-07-26.md`
2. **Last completed phase/step:** RESEARCH + PLAN + VALIDATE all done. VALIDATE reached `Gate: PASS` after one PVL supplement cycle (see Pipeline state below). Ready for EXECUTE.
3. **Validate-contract status:** written (inline `## Validate Contract` below) — `Gate: PASS`, `generated-by: outer-pvl`, date 2026-07-10. Gaps G1–G5 raised in PVL cycle 1 are closed in the plan body.
4. **Supporting context files loaded:** `process/context/all-context.md`, `process/context/database/all-database.md` (migration/journal-drift), `process/context/tests/all-tests.md` (test commands + e2e harness). Colocated task-folder artifacts a fresh agent must read alongside this plan: `ims-audit-remediation_AUDIT_10-07-26.md` (the 13 findings) and `ims-audit-remediation_RESEARCH_10-07-26.md` (prior-research fact sheet — verified file:line facts + locked decisions).
5. **Next step for a fresh agent:** user says `ENTER EXECUTE MODE for process/features/incident-management/active/ims-audit-remediation_10-07-26/ims-audit-remediation_PLAN_10-07-26.md` → orchestrator spawns vc-execute-agent (opus) SEQUENTIALLY through phases 1→2→3→4→5. Phase 1 blocks Phase 4 (M4b depends on Phase 1 caps) and phases share `apps/admin` files — do NOT parallelize. After EXECUTE, orchestrator spawns vc-tester for the independent EVL gate re-run (execute-agent's own green run never substitutes). Stage changes per phase; never commit. Produce the vc-risk-evidence-pack + browser-verify handoff before closeout.

### Pipeline state (as of 2026-07-10, produced in a prior session)

- **vc-setup: COMPLETE.** `process/context/all-context.md` routes to 5 populated groups (tests, planning, database, auth, uxui). Feature folders `incident-management` + `admin-staff-governance` exist. All 11 harness validators pass.
- **RIPER-5 state:**
  - RESEARCH — done. Three independent verification passes confirmed all 13 audit findings. Fact sheet = colocated `ims-audit-remediation_RESEARCH_10-07-26.md`.
  - PLAN — done (this file).
  - VALIDATE — done. PVL cycle 1 → `Gate: CONDITIONAL` (gaps G1–G5); supplement applied; cycle 2 → `Gate: PASS`. Validate-contract is inline below (`generated-by: outer-pvl`, date 2026-07-10). PVL bookkeeping colocated: `ims-audit-remediation-pvl-iteration-001_REPORT_10-07-26.md` + `results.tsv` (`HALTED_SUCCESS`).
- **NEXT ACTION:** as in step 5 above. The `/goal` block to use is the `## Autonomous Goal Block` section already in this file — reference it; do not duplicate it.

### Colocated artifacts (all in this task folder)

- `ims-audit-remediation_AUDIT_10-07-26.md` — the 13 findings, re-verified 2026-07-10.
- `ims-audit-remediation_RESEARCH_10-07-26.md` — verified file:line facts + locked decisions; execute-agent should read it alongside this plan.
- `ims-audit-remediation-pvl-iteration-001_REPORT_10-07-26.md` — PVL cycle-1 iteration report.
- `results.tsv` — PVL loop log (`HALTED_SUCCESS`).

### Git state at handoff (uncommitted — deliberate; the user commits himself, agents NEVER commit)

- Staged: rename `audit.md` → the AUDIT artifact path.
- Modified: `README.md` (new "Agent Harness" catalog section).
- The entire `process/` tree is untracked-but-intended-to-be-tracked (user will commit).
- A fresh session must NOT "clean up", revert, stash, or commit any of this.

### Session / model note

Plan authored 2026-07-10 in a prior session. The fresh session runs **opus** as the main model — model policy unchanged: EXECUTE leg = opus; research/plan/validate/tester spawns = sonnet.

### Fresh-session bootstrap reminder

Before EXECUTE, the orchestrator must run the CLAUDE.md bootstrap: `find process/context/ -type f`, `find process/development-protocols/ -type f`, and read the two `all-*` routers. Pass `process/context/all-context.md` + the full context file listing to vc-execute-agent and vc-tester, per `orchestration.md` §Gather Context.

---

## Validate Contract

Status: PASS
Date: 10-07-26
date: 2026-07-10
generated-by: outer-pvl
supersedes: 2026-07-10 (outer-pvl) — PVL cycle 2 re-validation after supplement cycle; current evidence

Parallel strategy: parallel-subagents (fan-out); executed sequentially by a single validate-agent under orchestrator PVL
Rationale: 5/7 signals present (S1 multi-package, S2 schema/auth surface, S6 high-risk class, S7 5+ files; S4 not a phase program). Read-only feasibility review of one plan across 4 dimensions + 5 sections, no cross-agent coordination needed.

### Test gates (C3 5-column — additive; legacy line form retained below)

| criterion id | behavior | strategy | proving test | gap-resolution |
|---|---|---|---|---|
| H1 | non-https / `javascript:` permalink rejected; https passes; id/shortId format-checked; title capped | Fully-Automated | `cd apps/admin && bun run test` — `sentry/map.test.ts` new cases | B |
| H2-persist | resolved+changed-note persists note + records `note_edited`; resolved+same-note no-ops; missing-id → `'not_found'` | Fully-Automated | `cd apps/admin && bun run test` — `issues.test.ts` (recorder-fake pins event contract + tri-state return) | B |
| H2-migration | `admin_issue_event_type_ck` accepts `note_edited` | Hybrid | apply CHECK DDL directly to local dev DB (push-managed); keep `db:generate` migration file; `cd packages/db && bunx tsc --noEmit` typechecks the edit | B (precondition: local dev DB) |
| M1 | pre-assignment history excluded from a new assignee's feed (assignedAt bound) | Hybrid + Agent-Probe | admin e2e `incident-notifications` spec + browser scenario 4 (unit mock cannot exercise SQL — see "What this does NOT prove") | C |
| L4 | removed person sees their own unassignment event | Hybrid + Agent-Probe | admin e2e + browser scenario 4 | C |
| M3 | resolved/in-progress unassigned incident NOT pool-readable | Hybrid | `bun run check` (import + type) + admin e2e `incident-detail` spec (resolved-unassigned → 404 to non-assignee) | C |
| M2 | `owner.json` + `owner-totp.txt` untracked | Fully-Automated | `git status` shows both staged for removal | A |
| M4a | past-date reject / NaN reject / grandfathering / UTC-midnight | Fully-Automated | `cd apps/admin && bun run test` — new `formValidation.test.ts` | B |
| M3/M5/L6 | typecheck + a11y lint clean | Fully-Automated | root `bun run check` + `bun run lint` | A |
| e2e | 5 IMS specs green on throwaway harness | Hybrid | `bun run --filter radius-admin test:e2e` (precondition: `radius_admin_test` DB, `TEST_ENV` blanks RESEND) | B |
| UI (H2/H1/M1/L4/L1) | 5 browser scenarios | Agent-Probe + human handoff | agent browser pass + human verification handoff (non-shell gate) | C |
| high-risk-pack | 5-artifact evidence pack for HIGH-risk classes | Manual-first | `vc-risk-evidence-pack` set in `{task-folder}/harness/` before closeout | D→C (produced at EXECUTE) |

gap-resolution legend: A — proven now · B — gate added by this plan's checklist · C — deferred to named later gate (e2e/browser/human handoff) · D — backlog test-building stub.

C-4 reconciliation: the `strategy` column carries only the 3 proving strategies (Fully-Automated / Hybrid / Agent-Probe) plus the manual-first evidence pack. No Known-Gap rows — every developed behavior has a real gate.

### Legacy line form (retained for existing consumers)

- H1 XSS: Fully-automated: `cd apps/admin && bun run test` (sentry/map.test.ts reject/pass/format cases)
- H2 persistence + audit: Fully-automated: `cd apps/admin && bun run test` (issues.test.ts note_edited + tri-state)
- H2 migration: hybrid: apply CHECK DDL to local dev DB + keep generated migration file + `cd packages/db && bunx tsc --noEmit` (precondition: local dev DB, push-managed)
- M1/L4 feed correctness: hybrid + agent-probe: admin e2e incident-notifications + browser scenario 4 (unit mock is JS-only)
- M3 detail predicate: hybrid: root `bun run check` + admin e2e incident-detail (resolved-unassigned → 404)
- M2 secrets: fully-automated: `git status` shows both files staged for removal
- M4a due-date: fully-automated: `cd apps/admin && bun run test` (formValidation.test.ts)
- M3/M5/L6 a11y + types: fully-automated: root `bun run check` + `bun run lint`
- IMS e2e: hybrid: `bun run --filter radius-admin test:e2e` (throwaway radius_admin_test harness)
- 5 browser scenarios: agent-probe + human handoff (non-shell gate)
- high-risk pack: manual-first: vc-risk-evidence-pack 5-artifact set before closeout

### Dimension findings

- Infra fit: PASS (cycle-2 verified) — test/migration commands are correct, but root `bun run check` fans out to `apps/*` only (NOT `packages/db` per tests context), so the Phase 1 `admin-issue-event.ts` schema edit is not typechecked by the stated Phase 1 gate. Real check for the schema change is `db:generate` producing a clean migration + direct-apply DDL. **Resolved (G3):** Phase 1 gate now adds `cd packages/db && bunx tsc --noEmit` (or clean `db:generate` diff).
- Test coverage: PASS (cycle-2 verified) — the Verification Evidence table labelled "notifications.test.ts: pre-assignment excluded / unassignment visible / self excluded" as Fully-Automated, but `notifications.test.ts` uses a `fakeDb` Proxy that returns canned rows regardless of the WHERE/JOIN predicate (its own comment: "the filter/read-join is SQL — covered by the e2e"). The M1 assignedAt bound and L4 OR-predicate are NOT provable at the unit tier; real proof is the e2e (hybrid) + browser scenario 4 (agent-probe). H2 tests ARE genuinely fully-automated (issues.test.ts recorder-fake pins event contract + JS return value). **Resolved (G1):** Verification Evidence split into a JS-shape-only Fully-Automated row + a Hybrid+Agent-Probe SQL-semantics row; Phase 2 item 14 states the unit test is JS-shape only.
- Breaking changes: PASS — `setIssueStatus` boolean → `'updated'|'unchanged'|'not_found'` is an internal module-private contract; both callers (`issues/[id]/+page.server.ts:72-73`, `issues/+page.server.ts:236-237`) are listed and currently ignore the return, so the plan's "update both in the same phase → `'not_found'` → fail(404)" closes the contract cleanly. `note_edited` CHECK relaxation is additive/forward-compatible. Notification audience predicate change is read-state-neutral (event×user scoped).
- Security surface: PASS — H1 https gate reuses existing `httpsUrl()` semantics (`startsWith('https://')`) plus format checks + title cap; loud `fail(400)` is safe (Sentry API always returns https; UI never sends non-https). M2 `git rm --cached` correct; rotation note captured (secret is in history). High-risk classes (XSS/trust-boundary, schema migration, auth predicate, secret) are handled by opus EXECUTE + agent browser pass + human handoff + `vc-risk-evidence-pack` (G5). Host-pinning correctly deferred to backlog with documentation.

Section feasibility:
- Phase 1 (H1+H2): PASS (cycle-2: G3 resolved) — mechanically feasible (`httpsUrl` module-local today, export + snapshot helper OK; `setIssueStatus` before-query must add `resolutionNote` — plan states this). Highest-risk edit: the same-status resolved+note-differs branch (must record `note_edited` so resolution metadata is never mutated without an audit trail — the exact concern the existing :635-636 comment raises). Gap: Phase 1 gate does not typecheck the packages/db schema edit (see Infra fit) — **resolved (G3)**.
- Phase 2 (M1+L4+M3): PASS (cycle-2: G1/G2/G4 resolved; G2 import-source corrected to @veent/core) — highest-risk edit in the whole plan (innerJoin→leftJoin predicate restructure across all 3 query sites at once; partial change desyncs read-state). Gaps: (a) the M3 fix `issue.status === ISSUE_STATUS.open` requires adding `ISSUE_STATUS` to the `$lib/server/issues` import in `detail/+server.ts` — **resolved (G2)**, item 13a added; (b) M1/L4 unit-tier mislabel — **resolved (G1)**; (c) M3 had no named automated proof — **resolved (G4)**, item 13b names the incident-detail e2e assertion.
- Phase 3 (M2): PASS — both files confirmed tracked (`git ls-files apps/admin/e2e/.auth/`); stage-only `git rm --cached` feasible; gitignore already covers the dir.
- Phase 4 (M4+M5): PASS — `parseDueDate` extraction, new rate-limit scopes, and title/description caps all trace to verified source; Phase-1-before-Phase-4 dependency (M4b caps) is correct.
- Phase 5 (Lows): PASS — all targets confirmed on disk (`probe.sample.ts` exists; BaseDialog/NotificationBell/Sidebar/MobileDrawer citations hold). L3 = ceiling comment + backlog stub only, as locked.

### Net gate

Layer 1: Infra PASS · Test coverage PASS · Breaking changes PASS · Security PASS
Layer 2: P1 PASS · P2 PASS · P3 PASS · P4 PASS · P5 PASS
Totals: 0 FAILs / 0 CONCERNs / 9 PASSes → Net Gate: PASS (cycle 2 — all 5 cycle-1 CONCERNs G1–G5 verified resolved against code; G2 import-source imprecision corrected in-plan)

No vacuous-green: every developed behavior has a Fully-Automated or Hybrid+Agent-Probe gate; there are no Known-Gap-only behaviors.

### Cycle-2 re-validation note (PVL cycle 2 — 2026-07-10)

Re-ran V1–V7 against the supplemented plan. All 5 cycle-1 supplements verified landed and code-accurate:
- G1 — `notifications.test.ts:28-30` confirmed to use a `fakeDb` Proxy that resolves to canned rows regardless of the WHERE/JOIN predicate; the M1/L4 retiering to Hybrid (e2e) + Agent-Probe (browser 4) is accurate.
- G2 — `ISSUE_STATUS` reachability confirmed. Found + corrected an import-source imprecision: it is exported by `@veent/core` (not re-exported by `$lib/server/issues`; `issues.ts` export surface has no `ISSUE_STATUS`). Item 13a / Touchpoints / E1 corrected to name `@veent/core` — the file already imports from it. Self-correcting at the `bun run check` gate regardless.
- G3 — `packages/db/tsconfig.json` exists and the `db:generate` script is present → the `cd packages/db && bunx tsc --noEmit` (or clean `db:generate` diff) gate is viable.
- G4 — `apps/admin/e2e/incident-detail.e2e.ts` exists → the named "resolved-unassigned → 404 to non-assignee" assertion has a host spec.
- G5 — Final step 31 (vc-risk-evidence-pack 5-artifact set under `{task-folder}/harness/`) present.
No NEW gaps introduced by the supplements beyond the G2 import-source wording (now corrected). All plan-referenced paths resolve on disk. Structural validator: 0 failures / 0 warnings.

### Open gaps — NONE unresolved (cycle 2). All 5 cycle-1 CONCERNs (G1–G5) verified resolved against code; the G2 import-source imprecision was corrected in-plan. History of the 5 cycle-1 gaps retained below:

- G1 (Test coverage, CONCERN): correct the Verification Evidence tier for M1/L4 from "Fully-Automated" to "Hybrid (e2e) + Agent-Probe (browser scenario 4)"; state explicitly that the notifications.test.ts unit test asserts only JS-level shape (NOTIFIABLE_EVENTS membership, predicate/row mapping), not SQL filter semantics. — **APPLIED:** Verification Evidence split into two rows; Phase 2 item 14 rewritten.
- G2 (Phase 2 mechanical, CONCERN): add a checklist sub-step to import `ISSUE_STATUS` into `apps/admin/src/routes/(app)/issues/[id]/detail/+server.ts` alongside the M3 predicate change. — **APPLIED:** Phase 2 item 13a added; Touchpoints updated.
- G3 (Infra fit / Phase 1 gate, CONCERN): add an explicit typecheck of the `packages/db` schema edit to the Phase 1 gate (e.g. `cd packages/db && bunx tsc --noEmit`, or assert a clean `db:generate` diff), since root `bun run check` does not cover `packages/db`. — **APPLIED:** Phase 1 gates updated; Verification Evidence row added.
- G4 (Phase 2 M3 coverage, CONCERN): the M3 predicate has no dedicated unit test; its only automated proof is `bun run check` + the `incident-detail` e2e spec. Name that e2e assertion (resolved unassigned incident is 404 to a non-assignee) explicitly, or add a route-handler unit test. — **APPLIED:** Phase 2 item 13b names the assertion; Verification Evidence row added.
- G5 (Security closeout, CONCERN/advisory): given the HIGH-risk classes, produce the manual-first evidence pack (`vc-risk-evidence-pack` 5-artifact set in the task folder `harness/`) at EXECUTE before closeout — the plan currently relies on the browser handoff alone. — **APPLIED:** Final step 31 added; Verification Evidence row added.

### What this coverage does NOT prove

- `cd apps/admin && bun run test`: does NOT prove the M1 assignedAt SQL bound or the L4 OR-predicate actually filter rows in Postgres — the notifications.test.ts fakeDb returns canned rows independent of the query. Does NOT prove the H2 migration applies on the prod chain (only the hybrid DDL-apply + generated file do). Does NOT prove any UI-visible behavior.
- root `bun run check`: does NOT typecheck `packages/db` (the `admin-issue-event.ts` schema edit) — fan-out is `apps/*` only. The Phase 1 `cd packages/db && bunx tsc --noEmit` gate (G3) covers this.
- `git status` (M2): proves the files are staged for removal, NOT that the leaked session/TOTP secret has been rotated (it remains in git history).
- admin e2e (`radius_admin_test`): proves end-to-end flows on a throwaway DB with RESEND blanked; does NOT prove real email delivery or production DB behavior.
- 5 browser scenarios (agent-probe + human handoff): judgment-based; not mechanically asserted. Human handoff is required before closeout for all UI-visible phases.

### Plan updates applied (PVL supplement cycle — DONE)

| # | What changed | Where in plan | Gap |
|---|---|---|---|
| P1 | Retiered M1/L4: split into a JS-shape-only Fully-Automated row + a Hybrid(e2e)+Agent-Probe(browser 4) SQL-semantics row; Phase 2 item 14 states unit test is JS-shape only | Verification Evidence table + Phase 2 item 14 | G1 |
| P2 | Added sub-step 13a: import `ISSUE_STATUS` into detail/+server.ts; Touchpoints updated | Phase 2 checklist item 13a | G2 |
| P3 | Added `cd packages/db && bunx tsc --noEmit` (or clean `db:generate` diff) to Phase 1 gate; Verification Evidence row added | Phase 1 gates + Verification Evidence | G3 |
| P4 | Added item 13b naming the incident-detail e2e assertion (resolved-unassigned → 404 to non-assignee); Verification Evidence row added | Phase 2 item 13b / Verification Evidence | G4 |
| P5 | Added Final step 31 (vc-risk-evidence-pack 5-artifact set in harness/); Verification Evidence row added | Final (after Phase 5) / Verification Evidence | G5 |

### Execute-agent instructions

| # | Instruction | Trigger condition |
|---|---|---|
| E1 | When editing `detail/+server.ts` for M3, add `ISSUE_STATUS` to the existing `@veent/core` import (already brings in `getAdminRole`/`MANAGER_ROLES`) — NOT `$lib/server/issues`, which does not re-export `ISSUE_STATUS`. Do not assume it is already imported. | Phase 2 entry |
| E2 | Phase 1: verify the CHECK migration by applying the DDL directly to the local dev DB (push-managed — `db:migrate` fails on journal drift); still run `db:generate` and keep the generated migration file for the prod chain; run `cd packages/db && bunx tsc --noEmit` to typecheck the schema edit. | Phase 1 migration step |
| E3 | Phase 2: change all 3 notification query sites (unreadCount, listNotifications, markAllNotificationsRead) AND `notifWhere` in ONE pass — a partial innerJoin→leftJoin change desyncs read-state. Do not commit Phase 2 with any site left on the old join. | Phase 2 entry |
| E4 | notifications.test.ts unit tests can only assert JS-level shape (the fakeDb returns canned rows). Do NOT claim the unit test proves the assignedAt/OR SQL filter; the e2e + browser scenario 4 are the real proof. | Phase 2 tests |
| E5 | High-risk classes present: produce the `vc-risk-evidence-pack` 5-artifact set in `{task-folder}/harness/` and complete the agent browser pass + human handoff before treating the work as ready for closeout. Stage changes per phase; never commit. | Before closeout |

Gate: PASS (0 FAILs, 0 unresolved CONCERNs; all 5 cycle-1 CONCERNs G1–G5 verified resolved against code in cycle 2; G2 import-source imprecision corrected in-plan)
Accepted by: session (autonomous, orchestrator-driven PVL) — accepted concerns: G1 M1/L4 tier accuracy, G2 ISSUE_STATUS import, G3 packages/db typecheck gate, G4 M3 e2e assertion naming, G5 high-risk evidence pack — all APPLIED to the plan body and verified against code in cycle 2. Cycle-2 verdict: PASS (no residual concerns; G2 import-source corrected to @veent/core).

---

**Next Step:** Gate PASS (cycle 2). Proceed to EXECUTE Phase 1 (H1+H2) on opus — all cycle-1 gaps G1–G5 verified closed.

---

## Autonomous Goal Block

```
SESSION GOAL: Remediate all 13 PR #74 IMS audit findings (2H/5M/6L) across apps/admin + packages/db in 5 phases.
Charter + umbrella plan: N/A — single plan (process/features/incident-management/active/ims-audit-remediation_10-07-26/ims-audit-remediation_PLAN_10-07-26.md)
Autonomy: EXECUTE runs on opus (high-risk classes: stored-XSS/trust-boundary, schema migration, auth/notification predicate, committed-secret). Agents never commit — stage changes + suggested conventional-commit message per phase; user commits himself (staging only).
Hard stop conditions / safety constraints:
- Do NOT point the e2e harness DROP SCHEMA at the real dev DB — throwaway radius_admin_test only.
- Do NOT run db:migrate on the local dev DB (journal drift) — apply CHECK DDL directly, keep the generated migration file for the prod chain.
- Browser-visible phases (H1/H2/M1/L4/L1) require an agent browser pass AND a human verification handoff before closeout — code-only is never VERIFIED.
- Change all 3 notification query sites + notifWhere in one pass (partial leftJoin change desyncs read-state).
- Produce the vc-risk-evidence-pack (5 artifacts) before closeout for the high-risk classes.
Next phase: EXECUTE Phase 1 (H1 + H2) on opus, then phases 2→3→4→5 in order (Phase 1 blocks Phase 4 M4b caps).
Validate contract: inline in plan (## Validate Contract) — Gate CONDITIONAL, generated-by outer-pvl, 5 CONCERNs (G1–G5) addressed by PVL supplement, 0 FAILs.
Execute start: fully-auto — `cd apps/admin && bun run test` · root `bun run check` · root `bun run lint` · `cd packages/db && bunx tsc --noEmit` · `git status` (M2). hybrid — apply Phase 1 CHECK DDL to local dev DB + keep migration file · `bun run --filter radius-admin test:e2e` (5 IMS specs, throwaway harness, TEST_ENV blanks RESEND). probe — 5 browser scenarios + human handoff. high-risk pack: yes.
```
