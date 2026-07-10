# Audit — PR #74: Incident Management System

**Scope:** merge commit `ccb2e02` (`feat/admin/IMS` → `staging`), 62 files, ~4.2k substantive
lines (drizzle meta snapshots and e2e auth artifacts excluded from review, flagged below).
**Method:** full read of the code diff, cross-checked against current `staging` sources
(`hooks.server.ts`, auth guards, email rate limiter, schema, Sentry facade). The PR's 18 new
unit tests were run and pass. The 4 new e2e specs were read but not executed (they need the
throwaway `radius_admin_test` harness).

**Re-verified 2026-07-10** against staging HEAD `ccb2e02` (three independent verification
passes, all files re-read). All 13 findings hold. Corrections applied: H2 caller line
(216 → 236-237), M2 expiry (07-14 → 07-15), M4a line range (95-101 → 99-106), L1 line range
(52-59 → 52-58), L3 no-index claim retracted (`admin_issue_assignee_user_idx` exists), L6c
comment-scope nuance.

**Verdict:** the architecture is sound — events written atomically inside each mutation's
transaction, a properly serialized pool-take (`FOR UPDATE` + in-tx re-check), the 23505 partial
unique index mapped to a friendly 409, consistent 404-not-403 anti-probing, and action POSTs
gated centrally in the hook (so the "actions bypass layout load" trap is already covered).
Two findings are severe enough to fix before this is considered done: a stored-XSS vector via
the client-supplied Sentry permalink, and resolution-note edits that silently no-op.

---

## High

### H1 — Stored XSS via unvalidated `sentryPermalink` (`javascript:` URI)
- **Where:** `apps/admin/src/routes/(app)/sentry/+page.server.ts:85-90` (`?/track` action)
  → rendered as `<a href={issue.sentryPermalink}>` in
  `apps/admin/src/routes/(app)/issues/[id]/+page.svelte:93` and
  `apps/admin/src/lib/components/feature/IssueDetailModal.svelte`.
- **What:** all four "Sentry snapshot" fields are plain hidden form inputs. The server trims
  them and stores them verbatim — no scheme check, no verification against the Sentry API
  (tracking deliberately works with Sentry unconfigured; the e2e exploits exactly that).
  `?/track` is open to **any** signed-in active staff member, not just managers.
- **Failure scenario:** a non-manager staff member POSTs `sentryPermalink=javascript:...`
  (Svelte escapes HTML but does not sanitize `href` schemes). Any manager or assignee who
  clicks "Open in Sentry" on the incident detail executes attacker JS in their session —
  staff→manager escalation in an app where managers can delete incidents and (elsewhere)
  manage staff.
- **Fix:** in `?/track`, reject unless `sentryPermalink` matches `^https://` (ideally pin the
  configured Sentry org host). Cheap, server-side, one regex. Consider the same for
  `sentryIssueId`/`sentryShortId` formats while there.

### H2 — Resolution-note edits are silently dropped (`setIssueStatus` same-status short-circuit)
- **Where:** `apps/admin/src/lib/server/issues.ts:637` (`if (before.status === status) return false;`),
  callers at `.../issues/[id]/+page.server.ts` (`?/updateStatus`) and
  `.../issues/+page.server.ts:236-237` — both ignore the `false` return and answer `{ ok: true }`.
- **What:** any submit where the status is unchanged touches nothing — including the
  resolution note. Two UIs promise exactly that edit:
  1. **Detail page** — the Update button is deliberately enabled when status is `resolved`
     "so the note can be edited" (`issues/[id]/+page.svelte`, comment above the button).
     The edit no-ops; the UI reports success.
  2. **My Issues card** (`MyIssuesList.svelte:314-317`) — selecting "Resolved" sets the draft
     and calls `requestSubmit()` **synchronously, before Svelte renders the note field**, so
     the resolve lands with an empty note. The note input that then appears auto-submits
     `onchange` (`:336`) — but now the status is unchanged, so the note is discarded. Net
     effect: an assignee can effectively never persist a resolution note from the card.
- **Fix:** in `setIssueStatus`, when `status === 'resolved'` and unchanged, still update the
  note (and record it, e.g. on a `comment`-style event or by updating the row without a
  bogus `status_changed` entry). Also surface `false` to the caller instead of `{ ok: true }`.

---

## Medium

### M1 — Newly assigned staff inherit the incident's entire history as "unread"
- **Where:** `apps/admin/src/lib/server/notifications.ts:47-53` (`notifWhere`).
- **What:** the feed predicate is *current assignee × notifiable event × not-my-action*. It
  never compares `adminIssueEvent.createdAt` to `adminIssueAssignee.assignedAt` (the column
  exists — `packages/db/src/schema/admin-issue.ts:70`). Assign someone to a long-lived, busy
  incident and every historical status change/comment by others instantly becomes their
  unread backlog; the sidebar badge jumps by dozens for activity that predates them.
- **Fix:** add `gte(adminIssueEvent.createdAt, adminIssueAssignee.assignedAt)` to `notifWhere`.

### M2 — Live session token + TOTP secret committed to the repo
- **Where:** `apps/admin/e2e/.auth/owner.json` (better-auth session cookie, expiry ≈ 2026-07-15),
  `apps/admin/e2e/.auth/owner-totp.txt` (TOTP secret).
- **What:** the PR adds `e2e/.auth/` to `apps/admin/.gitignore` *and* commits the artifacts.
  gitignore never applies to tracked files, so every future harness run that rewrites them
  will show up as a diff and re-commit fresh tokens. Test-env-only (localhost, throwaway DB),
  so no production exposure — but it normalizes secrets-shaped files in history.
- **Fix:** `git rm --cached apps/admin/e2e/.auth/owner.json apps/admin/e2e/.auth/owner-totp.txt`,
  commit, and let the harness regenerate locally.

### M3 — Detail endpoint over-grants on *unassigned* (not merely *open*) incidents
- **Where:** `apps/admin/src/routes/(app)/issues/[id]/detail/+server.ts:29-30`
  (`isPoolItem = issue.assignees.length === 0`).
- **What:** the stated contract is parity with `listOpenPool()` (open + unassigned, visible
  to all staff). The check drops the status half: a **resolved** or in-progress incident whose
  assignees were later removed is readable — full timeline and resolution note — by any staff
  member. Internal audience, so low impact, but it contradicts the endpoint's own comment.
- **Fix:** `const isPoolItem = issue.assignees.length === 0 && issue.status === ISSUE_STATUS.open;`

### M4 — Server-side validation gaps and cross-path inconsistencies
- `?/track` accepts **past due dates** (`sentry/+page.server.ts:99-106`); `?/create`/`?/update`
  reject them (`issues/+page.server.ts` `todayUtcMs` check). Same field, two rules.
- **Title length is client-side only** (`maxlength=200` on the input). `createIssue`,
  `createIssueFromSentry`, and the parsers accept unbounded text for title, description, and
  all four sentry snapshot fields — a tampered POST can store megabytes (comment bodies *are*
  capped at 2000 server-side, so the codebase already knows the pattern).
- `?/track` is open to all staff while the PR body and dialog copy say "managers track". The
  code comment says this is deliberate (same model as resolve/ignore) — fine, but it also
  means any staff member can generate assignment emails; the 30/15-min rate limit is the only
  ceiling. `?/selfReport` and `?/comment` have **no** rate limit (comment spam → notification
  spam for every assignee). Suggest one shared cheap limiter.
- No provenance check on track: `sentryIssueId` is never verified against Sentry, so a staff
  member can fabricate a "Tracked from Sentry RADIUS-…" incident. Integrity nit, related to H1.

### M5 — Design drift left in the PR: watermark vs read-rows
- Migration `0042` adds `admin_profile.notifications_seen_at`; `0043` drops it and creates
  `admin_notification_read`. Both ship in the same PR (harmless but noisy — and per the
  project's migration-chain situation, two extra journal entries for nothing).
- The PR description and the header comment of `incident-notifications.e2e.ts` still describe
  the **watermark** design ("newer than their `notifications_seen_at`", "watermark bump").
  The implementation is per-event read rows. Update the comment so the next reader doesn't
  reverse-engineer the wrong model.

---

## Low

### L1 — `BaseDialog` light-dismiss closes on legitimate in-dialog interactions
- **Where:** `apps/admin/src/lib/components/ui/BaseDialog.svelte:52-58`.
- **What:** the `click` handler on `<dialog>` checks only coordinates, not `e.target`.
  (a) Firefox dispatches keyboard-activated button clicks with `clientX/Y = 0` — that bubbles
  to the dialog, lands outside the rect, and closes the modal on keyboard activation of any
  inner button. (b) mousedown inside a text field + mouseup over the backdrop (text-selection
  drag) fires the click on `<dialog>` with outside coordinates — closes the form mid-edit and
  discards input. Both matter for the big IssueForm.
- **Fix:** require `e.target === el` *and* track `pointerdown` origin (only dismiss when the
  press started on the backdrop).

### L2 — Assignment emails block the request, serially
- **Where:** `notifyAssignees` awaited at `issues/+page.server.ts:164,201` and
  `sentry/+page.server.ts:130`; sends are sequential per recipient (`issueNotify.ts`).
- **What:** the design intent is "best-effort, never blocks the assignment" — and it never
  *fails* it, but it does delay the HTTP response by up to N × mailer latency. `void
  notifyAssignees(...)` (or `Promise.allSettled` inside) matches the stated contract better.

### L3 — Manager board payload grows without bound
- `load` for managers ships **every** issue (no pagination) plus the **full event history of
  every issue** (`listIssueEventsByIssue`) on each `/issues` visit — the event table is
  append-only, so this only grows. The assignee modal already demonstrates the fix (fetch
  `/issues/[id]/detail` on expand). Also: `unreadCount` runs on every admin page load — the
  `admin_user_id` filter IS backed by `admin_issue_assignee_user_idx` (re-verified; an earlier
  draft wrongly claimed no usable index), so the residual cost is one indexed query per page
  load, not a table scan. Fine today; worth a `// ponytail:`-style ceiling
  note, which the code mostly already carries elsewhere.

### L4 — `unassigned` notifications never reach the person who was unassigned
- `NOTIFIABLE_EVENTS` includes `unassigned`, but the feed requires a *current* assignee row —
  the unassignment that would notify you also removes you from the audience (and hides all
  your other unread items on that incident). Remaining assignees do see it. If notifying the
  removed person was the intent, this needs an audience exception; if not, document it.

### L5 — `packages/core/probe.sample.ts` is a stray debug script
- A MikroTik API probe (plain JS in a `.ts` file, `rejectUnauthorized: false`, raw
  `process.env`, no trailing newline) unrelated to the IMS, sitting in the package root. The
  PR body flags the smsgate rider but not this one. Move to a `scripts/`/docs location or drop.

### L6 — Minor a11y & cosmetics
- `NotificationBell` uses `role="menu"` but the panel contains forms/buttons that are not
  `menuitem`s; the mark-read button inside each row breaks the menu interaction model — a
  plain labelled region/list would be more honest. `aria-live` on a scrollable list re-announces
  on every open.
- Sidebar/MobileDrawer badge `aria-label` sits on a non-focusable `<span>` — most screen
  readers won't voice it; fold the count into the link's accessible name instead.
- `markOne` accepts any valid event id (even on incidents you can't see) — the read row is
  user-scoped so it's harmless junk at worst. The code comment only acknowledges the
  bogus-id case, not the real-but-invisible-incident case; worth a one-line amendment.

---

## What holds up well

- **Atomicity:** every mutation writes its timeline event via `recordEvent(tx, …)` inside the
  same transaction — the PR's own regression contract, honored everywhere including seeds.
- **Take race:** `takeIssue` locks the incident row (`FOR UPDATE`), re-checks
  open + zero-assignee in-tx, and the unit tests drive each refusal branch.
- **Duplicate tracking:** the partial unique index (`source='sentry'`) is the race-safe guard,
  with the 23505 → 409 mapping and a human error message.
- **AuthZ posture:** roles re-read from the DB on every action (`requireManager`), staff
  status re-checked per request in the hook, action POSTs gated centrally, 404-not-403
  consistently applied on the detail page and endpoint, `?/selfReport` force-clears any
  smuggled `assigneeId`, assignee lists whitelisted against active staff on every path.
- **Email hygiene:** HTML-escaping, CRLF-collapsed subjects, double rate limit
  (recipient + actor), self-assignment never notifies, whole-body try/catch so a mail failure
  can't fail (and duplicate) the committed incident.
- **Tests:** 18/18 unit tests pass; they pin the event-set contract per mutation and the
  pool-take invariants. The four e2e specs cover the real flows (timeline, notifications with
  self-exclusion, detail + comments, track-via-POST).

## Suggested fix order

1. H1 (one server-side regex) and H2 (note persistence) — user-visible correctness/security.
2. M1 (`assignedAt` filter) and M3 (status check) — one-line predicate fixes.
3. M2 (`git rm --cached` the auth artifacts).
4. M4/M5 consistency + comment cleanup, then the Lows opportunistically.
