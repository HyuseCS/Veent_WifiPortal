---
name: plan:ims-e2e-spec-modernization
description: "Modernize IMS e2e specs: post-L6a ARIA, loginNonManager timeout, live-trace the :113 assertion, add Report-an-issue tile coverage"
date: 10-07-26
feature: incident-management
---

# Backlog: IMS e2e spec modernization

**Priority:** Medium (test-infra debt; no app regression — all residuals are test-side)

**Origin:** EVL known-gap from `ims-audit-remediation_10-07-26` (see
`ims-audit-remediation-evl-iteration-001_REPORT_10-07-26.md` §Follow-up stub and `results.tsv`
row `evl-1b`).

## Problem

After this session's audit remediation, 4/7 IMS e2e specs pass; 3 residuals remain, all
test-side (app logic verified correct on inspection):

1. **Stale ARIA queries** — `incident-notifications.e2e.ts:80,84,88` still query
   `getByRole('menuitem', …)`. This session's L6a a11y fix intentionally dropped
   `role="menu"`/`menuitem` from `NotificationBell.svelte` in favor of a labelled region +
   list/links. The notification-click behavior also changed structurally this session — clicking
   a notification now opens `NotificationModal.svelte` (a preview modal) instead of navigating —
   so these specs need a rewrite to the new roles AND the new modal-based interaction, not just an
   ARIA-role swap.
2. **Login-helper timeout** — the M3 assertion in `incident-detail.e2e.ts:108` (resolved-unassigned
   incident → 404 for a non-assignee) now executes (selector unblocked) but the fresh-browser
   `loginNonManager` 2FA-enroll helper times out near the 60s cap. App logic (`detail/+server.ts:31`
   `isPoolItem`) verified correct by inspection; this is a harness timeout, not a bug.
3. **`:113` "2 unread" count** — needs a live browser/DB trace to distinguish reload-timing from
   bell accessible-name rendering. Count logic (`unreadCount` clean `count(*)`,
   `priority_changed` in `NOTIFIABLE_EVENTS`, `assignedAt <= createdAt` bound) verified correct by
   inspection; M1/L4 is proven working by the adjacent `:76` "1 unread" pass + self-exclusion
   (`:70`).

## Fix scope

1. Replace `role="menuitem"` dropdown queries with the post-L6a labelled-list/link roles across
   `incident-detail.e2e.ts`, `incident-notifications.e2e.ts`, `incident-timeline.e2e.ts`.
2. Update notification-click specs for the new modal-based flow (`NotificationModal.svelte`) —
   clicking a notification opens a preview modal, not a navigation.
3. Raise the `loginNonManager` helper's timeout, or (preferred) build/reuse a stored non-manager
   `storageState` fixture so re-enrolling 2FA isn't on the critical path per test run.
4. Re-run `incident-notifications.e2e.ts:113` with a live trace to confirm the 2-unread count
   renders correctly once (1) and (3) are fixed.
5. **New coverage gap identified this session:** the regular-admin "Report an issue" self-report
   tile path has zero e2e coverage today — add a spec.

## Notes

Not blocking — all 3 residuals are test-side with app logic verified correct by inspection. See
`ims-audit-remediation-evl-iteration-001_REPORT_10-07-26.md` for full root-cause detail.
