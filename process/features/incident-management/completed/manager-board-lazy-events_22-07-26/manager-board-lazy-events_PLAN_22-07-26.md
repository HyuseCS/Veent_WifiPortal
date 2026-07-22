---
name: plan:manager-board-lazy-events
description: "Manager /issues board — stop eager-loading every issue's full event history; fetch one issue's timeline lazily on row-expand via the existing /issues/[id]/detail endpoint. Admin-only, no schema change."
date: 22-07-26
feature: incident-management
---

# Manager Board — Lazy Event Timeline (Option 2)

**Date**: 22-07-26
**Status**: ✅ VERIFIED — code-complete, all automated gates green, G8 browser + human handoff confirmed 22-07-26. Archived.
**Complexity**: SIMPLE
**Feature**: incident-management

## Overview

**TL;DR:** The manager `/issues` board currently ships EVERY issue's FULL append-only event history on every page visit (one `listIssueEventsByIssue` query, N+0 but unbounded growth). This plan removes that eager load and instead fetches a single issue's timeline on-demand when its row is expanded — reusing the EXISTING `/issues/[id]/detail` GET endpoint and mirroring the assignee-side `IssueDetailModal.svelte` fetch pattern. The board looks and behaves identically; only *when* history is fetched changes. Row pagination (Option 1) is explicitly OUT OF SCOPE.

Complexity: **SIMPLE** (3 touched files + 1 orphan removal; admin-only; no schema/auth/API-contract change — we only *consume* an existing endpoint).

---

## Goals

- Remove the eager `listIssueEventsByIssue` call from the manager board load.
- Fetch each expanded issue's timeline lazily from `/issues/[id]/detail`, with loading + error states, cached per-id.
- Keep all IMS e2e specs green — especially `incident-timeline.e2e.ts`, which expands a row and asserts the timeline text appears.

## Non-Goals (LOCKED — do not expand)

- Row pagination of `listIssues()` (Option 1) — deferred, stays in backlog.
- Any schema change, migration, or new index.
- Any change to the `/issues/[id]/detail` endpoint itself, its auth, or its response shape.
- Any customer / core / db package change. **Admin scope only.**
- Any change to the single-issue detail *page* (`/issues/[id]/+page.server.ts`) — untouched.

---

## Touchpoints (file:symbol)

| # | File | Symbol / location | Change |
|---|------|-------------------|--------|
| T1 | `apps/admin/src/routes/(app)/issues/+page.server.ts` | manager `if (canManage)` branch, `events:` field (line ~64) + the L3 CEILING comment (lines ~58-64) + `listIssueEventsByIssue` import (line 12) + non-manager `events:` field (line ~88) | Remove the eager `events` field from BOTH return branches; remove the L3 CEILING comment; remove the now-unused import. |
| T2 | `apps/admin/src/lib/components/feature/IssuesTable.svelte` | `events` prop (lines 23-34), `toggleExpand` (line 42), expanded-row History block (line 230-233) | Drop the `events` prop; add per-id lazy fetch + cache + loading/error state; render Timeline from the cache. |
| T3 | `apps/admin/src/routes/(app)/issues/+page.svelte` | `<IssuesTable ... events={data.events} ... />` (line 26) | Remove the `events={data.events}` prop wiring. |
| T4 | `apps/admin/src/lib/server/issues.ts` | `listIssueEventsByIssue` (line 348) | Orphaned after T1 (grep confirms the board load is its ONLY caller; zero test refs). Remove the export. See Blast Radius note for the certainty check. |

**Read-for-context (not modified):**
- `apps/admin/src/lib/components/feature/IssueDetailModal.svelte` — the canonical on-demand fetch pattern to mirror (AbortController, `r.ok` guard, loading/failed state, `{ events }` destructure).
- `apps/admin/src/lib/components/feature/Timeline.svelte` — prop is `{ events: IssueEventRow[] }`, unchanged.
- `apps/admin/src/routes/(app)/issues/[id]/detail/+server.ts` — the reused endpoint. Returns `json({ issue, events }, { 'cache-control': 'no-store' })`; 404 on missing/unauthorized. Not modified.

---

## Public Contracts

- **No public contract changes.** The `/issues/[id]/detail` GET endpoint (response shape `{ issue, events }`, auth = manager OR assignee OR open-pool, 404 on missing/unauthorized) is consumed unchanged. `incident-detail.e2e.ts` asserts its 200/404-by-role contract — that behaviour is untouched by this plan.
- `IssuesTable`'s component prop surface changes (internal to admin): the `events` prop is removed. Its only caller is `+page.svelte` (T3). Not a cross-package contract.
- `IssueEventRow` type continues to be imported by IssuesTable (now for the fetch-result cache type instead of the prop).

---

## Blast Radius

- **Files changed:** 4 (`+page.server.ts`, `IssuesTable.svelte`, `+page.svelte`, `issues.ts`).
- **Packages:** `apps/admin` only. Zero changes to `packages/core`, `packages/db`, customer, locator.
- **Risk class:** LOW. No schema, no migration, no auth logic, no billing, no new dependency, no new endpoint. The one real regression risk is the e2e timeline assertion race (see Verification + E2E-Race Mitigation).
- **Orphan-removal certainty (T4):** `grep -rn "listIssueEventsByIssue" apps/admin/src packages/` returns exactly two hits — its definition in `issues.ts` and its single caller in the board load. `grep` of `issues.test.ts` shows zero references. After T1 removes the caller, the function is provably dead. Removing it is the shortest-diff correct outcome (removes the CEILING debt entirely). If, at execute time, any new caller has appeared, KEEP the function and add a one-line `// ponytail:` note in the plan report instead of deleting.

---

## Lazy-Fetch Approach (step-by-step)

Mirror `IssueDetailModal.svelte`, adapted for a board where MULTIPLE rows can be expanded at once (the existing `SvelteSet<number> expanded`). Instead of a `$effect` keyed on a single open id, trigger an imperative fetch from `toggleExpand` on expand, and cache results per-id so re-expanding never refetches (AC3).

**IssuesTable.svelte state (new):**

```
let eventsCache = $state<Record<number, IssueEventRow[]>>({}); // id → fetched events (cache)
let loadingIds  = $state<Record<number, boolean>>({});          // id → fetch in flight
let failedIds   = $state<Record<number, boolean>>({});          // id → fetch failed
```

(Plain `$state` records are deeply reactive in Svelte 5 — same pattern MyIssuesList already uses for `draft`/`errors`. `// ponytail:` no store, no Map wrapper needed.)

**Fetch fn (new):**

```
async function fetchEvents(id: number) {
  if (id in eventsCache || loadingIds[id]) return; // AC3: cached or in-flight → skip
  loadingIds[id] = true;
  failedIds[id] = false;
  try {
    const r = await fetch(`/issues/${id}/detail`);
    if (!r.ok) throw new Error(String(r.status));
    const d = (await r.json()) as { events: IssueEventRow[] };
    eventsCache[id] = d.events;
  } catch {
    failedIds[id] = true; // AC4: degrade gracefully, never throw out of the row
  } finally {
    loadingIds[id] = false;
  }
}
```

**Trigger on expand:**

```
function toggleExpand(id: number) {
  if (expanded.has(id)) expanded.delete(id);
  else { expanded.add(id); void fetchEvents(id); }
}
```

**Expanded-row History block (replaces line 230-233 `<Timeline events={events[issue.id] ?? []} />`):**

```
<div class="border-t border-border pt-3">
  <span class="mb-2 block font-medium text-ink">History</span>
  {#if loadingIds[issue.id]}
    <div class="flex items-center gap-2 py-2 text-sm text-muted">
      <LoaderCircle class="h-4 w-4 animate-spin" aria-hidden="true" /> Loading history…
    </div>
  {:else if failedIds[issue.id]}
    <div class="flex items-center gap-2 rounded-lg border border-border bg-surface p-3 text-sm text-muted">
      <TriangleAlert class="h-4 w-4 shrink-0" aria-hidden="true" />
      Couldn't load the history. Everything above is still current.
    </div>
  {:else}
    <Timeline events={eventsCache[issue.id] ?? []} />
  {/if}
</div>
```

(Loading/error copy + icons copied verbatim from `IssueDetailModal.svelte` lines 170-184 — no new design work. Add the two lucide icon imports `LoaderCircle` and `TriangleAlert` to IssuesTable, matching the modal's imports.)

**Prop removal:** delete `events` from the `$props()` destructure and its type; the `IssueEventRow` import stays (used by the cache type).

**Design decisions (locked, keep minimal — ponytail):**
- No `AbortController` on the board. The modal needs abort because a single `$effect` re-runs when the user switches between pool cards (stale-request race). The board's fetch is a one-shot per-id keyed by expand and guarded by the cache/in-flight check, so there is no stale-superseding-request scenario to abort. `// ponytail:` skip AbortController — mark with a comment.
- Cache is never invalidated within a page visit. History is append-only and the board is a preview; a stale-by-seconds timeline on re-expand is acceptable and matches the modal's per-open fetch intent. Fresh data arrives on the next full page load. (No refetch = AC3.)
- Accessibility: the expand `<button>` keeps its existing `aria-expanded` / `aria-label` exactly as-is — not touched.

---

## E2E-Race Mitigation (key regression risk — AC5)

**Risk:** `incident-timeline.e2e.ts:56-57` clicks `Expand issue details` then asserts `getByText('Created this incident')` is visible. With eager load the text was present in the initial HTML; with lazy fetch it now appears only after the `/issues/[id]/detail` round-trip resolves.

**Why it stays green without a test change:** Playwright's `expect(locator).toBeVisible()` **auto-retries** until the default timeout (the spec runs under a 60s test timeout). As long as the component renders the Timeline once the fetch resolves (it does — the `{:else}` branch renders `<Timeline events={eventsCache[issue.id] ?? []} />` reactively when `loadingIds[id]` flips false and the cache fills), the assertion polls through the loading state and passes on the first frame the text exists. The `'Created this incident'` string is server-formatted by `eventSummary` in `issues.ts` and delivered inside the detail endpoint's `events` — identical bytes to before, just fetched later.

**Execute-time verification of the mitigation:** run `incident-timeline.e2e.ts` after the change (gate G5 below). If it flakes, the minimal fix is to ensure the loading→render transition is reactive (it is by construction). Do **not** add arbitrary `waitForTimeout`; `toBeVisible()` auto-wait is the correct mechanism. Only if a real failure surfaces, add an explicit `await expect(row.getByText('Loading history…')).toBeHidden()` before the text assertion — but this is a fallback, not part of the planned change.

---

## Implementation Checklist

1. **T2a — IssuesTable state:** In `apps/admin/src/lib/components/feature/IssuesTable.svelte`, add the three `$state` records (`eventsCache`, `loadingIds`, `failedIds`) and the two lucide imports (`LoaderCircle`, `TriangleAlert`). Verify: `bunx eslint` clean on the file.
2. **T2b — fetch fn:** Add `async function fetchEvents(id)` exactly per the Lazy-Fetch Approach (cache/in-flight guard first; `r.ok` throw; `failedIds` on catch; `loadingIds=false` in finally). Mark the no-AbortController choice with a `// ponytail:` comment.
3. **T2c — trigger:** Update `toggleExpand` to `void fetchEvents(id)` on the expand branch only.
4. **T2d — prop removal:** Remove `events` from the `$props()` destructure + its type; keep the `IssueEventRow` import (now the cache type).
5. **T2e — History block:** Replace the `<Timeline events={events[issue.id] ?? []} />` block (line ~230-233) with the loading / failed / Timeline `{#if}` block. Verify: `bun run check` clean.
6. **T3 — page wiring:** In `apps/admin/src/routes/(app)/issues/+page.svelte`, remove `events={data.events}` from `<IssuesTable ... />`.
7. **T1 — server load:** In `apps/admin/src/routes/(app)/issues/+page.server.ts`, remove the `events:` field from BOTH the manager and non-manager return objects, remove the L3 CEILING comment (lines ~58-64), and remove the `listIssueEventsByIssue` import. Verify: G1 grep shows no `listIssueEventsByIssue` / `events:` in the file.
8. **T4 — orphan removal:** Re-run `grep -rn "listIssueEventsByIssue" apps/admin/src packages/`. If the only remaining hit is the definition in `issues.ts`, remove the exported `listIssueEventsByIssue` function. If any new caller exists, KEEP it and note in the report.
9. **Gates:** Run G6 (`bun run check`) → G7 (scoped prettier + eslint) → G2 (`bunx vitest run`) → G3, G4, G5 (playwright specs) → G8 (browser + human handoff). All from inside `apps/admin/`.

## Phase Completion Rules

This SIMPLE plan is a single phase. It is **CODE DONE** when steps 1-8 are applied and gates G1, G2, G6, G7 are green. It is **VERIFIED** only when G3, G4, G5 (all admin e2e) are green AND the G8 browser pass + human verification handoff confirm expand→timeline, per-id caching (no refetch), and graceful fetch-failure — matching the project rule that browser-visible changes need both an agent browser pass and a human handoff. AC3/AC4 close as Agent-Probe (manual) with a backlog stub registered (see Test Infra Improvement Notes); do not mark VERIFIED on automated gates alone.

## Verification Evidence

| Gate / Scenario | Strategy | Proves SPEC criterion |
|---|---|---|
| G1 — `cd apps/admin && bunx grep`-equivalent: manager load no longer references event history. Concretely, after edit, `grep -n "listIssueEventsByIssue\|events:" apps/admin/src/routes/(app)/issues/+page.server.ts` shows no `listIssueEventsByIssue` and no `events:` field in either return branch. | Fully-Automated | AC1 |
| G2 — `cd apps/admin && bunx vitest run` (unit suite, incl. `issues.test.ts`) exits 0 — confirms no unit regression from the `issues.ts` orphan removal; `eventSummary` test (the source of the "Created this incident" string) still passes. | Fully-Automated | AC1, AC5 |
| G3 — `cd apps/admin && bunx playwright test e2e/incident-timeline.e2e.ts` green — expands a board row, timeline fetches + shows "Created this incident". | Hybrid (throwaway `radius_admin_test` DB + build/preview harness) | AC2, AC5 |
| G4 — `cd apps/admin && bunx playwright test e2e/incident-detail.e2e.ts` green — `/issues/[id]/detail` 200/404-by-role contract unchanged (we only consume it). | Hybrid | AC5 |
| G5 — `cd apps/admin && bunx playwright test` (full admin e2e, 12 specs / 23 tests: self-report, notifications, sentry, etc.) all green — board still shows freshly-created incidents on expand. | Hybrid | AC5 |
| G6 — `bun run check` exits 0 (svelte-check across apps). | Fully-Automated | AC6 |
| G7 — `cd apps/admin && bunx prettier --check "src/routes/(app)/issues/+page.server.ts" "src/routes/(app)/issues/+page.svelte" "src/lib/components/feature/IssuesTable.svelte" "src/lib/server/issues.ts"` clean + `bunx eslint <same 4 files>` clean. Scoped to touched files because repo-wide `bun run lint` has 297 files of pre-existing prettier drift (tracked backlog) that this change must neither fix nor worsen. | Fully-Automated | AC6 |
| G8 — Manual browser pass (agent + human handoff): open `/issues` as owner, expand a row → loading indicator then timeline; collapse + re-expand → no network refetch (DevTools Network); force a fetch failure (offline) → graceful "Couldn't load the history" message, row does not crash. | Agent-Probe | AC2, AC3, AC4 |

**Acceptance criteria ↔ proving gate:**
- **AC1** manager load no longer fetches event history eagerly — *proven by:* G1 (source grep) + G2 (unit suite green after orphan removal) — *strategy:* Fully-Automated.
- **AC2** expanding a row fetches + shows that issue's timeline — *proven by:* G3 (e2e expand→visible) + G8 (browser) — *strategy:* Hybrid.
- **AC3** fetch cached per-id / not refetched on re-expand — *proven by:* G8 (DevTools Network shows single request per id) — *strategy:* Agent-Probe. (Known-gap for automation: no unit/e2e harness currently asserts network-call counts for this component; see Test Infra Improvement Notes. AC3's gate stays CONDITIONAL on the manual probe — the cache/in-flight guard in code is the mechanism, the probe is the proof.)
- **AC4** fetch failure degrades gracefully — *proven by:* G8 (offline probe) — *strategy:* Agent-Probe. (Same known-gap: no automated fault-injection harness; CONDITIONAL on manual probe.)
- **AC5** all IMS e2e specs stay green — *proven by:* G3 + G4 + G5 — *strategy:* Hybrid.
- **AC6** `bun run check` + lint clean — *proven by:* G6 + G7 — *strategy:* Fully-Automated.

---

## Test Infra Improvement Notes

- **AC3 / AC4 have no automated coverage path within this plan's scope.** The client (browser) Vitest project (`vitest-browser-svelte` + real Chromium) is wired in `apps/admin` but has **zero `.svelte.test.ts` files** repo-wide — there is no existing pattern to add a component-level test that asserts "single fetch per id" (AC3) or "renders error state on fetch failure" (AC4). Writing the first `.svelte.test.ts` for this component is out of scope for a SIMPLE change and would be a green-field test-infra build. **Resolution: accept AC3/AC4 as Agent-Probe (manual) for now; register a backlog stub** to add a `IssuesTable.svelte.test.ts` (fetch-mock, assert one call on double-expand + error branch render) when the browser Vitest harness gets its first spec. Backlog note to write at UPDATE PROCESS: `process/features/incident-management/backlog/issuestable-component-test_NOTE_22-07-26.md`.
- Repo-wide `bun run lint` remains red (297 files pre-existing prettier drift, tracked in `repo-wide-lint-prettier-drift_NOTE_10-07-26.md`) — G7 is scoped to touched files as the honest gate.

---

## Resume and Execution Handoff

1. **Selected plan file:** `process/features/incident-management/active/manager-board-lazy-events_22-07-26/manager-board-lazy-events_PLAN_22-07-26.md`
2. **Last completed step:** PLAN written (this file). No code changed yet.
3. **Validate-contract status:** pending — vc-validate-agent writes the `## Validate Contract` section before EXECUTE.
4. **Supporting context loaded:** `process/context/all-context.md`, `process/context/tests/all-tests.md`, `process/context/uxui/all-uxui.md` (Svelte 5 runes conventions). Read the 4 touchpoint files + `IssueDetailModal.svelte` (fetch pattern) + `Timeline.svelte` (prop) before editing.
5. **Next step for a fresh agent:** apply T1→T4 in order (T2 is the substantive edit; T1/T3 are prop-wiring removals; T4 is the orphan cleanup — re-run the grep certainty check first). Then run gates in order: G1 → G6 → G7 → G2 → G3 → G4 → G5, then G8 browser + human handoff. Test runner: `bunx vitest run <file>` / `bunx playwright test <spec>` from **inside `apps/admin/`** (never `bun test <file>`). Branch: `refactor/mngr-pagination`. Do NOT auto-commit — prepare staged changes + message for the user.

---

## Validate Contract

Status: CONDITIONAL
Date: 22-07-26
date: 2026-07-22
generated-by: outer-pvl

Parallel strategy: sequential
Rationale: signal score 0/7 (single package `apps/admin`, no schema/API/auth surface, 4 files, LOW risk). No fan-out; in-session verification.

Net gate: CONDITIONAL — 0 FAILs, 1 CONCERN (test-coverage: AC3/AC4 have no automated gate, manual Agent-Probe only). Concern documented, backlog-stubbed, and explicitly accepted this session (see Accepted by).

### Test gates (C3 5-column table)

| criterion id | behavior | strategy | proving test | gap-resolution |
|---|---|---|---|---|
| AC1 | Manager board load no longer eager-fetches event history | Fully-Automated | `grep -n "listIssueEventsByIssue\|events:" apps/admin/src/routes/(app)/issues/+page.server.ts` shows neither + `cd apps/admin && bunx vitest run` exits 0 (G1+G2) | A |
| AC2 | Expanding a row fetches + shows that issue's timeline | Hybrid | `cd apps/admin && bunx playwright test e2e/incident-timeline.e2e.ts` green (G3) | A |
| AC3 | Fetch cached per-id, not refetched on re-expand | Agent-Probe | G8 DevTools Network: exactly one `/issues/[id]/detail` request per id across collapse+re-expand | D |
| AC4 | Fetch failure degrades gracefully (no row crash) | Agent-Probe | G8 offline expand → "Couldn't load the history" message, row stays intact | D |
| AC5 | All IMS e2e specs stay green | Hybrid | `cd apps/admin && bunx playwright test` — 12 specs / 23 tests incl. incident-timeline + incident-detail (G3+G4+G5) | A |
| AC6 | `bun run check` + scoped lint clean | Fully-Automated | `bun run check` exits 0 (G6) + scoped `bunx prettier --check`/`bunx eslint` on the 4 touched files clean (G7) | A |

gap-resolution legend: A = proven now / by this cycle's gate · B = fixed in this plan · C = deferred to named later phase · D = backlog test-building stub (named residual; keep-active).

C-4 reconciliation: the strategy column carries only the 3 proving strategies (Fully-Automated / Hybrid / Agent-Probe). Known-Gap is NOT a strategy here — the AC3/AC4 automated-harness absence is a named residual carried via gap-resolution D (backlog stub), and the Agent-Probe (G8) is their actual proving strategy.

Legacy line form (retained for existing consumers):
- AC1 (server load): Fully-automated: `grep -n "listIssueEventsByIssue\|events:" apps/admin/src/routes/(app)/issues/+page.server.ts` returns no match + `cd apps/admin && bunx vitest run` exits 0
- AC2 / AC5 (e2e): hybrid: `cd apps/admin && bunx playwright test e2e/incident-timeline.e2e.ts e2e/incident-detail.e2e.ts` then full `cd apps/admin && bunx playwright test` — precondition: throwaway `radius_admin_test` DB + build/preview harness (`TEST_ENV`), serial (`workers:1`)
- AC3 (no refetch): agent-probe: DevTools Network shows single request per id on re-expand
- AC4 (graceful failure): agent-probe: offline expand shows "Couldn't load the history."; known-gap: no admin browser-Vitest harness (zero `.svelte.test.ts` repo-wide) — backlog stub registered
- AC6 (check/lint): fully-automated: `bun run check` + scoped `bunx prettier --check`/`bunx eslint` on the 4 touched files

Failing stubs: none authored. The Fully-Automated rows (AC1, AC6) are static-analysis + existing-suite gates (source grep, `svelte-check`, scoped prettier/eslint) and a re-run of the EXISTING `apps/admin/src/lib/server/issues.test.ts` — no NEW red-first behavioral unit test applies. The one genuinely new behavior (client-side lazy fetch / cache / error state) has no automated harness within scope; that is the documented AC3/AC4 known-gap (backlog stub), not a stub-able Fully-Automated row.

Dimension findings:
- Infra fit: PASS — all 4 touched files are in `apps/admin`; no container/port/runtime surface. Test commands verified against `tests/all-tests.md`: `cd apps/admin && bunx vitest run <file>` and `bunx playwright test <spec>` run from inside the app (never `bun test <file>`, which no-ops fake timers).
- Test coverage: CONCERN — AC3 (no-refetch) and AC4 (graceful-failure) have NO Fully-Automated or Hybrid gate; sole proof is the manual Agent-Probe (G8), because the admin browser-Vitest project has zero `.svelte.test.ts` files repo-wide. Documented known-gap; backlog stub registered; accepted this session.
- Breaking changes: PASS — `listIssueEventsByIssue` orphan removal verified: exactly one caller (the board load import+usage in `+page.server.ts`), zero refs in `issues.test.ts`, zero refs in `e2e/`. Endpoint contract is byte-identical: `listIssueEvents` (used by `/issues/[id]/detail`) and `listIssueEventsByIssue` (removed) share the SAME `selectEvents` query, `mapEventRow`, `eventSummary` formatter, and `desc(createdAt), desc(id)` ordering — so lazy fetch delivers the same `IssueEventRow[]` (same "Created this incident" summary, same order) to the same Timeline. `listIssueEvents` is untouched.
- Security surface: PASS — no auth/schema/billing/secret/trust-boundary change. `/issues/[id]/detail` auth (manager OR assignee OR open-pool; 404-not-403; `cache-control: no-store`) is consumed unchanged; no evidence pack required (LOW risk class).
- Section feasibility (single SIMPLE phase): PASS — every edit target present and uniquely matchable (import line 12; manager `events:` line 64 + CEILING comment; non-manager `events:` line 88; IssuesTable `events` prop line 25/31, `toggleExpand` line 42, `<Timeline events={events[issue.id] ?? []}>` line 232; `+page.svelte` line 26). Minor gap: plan cited the Timeline block at ~230-233; actual line 232 — matchable by string, not a blocker. Highest-risk edit: T2e loading→render reactive transition (the `incident-timeline.e2e.ts` expand→`toBeVisible('Created this incident')` assertion now depends on the fetch resolving). Mitigation: mirror the proven `IssueDetailModal.svelte` fetch pattern (already renders this exact endpoint's events into Timeline) + rely on Playwright `toBeVisible()` auto-wait (60s test timeout) — no arbitrary `waitForTimeout`.

Open gaps:
- AC3/AC4 automated coverage: known-gap: no admin browser-Vitest harness (zero `.svelte.test.ts` files in any app). Resolution D — backlog stub to write at UPDATE PROCESS: `process/features/incident-management/backlog/issuestable-component-test_NOTE_22-07-26.md` (add `IssuesTable.svelte.test.ts`: fetch-mock asserts one call on double-expand + renders error branch on fetch failure) once the browser Vitest project gets its first spec.
- Repo-wide `bun run lint` is red (297 files pre-existing prettier drift, tracked in `repo-wide-lint-prettier-drift_NOTE_10-07-26.md`). G7 is deliberately scoped to the 4 touched files — this change must neither fix nor worsen the pre-existing drift.

### What This Coverage Does NOT Prove

- G1 (source grep): proves the manager load no longer references the eager event-history call; does NOT prove any runtime behavior.
- G2 (`bunx vitest run`): proves no server-side unit regression after the orphan removal and that `eventSummary` still yields "Created this incident"; does NOT exercise the client-side lazy fetch at all.
- G3/G4/G5 (playwright e2e): prove expand→timeline text becomes visible, the `/issues/[id]/detail` 200/404-by-role contract is intact, and all 12 admin specs stay green; do NOT assert the network-call COUNT (AC3 no-refetch) and do NOT inject a fetch failure (AC4 graceful degradation).
- G6/G7 (`bun run check` + scoped lint): prove typecheck and touched-file format/lint; do NOT prove any behavior.
- G8 (Agent-Probe): proves no-refetch and graceful-failure only by human/agent observation in DevTools; NOT machine-asserted — no automated harness exists to regress-guard it.

Gate: CONDITIONAL (1 concern noted, accepted; plan already structurally clean — 0 validator failures)
Accepted by: session — orchestrator explicitly accepted the AC3/AC4 closure as CONDITIONAL this session: "confirm AC3 (no refetch) / AC4 (graceful failure) closing as manual Agent-Probe is an accepted CONDITIONAL, not a FAIL, given no admin browser-Vitest harness exists." Accepted concern by name: `test-coverage: AC3/AC4 automated-harness known-gap`.

## Autonomous Goal Block

```
SESSION GOAL: Manager /issues board — lazy-load each issue's event timeline on row-expand (Option 2); remove the eager listIssueEventsByIssue board load.
Charter + umbrella plan: N/A — single plan
Autonomy: standard — EXECUTE requires explicit ENTER EXECUTE MODE; agents never auto-commit (user commits himself — prepare staged changes + suggested message only).
Hard stop conditions / safety constraints:
- Admin scope only — zero change to packages/core, packages/db, apps/customer, apps/locator.
- No schema/migration/endpoint change — /issues/[id]/detail is CONSUMED unchanged (auth + { issue, events } shape untouched).
- Do NOT delete listIssueEvents (single-issue fn backing the endpoint) — only listIssueEventsByIssue (the batch board fn) is the orphan. Re-run the grep certainty check at execute time; if a new caller appeared, KEEP it.
- Browser-visible change → G8 manual browser pass + human verification handoff required before VERIFIED. Do not mark VERIFIED on automated gates alone.
Next phase: EXECUTE: process/features/incident-management/active/manager-board-lazy-events_22-07-26/manager-board-lazy-events_PLAN_22-07-26.md
Validate contract: inline in plan (Gate: CONDITIONAL — AC3/AC4 accepted as manual Agent-Probe)
Execute start: apply T1→T4 in order; gates G1 → G6 (bun run check) → G7 (scoped prettier+eslint on the 4 files) → G2 (cd apps/admin && bunx vitest run) → G3/G4/G5 (cd apps/admin && bunx playwright test <spec> / full) — NEVER `bun test <file>` — then G8 browser + human handoff. Branch: refactor/mngr-pagination. Strategy: sequential single vc-execute-agent (opus). High-risk pack: no.
```
