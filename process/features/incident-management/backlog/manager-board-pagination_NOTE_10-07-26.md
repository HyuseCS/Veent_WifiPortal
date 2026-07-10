---
name: plan:manager-board-pagination
description: "L3 — paginate the manager /issues board load and fetch event history on expand instead of eager-loading everything"
date: 10-07-26
feature: incident-management
---

# Backlog: Manager-board pagination + event-history-on-expand (L3)

**Priority:** Low

**Origin:** deferred scope item from `ims-audit-remediation_10-07-26` (see plan `## Backlog` and
Phase 5 item 28), audit finding L3. Phase 5 shipped a ceiling comment on the manager branch of the
`/issues` load only — no pagination behavior changed this session.

## Problem

The manager branch of `/issues` load (`apps/admin/src/routes/(app)/issues/+page.server.ts`) loads
all incidents (and implicitly their event history) without pagination. This is fine at current
volume but will not scale as incident count grows.

## Fix options

1. Paginate the manager board load (cursor or offset-based).
2. Move event-history fetching to the existing `/issues/[id]/detail` endpoint, loaded on
   expand/click rather than eagerly for every row.

## Notes

No urgency at current data volume — ceiling comment in place at the load site marks the upgrade
path. Revisit when incident volume or load-time becomes a real concern.
