# incident-management

<!-- Part of veent_wifiportal -->

## Scope

Staff-facing incident/issue tracking and Sentry error ingestion for the admin app. Covers the
`/issues` and `/sentry` route surfaces, error-event-to-incident linkage, assignment-aware status
tracking, a self-serve "Open pool" for unassigned incidents, in-app/email notifications, and the
resolution flow (including resolution notes).

## Key Source Files

- `apps/admin/src/routes/(app)/issues/**` -- issue list, detail (`[id]/`), and notifications routes (8 files)
- `apps/admin/src/routes/(app)/sentry/**` -- Sentry incident ingestion/inspection routes (5 files)
- `apps/admin/src/lib/server/issues.ts` (+ test) -- core issue/incident service logic
- `apps/admin/src/lib/server/issueNotify.ts` -- issue assignment/status notification dispatch
- `apps/admin/src/lib/server/notifications.ts` (+ test) -- bell/notification-center backend
- `apps/admin/src/lib/server/sentry/*` -- Sentry event ingestion, dedupe, PII scrubbing
- `apps/admin/src/lib/server/emails/issue-assigned.ts` -- assignment email template
- `packages/db/src/schema/admin-issue.ts` -- incident/issue schema
- `packages/db/src/schema/admin-issue-event.ts` -- issue event/timeline schema
- `apps/admin/e2e/incident-detail.e2e.ts`, `apps/admin/e2e/incident-notifications.e2e.ts`, `apps/admin/e2e/incident-sentry.e2e.ts`, `apps/admin/e2e/incident-timeline.e2e.ts` -- E2E coverage

## Related Context

- `process/context/all-context.md` -- root context router
- `process/context/database/all-database.md` -- schema ownership (`packages/db/src/schema/*`), migration commands
- `process/context/auth/all-auth.md` -- admin auth-guard pattern used by the issues/sentry routes
- Sentry integration section in `process/context/all-context.md` (per Subagent C/D findings: `@sentry/sveltekit`, `apps/admin/src/lib/server/sentry/`, PII `scrubEvent`)

## Current Status

Status: stable — audit remediation complete (2026-07-10)

The full Incident Management System (IMS) build merged to `staging` via PR #74 (`ccb2e02`, 62
files, ~4.2k lines): two-tab filters, quick-preview modal, self-report tile, assignment-aware
status, self-serve Open pool, and a Sentry-dedupe partial unique index.

All 13 findings (2H/5M/6L) from the post-merge code-review audit were remediated in
`completed/ims-audit-remediation_10-07-26/` (2026-07-10): H1 stored-XSS via unvalidated
`sentryPermalink` closed, H2 resolution-note edits now persist + audit-trail via a new
`note_edited` event type (migration `0046_oval_lorna_dane.sql`), M1/L4 notification-feed
predicate bugs fixed, M2 committed test-harness secrets untracked, M3 open-pool readability
predicate fixed, M4 validation unified + rate limits added, M5/L1/L2/L5/L6 addressed. Same
session also shipped post-audit polish: incident-card status indicators moved to the card
footer, notification bell list moved into the `(app)` layout, and notification clicks now open a
`NotificationModal.svelte` preview instead of navigating.

**Known gaps (backlog, non-blocking):** repo-wide `bun run lint` fails on a pre-existing
`.prettierrc` path drift (unrelated to IMS); manager-board pagination (L3) is a ceiling comment
only. IMS e2e spec modernization (the L6a a11y/modal-click rewrite + self-report tile coverage)
shipped 20-07-26 — `completed/ims-e2e-spec-modernization_20-07-26/`, all 12 admin e2e specs green.
Sentry-permalink host pinning and `sentryIssueId` API-provenance checks were also already closed —
see `completed/`. See `process/features/incident-management/backlog/` for the remaining filed
notes.

## Folder Contents

```
process/features/incident-management/
  active/       -- in-progress plans for this feature (each task lives inside a {slug}_{date}/ task folder)
  completed/    -- archived completed plans
  backlog/      -- deferred/future plans
```

All artifacts (plans, specs, reports, references) colocate inside each `{slug}_{date}/` task folder. Do NOT create `reports/` or `references/` sibling dirs.
