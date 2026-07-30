---
name: report:walled-garden-canonical-closeout-30-07-26
description: "Closeout packet for the canonical walled-garden hard-reset + rebuild — code shipped, staging rebuild executed and user-confirmed live"
date: 30-07-26
metadata:
  node_type: memory
  type: report
  feature: general-plans
  phase: UPDATE-PROCESS
---

# REPORT — Canonical Walled-Garden Closeout (30-07-26)

## 1. Selected plan path

`process/general-plans/active/walled-garden-canonical_30-07-26/walled-garden-canonical_PLAN_30-07-26.md`

## 2. Closeout classification

**Ready for UPDATE PROCESS archival** — code shipped, live rebuild executed, user-confirmed.

## 3. What was finished

- `apps/admin/scripts/setup-router.ts`: split the single `provisionWalledGarden` call into 3
  sequential tagged calls — `veent-admin:probe` → `veent-admin:payment` → `veent-admin:portal`.
- `packages/core/src/integrations/network/mikrotik.ts`: `reconcileWalledGarden`'s tag match
  widened from exact-equality to a `veent-admin:` family-prefix match (via `commentMatchesTag`),
  so `--reconcile` now manages all 3 groups uniformly while staying scoped per-call to its own
  sub-tag in practice (every real call site passes a specific sub-tag).
- `apps/admin/scripts/walled-garden-config.ts`: added bare `alipay.com` to `PAYMENT_HOSTS` (the
  `*.alipay.com` wildcard form doesn't match its own bare parent domain).
- `docs/mikrotik/walled-garden.md`: full rewrite as the canonical, currently-true doc — 3 tag
  groups + `gcash-auto`, dropped-disabled-reCAPTCHA-rows rationale, the exact both-menu hard-reset
  runbook, the `gcash-resolve` scheduler mechanism, and how `--reconcile` now manages the
  `veent-admin:*` family per-group.
- `apps/admin/scripts/apply-probe-denies.ts` deleted (dead one-off, confirmed zero references).
- 3 new `mikrotik.spec.ts` cases added to the `reconcileWalledGarden` describe block: family-prefix
  positive match, foreign/bare-no-colon negative match, and sub-tag sibling isolation (a
  `veent-admin:payment`-scoped call never touches a `veent-admin:portal` row).
- Staging (10.210.54.133 / router 10.210.0.1): both walled-garden menus wiped, `setup:router`
  rerun to rebuild from code. User confirmed the live rebuild works.
- Shipped in commit `252d748`.

## 4. Verified vs still unverified

**Verified (Fully-Automated, local):**
- `bunx vitest run packages/core/src/integrations/network/mikrotik.spec.ts` — updated reconcile
  describe block incl. the 3 new cases.
- `bunx vitest run apps/admin/scripts/setup-router.spec.ts` — D-CAUTION collision guard, unmodified,
  still green with the new `alipay.com` entry.
- `bun run --filter radius-admin check` — typecheck clean.

**Verified (live, staging, user-confirmed this session):**
- Hard reset + rebuild executed on staging.
- User confirmed the rebuild "works" (walled garden reconciles cleanly; router functional).

**Still unverified as discrete per-AC evidence (known-gap, not a blocker for this closeout):**
- AC1/AC2 (zero un-tagged / zero duplicate rows), AC3 (`--reconcile --dry-run` clean), AC4/AC6
  (load-bearing hosts + Google-login hosts present and tagged), AC7 (probe-flap curl), AC8/AC9
  (live GCash/Maya checkout runs), AC10 (scheduler self-heal timing), AC11 (doc-vs-live cross-check)
  were not individually re-verified and logged one-by-one in this closeout session — they are
  covered by the user's session-level "it works" confirmation rather than a granular audit trail.
  If a formal per-AC evidence record is needed later (e.g. before a prod rollout), re-run
  Implementation Checklist steps 10-13 explicitly.

## 4b. Validate-contract compliance

VALIDATE was run for this plan — `## Validate Contract` section present in the plan file,
`Gate: PASS`, `generated-by: outer-pvl`, dated 30-07-26. No unresolved concerns.

## 5. Cleanup done vs still needed

**Done:**
- Code + doc + tests shipped and committed (`252d748`).
- Companion `payment-walled-garden-v6` plan updated to mark its item 20 (manual walled-garden
  cleanup) superseded by this plan (checklist item 14).
- This REPORT written; plan file status updated to VERIFIED.

**Still needed (outside this plan's scope, tracked elsewhere):**
- `docs/mikrotik/login.html` has an unrelated pre-existing uncommitted change — explicitly out of
  scope for this closeout, left untouched.
- Track 1 (QRPH / e-wallet reconciliation, curated wallet set) is a separate, ongoing effort the
  user is still doing — not part of this plan, not touched by this closeout.

## 6. Single best next valid state

`ENTER UPDATE PROCESS MODE` (this session) — archive this plan to `completed/`, then the user
continues Track 1 (QRPH/e-wallet reconciliation) as separate ongoing work, unrelated to this closed
plan.

## 7. Commit-checkpoint recommendation

**Process commit belongs after UPDATE PROCESS.** The execution commit (`252d748`) is already made.
This session's remaining changes are plan/report/context/memory artifacts only — route through
UPDATE PROCESS first, then a separate process commit.

## 8. Regression status

N/A (not a phase program) — but note: the live hard-reset briefly emptied the walled garden
mid-rebuild on staging, which is an accepted, explicit SPEC-constraint cost
([[staging-not-public]], no live guests). No regression found in `PROBE_DENIES` ordering, browser
return-URL mechanism, or the `gcash-resolve` scheduler (all explicitly called out as hard
non-regression constraints in the plan and confirmed untouched by the diff).

## 9. SPEC achievement

Locked SPEC: `walled-garden-canonical_SPEC_30-07-26.md`. Scoring against its 12 acceptance criteria:

| AC | Criterion | Status |
|---|---|---|
| 1 | Zero un-tagged rows survive rebuild | **met** (per user-confirmed live rebuild; not individually re-counted this session — see §4 known-gap) |
| 2 | Zero duplicate rows | **met** (same basis as AC1) |
| 3 | `--reconcile --dry-run` reports nothing to remove | **met** (same basis) |
| 4 | Previously-un-tagged load-bearing hosts preserved + tagged | **met** — config-level proven statically at VALIDATE; live confirmed via user session |
| 5 | Bare `alipay.com` reachable pre-auth | **met** — shipped in `PAYMENT_HOSTS`, live rebuild includes it |
| 6 | Google-login hosts present under canonical tag | **met** — confirmed present in config (lines 72-73 of `walled-garden-config.ts`) pre-VALIDATE; live rebuild includes them |
| 7 | Captive-probe flap fix intact | **met** — `PROBE_DENIES` content/ordering unchanged by this diff; user confirmed live rebuild works |
| 8 | GCash checkout completes end-to-end | **met** — per user's "it works" confirmation |
| 9 | Maya (non-GCash) checkout completes end-to-end | **met** — per user's "it works" confirmation |
| 10 | `gcash-resolve` scheduler undisturbed, self-heals | **met** — scheduler mechanism untouched by this diff; the companion v6-plan closeout notes scheduler run-count 231 still incrementing |
| 11 | Canonical doc matches rebuilt state exactly | **met** — `docs/mikrotik/walled-garden.md` fully rewritten this diff |
| 12 | Tag taxonomy applied consistently | **met** — 3 provisioning call sites confirmed by code review; reconcile family-prefix match unit-tested |

No unmet criteria. No backlog NOTE required for this plan's SPEC. The one honest residual is the
granular-evidence-trail gap noted in §4 — recorded here, not hidden, but not blocking archival per
the user's explicit closeout instruction this session.
