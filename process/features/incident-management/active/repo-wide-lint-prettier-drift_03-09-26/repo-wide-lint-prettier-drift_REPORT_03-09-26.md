---
name: report:repo-wide-lint-prettier-drift
description: 'Execution report: prettier drift sweep (GH #98, Option 1) — prettier green, 25 substantive eslint errors recorded as residual'
date: 03-09-26
feature: incident-management
status: executed
---

# REPORT: repo-wide lint — prettier drift sweep (GH #98)

Branch: `chore/repo-wide-lint-98` (off `staging`). Uncommitted at time of writing —
commit pending user go-ahead. Plan: sibling `*_PLAN_03-09-26.md`. PVL: CONDITIONAL →
fix loop (1 cycle) → PASS.

## What was done

1. **Step 0 — `.prettierignore` fix (deliberate config change):** `/drizzle/` →
   `drizzle/` (root-anchored line missed `packages/db/drizzle/meta/` — 53 generated
   drizzle snapshot JSONs would have been swept and re-drifted on next `db:generate`).
   Added `process/context/generated-skills-catalog.json` (graphify-generated).
   Verified: 0 generated paths left in `--list-different`; count dropped 362 → 308.
2. **Sweep:** `bunx prettier --write .` — 308 files reformatted. 5 files needed a
   second `--write` pass to converge (prettier idempotency quirk on:
   `apps/admin/scripts/seed-test-data.ts`, `packages/core/src/services/networkHealth.integration.spec.ts`,
   two completed process plans, `SYSTEM-IMPROVEMENT-SCAN_16-07-26.md`).
3. **ESLint (first-ever full root run):** 26 errors found. 1 auto-fixed
   (`svelte/no-useless-mustaches`, `customer/routes/auth/verify/+page.svelte`).
   Prettier re-checked green after the fix.

## Gate results (EVL)

| Gate | Result |
|---|---|
| `prettier --check .` | GREEN (exit 0) |
| `eslint .` | RED — 25 residual errors, all pre-existing, recorded below |
| `bun run lint` (aggregate) | RED — eslint leg, per criterion 2 contingency |
| `bun run check` | Same 5 pre-existing errors as baseline, 0 NEW (criterion 3 MET) |
| `bun run build` | GREEN — all 3 apps exit 0 (needs dummy env: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `MAYA_SANDBOX` — no `.env` on this machine; first run failed on missing env, NOT on code) |
| Diff audit | 308 modified, 0 deleted; sampled hunks are rewrap/quote-only (criterion 4 MET) |

## Residual eslint errors (25 — substantive, NOT fixed, out of scope)

- **19 × `svelte/no-navigation-without-resolve`** — raw `href` links, spread across
  admin components/layouts/error pages, customer SocialLinks + error page.
- **3 × `svelte/no-unused-props`** — `customer/src/lib/DeviceList.svelte:24`
  (`thisDeviceBound`, `atCap`, `oldest`).
- **2 × `@typescript-eslint/no-unused-vars`** — `customer/src/lib/server/maya-webhook.spec.ts:34`
  (`_args`), `docs/architecture/atlas/build.mjs:26` (`groupTitle`).
- **1 × `svelte/no-at-html-tags`** — `admin/src/routes/(app)/profile/+page.svelte:262`,
  `{@html}` flagged as XSS-prone. Pre-existing, admin-authenticated surface; rule-level
  flag, not a confirmed vulnerability. Worth a look when that page is next touched.

Follow-up tracking: backlog note updated (`../backlog/repo-wide-lint-prettier-drift_NOTE_10-07-26.md`).

## Known ceiling (unchanged, documented in backlog note)

`tailwindStylesheet` points at admin's `layout.css`, so customer/locator Tailwind
classes sort against admin's theme — cosmetic only. Fix would be Option 2 (per-app
configs), deliberately rejected 03-09-26.
