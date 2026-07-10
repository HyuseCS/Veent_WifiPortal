---
name: plan:repo-wide-lint-prettier-drift
description: "Repo-wide bun run lint fails at root due to .prettierrc tailwindStylesheet path drift — pre-existing, not caused by IMS audit remediation"
date: 10-07-26
feature: incident-management
---

# Backlog: repo-wide `bun run lint` prettier-config path drift

**Priority:** Low-Medium (blocks a clean root lint run repo-wide; not IMS-specific)

**Origin:** EVL known-gap from `ims-audit-remediation_10-07-26` (`results.tsv` row `evl-0`: "lint
FAIL confirmed pre-existing prettier-config drift (known-gap, not regression)"). This is a
general-plans-shaped issue (not incident-management-specific) but is recorded here because it was
discovered during this feature's EVL run; move/duplicate into `process/general-plans/backlog/` if
a general maintainer picks it up independently.

## Problem

Root `bun run lint` fails repo-wide due to a `.prettierrc` `tailwindStylesheet` path that is
root-relative and breaks when the lint command is invoked from the monorepo root rather than a
per-app context. Confirmed pre-existing (not introduced by this session's changes) — re-verified
against `HEAD` before this session's commits.

## Fix options

1. Make the `tailwindStylesheet` path resolution work correctly regardless of invocation cwd
   (e.g. resolve relative to the `.prettierrc` file location, or use an absolute/monorepo-relative
   path per app).
2. Alternatively, scope the root `lint` script to fan out per-app (matching the existing `check`
   script's per-app fan-out pattern) so each app resolves its own prettier config correctly.

## Notes

Per-app lint (`cd apps/admin && bun run lint`, etc.) was not verified to have the same failure —
scope the investigation to confirm whether this is root-invocation-only or affects all invocation
paths before fixing.
