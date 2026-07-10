# Prior Research — IMS Audit Remediation (PR #74)

RESEARCH phase is complete: on 2026-07-10 three independent verification passes re-read every file
cited by the 13-finding audit at repo-root `audit.md` (now committed, `0d3c792`). ALL 13 findings
hold against current staging. Six cosmetic corrections were applied to audit.md (line numbers, one
retracted index claim). A follow-up implementation fact sheet was gathered. Design decisions were
locked with the user. Everything below is verified against code — the plan agent should NOT re-do
this research, only structure it into the plan artifact.

## Locked design decisions (user-approved 2026-07-10)

1. **H2 audit trail:** new `note_edited` event type — requires ONE small migration relaxing the
   `admin_issue_event_type_ck` CHECK constraint (`packages/db/src/schema/admin-issue-event.ts:36,42-45`
   — column is `text` + CHECK list, not a pg enum).
2. **L4:** notify the removed person — audience exception in the notification feed queries
   (folded into the same predicate restructure as M1).
3. **Scope:** all H+M+L findings, 5 phases in the audit's fix order. L3 gets a ceiling comment +
   backlog stub only (no pagination now).

## Verified implementation facts (from the fact sheet)

- `ISSUE_EVENT` const: `apps/admin/src/lib/server/issues.ts:33-41`; `eventSummary()` :363-388;
  `recordEvent(tx, {issueId, actorId, type, fromValue?, toValue?, note?})` :405-424 (module-private).
- `setIssueStatus`: `issues.ts:621-661`, returns boolean; same-status short-circuit at :637
  (`if (before.status === status) return false;`), `before` query selects only `status`. Both
  callers ignore the return: `issues/[id]/+page.server.ts:72-73` and `issues/+page.server.ts:236-237`.
- Timeline icon/tone map: `apps/admin/src/lib/components/feature/Timeline.svelte:24-32` (META keyed
  by event type; `metaOf` has a safe fallback).
- `httpsUrl()` exists in `apps/admin/src/lib/server/sentry/map.ts` (:19-21, used at :55) — only
  allows `https://`-prefixed strings; module-local today (export/reuse it for H1).
- Sentry env: `SENTRY_API_BASE` (default `https://de.sentry.io/api/0`), `SENTRY_ORG_SLUG`,
  `SENTRY_PROJECT_ID`, `SENTRY_AUTH_TOKEN` in `apps/admin/src/lib/server/sentry/client.ts`;
  `PUBLIC_SENTRY_DASHBOARD_URL` read in `sentry/index.ts:33`. Host pinning DEFERRED to backlog.
- `rateLimit(scope, identifier, max, windowMs)`: `apps/admin/src/lib/server/rateLimit.ts:19-21`,
  DB-backed via @veent/core `consumeRateLimit` (rate_limits table). Track call sites:
  `sentry/+page.server.ts:42` (admin_sentry_mutate, IP-keyed) and :82 (admin_sentry_track,
  userId-keyed), both 30/15min → fail(429).
- `parseIssueInput(form, existingDueMs?)`: `issues/+page.server.ts:106-142` — validates title
  non-empty (NO length cap), description no cap, priority guard, networkId positive int, dueDate
  UTC-midnight + NaN check + past-date rejection with grandfathering (:125-138), assigneeIds dedupe.
  Callers: create (:159), selfReport (:181, then forces assigneeIds=[]), update (:196).
- Track's own due-date block: `sentry/+page.server.ts:99-106` — NaN check only, NO past-date check.
- Comment cap pattern (the model for server-side length caps):
  `issues/[id]/+page.server.ts:47-49` (2000-char fail(400)).
- `notifyAssignees(assigneeIds, actor, issue, origin)`: `apps/admin/src/lib/server/issueNotify.ts`
  — whole-body try/catch (never throws), serial per-recipient sends; awaited at
  `issues/+page.server.ts:164,201` and `sentry/+page.server.ts:130`, nothing after the await uses it.
- Notifications: `apps/admin/src/lib/server/notifications.ts` — `notifWhere(userId)` :47-53
  (assignee identity + NOTIFIABLE_EVENTS + not-self; NO assignedAt bound), innerJoin sites:
  unreadCount :60, listNotifications :96, markAllNotificationsRead :137. NOTIFIABLE_EVENTS :24-30
  includes `unassigned`. Unassignment order: assignee row DELETEd first, THEN unassigned event
  recorded with `toValue: adminUserId` (`issues.ts:582-598`) — so the removed person never matches
  the innerJoin. `markNotificationRead` :123-129 (comment at :121-122 covers only bogus-id case).
  Schema: `adminIssueAssignee.assignedAt` exists (`packages/db/src/schema/admin-issue.ts:70`);
  `admin_issue_assignee_user_idx` on admin_user_id EXISTS (:71-75) — do NOT add an index.
- Detail endpoint: `issues/[id]/detail/+server.ts:29-30` — `isPoolItem = issue.assignees.length===0`
  (missing status check); `listOpenPool()` filter at `issues.ts:231-235` is open AND zero assignees.
- M2: `git ls-files apps/admin/e2e/.auth/` → owner.json (session cookie, domain=localhost, expiry
  ≈2026-07-15) + owner-totp.txt (live TOTP secret) are TRACKED despite `e2e/.auth/` being in
  apps/admin/.gitignore (force-added in cb08387).
- M5: migrations `packages/db/drizzle/0042_real_inhumans.sql` (adds notifications_seen_at) and
  `0043_light_doomsday.sql` (drops it, creates admin_notification_read) — already merged, no schema
  action; stale watermark header comment at `apps/admin/e2e/incident-notifications.e2e.ts:1-10`.
- L1: `BaseDialog.svelte:52-58` — coordinate-only backdrop check, no e.target identity, wired
  `onclick` at :64.
- L5: `packages/core/probe.sample.ts` — nothing references it; proper probe-router.ts exists in
  packages/core/scripts/.
- L6a: `NotificationBell.svelte` — role="menu" at :97 with non-menuitem forms/buttons inside
  (:104-115, :136-153); aria-live="polite" on remounting <ul> :122. L6b: badge aria-label on
  non-focusable <span> — `Sidebar.svelte:174-179`, `MobileDrawer.svelte:173-178`.
- Tests: `apps/admin` vitest node project; 18 IMS unit tests = issues.test.ts (13) +
  notifications.test.ts (5), hand-rolled fake tx/db mocks (no real DB). Commands:
  `cd apps/admin && bun run test`; root `bun run check`, `bun run lint`. E2E: throwaway
  radius_admin_test DB harness (see process/context/tests/all-tests.md).
- Migration gotcha: dev DB is push-managed — db:migrate fails on journal drift; verify new DDL by
  applying it directly to the local dev DB, still generate the migration file for the prod chain.

## The agreed 5-phase remediation structure (carry into the plan artifact)

### Phase 1 — High severity
**H1 (stored XSS):** export/reuse `httpsUrl()` from sentry/map.ts in the `?/track` action —
non-empty permalink failing the https gate → fail(400) 'Invalid Sentry permalink.' (reject loudly;
legit UI always sends https from the Sentry API). Format-check `sentryIssueId` (/^\d{1,32}$/),
`sentryShortId` (/^[A-Za-z0-9._-]{0,64}$/), cap `sentryTitle` ≤500. Put snapshot validation in a
small exported helper next to httpsUrl for unit testing; extend sentry/map.test.ts.
**H2 (silent note drop):** (1) schema CHECK + migration adding 'note_edited'; (2) ISSUE_EVENT.noteEdited
+ eventSummary case ("updated the resolution note"); (3) setIssueStatus returns
'updated'|'unchanged'|'not_found', selects resolutionNote in the before query, same-status branch:
resolved + note differs → update resolutionNote+updatedAt, recordEvent(note_edited, note: newNote),
'updated'; rewrite the :635-636 comment; (4) both updateStatus callers: 'not_found' → fail(404),
plus resolutionNote ≤2000 cap (pre-satisfies part of M4b); (5) Timeline META entry (PenLine icon,
text-ink tone); (6) NOTIFIABLE_EVENTS deliberately unchanged (note why in code); (7) client flows
self-heal — NO component changes; verify in browser.
Tests: update "records nothing when unchanged" (still true for non-resolved); add resolved+changed-note,
resolved+same-note no-op, missing-id → 'not_found'.

### Phase 2 — Feed/endpoint predicates (M1 + L4 + M3)
M1+L4 one restructure in notifications.ts (all 3 query sites): innerJoin → leftJoin with ON
(issueId match AND adminUserId=userId AND assignedAt <= event.createdAt) [the assignedAt bound IS
M1]; audience predicate: and(inArray(type,NOTIFIABLE), actor distinct from userId,
or(isNotNull(assignee.adminUserId), and(eq(type,'unassigned'), eq(toValue,userId)))) [OR branch is
L4]. Read-state is event×user scoped — markOne/markAll work unchanged.
M3: `isPoolItem = issue.assignees.length === 0 && issue.status === ISSUE_STATUS.open;`
Tests: extend notifications.test.ts — pre-assignment excluded, unassigned visible to removed
person, self-actions still excluded.

### Phase 3 — M2 committed secrets
Stage `git rm --cached apps/admin/e2e/.auth/owner.json apps/admin/e2e/.auth/owner-totp.txt`
(STAGE ONLY — user commits). gitignore already covers e2e/.auth/. Regenerate throwaway harness
creds (TOTP re-enroll) on next e2e run; committed secret should rotate since it's in history.

### Phase 4 — M4 validation consistency + M5 comment drift
M4a: extract shared `parseDueDate(raw, existingDueMs?)` into
`apps/admin/src/lib/server/formValidation.ts` (+ tests); use in parseIssueInput AND track.
M4b: title ≤200 + description ≤5000 in parseIssueInput (snapshot + resolutionNote caps landed in Phase 1).
M4c: rateLimit('admin_issue_selfreport', userId, 30, 15*60*1000) on ?/selfReport;
rateLimit('admin_issue_comment', userId, 30, 15*60*1000) on ?/comment; fail(429) same shape as track.
M4d (provenance vs Sentry API): BACKLOG.
M5: rewrite watermark header comment in incident-notifications.e2e.ts to per-event read-row model.

### Phase 5 — Lows
L1: BaseDialog — onpointerdown records press-started-on-backdrop (e.target===el + outside rect);
click handler requires pressOnBackdrop AND e.target===el AND outside rect → open=false; reset flag.
L2: `await notifyAssignees` → `void notifyAssignees` ×3 (never-throws; node/VPS runtime).
L5: delete packages/core/probe.sample.ts.
L6a: NotificationBell — drop role="menu"/menuitem for labelled panel + list; remove aria-live from
remounting <ul>. L6b: fold unread count into the link's accessible name (sr-only), remove span
aria-label. L6c: one-line comment amendment on markNotificationRead.
L3: ceiling comment on manager branch of /issues load (upgrade path: paginate + fetch history on
expand via existing /issues/[id]/detail); backlog stub.

## Verification gates (for the validate-contract later)
- Per phase: `cd apps/admin && bun run test` (18 existing tests stay green + new ones), root
  `bun run check`, `bun run lint`.
- Phase 1 migration: apply CHECK DDL directly to local dev DB; keep generated migration file.
- Final: admin e2e (throwaway radius_admin_test harness; TEST_ENV blanks RESEND) — 5 IMS specs.
- Browser verification (agent pass + human handoff — REQUIRED for UI-visible changes): (1) resolve
  from My Issues card with note → persists + note_edited in timeline; (2) edit note on detail page
  at resolved → persists; (3) ?/track POST with javascript: permalink → 400; (4) newly assigned
  user's bell has no pre-assignment backlog; unassigned user sees the unassignment; (5) BaseDialog
  keyboard-activation (Firefox) + drag-select from input → stays open; true backdrop click closes.

## Backlog items (record in plan)
- Sentry permalink host pinning (H1 hardening); sentryIssueId provenance check via Sentry API (M4d)
- Manager board pagination + event-history-on-expand (L3)

## Constraints
- User commits himself — staged changes + suggested conventional-commit messages per phase only.
- audit.md (repo root, tracked) must be `git mv`ed into the task folder as the plan's audit
  reference artifact (user-approved).
- EXECUTE later runs on opus; browser-verify handoff required before closeout.
