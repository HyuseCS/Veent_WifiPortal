---
name: plan:repo-wide-lint-prettier-drift
description: "Repo-wide bun run lint fails at root due to .prettierrc tailwindStylesheet path drift — pre-existing, not caused by IMS audit remediation"
date: 10-07-26
feature: incident-management
---

# Backlog: repo-wide `bun run lint` prettier-config path drift

**Status: PARTIALLY CLOSED (20-07-26).** The original root cause (a broken `tailwindStylesheet`
path that crashed prettier with ENOENT) is fixed. Remaining scope is narrower — see below. Do NOT
close this note further without a decision on the 297-file sweep.

**What was fixed (20-07-26):** `.prettierrc`'s `tailwindStylesheet` was `./src/routes/layout.css`
(root-relative, resolved against the monorepo root — the file doesn't exist there) and now reads
`apps/admin/src/routes/layout.css` (verified present in `.prettierrc` on the tree). This removed
the ENOENT crash that previously blocked prettier from running at all.

**What is NOT fixed — still blocks a clean root lint:** re-run of `bun run lint` at repo root
(20-07-26) still exits 1: `prettier --check .` reports **297 files** with pre-existing style/format
drift (not crashes — genuine formatting differences), so `&& eslint .` never runs and eslint
remains unverified at the repo root. This is a much narrower problem than before (no crash, just
volume), but root lint is still red.

**Decision needed:** whether to run a repo-wide `prettier --write .` sweep (297 files, high diff
noise, needs review) to get root lint green, or to permanently scope `lint` to fan out per-app
(matching `check`'s existing per-app pattern) so a red root aggregate doesn't block work.

**Ceiling that cannot be fixed by editing `.prettierrc` alone:** `tailwindStylesheet` only feeds
Tailwind class **sort order** in prettier's Tailwind plugin, not correctness. Pointing it at
admin's `layout.css` (its Tailwind theme/config) means customer and locator files get their
Tailwind classes sorted against **admin's** theme, not their own — cosmetic only (wrong sort order
for customer/locator's own token set), never a build or runtime issue. A fully-correct fix would
need per-app prettier config or a per-app lint fan-out (see Fix options below), not just a
different single path.

## Fix options

1. Repo-wide `prettier --write .` sweep to clear the 297-file drift, then re-verify root lint is
   green and `eslint .` actually runs. High diff volume — needs review before applying.
2. Scope the root `lint` script to fan out per-app (matching the existing `check` script's
   per-app fan-out pattern) so each app resolves its own prettier config (and correct
   `tailwindStylesheet` target) independently. This also resolves the sort-order ceiling above.

## Notes

Per-app lint (`cd apps/admin && bun run lint`, etc.) was not verified to have the same failure —
scope the investigation to confirm whether the 297-file drift is root-invocation-only or affects
all invocation paths before choosing a fix.
