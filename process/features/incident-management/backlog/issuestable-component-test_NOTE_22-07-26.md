---
name: note:issuestable-component-test
description: "Add IssuesTable.svelte.test.ts once the admin browser-Vitest project gets its first spec — covers AC3 (no-refetch on re-expand) and AC4 (graceful fetch-failure), which currently have no automated coverage."
date: 22-07-26
feature: incident-management
---

# Backlog: IssuesTable component test (AC3/AC4 automated coverage)

**Priority:** Low

**Origin:** deferred test-infra gap from `manager-board-lazy-events_22-07-26` (see
`process/features/incident-management/completed/manager-board-lazy-events_22-07-26/manager-board-lazy-events_PLAN_22-07-26.md`
§Test Infra Improvement Notes and its validate-contract concern
`test-coverage: AC3/AC4 automated-harness known-gap`).

## Problem

`IssuesTable.svelte`'s lazy event-timeline fetch (added 22-07-26) has two behaviors with no
automated proof:

- **AC3** — fetch is cached per-id and not re-issued on re-expand (cache/in-flight guard in
  `fetchEvents`).
- **AC4** — a failed fetch degrades gracefully (shows "Couldn't load the history." instead of
  crashing the row).

Both were verified only by a manual Agent-Probe (DevTools Network + offline test) during the
22-07-26 session, because the admin browser-Vitest project (`vitest-browser-svelte` +
`@vitest/browser-playwright`, real headless Chromium) has **zero `.svelte.test.ts` files anywhere**
in the repo — see `process/context/tests/all-tests.md`. There is no existing pattern to write the
first component-level test against.

## Fix

Once the admin (or any app's) browser-Vitest project gets its first `.svelte.test.ts` spec, add
`apps/admin/src/lib/components/feature/IssuesTable.svelte.test.ts`:

1. Mock `fetch` for `/issues/[id]/detail`.
2. Expand a row, expand+collapse+re-expand the same row → assert exactly ONE fetch call for that
   id (proves AC3).
3. Mock a rejected/non-ok fetch → expand → assert the "Couldn't load the history." error branch
   renders instead of throwing (proves AC4).

## Notes

No urgency — the underlying behavior is already correct and human-verified; this is purely about
closing the automated-coverage gap so a future regression would be caught by CI-equivalent gates
instead of relying on another manual pass.
