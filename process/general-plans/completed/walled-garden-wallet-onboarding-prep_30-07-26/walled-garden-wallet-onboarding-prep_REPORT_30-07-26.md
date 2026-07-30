---
phase: walled-garden-wallet-onboarding-prep
date: 2026-07-30
status: COMPLETE
feature: N/A (general-plans)
plan: process/general-plans/active/walled-garden-wallet-onboarding-prep_30-07-26/walled-garden-wallet-onboarding-prep_PLAN_30-07-26.md
---

### What Was Done
- `apps/admin/scripts/walled-garden-config.ts`: `PAYMENT_HOSTS` regrouped into 3 labeled blocks
  (Maya/PayMaya, GCash+Alipay+Mynt/G-Xchange, Google APIs) and trimmed by exactly 6 hosts:
  `pay.google.com`, `payments.google.com`, `accounts.google.com`, `accounts.google.com.ph`
  (Google Pay — abandoned, WebView `OR_BIBED_15` blocks it captive) + `*.paymongo.com` +
  `*.xendit.co` (dead — no integration code, grep-confirmed only config/seed comment references).
  `*.googleapis.com` retained (98-hit checkout dependency). GCash comment corrected ("Maya/PayMongo
  redirect" → "Maya's hosted checkout redirects").
- `docs/mikrotik/walled-garden.md`: added "How to add a wallet/bank (₱0 recon protocol)" section
  (dns-cache-flush → drive flow on captive device → cache-print → classify direct-resolve vs
  CNAME-to-CDN → add → retest; two hard rules: `*.domain` ≠ bare parent, no broad CDN allows;
  "domain open ≠ app works" caveat) + "Google Pay — KNOWN-DEAD" note + "Candidate wallets/banks
  (UNVERIFIED — recon required)" table (GoTyme, SeaBank, GrabPay, ShopeePay, Coins.ph, BDO, BPI,
  Landbank, Security Bank — all UNVERIFIED, banks flagged with a cert-pin/captive-detect caveat).
  No candidate host added to `PAYMENT_HOSTS`.

### What Was Skipped/Deferred
- No candidate wallet/bank was live-verified or whitelisted this session (deliberately out of
  scope — this is a prep/documentation task only).
- None of the 9 candidates in the new table have gone through the recon protocol yet — this is
  future work, tracked only as the table itself (not a backlog NOTE; the doc table IS the tracker).

### Test Gate Outcomes
| Gate | Command | Result |
|---|---|---|
| Collision guard | `bunx vitest run apps/admin/scripts/setup-router.spec.ts` | PASS (1/1, re-run independently in UPDATE PROCESS) |
| TS check | `bun run --filter radius-admin check` | PASS (0 errors, 0 warnings, 2316 files) |
| Deliberate-removal diff | grep for the 6 removed hosts (excluding comments) + googleapis retained | PASS — 0 matches for removed hosts, googleapis present (2 refs: array + comment) |

### Plan Deviations
None. Diff matches the plan's Execute-agent instructions (E1–E5) exactly.

### Test Infra Gaps Found
None.

### SPEC Achievement
No `*_SPEC_*.md` exists for this plan (SIMPLE plan, no SPEC phase — trivial/mechanical scope per
CLAUDE.md RIPER-5 Phase Table skip condition). Verification Evidence table in the plan (4 rows) is
the closest analog; all 4 rows are met:
1. Collision guard green — met (Fully-Automated, re-confirmed).
2. Sorted host set = HEAD minus exactly 6 — met (Fully-Automated, re-confirmed via grep).
3. TS check clean — met (Fully-Automated, re-confirmed).
4. Doc sections render with recon steps + candidate table + out-of-scope note — met (Agent-Probe,
   confirmed by reading `git diff --cached docs/mikrotik/walled-garden.md`).

### Closeout Packet
1. Selected plan path: `process/general-plans/active/walled-garden-wallet-onboarding-prep_30-07-26/walled-garden-wallet-onboarding-prep_PLAN_30-07-26.md`
2. Closeout classification: **Ready for UPDATE PROCESS archival**
3. What was finished: see "What Was Done" above.
4. Verified: all 3 gates independently re-run green in this UPDATE PROCESS session (not just
   trusted from FAST MODE's own report) | Unverified: none — doc section content confirmed by
   direct diff read (Agent-Probe tier, as declared in the plan).
4b. Validate-contract: present, inline in plan, `Gate: PASS`, `generated-by: outer-pvl`, dated
   2026-07-30.
5. Cleanup done: this report written, plan will be archived, context + memory updates follow in
   this same UPDATE PROCESS pass | Still needed: none.
6. Next valid state: archive to `process/general-plans/completed/`, then user makes the SEPARATE
   code commit (staged files untouched by this agent) followed by the process commit.
7. Commit checkpoint: **Process commit belongs after UPDATE PROCESS** — the 2 staged code files
   are the user's pending commit (per this session's explicit instruction not to commit); this
   agent's own changes (report, archived plan, context/memory docs) form a second, separate
   `process(...)` commit for the user to make afterward.
8. Regression status: N/A — not a phase program.
9. SPEC achievement: see "SPEC Achievement" above (no SPEC file; plan's own Verification Evidence
   table used as the equivalent, all 4 rows met).

Drift score signals: (a) 2 files touched in EXECUTE (+1), (b2) 1 doc under
`process/development-protocols/`-adjacent scope not touched (0), (d) new task folder created (+1,
this plan's own folder), (e) no validate-contract deviation (0). Total: **LOW-MEDIUM (2 signals)**.
Recommend UPDATE PROCESS -- significant changes detected.

### Forward Preview

#### Test Infra Found
None new.

#### Blast Radius Changes
None vs plan — exactly the 2 declared files (`walled-garden-config.ts`, `walled-garden.md`).

#### Commands to Stay Green
- `bunx vitest run apps/admin/scripts/setup-router.spec.ts`
- `bun run --filter radius-admin check`

#### Dependency Changes
None.
