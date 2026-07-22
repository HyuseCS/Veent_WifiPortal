---
name: plan:manager-board-pagination
description: "L3 Option 1 (row pagination) — Option 2 (event-history-on-expand) shipped 22-07-26, see completed/manager-board-lazy-events_22-07-26/"
date: 10-07-26
feature: incident-management
---

# Backlog: Manager-board pagination (L3 Option 1)

**Priority:** Low

**Update 22-07-26:** Option 2 (fetch event history on expand instead of eager-loading it) shipped —
see `process/features/incident-management/completed/manager-board-lazy-events_22-07-26/`. Only
Option 1 (row pagination of `listIssues()`) remains open below.

**Origin:** deferred scope item from `ims-audit-remediation_10-07-26` (see plan `## Backlog` and
Phase 5 item 28), audit finding L3. Phase 5 shipped a ceiling comment on the manager branch of the
`/issues` load only — no pagination behavior changed this session.

## Problem

The manager branch of `/issues` load (`apps/admin/src/routes/(app)/issues/+page.server.ts`) loads
all incidents (and implicitly their event history) without pagination. This is fine at current
volume but will not scale as incident count grows.

## Fix options

1. Paginate the manager board load (cursor or offset-based). **Still open.**
2. ~~Move event-history fetching to the existing `/issues/[id]/detail` endpoint, loaded on
   expand/click rather than eagerly for every row.~~ **Shipped 22-07-26** — see
   `process/features/incident-management/completed/manager-board-lazy-events_22-07-26/`.

## Notes

No urgency at current data volume — Option 2's eager-load removal buys more headroom before
Option 1 (row pagination of the manager board's incident LIST itself) becomes necessary. Revisit
when incident volume or load-time becomes a real concern.
