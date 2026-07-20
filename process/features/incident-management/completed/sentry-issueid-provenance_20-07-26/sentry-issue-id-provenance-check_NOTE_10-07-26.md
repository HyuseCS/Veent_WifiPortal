---
name: plan:sentry-issue-id-provenance-check
description: "M4d — verify sentryIssueId against the Sentry API to prevent fabricated 'Tracked from Sentry' incidents"
date: 10-07-26
feature: incident-management
---

# Backlog: sentryIssueId provenance check (M4d)

**Status: CLOSED (20-07-26).** Implemented and VERIFIED —
`process/features/incident-management/completed/sentry-issueid-provenance_20-07-26/`. Fix option 1
below was taken (reused the existing `fetchLatestEventRaw`, no new endpoint); fix option 2 (cache +
rate-limit) was already satisfied by the existing `admin_sentry_track` rate limit plus
`fetchLatestEventRaw`'s existing read cache — no new scope needed. See that plan's REPORT for full
verification evidence, including a real hygiene finding this work surfaced (live Sentry credentials
were leaking into the e2e test env — since fixed as part of the same session).

**Priority:** Medium

**Origin:** deferred scope item from `ims-audit-remediation_10-07-26` (see plan `## Backlog`), audit
finding M4d.

## Problem

`?/track` (`apps/admin/src/routes/(app)/sentry/+page.server.ts`) now format-checks `sentryIssueId`
(`/^\d{1,32}$/`, added in H1 remediation) but does not verify the id actually exists as a Sentry
issue via the Sentry API. A staff member with `?/track` access could submit any well-formed numeric
id + arbitrary title/permalink and create an incident that displays as "Tracked from Sentry" without
being a real Sentry-sourced event.

## Root cause

Format validation is not provenance validation — no server-side round-trip to the Sentry API to
confirm the issue id is real and belongs to the configured org/project.

## Fix options

1. Call the Sentry API (`GET /api/0/issues/{issue_id}/`) server-side in `?/track` before persisting,
   reject if not found or if the org/project doesn't match.
2. Cache/rate-limit the lookup to avoid hammering the Sentry API on repeated submissions.

## Notes

Requires a `SENTRY_AUTH_TOKEN`-scoped API call (already present as an admin env var for other
Sentry integration surfaces). Not blocking — this is a trust/provenance concern, not a live
vulnerability like H1.
