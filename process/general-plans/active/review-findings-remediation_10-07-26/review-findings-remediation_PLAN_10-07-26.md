---
name: plan:review-findings-remediation
description: "Close 19 verified code-review findings across apps/admin code, .gitignore, context docs, and protocol docs — surgical fixes only"
date: 10-07-26
feature: general
phase: "PLAN"
---

# Review Findings Remediation — Code-Review Findings Sweep (19 claims)

Date: 10-07-26
Status: ACTIVE — VALIDATE complete (Gate: PASS), ready for EXECUTE
Complexity: SIMPLE (19 small surgical fixes, no phase split)

## Context

A code-review pass on the incident-management work produced 24 findings (19 inline + 5
nitpick). Each was verified against **current** code at line level in RESEARCH. **5 are
invalid or already-addressed and are explicitly OUT OF SCOPE for this plan — EXECUTE must
never touch them:**

| # | Claim | Why skipped |
|---|---|---|
| 3 | NotificationModal stale-request guard | Already implemented via `AbortController` + `AbortError` ignore + `!controller.signal.aborted` gate. No live bug. |
| 7 | login.html hardcoded `172.17.0.187` | Intentional dev template; `bun run setup:prod` already rewrites host:port for `deploy/login.html`. Outside `/admin` scope. |
| 8 / 10 | `*.md.seed` keywords → YAML list | Every real `all-{group}.md` uses scalar `keywords: a, b, c`; a list would diverge from the working discovery-validator convention. |
| 19 | RESEARCH doc PR #74 → #75 | #74 is correct (`ccb2e02` "Merge pull request #74"). No #75 exists. |

19 findings are valid and are remediated here, grouped A–E. Most are doc-accuracy fixes;
four are small `apps/admin` code fixes, all on paths with existing test coverage. No new
files are expected — every fix touches an existing file.

Migrations were counted live at RESEARCH time: **47 files, `0000`–`0046`**
(`0046_oval_lorna_dane.sql`). This count is a **snapshot** — re-derive via
`ls packages/db/drizzle/*.sql | wc -l` at EXECUTE time in case it drifted, and use the live
number in C1/C2 instead of the stale "47" if it changed. (Re-confirmed live at VALIDATE
time 10-07-26: still 47 — no drift.)

Admin e2e suite has **10 specs total, 4 of which are IMS** (`incident-detail`,
`incident-notifications`, `incident-sentry`, `incident-timeline`). This fact drives C3/C4.

## Guardrails — must not destroy functionality

- **A1**: valid `<input type="date">` values (`yyyy-mm-dd`) must still parse; only
  impossible/malformed calendar dates (e.g. `2026-02-31`) are newly rejected.
- **A2**: `.for('update')` only serializes concurrent transactions; single-caller behavior
  is byte-for-byte identical.
- **A3**: `role` and `unreadCount` failures must still propagate/reject the page load as
  today — only the `listNotifications` call gets the `.catch(() => [])` isolation.
- **D2 / D4**: preserve every verbatim signal string (`Gate: PASS`, `V1 AUTO-PROCEED`,
  etc.) and the skip-reason documentation requirement — reword surrounding prose only.
- Doc counts (C1/C2) are snapshots — re-derive from
  `ls packages/db/drizzle/*.sql | wc -l` if stale at EXECUTE time.
- Every fix is surgical: no adjacent refactors, no reformatting beyond the stated line(s).

## Touchpoints

| File | Fixes |
|---|---|
| `apps/admin/src/lib/server/formValidation.ts` | A1 |
| `apps/admin/src/lib/server/formValidation.test.ts` | A1 (new test case) |
| `apps/admin/src/lib/server/issues.ts` | A2 |
| `apps/admin/src/routes/(app)/+layout.server.ts` | A3 |
| `apps/admin/e2e/incident-detail.e2e.ts` | A4 |
| `.gitignore` | B1 |
| `process/context/all-context.md` | C1, E4 |
| `process/context/database/all-database.md` | C2 |
| `process/context/tests/all-tests.md` | C3 |
| `process/features/incident-management/_GUIDE.md` | C4 |
| `process/development-protocols/vc-autoresearch-spec.md` | D1, E5 |
| `process/development-protocols/orchestration.md` | D2 |
| `process/development-protocols/vc-system-behavior/04-research.md` | D3 |
| `process/development-protocols/vc-system-behavior/08-validate.md` | D4 |
| `process/development-protocols/vc-system-behavior/09-execute.md` | D4 |
| `process/development-protocols/all-development-protocols.md` | D1 (secondary reference — see VALIDATE addendum below) |
| `process/features/admin-staff-governance/_GUIDE.md` | E1 |
| `process/general-plans/active/_GUIDE.md` | E2 |
| `process/_seeds/general-plans/active/_GUIDE.md` | E3 |
| `process/development-protocols/vc-system-behavior/05-spec.md` | E6 |

19 fixes across 19 files (C1 and E4 both touch `all-context.md`; D1 touches 2 files —
see VALIDATE addendum). No new/untracked files expected.

**VALIDATE addendum (added at VALIDATE, 10-07-26):** Layer 2 review found that D1's fix
(changing `vc-autoresearch-spec.md` frontmatter `read_order: 7` → `8`) leaves a stale
secondary mention at `process/development-protocols/all-development-protocols.md:51`,
which currently reads `` `vc-autoresearch-spec.md` (optional deep reference; `read_order: 7`,
`required: false`) ``. This line is not machine-parsed (routing uses the actual frontmatter,
not this prose mention) but would become inaccurate the moment D1 lands, re-introducing the
same class of doc drift this plan exists to fix. **D1 checklist item below now includes this
second edit.**

## Public Contracts

- **A1** changes `parseDueDate`'s accepted input set (narrows it — rejects previously
  silently-normalized malformed dates like `2026-02-31`). This is a behavior change at a
  public trust boundary (Sentry `?/track` action + incident board `parseIssueInput`), but
  it is a bug fix, not a contract widening — no caller currently relies on malformed-date
  acceptance. **Confirmed at VALIDATE**: `new Date('2026-02-31T00:00:00Z')` currently
  silently normalizes to `2026-03-03T00:00:00.000Z` instead of rejecting — the finding is a
  real, live bug, not a false positive.
- **A2** does not change the function signature or return shape of `setIssueStatus` — only
  adds a row lock inside the existing transaction.
- **A3** does not change the `+layout.server.ts` load-function return shape — `notifications`
  still resolves to `[]` on failure exactly as the `Promise.resolve([])` non-`/issues` branch
  already does today; only the failure path changes from "reject" to "resolve empty".
- **A4** does not change `loginNonManager`'s return type or success-path behavior — only its
  failure-path cleanup.
- **B1** changes `.gitignore` matching (widens: was dir-only, now matches files too) — no
  runtime contract impact.
- **C/D/E** are documentation-only; no runtime contract impact.

## Blast Radius

- **Risk class**: none of the 19 fixes touch auth/identity, billing/credits, schema
  migrations, or public API contracts. A1 touches a validation trust-boundary function but
  is a narrowing bug fix with existing test coverage. A2 touches a DB read inside an
  existing transaction (adds row lock, no schema change).
- **Package scope**: `apps/admin` (code: A1–A4), repo root (`.gitignore`: B1),
  `process/context/**` (C1–C4, E4), `process/development-protocols/**` (D1–D4, E1, E5, E6),
  `process/general-plans/**` and `process/_seeds/**` (E2, E3), `process/features/**` (C4, E1).
- **File count**: 19 files touched, 20 discrete edits (D1 now touches 2 files — see
  VALIDATE addendum above).
- **Size**: every edit is small (1–15 lines); no fix exceeds a single function/section.

## Implementation Checklist

### Group A — `apps/admin` code fixes (4)

- [ ] **A1** — `apps/admin/src/lib/server/formValidation.ts` `parseDueDate` (~L42–53):
  reject impossible calendar dates.
  - Require `/^\d{4}-\d{2}-\d{2}$/` on `trimmed`; on mismatch return
    `{ error: 'Invalid due date.' }`.
  - Parse the three integer components (`y`, `mo`, `d`), build
    `new Date(Date.UTC(y, mo - 1, d))`, and verify `getUTCFullYear()`,
    `getUTCMonth() + 1`, and `getUTCDate()` all equal the parsed components; on any
    mismatch return `{ error: 'Invalid due date.' }`.
  - Keep the existing past-date + `existingDueMs` grandfather check unchanged (runs after
    the new strict-parse guard, using the validated `Date`).
  - **Test**: add a case to `apps/admin/src/lib/server/formValidation.test.ts` asserting
    `parseDueDate('2026-02-31')` → `{ error: 'Invalid due date.' }`, plus a sanity case
    that a valid `yyyy-mm-dd` (e.g. a future date) still parses to `{ dueDate: Date }`.
    Must not break the existing suite.

- [ ] **A2** — `apps/admin/src/lib/server/issues.ts` `setIssueStatus` pre-update select
  (~L643–648): add row lock.
  - Add `.for('update')` to the `before` read so two concurrent same-status
    resolution-note edits serialize before the compare/emit:
    `.where(eq(adminIssue.id, id)).for('update').limit(1)`.
  - Match the existing repo idiom at `packages/core/src/services/rateLimit.ts:77`
    (`.where(...).for('update').limit(1)`).
  - Single-caller path behavior is unchanged — no new test (concurrency isn't
    unit-testable here); existing `issues.test.ts` must stay green as regression proof.

- [ ] **A3** — `apps/admin/src/routes/(app)/+layout.server.ts` (~L31–35): isolate the
  notification-list read.
  - Change `onIssues ? listNotifications(db, event.locals.user.id) : Promise.resolve([])`
    to `onIssues ? listNotifications(db, event.locals.user.id).catch(() => []) : Promise.resolve([])`.
  - `role` and `unreadCount` promises in the same `Promise.all` are untouched and must
    keep propagating failures as today.

- [ ] **A4** — `apps/admin/e2e/incident-detail.e2e.ts` `loginNonManager` (~L55–71): close
  browser on failure.
  - Wrap the goto/fill/click auth sequence (everything after `browser.newPage(...)`) in
    `try { ...; return page } catch (e) { await browser.close(); throw e }`.
  - Success path (returns the open `page`, caller owns teardown) is unchanged.

### Group B — config (1)

- [ ] **B1** — `.gitignore` L55: `.vibecode-backup*/` → `.vibecode-backup*` (drop
  trailing `/`) so backup files and dirs are both ignored. Optionally delete the now-fully-
  subsumed L49 `.vibecode-backup` entry (not required — verify it doesn't break anything
  else first; if unsure, leave L49 in place).

### Group C — context-doc accuracy (4)

- [ ] **C1** — `process/context/all-context.md` L184 (repository structure tree): change
  `drizzle/ ← 46 migrations` → `drizzle/ ← 47 migrations` (re-verify count live at EXECUTE
  time; grep the file for any other stale "46" migration references before finishing).

- [ ] **C2** — `process/context/database/all-database.md` L154–155: change
  `46, 0000–0045` → `47, 0000–0046 as of 2026-07-10`; mention `0046_oval_lorna_dane.sql`
  by name.

- [ ] **C3** — `process/context/tests/all-tests.md` L177: change
  `3/10 IMS e2e specs` → `3/10 admin E2E specs` (the 10 is the admin suite total; only 4
  specs are IMS). Leave the rest of the line unchanged.

- [ ] **C4** — `process/features/incident-management/_GUIDE.md` L23: prefix the four spec
  names with `apps/admin/e2e/` (`incident-detail`, `incident-notifications`,
  `incident-sentry`, `incident-timeline`).

### Group D — protocol-doc fixes (4)

- [ ] **D1** — `process/development-protocols/vc-autoresearch-spec.md` frontmatter:
  change `read_order: 7` → `read_order: 8` (fixes collision with
  `communication-standards.md`, also `7`). Resulting order:
  communication-standards=7, vc-autoresearch-spec=8, autopilot=9 (already correct).
  **Also update the secondary mention at
  `process/development-protocols/all-development-protocols.md:51`** — change
  `` `vc-autoresearch-spec.md` (optional deep reference; `read_order: 7`, `required: false`) ``
  to `` `vc-autoresearch-spec.md` (optional deep reference; `read_order: 8`, `required: false`) ``
  in the same pass, so this fix doesn't reintroduce the drift it's closing. (Added at
  VALIDATE — see VALIDATE addendum in Touchpoints.)

- [ ] **D2** — `process/development-protocols/orchestration.md` §VALIDATE Gate §Skip
  conditions (~L602–612): restructure the "skipped when **ALL** of the following are
  true" numbered list (which currently mixes a brand-new-trivial-change path, items 1–3,
  with an existing-PASS-contract path, item 4, that cannot co-exist with the others) into
  **two alternative branches**:
  - **Branch (a) — new trivial change**: single-file edit under 15 lines, no schema/
    auth/API/billing surface; no new dependencies/agents/runtime surfaces; user
    explicitly skips with a stated reason.
  - **Branch (b) — existing PASS contract**: plan already has `## Validate Contract`
    with `Gate: PASS`; ask user to re-validate or proceed; under /goal, auto-proceed
    per the `## Inner Loop Refresh Note` date check (preserve the `V1 AUTO-PROCEED`
    relay-verbatim requirement exactly as currently written).
  - Preserve verbatim: the skip-reason documentation requirement (currently ~L611–612)
    and the full `V1 AUTO-PROCEED: ...` relay-in-main-thread note. Reword surrounding
    prose only — every signal string stays byte-identical. Scope this edit to
    `orchestration.md` only — do not touch any other file's copy of this rule.

- [ ] **D3** — `process/development-protocols/vc-system-behavior/04-research.md` L27:
  add `sort` to the Bash command whitelist (it is used by the required session-start
  commands at ~L52/53/60/65 — `find ... | sort`).

- [ ] **D4** — `process/development-protocols/vc-system-behavior/08-validate.md`
  L123–127 and `09-execute.md` L226: replace stale `pnpm` commands with the real `bun`
  equivalents, keeping the pre-V1 baseline gate itself intact (doc-only, no gate
  removed):
  - `pnpm typecheck` → `bun run check`
  - `pnpm test:local` → the scoped `bun test` invocation (use the exact script name(s)
    from `process/context/tests/all-tests.md` as the source of truth — do not invent a
    script name). **Confirmed at VALIDATE**: `all-tests.md` names `bun test` (root,
    `bun run --filter './apps/*' --filter '@veent/core' test`) as the real command — use
    that exact string, not `test:local`.
  - Apply to both the L125 gate line and the L127 "necessary but not sufficient" note in
    `08-validate.md`, and the stray `pnpm test:local` reference at `09-execute.md:226`.

### Group E — markdown fence language, MD040 (6)

- [ ] **E1** — `process/features/admin-staff-governance/_GUIDE.md` L55: add ` ```text `
  to the opening fence.
- [ ] **E2** — `process/general-plans/active/_GUIDE.md` L9: add ` ```text ` to the
  opening fence.
- [ ] **E3** — `process/_seeds/general-plans/active/_GUIDE.md` L9: add ` ```text ` to
  the opening fence.
- [ ] **E4** — `process/context/all-context.md` L41 **and** L176 (both repository
  structure trees): add ` ```text ` to each opening fence.
- [ ] **E5** — `process/development-protocols/vc-autoresearch-spec.md`: add a language
  to 4 opening fences — `text` (ASCII loop diagram + termination list), `markdown`
  (gap-entry format block), `tsv` (TSV log format block). Confirm exact count/locations
  by grepping the file for bare ` ``` ` at EXECUTE time (draft counted 4; re-verify).
  **Confirmed at VALIDATE**: exactly 4 opening bare fences at L38 (text — loop diagram),
  L156 (text — termination-priority list), L268 (markdown — gap entry format), L289
  (tsv — TSV log format); closing fences at L63, L164, L275, L296 stay bare. (A 5th bare
  fence at L255 is a closing fence only — its opener elsewhere is already tagged; leave
  it alone.)
- [ ] **E6** — `process/development-protocols/vc-system-behavior/05-spec.md`: add
  ` ```text ` to 3 unlabeled opening fences at L31, L43, L124.
  Rule for all of Group E: only OPENING fences get a language tag; closing fences (bare
  ` ``` `) are left unchanged.

## Acceptance Criteria

- [ ] All 19 checklist items (A1-A4, B1, C1-C4, D1-D4, E1-E6) applied exactly as scoped — no scope creep into the 5 skipped findings (#3, #7, #8/10, #19).
- [ ] `bun test src/lib/server/formValidation.test.ts` and `bun test src/lib/server/issues.test.ts` pass (apps/admin).
- [ ] Root `bun run check` passes with zero new typecheck errors.
- [ ] `validate-context-discovery.mjs` and `validate-protocol-wiring.mjs` pass with zero new failures.
- [ ] Manual A3/A4 checks confirm no regression in notification-list isolation or e2e browser cleanup.
- [ ] No stale "46 migrations" / "0000-0045" / "3/10 IMS e2e specs" strings remain in `process/context/`.
- [ ] Every verbatim signal string in D2/D4 (`Gate: PASS`, `V1 AUTO-PROCEED`, etc.) is byte-identical to before the edit.
- [ ] `process/development-protocols/all-development-protocols.md:51` no longer says `read_order: 7` for `vc-autoresearch-spec.md` (added at VALIDATE).

## Phase Completion Rules

This is a SIMPLE single-pass plan (no phase split). It is considered complete when:
1. All 19 checklist items are checked off.
2. All Verification Evidence gates below are green (or explicitly accepted as CONDITIONAL known-gaps for the 2 Agent-Probe / 1 Hybrid rows).
3. `git diff` scoped to exactly the 19 touched files listed in Touchpoints — no unrelated file changes.
4. Acceptance Criteria above are all checked.

## Verification Evidence

| Gate / Scenario | Strategy | Proves SPEC criterion |
|---|---|---|
| `cd apps/admin && bun test src/lib/server/formValidation.test.ts` | Fully-Automated | A1: `2026-02-31` rejected, valid dates still parse |
| `cd apps/admin && bun test src/lib/server/issues.test.ts` | Fully-Automated | A2: `setIssueStatus` outcomes unchanged for single-caller path |
| Root `bun run check` | Fully-Automated | A1/A2/A3/A4 typecheck clean across all 3 apps + packages |
| `node .claude/skills/vc-audit-context/scripts/validate-context-discovery.mjs` | Fully-Automated | C1–C4, D1 frontmatter/routing stay valid (D1 read_order de-dupe specifically) |
| `node .claude/skills/vc-audit-vc/scripts/validate-protocol-wiring.mjs` | Fully-Automated | D2/D3/D4 protocol doc edits keep wiring/discovery intact |
| Manual: on an `(app)` page with `/issues*` route, force a `listNotifications` throw → page still renders, bell shows empty list | Agent-Probe | A3: notification-list isolation degrades gracefully; `role`/`unreadCount` still propagate |
| Manual: run non-manager e2e login helper against a forced-failure auth step, confirm no orphaned browser process | Agent-Probe | A4: browser closed on login failure |
| `grep -rn "46 migrations\|0000–0045\|3/10 IMS" process/context/` returns no matches post-edit | Fully-Automated | C1/C2/C3 stale counts fully replaced |
| Re-run `git diff .gitignore` shows only the L55 glob change (and optional L49 removal) | Fully-Automated | B1 scoped correctly |
| markdownlint / MD040 check on the 6 files in Group E (if a lint script exists in this repo — otherwise visual diff review) | Hybrid | E1–E6 fence language added, closing fences untouched |
| `grep -n "read_order: 7" process/development-protocols/all-development-protocols.md` returns no matches post-edit | Fully-Automated | D1 secondary reference updated (VALIDATE addendum) |

## Test Infra Improvement Notes

(none identified yet). **Confirmed at VALIDATE**: no `markdownlint` config or script
exists in this repo (`package.json` `lint` = `prettier --check . && eslint .` only) — the
Group E Hybrid gate correctly falls back to visual diff review; this is not a gap, the
plan already accounts for it.

## Validate Contract

Status: PASS
Date: 10-07-26
date: 2026-07-10
generated-by: outer-pvl

Parallel strategy: sequential
Rationale: 7-signal score 1/7 (only S7 — 5+ files in blast radius — present; no
multi-package, no schema/auth/billing surface, not a phase program, no 3+ divergent
directions to fan out over). LOW tier → sequential single-pass VALIDATE is correct; no
parallel subagent fan-out warranted. Layer 1 + Layer 2 checks below were run as one
sequential deep-mode pass (direct source reads of every touched file/line) rather than
spawned in parallel, per the threshold table's "do not mention fan-out" rule for LOW scores.

Test gates (C3 5-column table):

| criterion id | behavior | strategy | proving test | gap-resolution |
|---|---|---|---|---|
| A1 | `parseDueDate` rejects impossible calendar dates (`2026-02-31`), still accepts valid `yyyy-mm-dd` | Fully-Automated | `cd apps/admin && bun test src/lib/server/formValidation.test.ts` (new case added by this plan) | B |
| A2 | `setIssueStatus` outcomes byte-identical for the single-caller path after adding `.for('update')` | Fully-Automated | `cd apps/admin && bun test src/lib/server/issues.test.ts` (pre-existing suite as regression proof) | A |
| A3 | `listNotifications` failure isolated (page still renders, bell empty); `role`/`unreadCount` failures still propagate | Agent-Probe | Manual: force a `listNotifications` throw on an `/issues*` page, confirm page renders and other two promises still fail loudly | B |
| A4 | `loginNonManager` closes the browser on an auth-step failure, no orphaned process | Agent-Probe | Manual: force the auth sequence to fail, confirm `browser.close()` ran and no leaked Chromium process | B |
| B1 | `.gitignore` L55 glob widened to match files + dirs | Fully-Automated | `git diff .gitignore` shows only the L55 change (+ optional L49 removal) | A |
| C1-C4 | Migration count / spec-name doc strings match live repo state (47 migrations, `0000`-`0046`, 10 admin specs / 4 IMS) | Fully-Automated | `grep -rn "46 migrations\|0000–0045\|3/10 IMS" process/context/` → no matches | B |
| D1-D4 | Protocol-doc frontmatter/skip-conditions/whitelist/command references match live behavior and each other (incl. the VALIDATE-added secondary D1 reference) | Fully-Automated | `node .claude/skills/vc-audit-context/scripts/validate-context-discovery.mjs`; `node .claude/skills/vc-audit-vc/scripts/validate-protocol-wiring.mjs`; `grep -n "read_order: 7" process/development-protocols/all-development-protocols.md` → no matches | B |
| E1-E6 | All 14 confirmed opening bare fences (E1=1, E2=1, E3=1, E4=2, E5=4, E6=3) get a language tag; closing fences stay bare | Hybrid | Visual diff review of the 6 files (no markdownlint script exists in this repo — confirmed at VALIDATE) | A |
| All 19 items | Root typecheck stays clean after all edits | Fully-Automated | `bun run check` (root) | A |

gap-resolution legend:
- A — proven now (gate passes in this cycle, using a pre-existing or currently-runnable check)
- B — fixed in this plan (gate/edit is added by this plan's own checklist, will exist post-EXECUTE)
- C — deferred to a named later phase/plan
- D — backlog test-building stub (named residual; keep-active; continue)

Legacy line form (retained so existing validate-contract consumers still parse):
- apps/admin (A1-A4): Fully-automated: `bun test src/lib/server/{formValidation,issues}.test.ts` | Agent-probe: manual A3 error-isolation check + A4 browser-cleanup check
- .gitignore (B1): Fully-automated: `git diff .gitignore` inspection
- process/context/** (C1-C4): Fully-automated: `grep -rn "46 migrations|0000–0045|3/10 IMS" process/context/`
- process/development-protocols/** (D1-D4): Fully-automated: `validate-context-discovery.mjs` + `validate-protocol-wiring.mjs` + `grep -n "read_order: 7" all-development-protocols.md`
- markdown fences (E1-E6): Hybrid: visual diff review (no markdownlint script exists in this repo)

Dimension findings:
- Infra fit: PASS — no container/worker/proxy/runtime surface touched; all 19 edit-target file paths and line numbers confirmed to exist and match the plan's before-state description via direct source read.
- Test coverage: PASS — every developed behavior (A1-A4) has at least one Fully-Automated or Agent-Probe gate; none rest on Known-Gap alone (net-gate vacuous-green ban satisfied). A1/A2 are Fully-Automated via real, confirmed `bun test` commands; A3/A4 are legitimate Agent-Probe (no load-function/e2e-helper unit-test pattern exists in this repo per `all-tests.md`); Group E's Hybrid gate correctly degrades to visual diff since no markdownlint script exists (confirmed).
- Breaking changes: PASS — A1 narrows (bug fix, no caller relies on malformed-date acceptance; confirmed live that `2026-02-31` currently silently normalizes to `2026-03-03`, so this is a real bug). A2 no signature/shape change. A3 no return-shape change (matches the existing non-`/issues` branch's `Promise.resolve([])` pattern). A4 no signature/success-path change. B1 widens `.gitignore` (no runtime impact). C/D/E are docs-only.
- Security surface: PASS — no auth/identity/billing/secrets/trust-boundary surface touched. A2's `.for('update')` is a defensive concurrency fix (closes a race), matches an existing repo idiom (`rateLimit.ts:77`) exactly. A1 tightens input validation (reduces attack surface). A3's error isolation is scoped to one specific promise; `role`/`unreadCount` (the auth-relevant reads) are explicitly untouched and still propagate failures.
- Section A (code fixes): PASS — mechanical feasibility confirmed via direct read of all 4 target files/lines; no gaps found; highest-risk edit is A2 (row lock) — mitigated by matching the existing single-call-site idiom and requiring the existing `issues.test.ts` suite stay green.
- Section B (.gitignore): PASS — trivial, confirmed current state (`L49` no-slash, `L55` dir-only-slash) matches the plan's described before-state exactly.
- Section C (context docs): PASS — all 4 target lines confirmed exact match; migration count re-verified live (47, no drift).
- Section D (protocol docs): PASS after plan update — mechanical feasibility confirmed for D1-D4 (all line numbers, whitelist gap, and pnpm references verified live); one CONCERN found (D1 leaves a stale secondary `read_order: 7` mention at `all-development-protocols.md:51`) — resolved via Plan Update P1 (added a second edit to the D1 checklist item + a new Touchpoints row + a new Verification Evidence row) rather than left open, so the net gate is not held back by it.
- Section E (markdown fences): PASS — all bare-fence line numbers and open/close pairing confirmed exactly for all 6 files, including the 4-count and 3-count claims in E5/E6 (verified against real `grep -n '^```$'` output and context reads).

Open gaps: none — the one CONCERN found (D1 secondary reference) was resolved in-plan (see Plan Update P1 below), not deferred.

What this coverage does NOT prove:
- `bun test formValidation.test.ts` / `issues.test.ts` prove the specific asserted cases only — they do not prove absence of *other* undiscovered date-parsing or status-transition edge cases outside what the plan's new test case and existing suite already assert.
- `bun run check` proves TypeScript type-soundness only — it does not prove runtime behavior of A1-A4 beyond what the two `bun test` gates above assert, and does not exercise the doc-only changes at all.
- `validate-context-discovery.mjs` / `validate-protocol-wiring.mjs` prove frontmatter/routing/wiring structure stays valid — they do not prove the *prose content* of C1-C4/D1-D4 is accurate; that accuracy was confirmed manually during this VALIDATE pass via direct line-level reads, not by an automated content-diff gate.
- The `grep -rn "46 migrations|..."` stale-string checks prove those specific 3 strings are gone — they do not prove no *other* stale count/reference exists anywhere in `process/`; scope is deliberately limited to `process/context/` per the plan's own Acceptance Criteria.
- The Agent-Probe rows (A3, A4) prove the specific manual scenario described was judged correct by the person/agent running it at EXECUTE/EVL time — they do not constitute a repeatable, CI-enforceable regression gate; a future regression in this area would not be caught automatically.
- The Hybrid visual-diff row (E1-E6) proves a human/agent visually confirmed the fence tags at EXECUTE time — it does not constitute an automated markdownlint gate (none exists in this repo), so a future re-introduction of an untagged fence in these files would not be caught automatically.

Gate: PASS (no FAILs, plan updated to resolve the 1 CONCERN found)

### Proposed Plan Updates (P1 — applied)

| # | What changes | Where in plan | Why |
|---|---|---|---|
| P1 | Added a second edit to D1 (update `all-development-protocols.md:51` `read_order: 7` → `8`); added a new Touchpoints row for that file; added a new Verification Evidence + Test Gates row (`grep -n "read_order: 7" all-development-protocols.md` → no matches); bumped file/edit counts (18→19 files, 19→20 discrete edits) | Touchpoints, Blast Radius, Group D checklist (D1), Acceptance Criteria, Verification Evidence | Layer 2 review of D1 found that fixing `vc-autoresearch-spec.md`'s `read_order` in isolation leaves a stale duplicate mention in the protocol router file, reintroducing the exact class of doc-drift this plan exists to close. Applied directly rather than left as an open CONCERN since the fix is a one-line addition fully within D1's existing scope. |

No Execute-Agent Instructions or Backlog Artifacts were needed — the single finding was resolved as a Plan Update.

## Autonomous Goal Block

SESSION GOAL: Close 19 verified code-review findings (4 apps/admin code fixes + 15 doc/config accuracy fixes) with zero scope creep into the 5 explicitly-invalid findings.
Charter + umbrella plan: N/A — single plan (no phase program, no umbrella plan exists on disk for this work).
Autonomy: standard RIPER-5 autonomy rules — VALIDATE gate is PASS, EXECUTE requires explicit "ENTER EXECUTE MODE"; no standing /goal has been declared for this session.
Hard stop conditions / safety constraints:
- Do not touch findings #3, #7, #8/10, #19 (verified invalid/already-addressed) — any edit to those areas is out of scope.
- A1's strict-parse guard must still accept every valid `yyyy-mm-dd` date; only impossible calendar dates get newly rejected.
- A2's `.for('update')` addition must not change single-caller output — `issues.test.ts` must stay green as the regression proof.
- A3's `.catch(() => [])` must be scoped to `listNotifications` only — `role` and `unreadCount` must keep propagating failures.
- Every verbatim signal string touched by D2/D4 (`Gate: PASS`, `V1 AUTO-PROCEED: ...`, etc.) must be byte-identical after the edit — reword only the surrounding prose.
- `git diff` at completion must be scoped to exactly the 19 Touchpoints files — no unrelated changes.
Next phase: EXECUTE — `process/general-plans/active/review-findings-remediation_10-07-26/review-findings-remediation_PLAN_10-07-26.md`
Validate contract: inline in plan (see `## Validate Contract` section above)
Execute start: Fully-automated commands: `cd apps/admin && bun test src/lib/server/formValidation.test.ts`, `cd apps/admin && bun test src/lib/server/issues.test.ts`, root `bun run check`, `node .claude/skills/vc-audit-context/scripts/validate-context-discovery.mjs`, `node .claude/skills/vc-audit-vc/scripts/validate-protocol-wiring.mjs` | Agent-probe: A3 notification-isolation check, A4 browser-cleanup check, Group E visual fence-diff review | high-risk pack: no (no high-risk class present)

## Resume and Execution Handoff

1. **Selected plan file path**: `process/general-plans/active/review-findings-remediation_10-07-26/review-findings-remediation_PLAN_10-07-26.md`
2. **Last completed phase or step**: VALIDATE — full V1-V7 sequence run 10-07-26, Gate: PASS
   (1 CONCERN found and resolved in-plan; see Proposed Plan Updates P1). RESEARCH was
   completed upstream (draft at `~/.claude/plans/resilient-imagining-teapot.md`, fully
   verified at line level; VALIDATE independently re-verified every touched file/line
   directly against live source).
3. **Validate-contract status**: written, Gate: PASS (see `## Validate Contract` section
   above).
4. **Supporting context files loaded**: `process/context/all-context.md`,
   `process/context/database/all-database.md` (routing target for C2),
   `process/context/tests/all-tests.md` (routing target for C3 and D4's script-name
   source of truth).
5. **Next step for a fresh agent picking up mid-execution**: run `ENTER EXECUTE MODE` on
   this plan file. All 20 discrete edits (19 findings, D1 now spans 2 files) are ready to
   implement in checklist order; run the Verification Evidence gates as each group
   completes.
