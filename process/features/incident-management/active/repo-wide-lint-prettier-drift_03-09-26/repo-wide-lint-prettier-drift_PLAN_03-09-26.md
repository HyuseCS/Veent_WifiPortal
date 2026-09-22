---
name: plan:repo-wide-lint-prettier-drift
description: 'One-time prettier --write sweep to clear 361-file drift and get root `bun run lint` green (GH #98, Option 1)'
date: 03-09-26
feature: incident-management
status: active
---

# PLAN: repo-wide lint — prettier drift sweep (GH #98)

**Decision (user, 03-09-26): Option 1 — one-time `prettier --write .` sweep.**
Option 2 (per-app lint fan-out) rejected: no per-app lint scripts exist today, so it
would add new machinery to 5 workspaces to fix a cosmetic tailwind sort-order quirk.
Backlog note: `process/features/incident-management/backlog/repo-wide-lint-prettier-drift_NOTE_10-07-26.md`.

## Goal (success criteria)

1. `bunx prettier --check .` exits 0 at repo root.
2. `eslint .` at root runs to completion (state currently unknown — it has never run
   past the prettier failure). Mechanical/auto-fixable findings fixed; substantive
   findings recorded, not fixed (out of scope). Root `bun run lint` is green only if
   no substantive eslint ERRORS remain; otherwise the REPORT states the residual
   exit status and findings explicitly, with a follow-up backlog entry.
3. `bun run check` (svelte-check, all apps) reports no NEW errors vs pre-sweep baseline.
   Baseline (03-09-26): 5 pre-existing errors — `src/lib/server/db.ts` 6:28 in all
   three apps, `customer/src/lib/server/account-feed.ts` 38:36,
   `admin/src/lib/server/dashboard-feed.ts` 45:26 (all `string | undefined`).
4. Diff is style-only: no logic changes, no file deletions, no config changes —
   EXCEPT the pre-sweep `.prettierignore` fix in step 0 (deliberate, see below).

## Research facts (03-09-26)

- Drift is ~362 files now (was 297 on 20-07-26; re-measure at sweep time). Root
  `lint` = `prettier --check . && eslint .`.
- PVL found 53 of those are GENERATED drizzle snapshots (`packages/db/drizzle/meta/*.json`):
  `.prettierignore`'s `/drizzle/` line is root-anchored and misses `packages/db/drizzle/`.
  Sweeping them would re-drift on the next `db:generate`. Must be excluded pre-sweep.
- `process/context/generated-skills-catalog.json` is also generated (graphify catalog) —
  exclude it too.
- No per-app `lint`/`format` scripts exist; only root. Apps only have `check` (svelte-check).
- `.prettierrc` already fixed (tailwindStylesheet → `apps/admin/src/routes/layout.css`); no crash.
- Tailwind class reordering by prettier-plugin-tailwindcss is markup-attribute order only —
  CSS application order is decided by the stylesheet, so behavior-neutral.

## Steps

0. **Prettierignore fix (pre-sweep, deliberate config change)**: change `/drizzle/` →
   `drizzle/` and add `process/context/generated-skills-catalog.json`. Verify via
   `bunx prettier --list-different .` that no `packages/db/drizzle/` or generated-catalog
   paths remain in the list.
1. **Baseline**: record `bun run check` output before the sweep. DONE 03-09-26 —
   see criterion 3 for the 5 pre-existing errors.
2. **Sweep**: `bunx prettier --write .` at repo root. Verify `bunx prettier --check .` exits 0.
3. **Diff audit**: confirm the diff is whitespace/quotes/class-order/wrapping only —
   spot-check via `git diff --stat` and sampled hunks; no semantic tokens added/removed.
4. **ESLint**: run `bunx eslint .`. If failures: apply `--fix` for auto-fixable only,
   re-run prettier check after (eslint-config-prettier is present, conflicts unlikely).
   Substantive (non-auto-fixable) findings → recorded in REPORT + backlog note update, NOT fixed.
5. **Verify**: `bun run check` again — compare to baseline (criterion 3). `bun run build` as smoke.
6. **Report**: write `repo-wide-lint-prettier-drift_REPORT_03-09-26.md` in this folder.

## Blast radius

- ~309 files after the drizzle/catalog exclusions. Breakdown (PVL): process/ ~115,
  apps/admin 83, docs/ ~40, apps/customer 27, packages/core 19, apps/locator 4,
  scripts 5, root ~5, packages/db 3 (non-generated). Over 40% is markdown docs/process —
  prettier rewraps prose/tables; harmless but large diff noise. Vendored external docs
  (e.g. `docs/CAST_API_DOCS*`) get reformatted too — accepted, cosmetic only.
- Billing-path source files are touched but only re-formatted; criterion 4 guards semantics.
- Branch: `chore/repo-wide-lint-98` off `staging`. No commit/push until user says so.
  When the user asks to commit: the sweep lands as ONE isolated commit (atomic revert);
  any eslint `--fix` changes land as a separate commit.

## Out of scope

- Per-app prettier configs / lint fan-out (Option 2) — stays in backlog note as the
  documented ceiling for tailwind sort order in customer/locator.
- Fixing substantive eslint findings.
- The 297→361 growth cause (it is just continued drift since July).
