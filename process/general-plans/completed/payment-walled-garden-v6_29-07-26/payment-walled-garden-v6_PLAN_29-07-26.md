---
name: plan:payment-walled-garden-v6
description: "RouterOS v6 diagnostic-first walled-garden fix — Stage A codifies live-proven PAYMENT_HOSTS + collision guard (always-ship), Stage B captures a live GCash/GPay checkout to prove whether a whole-network DoH/DoT block is even needed, Stage C ships provisionDnsEnforcement() ONLY if Stage B proves gcash.com is contacted and DoH-hidden; retires the rotating 23.7.208.188 IP allow when justified"
date: 29-07-26
feature: general-plans
---

# Payment Walled-Garden Fix (RouterOS v6) — PLAN

Date: 29-07-26
Status: ✅ VERIFIED — items 18/19/22 shipped + live-verified (`bde53d2`), item 20 SUPERSEDED by
`walled-garden-canonical` (`252d748`), item 21 live-exercised during that plan's rebuild
verification. See §Closeout (30-07-26) near the end of this file.
Complexity: COMPLEX

## Live Diagnostic Findings 29-07-26 (Stage B run — SUPERSEDES the Stage C DoH premise)

Full session report: `payment-walled-garden-v6_REPORT_29-07-26.md` (same folder). Stage B's live
capture ran this session and found a **different root cause than the plan designed for**. Summary
(see the report for full detail):

- **GCash root cause is CNAME-to-Akamai, not DoH-hiding.** `payments.gcash.com` CNAMEs to an
  Akamai edge (`e9816.cj.akamaiedge.net`) — v6 `dst-host` walled-garden matching cannot follow a
  CNAME chain to `*.gcash.com`, so the rule never matches regardless of plain vs. encrypted DNS.
  **The Stage C DoT/DoH block would not have fixed this.** `mdap.paas.mynt.xyz` is the same class.
  **Live fix (working, user-confirmed):** a `/system scheduler` script (`gcash-resolve`, 5-min
  interval) that `:resolve`s the hostname and upserts a `walled-garden ip` row — see §Stage C
  Replacement Design below, which REPLACES the DoT/DoH design as Stage C's build target.
- **Android captive-icon investigation: non-issue, closed.** `*.googleapis.com` was never
  implicated; the earlier floated "D-GAPI overturn" (drop `*.googleapis.com`) is **cancelled** —
  D-GAPI's original KEEP decision stands unchanged.
- **Google Pay: reachability fixed live, hard-blocked by Google policy (`OR_BIBED_15`).** Missing
  bare `accounts.google.com` (the `*.` wildcard doesn't cover its own bare parent) and
  `accounts.google.com.ph` (SetSID PH-ccTLD bounce) were added and fixed login/SetSID. All Google
  hosts touched resolve DIRECTLY to Google IPs (no CNAME-to-CDN, unlike GCash) — so Google only
  ever needed host rules, no resolve-script. But Google Pay itself refuses to run inside the
  captive-portal's Android WebView (`OR_BIBED_15`) — this is unfixable by any network/DNS change.
  **AC3 (Google Pay checkout completes while captive) is re-scoped OUT of captive scope** — see
  §Re-Scoped Acceptance Criteria below.
- **Walled-garden cleanup debt confirmed live** (48 rows: duplicates, redundant pairs, 5 dead
  GCash hostname rules, and — the important one — manual `*keyword*` rules SHADOWING the Stage A
  codified `*.domain` rules because they sit above them in match order). Added as an explicit
  checklist task; see §Stage A Follow-Up Checklist Additions below.

**Net effect on this plan's structure:** Stage C's `provisionDnsEnforcement()` (DoT/DoH block)
design is DEAD — do not build it; the diagnosis it was gated on (Q2: DoH-hidden?) resolved to "no,
the real problem is CNAME" instead of yes/no as designed. Stage C is REPLACED by codifying the
`gcash-resolve` scheduler pattern + the two Google host additions into the codebase, per
§Stage C Replacement Design below. The plan stays ACTIVE — this is not yet EXECUTEd into code
(the fixes exist only as live router state right now).

## Overview

RouterOS v6 (6.49.18, CCR1036) walled-garden fix, restructured **diagnostic-first** so the
whole-network encrypted-DNS block only ships if a live capture proves it is necessary. Live router
hit-data already proves plain-DNS snooping WORKS for almost every payment host (`*alipay*`=23,
`*.googleapis.com`=98, `pay.google.com`=17); the ONLY 0-hit host family is `gcash.com`. So the
DoT/DoH drop may be UNNECESSARY — if GCash checkout flows entirely through the Alipay/mynt cashier
hosts and the browser never actually contacts `payments.gcash.com`, blocking DoH degrades every
guest's encrypted DNS for zero benefit. This plan therefore splits into three explicit stages:
**Stage A** (safe, always-ship: codify the live-proven `PAYMENT_HOSTS` as enumerated `*.domain`
forms + the collision-guard unit test + operator cleanup — no network-wide DNS change);
**Stage B** (staging diagnostic capture on Maya LIVE to answer whether the DoH block is needed);
**Stage C** (CONDITIONAL: build + ship `provisionDnsEnforcement()` ONLY if Stage B proves it).
Context router: `process/context/all-context.md`. Test routing: `process/context/tests/all-tests.md`.


> TL;DR: **Do not ship a whole-network DNS change before proving it's needed.** Stage A ships
> immediately: codify the proven-working manual walled-garden rules into `PAYMENT_HOSTS` as proper
> `*.domain` forms (Alipay set, `*.mynt.xyz`, `*.g-xchange.com`, pay/payments.google.com, KEEP
> `*.googleapis.com`), add the `PAYMENT_HOSTS ∩ PROBE_DENIES = ∅` collision-guard unit test, and hand
> the operator the manual cleanup list. Stage A carries NO DoT/DoH block and NO `provisionDnsEnforcement`
> call — purely additive host codification + tests + docs. Stage B then runs a real GCash + Google Pay
> checkout on the captive staging device (Maya LIVE, DoH block NOT yet applied) and answers three
> questions: is `gcash.com` contacted at all? does the router see the query or is it DoH/DoT-hidden?
> does checkout already complete via the cashier hosts alone? Stage C builds + ships the full
> `provisionDnsEnforcement()` (DoT/DoH drop, already designed below) ONLY if Stage B shows
> `gcash.com`-family is contacted AND DoH-hidden — otherwise the DoH block is recorded as
> designed-but-not-shipped and the `23.7.208.188` IP allow is kept/narrowed. Blast radius: Stage A ≤ 3
> files; Stage C adds ≤ 3 more IF triggered. Verified only against Maya LIVE on staging
> 10.210.54.133 — sandbox cannot reproduce this bug class.

**Complexity:** COMPLEX (Stage C introduces a new provisioning surface — first `/ip/firewall/filter`
code in the repo; high-risk network/gateway class; live-hardware-only verification; and the whole
Stage B→C branch is a live-capture-gated decision).

**SPEC:** `process/general-plans/active/payment-walled-garden-v6_29-07-26/payment-walled-garden-v6_SPEC_29-07-26.md` (locked, Path A accepted incl. whole-network DoH/DoT block — this plan sequences that block behind a diagnostic gate so it ships only if proven necessary; the SPEC acceptance is a ceiling, not a mandate to ship regardless of evidence).

---

## Goals

1. **Ship the safe, proven win immediately (Stage A):** codify `PAYMENT_HOSTS` to the live-proven set,
   converting over-broad manual `*keyword*` substring wildcards into enumerated proper `*.domain`
   forms WITHOUT dropping coverage. No whole-network DNS change.
2. **Add the first unit coverage for this area (Stage A):** a collision guard proving no global
   `PAYMENT_HOSTS` entry ever equals a `PROBE_DENIES` host (D-CAUTION), plus the constant-extraction
   refactor it needs.
3. **Prove whether the DoH/DoT block is needed before building it (Stage B):** capture a live
   GCash + Google Pay checkout and answer the three branch questions — is `gcash.com` contacted, is
   its DNS query router-visible or DoH-hidden, and does checkout already complete via cashier hosts.
4. **Only fix the root cause the diagnosis proves (Stage C, CONDITIONAL):** if and only if Stage B
   shows the `gcash.com`-family is contacted AND DoH-hidden, build + ship `provisionDnsEnforcement()`
   so the `dst-host` rules flip 0→nonzero; otherwise do NOT ship the block and avoid degrading every
   guest's encrypted DNS.
5. **Retire the non-durable rotating `23.7.208.188` GCash IP allow** when the diagnosis justifies it
   (Stage C, GCash-hostname path proven working); keep/narrow + document it otherwise.
6. Keep the operator model intact: idempotent, single manual `bun run --filter radius-admin
   setup:router`, docs mirror kept in sync, `PROBE_DENIES`/ordering/browser-return-URL untouched.

## Non-Goals (carry SPEC Out-of-Scope verbatim)

- No v7 upgrade; v6-available RouterOS primitives only.
- No scheduled `:resolve`→address-list churn script (deferred; named escalation only, built only if
  Stage C is triggered AND hostname matching alone cannot hold a full checkout).
- No decoupled-payment / CNA-handoff redesign, no 3DS/card-ACS domains, no QRPh-own-bank-app path,
  no admin UI changes.
- No auto-prune of UN-tagged (manually-added operator) walled-garden rows — that cleanup stays a
  documented manual step (D-PRUNE). **REVISED 30-07-26:** an opt-in, TAGGED-ONLY `--reconcile` prune
  IS in scope now (item 22) — it only removes rows the code itself created; the default (no-flag) run
  stays fully additive, unchanged.

---

## Locked Decisions (from INNOVATE — do not re-open)

| ID | Decision |
|---|---|
| D1 | Google/reCAPTCHA (`www.google.com`/`www.gstatic.com`/`www.recaptcha.net`) STAYS per-device in `checkoutAccess.ts` — UNCHANGED. Broad `*.google.com`/`*.gstatic.com` global allows stay OUT (they cause the captive "Connected" flap). Only add a *distinct* Google Pay host to global `PAYMENT_HOSTS` if the Stage B live capture confirms it's needed AND it does not collide with a `PROBE_DENIES` host. |
| D2 | DoH-provider-IP blocklist is an inline constant in `setup-router.ts` (same convention as `PAYMENT_HOSTS`/`PROBE_DENIES`), with a rationale comment + documented staleness note → the deferred `:resolve` script is the named escalation. **Applies only if Stage C is triggered.** |
| D3 | Firewall-filter code lives in a NEW sibling function `provisionDnsEnforcement()` in `mikrotik.ts`. Do NOT widen the zero-coverage `provisionWalledGarden()`. **Built only in Stage C.** |
| D-CAUTION | Add a unit assertion (vc-predict CAUTION guard) that no `PAYMENT_HOSTS` entry (esp. Google-family) collides with any `PROBE_DENIES` host — a collision would silently re-open a captive-probe host and reintroduce the flap. **Ships in Stage A** (independent of the DoH block). |
| D-PRUNE | **REVISED 30-07-26 (user decision, this session):** `setup:router` stays additive-by-default (no flag = byte-for-byte unchanged behavior, idempotent print-then-add, does NOT prune anything). Auto-prune of UN-tagged (operator-added manual) rows is still REJECTED — it would need to reason about which un-tagged rows are safe to delete, which is still too high a blast radius on a payments-critical router. What's now PERMITTED: an opt-in `--reconcile` flag that removes ONLY rows the script itself created (matched by the exact `provisionWalledGarden`/new-sibling-fn tag, default `veent-admin` for host rules / `gcash-auto` for the gcash-resolve IP row) AND that are absent from the current desired set. This is safe because the blast radius is self-scoped to exactly what the code owns — it can never touch an un-tagged operator row, by construction of the tag match. See §Stage A Follow-Up Checklist Additions item 22 for the implementation. Cleanup of un-tagged/shadowing manual rows (item 20) remains a documented manual operator step — `--reconcile` does not and cannot touch those. |

---

## Live Router Ground Truth (authoritative over research guesses)

Router: **RouterOS 6.49.18, CCR1036-8G-2S+**. `/ip hotspot walled-garden print` shows code-managed
rows (`;;; veent-admin`) PLUS ~12 manual un-commented rows the operator added before the script
existed. Operator confirmed these are theirs; cleanup is expected.

**The stubborn gap:** every `gcash.com`-family hostname rule shows **0 hits** (`gcash.com`,
`*.gcash.com`, `payments.gcash.com`, `*gcash*`). GCash currently works ONLY via the manual IP allow
`23.7.208.188` (`gcash-test` on the `walled-garden ip` layer — an Akamai IP that **rotates**). This
is the diagnostic target of Stage B.

**Why this is now diagnostic-first, not block-first:** the live hits prove snooping already works for
`*alipay*`=23, `*.googleapis.com`=98, `pay.google.com`=17, etc. So a whole-network DoT/DoH block is
NOT needed to restore snooping generally. Its ONLY possible job is to make the `gcash.com`-family
hostnames snoop-and-match. But it is unknown whether the browser even contacts `payments.gcash.com`
during checkout (GCash may run entirely through the Alipay/mynt cashier hosts, which already match).
**Stage B's live capture is the branch test that decides whether Stage C ships at all.**

### Manual rules to CODIFY (nonzero hits = actually matching; enumerate, do NOT substring)

| Live manual rule | Hits | Codify as |
|---|---|---|
| `*alipay*` | 23 | `*.alipay.com`, `*.alipayobjects.com`, `*.alicdn.com`, `*.antgroup.com` |
| `*.googleapis.com` | 98 | KEEP (proven needed) — see D-GAPI decision below |
| `pay.google.com` | 17 | `pay.google.com` |
| `payments.google.com` | 13 | `payments.google.com` |
| `*.mynt.xyz` | 2 | `*.mynt.xyz` (GCash/Mynt/G-Xchange infra; research flagged `mdap.paas.mynt.xyz`) |
| `g-xchange` (matched) | — | `*.g-xchange.com` |

**D-GAPI (`*.googleapis.com`, 98 hits):** proven needed by live traffic but a broad abuse surface.
Decision: **KEEP** it (dropping a rule with 98 live hits risks breaking checkout), document the
abuse residual in the docs + a code comment. Do NOT silently drop. Do NOT tighten in this pass —
tightening 98-hit traffic without a capture of exactly which `*.googleapis.com` subpaths checkout
needs is speculative and out-of-scope; note it as a follow-up backlog candidate.

### Manual rules to REMOVE (operator deletes by hand — `setup:router` will NOT prune)

`*gcash*` DUPLICATE (rules 30+31), `*g-xchange*`, `*maya.ph*`, `*paymaya*` — substring `*keyword*`
wildcards are over-broad (match `gcash.evil.com`); replaced by proper `*.domain` forms above.
`*.accounts.google.com` (0 hits) — evaluate; likely droppable.

### Disabled rules (already `X` — KEEP disabled)

`*.gstatic.com`, `*.google.com`, `*.recaptcha.net` (had 250/38 hits before being disabled). This IS
the live flap fix and validates D1 — never re-enable globally.

---

## Touchpoints

| File | Stage | Change |
|---|---|---|
| `apps/admin/scripts/setup-router.ts` | A | Reconcile `PAYMENT_HOSTS` (add codified `*.domain` hosts). Extract `PAYMENT_HOSTS`/`PROBE_DENIES` (and later `DOH_PROVIDER_IPS`) into a side-effect-free config module for testability (see §Test-file placement note). |
| `apps/admin/scripts/walled-garden-config.ts` (NEW) | A | Side-effect-free module exporting `PAYMENT_HOSTS`/`PROBE_DENIES` so the collision-guard spec can import them without running the provisioning script. |
| `apps/admin/scripts/setup-router.spec.ts` (NEW, or colocated) | A | The D-CAUTION collision guard: assert `PAYMENT_HOSTS ∩ PROBE_DENIES.host === ∅`. |
| `apps/admin/vite.config.ts` | A | Widen the `server` project's `include` glob (1-line addition: `'scripts/**/*.{test,spec}.{js,ts}'`) so the collision-guard spec is actually discovered — the current glob (`src/**/*.{test,spec}.{js,ts}`) does NOT cover `scripts/`; empirically confirmed via a throwaway probe spec during VALIDATE (`vitest run` reported "No test files found" before the fix, passed after). Without this the Fully-Automated tier claimed in Verification Evidence is false. |
| `docs/mikrotik/walled-garden.md` | A (hosts + cleanup) / C (DoH section) | Sync in each stage: Stage A adds new hosts + operator cleanup list; Stage C (if triggered) adds the DoT/DoH enforcement section + version prereq + DoH-IP staleness/escalation + IP-allow retirement step. |
| `packages/core/src/integrations/network/mikrotik.ts` | C (conditional) | ADD `provisionDnsEnforcement()` + `DnsEnforcementInput`/`DnsEnforcementResult` interfaces. First `/ip/firewall/filter` + `/ip/firewall/address-list` calls. Idempotent print-then-add, reuse `openConn`/`conn.write` shape. Do NOT touch `provisionWalledGarden()`. |
| `packages/core/src/integrations/network/index.ts` | C (conditional) | Re-export `provisionDnsEnforcement` + its types (add to the existing `from './mikrotik'` block ~line 10–29) so it surfaces at `@veent/core`. |
| `packages/core/src/integrations/network/mikrotik.spec.ts` | C (conditional) | ADD `describe('provisionDnsEnforcement')`: idempotency + rule-shape assertions. NOTE (VALIDATE correction): the file's existing `vi.mock('node-routeros')`/`fakeConn` (lines 11-71) is a single-purpose EventEmitter fake for `/ping` connection-error/concurrency testing only — there is no existing growing-in-memory-table print-then-add fixture to "extend" (`provisionWalledGarden` has zero unit coverage today, confirmed). Execute-agent builds a NEW `conn.write` fake that returns a growing table for `/ip/firewall/filter` + `/ip/firewall/address-list`, reusing only the `vi.mock('node-routeros')` module-mock convention, not a ready-made fixture. |
| `apps/admin/scripts/setup-router.ts` (DoH wiring) | C (conditional) | Add inline `DOH_PROVIDER_IPS` constant (D2). Call `provisionDnsEnforcement(config, ...)` alongside `provisionWalledGarden(...)`. Log its results. |
| `packages/core/src/services/checkoutAccess.ts` | B→conditional | ONLY IF the Stage B live capture confirms a distinct Google Pay host is needed per-device — otherwise UNTOUCHED (default). |
| `apps/admin/scripts/setup-router.ts` (reconcile wiring, item 22) | A-follow-up | NEW opt-in `--reconcile` argv flag (alongside existing `--dry-run`/`--restrict-api`). When set, AFTER the additive `provisionWalledGarden` call, calls the new sibling reconcile function to remove code-owned rows absent from the current desired set. `--reconcile --dry-run` prints without removing (reuses the existing `DRY_RUN` const). Default (no flag) run is byte-for-byte unchanged. |
| `packages/core/src/integrations/network/mikrotik.ts` (item 22) | A-follow-up | ADD a NEW sibling function (e.g. `reconcileWalledGarden` — exact name execute-agent's choice) per D3 — do NOT widen `provisionWalledGarden`. Removes ONLY rows tagged with the code's own tag (default `veent-admin`) whose host/dst-address is not in the caller-supplied desired set. Print-then-index removal (v6 has no working `find where` filter clause for this — established live 29-07-26); never touches the separate `gcash-auto`-tagged row or any un-tagged manual row. |
| `packages/core/src/integrations/network/index.ts` (item 22) | A-follow-up | Re-export the new reconcile function + its input/result types alongside the existing `provisionWalledGarden` re-exports. |
| `packages/core/src/integrations/network/mikrotik.spec.ts` (item 22) | A-follow-up | ADD `describe('reconcile<Name>')`: mocked growing-table idempotency/scoping tests — default run removes nothing; `--reconcile` removes an absent veent-tagged row; leaves un-tagged AND `gcash-auto`-tagged rows untouched; dry-run removes nothing. |
| `docs/mikrotik/walled-garden.md` (item 22) | A-follow-up | Add a short "`--reconcile` (opt-in prune)" note: what it removes, what it never touches (un-tagged manual rows, `gcash-auto` row), and that item 20's shadowing-rule cleanup still needs manual deletion. |

**Files-to-read for context (not changed):** `docs/problems/captive-connected-flap-on-free-time.md`
(the flap this must not reintroduce), `process/context/tests/all-tests.md` (runner = `packages/core`
Vitest; `bunx vitest run <file>` from inside the package dir), `process/general-plans/backlog/gcash-walled-garden-ip-productionize_NOTE_23-07-26.md` (the IP-allow this may retire in Stage C).

## Public Contracts

**Stage A (always-ship):**
- **`PAYMENT_HOSTS`** array contents change (operator-visible walled-garden config). No type change.
- **New module** `apps/admin/scripts/walled-garden-config.ts` exporting `PAYMENT_HOSTS`/`PROBE_DENIES`
  (config extraction — a refactor with no runtime behavior change).
- **Unchanged (hard):** `PROBE_DENIES` content + "above the allows" ordering; browser return URL
  (`event.url.origin`/`ORIGIN`, never `TUNNEL_ORIGIN`); `/ip dns allow-remote-requests=yes` +
  hotspot DNS-redirect-to-self; `provisionWalledGarden()` signature/body.

**Stage A follow-up (item 22, `--reconcile`, ADDITIVE to Stage A — REVISES D-PRUNE):**
- **New exported function** (e.g. `reconcileWalledGarden(config, input)` — exact name execute-agent's
  choice) at `@veent/core`, alongside `provisionWalledGarden`. Additive; no existing signature changes.
- **New CLI flag** `--reconcile` on `setup:router` (additive; default behavior with no flag is
  byte-for-byte unchanged — D-PRUNE's additive-only default is preserved).
- **Removal scope (hard, security-relevant):** removes ONLY rows carrying the code's own tag (default
  `veent-admin` for host/IP-layer rows created by `provisionWalledGarden`) that are absent from the
  desired set computed for the current run. NEVER removes: un-tagged/manually-added operator rows; the
  `gcash-auto`-tagged walled-garden-ip row (the `gcash-resolve` scheduler's own upsert target — a
  DIFFERENT tag from the veent host-rule tag); the disabled reCAPTCHA rows (un-tagged manual rows).

**Stage C (CONDITIONAL — only if Stage B triggers it):**
- **New exported function** `provisionDnsEnforcement(config: MikrotikConfig, input: DnsEnforcementInput): Promise<DnsEnforcementResult>` at `@veent/core`. Additive; no existing signature changes.
  - `DnsEnforcementInput = { dohProviderIps: string[]; tag?: string }` (DoT ports are fixed 853; DoH port fixed 443 — not caller-configurable, keep the surface minimal).
  - `DnsEnforcementResult = { filterRules: { value: string; created: boolean }[]; addressListEntries: { value: string; created: boolean }[] }` — mirrors `WalledGardenResult`'s `{ value, created }` shape for consistent logging.
- **Router runtime contract:** new `/ip/firewall/filter` `action=drop` rows (forward chain) + a
  `/ip/firewall/address-list` named list, all tagged `comment=veent-dns-enforce`. NEW router surface
  — first firewall-filter rows this tooling has ever created.

## Blast Radius

- **Stage A files:** ≤ 4 (setup-router.ts, NEW walled-garden-config.ts, NEW collision-guard spec,
  1-line `vite.config.ts` include-glob widening — added at VALIDATE, see Touchpoints) + docs sync
  (walled-garden.md). Purely additive host codification + one refactor + one test + one test-infra fix.
- **Stage C files (CONDITIONAL — added only if Stage B triggers the block):** ≤ 3 more (mikrotik.ts,
  network/index.ts, mikrotik.spec.ts) + DoH wiring in setup-router.ts + DoH section in walled-garden.md
  + conditional checkoutAccess.ts.
- **Total if Stage C ships:** ≤ 6 code/doc files. If Stage C does NOT ship: ≤ 3 + docs.
- **Stage A follow-up (item 22, `--reconcile`):** +~4 files (setup-router.ts argv/call wiring,
  mikrotik.ts new sibling fn, index.ts export, mikrotik.spec.ts new test) + a docs note in
  walled-garden.md. Same two packages as the rest of this plan (`radius-admin` + `@veent/core`) —
  does not add a new package. Risk class: LOW-MEDIUM — it IS a delete path on a payments-critical
  router, but the deletion is strictly tag-scoped (cannot touch un-tagged rows by construction),
  dry-run-inspectable before any live removal, and fully covered by mocked Fully-Automated tests for
  the scoping logic; the live removal itself is Agent-Probe, same tier as the rest of Stage A/B.
- **Packages:** `radius-admin` (`apps/admin`) always; `@veent/core` (`packages/core`) always now (item
  22's reconcile fn adds to it independent of whether Stage C ships).
- **Risk class:** Stage A is LOW-MEDIUM (config codification + test; no runtime router-behavior change
  beyond additive walled-garden allows). Stage C is HIGH — deploy/runtime/gateway change on a live
  payments-critical router; whole-network DNS-behavior change (every guest loses encrypted DNS); new
  firewall-filter surface with `action=drop` (a mis-scoped drop could black-hole guest traffic).
  Stage C requires the High-Risk Execution Handoff manual-first evidence pack; Stage A does not.
- **Reversibility:** Stage A is a code revert + removing additive walled-garden rows. Stage C router
  rows are tag-scoped (`veent-dns-enforce`) → fully removable via `/ip firewall filter remove [find
  comment=veent-dns-enforce]` + `/ip firewall address-list remove [find list=doh-providers]`.

---

## Design Decisions (implementation-level, locked)

### Stage A (always-ship)

- **`PAYMENT_HOSTS` reconciliation:** add the codified `*.domain` forms (Alipay set, `*.mynt.xyz`,
  `*.g-xchange.com`, `pay.google.com`, `payments.google.com`, KEEP `*.googleapis.com`) with per-line
  rationale comments. Do NOT add broad `*.google.com`/`*.gstatic.com` (D1). Additive to the existing
  print-then-add `provisionWalledGarden` flow — no new provisioning function needed for Stage A.
- **Constant extraction:** move `PAYMENT_HOSTS`/`PROBE_DENIES` to a side-effect-free module so the
  collision guard can import them without executing the provisioning script (see §Test-file placement).

### Stage C — SUPERSEDED by live diagnostic (29-07-26): DoH/DoT design DEAD, see §Stage C Replacement Design below

**This subsection's DoT/DoH design is preserved for the historical record only — DO NOT BUILD IT.**
The live Stage B capture (29-07-26) found GCash's root cause is CNAME-to-Akamai, not DoH-hiding, so
this whole-network DoH/DoT block would not have fixed the bug it was designed for. The actual
Stage C build target is now the `:resolve`-scheduler pattern in §Stage C Replacement Design. The
original design is left below unmodified for audit trail / in case a future, genuinely-DoH-hidden
payment host is discovered (unlikely given this session's findings, but not impossible).

- **DoT block (superseded, do not build):** `/ip/firewall/filter` chain=`forward`, protocol=`tcp`, dst-port=`853`, action=`drop`, comment=`veent-dns-enforce`. ALSO add the `udp`/`853` twin (DoQ / DNS-over-QUIC bootstraps on udp/853). Two rows.
- **DoH block:** an address-list `doh-providers` (inline `DOH_PROVIDER_IPS` in setup-router.ts) + two filter rows — chain=`forward`, dst-address-list=`doh-providers`, dst-port=`443`, action=`drop`, one for `protocol=tcp` and one for `protocol=udp` (HTTP/3 DoH is udp/443 QUIC). Blocking only tcp/443 would let QUIC-DoH bootstrap through.
- **`DOH_PROVIDER_IPS` seed set (inline constant, D2):** the well-known public DoH resolver anycast IPs — Cloudflare (`1.1.1.1`, `1.0.0.1`), Google (`8.8.8.8`, `8.8.4.4`), Quad9 (`9.9.9.9`, `149.112.112.112`) at minimum; include IPv6 twins only if the router forwards IPv6 to guests (verify live — see Stage C step). The constant carries a comment: this list is STALE-PRONE (providers add IPs); the named escalation for churn is the deferred `:resolve`→address-list script (SPEC Out-of-Scope).
- **Firewall rule ordering:** the drop rows must evaluate before any broad `forward` accept that would pass the same traffic. Implementation: on a fresh install `add` appends; for effectiveness, `place-before` the first non-`veent-dns-enforce` forward rule (mirror the `provisionWalledGarden` `beforeId`/`place-before` technique). EXACT placement is validated live (torch/HAR) — if a drop is shadowed by an earlier accept, move it up. Flagged as the one ordering-sensitive item.
- **Idempotency:** print `/ip/firewall/filter` and match on the rule signature (chain+protocol+dst-port+action+dst-address-list) case-insensitively before add; print `/ip/firewall/address-list` and match on (list name + address) before add. Never add a duplicate on re-run (AC6). Same print-then-add pattern as `provisionWalledGarden`.
- **`provisionDnsEnforcement` is called even though `provisionWalledGarden` opens its own conn** — accept two sequential connections in setup-router.ts (simpler than threading one conn through both; setup:router is a manual, latency-insensitive step). Do not refactor `provisionWalledGarden` to share a conn (scope creep).

### Stage C Replacement Design (live-proven 29-07-26 — this is the real Stage C build target)

Rule of thumb established live this session: a payment host that CNAMEs to a CDN (GCash → Akamai)
needs a `:resolve` scheduler upserting a `walled-garden ip` row; a payment host that resolves
DIRECTLY to the provider's own IP (all Google hosts touched) needs only correct `dst-host` rules,
no script. Apply this rule when deciding which mechanism a newly-discovered payment host needs.

- **`gcash-resolve` scheduler (codify into `setup:router`).** Port the live-proven script into
  `provisionWalledGarden()` or a new sibling function in `mikrotik.ts` — v6 has no
  `/system scheduler run`, so the codified version should either provision the scheduler item
  itself (idempotent add-if-absent, matching the `comment=gcash-auto`/`name=gcash-resolve`
  convention) or resolve+upsert directly at `setup:router` run time (simpler, avoids a new
  RouterOS scheduler-management code path, but loses the 5-minute self-healing cadence between
  manual runs — flag this tradeoff explicitly in EXECUTE and pick one, documented in
  `docs/mikrotik/walled-garden.md`). Reuse the print-then-add idempotency pattern already used by
  `provisionWalledGarden()`/`provisionDnsEnforcement`'s sibling-function convention (D3).
  `mdap.paas.mynt.xyz` gets the same mechanism if/when a live capture confirms it's contacted and
  unmatched (not yet confirmed — do not add speculatively).
  **VALIDATE 30-07-26 resolution (locked — do not re-open):** mechanism = PROVISION the
  `/system scheduler` item itself (idempotent add-if-absent, matched on `name=gcash-resolve`),
  NOT the runtime resolve+upsert alternative — the scheduler-item path self-heals on the live
  5-min cadence and reproduces live router state exactly. Two DISTINCT match keys are in play;
  do not conflate them: the new sibling function idempotency-checks the SCHEDULER ITEM by
  `name=gcash-resolve` (via `/system/scheduler/print`, `?name=` filter — safe by analogy to the
  already-live-proven `?dst-host=` filter in `provisionWalledGarden`'s hosts loop). The on-event
  script body's OWN internal upsert logic (copied verbatim from the live-proven script — do not
  retype/paraphrase it) separately matches the `/ip/hotspot/walled-garden/ip` row it upserts by
  `comment="gcash-auto"` — that inner logic is unchanged from the live-proven text. Do NOT
  templatize the on-event script body from data structures without a RouterOS-script-injection
  review first — it must stay a hardcoded, static script string (see the 30-07-26 supplement
  validate-contract's Execute-Agent Instructions E3).
- **Google host additions (Stage A follow-up, NOT Stage C — see checklist below).** Because these
  resolve directly (no CDN indirection), they are ordinary `PAYMENT_HOSTS` entries, not a Stage C
  concern at all — add `accounts.google.com` (bare) and `accounts.google.com.ph` to the codified
  config module alongside the existing `pay.google.com`/`payments.google.com` entries.
- **v6 syntax notes (apply when writing/testing router code this session surfaced):** no
  `/system scheduler run` on v6 — the on-event body must be exercised by calling `:resolve` +ROLE
  the upsert logic directly when testing, not via a scheduler manual-trigger command; `find where
  dst-address=X`/`find where action=deny` return empty on v6 for both `walled-garden` and
  `walled-garden ip` — operate rows by print-then-index, never by a `find where` filter clause in
  new code targeting this router; the HOST layer (`/ip hotspot walled-garden`) uses
  `action=allow` (default, omit) — `action=accept` is `walled-garden ip`-sublayer-only syntax and
  errors at the host layer.
- **Not shipping:** `DOH_PROVIDER_IPS`, `provisionDnsEnforcement()`, any `/ip/firewall/filter`
  `action=drop` rows. None of this is needed — the CNAME/direct-resolve distinction covers every
  host found so far without touching guest DNS behavior at all. AC7 (non-payment plain DNS
  unaffected) is trivially satisfied by never shipping this.

### Re-Scoped Acceptance Criteria (live-proven 29-07-26)

Per the Method Support Matrix this session established:

| Payment method | Captive-scope status |
|---|---|
| GCash / QRPH | **Supported** — fixed via `gcash-resolve` (live-proven; codification pending) |
| Maya wallet | **Supported** — already working (direct-resolve host rules, no change needed) |
| Google Pay | **NOT achievable in captive scope** — `OR_BIBED_15` WebView policy block, unfixable by network/DNS config; requires a decoupled (non-CNA, standalone-browser) payment path, which is explicitly OUT OF SCOPE per the original SPEC |
| Credit/debit 3DS | **NOT achievable in captive scope** — already SPEC out-of-scope; the Google Pay WebView finding reinforces that unpredictable ACS/bank-app domains in a CNA WebView are a structural, not incremental, gap |

**AC3 ("Google Pay checkout completes while captive") is downgraded from a shippable acceptance
criterion to a documented known-limitation.** It cannot be met by any change this plan's scope
permits — meeting it would require the decoupled-payment-path redesign that is explicitly listed
as Out of Scope in the locked SPEC (`process/general-plans/active/payment-walled-garden-v6_29-07-26/payment-walled-garden-v6_SPEC_29-07-26.md`
§Out Of Scope). See the SPEC revision note appended to that file for the corresponding
Out-of-Scope/AC update. AC1/AC2 (GCash root cause + checkout) remain in scope and are the primary
deliverable of this plan.

### Stage A Follow-Up Checklist Additions (live-proven 29-07-26)

These are NEW checklist items, additive to the existing Stage A steps 1–7 (already committed in
`ec24ed4`) — do them in a follow-up EXECUTE pass before this plan can be marked `STAGE A CODE-DONE`
again (the live router now has state the codebase doesn't know about) or `VERIFIED`:

18. **Codify `gcash-resolve` into `setup-router.ts`/`mikrotik.ts`.** Per §Stage C Replacement
    Design above — this is the actual remaining Stage C build work, replacing the dead DoH design.
19. **Add `accounts.google.com` + `accounts.google.com.ph` to `PAYMENT_HOSTS`** in
    `walled-garden-config.ts`, with a rationale comment citing the live SetSID/bare-host findings.
    Re-run the D-CAUTION collision guard after adding (neither host should collide with
    `PROBE_DENIES`).
20. **Walled-garden cleanup EXECUTE pass.** Reconcile the live 48-row rule set to the single
    canonical `veent-admin`-tagged codified set:
    - Remove duplicate `*gcash*` rows (29+30, redundant with each other).
    - Remove redundant substring/wildcard pairs once the enumerated `*.domain` form is confirmed
      to catch the same traffic (`*.maya.ph` vs `*maya.ph*`, `*.paymaya.com` vs `*paymaya*`,
      `*.mynt.xyz` vs `mynt.xyz`).
    - Remove the five dead GCash hostname rules (0 hits, fully superseded by `gcash-auto`/
      `gcash-resolve`).
    - **Coverage-regression check required before removing any manual `*keyword*` rule that is
      currently SHADOWING a Stage A codified rule** (confirmed live: rule 32 `*alipay*` matches
      before the Stage A `*.alipay.com` rules at 41-44, which is why those show 0 hits despite
      being correct) — reorder or remove the shadowing manual rule only after confirming the
      codified rule underneath it actually catches the same traffic once it's reachable.
    - Document the final canonical rule set in `docs/mikrotik/walled-garden.md`.
    - **HONESTY NOTE (added 30-07-26, item 22 supplement):** the new opt-in `--reconcile` flag
      (item 22 below) automates ONLY the veent-tagged portion of cleanup. The shadowing manual
      `*keyword*` operator rows this item describes (`*gcash*` duplicates, `*g-xchange*`, `*maya.ph*`,
      `*paymaya*`, etc.) are UN-tagged — `--reconcile` will NEVER remove them by design (it only
      touches rows carrying the code's own tag). Item 20's manual deletion + coverage-regression check
      is still required in full; do not assume `--reconcile` closes this item.
21. **Re-verify AC4/AC5 not re-tested this session.** The stay-captive `PROBE_DENIES` invariant and
    the browser return-URL mechanism were not touched this session but were also not freshly
    re-verified — do a quick confirmation pass in the next live session before calling the plan
    `VERIFIED`.
22. **Add opt-in `--reconcile` prune to `setup:router` (added 30-07-26 — REVISES D-PRUNE).** User
    chose this over keeping cleanup fully manual. Implements the D-PRUNE revision above:
    - New `--reconcile` argv flag on `setup:router` (`apps/admin/scripts/setup-router.ts`), alongside
      the existing `--dry-run`/`--restrict-api`. Default (no flag) run is byte-for-byte unchanged —
      still purely additive.
    - When `--reconcile` is set: AFTER the additive `provisionWalledGarden` call, invoke a NEW sibling
      function in `mikrotik.ts` (e.g. `reconcileWalledGarden` — exact name execute-agent's choice, per
      D3 — do NOT widen `provisionWalledGarden`'s signature/body) that removes ONLY walled-garden rows
      carrying the code's own tag (default `veent-admin`) whose host (or IP, for the `ips` layer) is
      NOT in the desired set the script would provision this run (codified `PAYMENT_HOSTS` +
      `ADMIN_WG_HOSTS` + the derived `ORIGIN` host + `PROBE_DENIES`).
    - **Hard non-targets (never removed, by construction of the tag match):** (1) any un-tagged /
      manually-added operator row; (2) the `gcash-resolve` scheduler's own upserted walled-garden-ip
      row, tagged `comment="gcash-auto"` — a DIFFERENT tag from the veent host-rule tag, so scope the
      tag match precisely and do not conflate the two; (3) the disabled reCAPTCHA rows (un-tagged
      manual rows).
    - `--reconcile --dry-run` prints what it would remove without removing (reuse the existing
      `DRY_RUN` const). The removal path logs each removed row.
    - **v6 syntax constraint:** operate rows by print-then-index-number, never a `find where
      dst-host=...`/`find where dst-address=...` filter clause (returns empty on this v6 router —
      established live 29-07-26).
    - **VALIDATE 30-07-26 finding (action-scoping — REQUIRED, do not re-open the design, this is an
      implementation fix):** `provisionWalledGarden()` tags BOTH the deny rows (`PROBE_DENIES`,
      `action=deny`) AND the host allow rows (`action=allow`) with the SAME comment tag on the SAME
      `/ip/hotspot/walled-garden` menu — confirmed by reading `mikrotik.ts:1035-1115` (one `tag`
      const shared across the denies/hosts/ips loops). Reconcile MUST therefore scope its host-layer
      removal candidates to `action=allow` rows ONLY — never inspect or remove `action=deny` rows,
      even though they carry the same tag — because `PROBE_DENIES` is on the Public Contracts
      "Unchanged (hard)" list and deleting a deny row would silently re-open a captive-probe host (the
      exact regression class D-CAUTION's collision guard exists to prevent, from a different angle).
      Additionally: (1) reconcile MUST reuse the EXACT same `[...hosts]`/`[...ips]` arrays
      `setup-router.ts` already computed for the just-completed `provisionWalledGarden` call as its
      desired set — do not recompute a second desired set that could drift from what was actually just
      provisioned; (2) the tag/comment match MUST be an exact equality check (`row.comment === tag`),
      never a substring/prefix match, so the differently-tagged `gcash-auto` row is excluded by
      construction, not by luck; (3) the `veent-admin` tag string is ALSO reused (with a
      `:<epochMs>` suffix, as `ADMIN_BYPASS_TAG`) for a completely unrelated RouterOS resource —
      admin-device bypass rows on `/ip/hotspot/ip-binding` (confirmed: `mikrotik.ts:102`). Reconcile
      MUST only ever `conn.write` against `/ip/hotspot/walled-garden` and
      `/ip/hotspot/walled-garden/ip` — never the `ip-binding` menu — despite the shared tag string.
    - **Test gate (Fully-Automated, code-provable this pass):** new `mikrotik.spec.ts` coverage —
      (a) default run (no `--reconcile`) removes nothing; (b) `--reconcile` removes a veent-tagged row
      absent from the desired set; (c) `--reconcile` leaves an un-tagged row AND a `gcash-auto`-tagged
      row untouched even when their value is absent from the desired set; (d) `--reconcile --dry-run`
      removes nothing (log-only); (e) `--reconcile` NEVER removes an `action=deny` row (a
      `PROBE_DENIES` row) even when it shares the veent-admin tag and its host is absent from the
      desired ALLOW-hosts set — proves the action-scoping fix above. Reuse the
      `vi.mock('node-routeros')` growing-in-memory-table convention already established for
      `provisionWalledGarden`/scheduler-item tests.
    - **Live confirmation (Agent-Probe, scheduled at next live EXECUTE session):** run `setup:router
      --reconcile --dry-run` on staging first, confirm the printed removal list matches expectation,
      then run `--reconcile` for real and confirm only the expected veent-tagged rows are gone.

---

## Implementation Checklist (atomic, ordered, staged)

### Stage A — Safe, always-ship (no network-wide downside)

1. **Extract config module.** Create `apps/admin/scripts/walled-garden-config.ts` (side-effect-free)
   exporting `PAYMENT_HOSTS` and `PROBE_DENIES`; update `setup-router.ts` to import them. This is the
   small, justified refactor the collision guard needs — flag it explicitly, no behavior change.
1b. **Widen the Vitest include glob (VALIDATE finding).** In `apps/admin/vite.config.ts`, add
   `'scripts/**/*.{test,spec}.{js,ts}'` to the `server` project's `include` array (alongside the
   existing `'src/**/*.{test,spec}.{js,ts}'`). Without this, `bunx vitest run scripts/setup-router.spec.ts`
   reports "No test files found" — empirically confirmed during VALIDATE. 1-line, test-infra-only,
   no production behavior change.
2. **`PAYMENT_HOSTS` reconciliation.** In the config module, add (with per-line rationale comments):
   `*.alipay.com`, `*.alipayobjects.com`, `*.alicdn.com`, `*.antgroup.com`, `*.mynt.xyz`,
   `*.g-xchange.com`, `pay.google.com`, `payments.google.com`, `*.googleapis.com` (KEEP, with
   abuse-residual comment per D-GAPI). Do NOT add broad `*.google.com`/`*.gstatic.com`. Do NOT add
   per-device Google/reCAPTCHA hosts here (D1 — they stay in checkoutAccess.ts).
3. **Collision-guard test (D-CAUTION).** New spec asserting
   `PAYMENT_HOSTS.every(h => !PROBE_DENIES.some(d => d.host.toLowerCase() === h.toLowerCase()))`,
   importing both from the new config module. This must FAIL if anyone later dumps a Google-family
   probe host into `PAYMENT_HOSTS`.
4. **`docs/mikrotik/walled-garden.md` sync (Stage A part).** Add the new codified hosts under the
   allow list, and the operator cleanup list (§Operator Cleanup). Do NOT yet add the DoT/DoH section
   (that is Stage C, conditional).
5. **Run `setup:router` + local gates.** `bun run --filter radius-admin setup:router` (adds codified
   hosts; confirm log shows new rows `added`, second run `already present`). Then
   `cd apps/admin && bun run check`; `cd apps/admin && bunx vitest run scripts/setup-router.spec.ts`
   (requires step 1b's include-glob widening — confirm it reports 1 passed, not "No test files found");
   scoped `bun run lint` on touched files (repo-wide lint has known pre-existing drift — do not chase it).
6. **Operator cleanup (manual).** After the codified allows are confirmed present, hand the operator
   the §Operator Cleanup rows to delete the messy `*keyword*` substrings by hand. (The
   `23.7.208.188` IP-allow retirement stays GATED on Stage C — do NOT retire it yet.)
7. **Commit prep** (user commits): conventional message
   `fix(mikrotik): codify live-proven PAYMENT_HOSTS as enumerated *.domain forms + collision guard`.
   Stage A is safe to ship immediately — it carries NO DoT/DoH block and NO `provisionDnsEnforcement`.

### Stage B — Diagnostic capture (staging, Maya LIVE, DoH block NOT yet applied)

8. **Capture a real GCash checkout.** With Stage A live on `10.210.54.133`, put a real device in the
   captive state and run a real Maya-LIVE GCash top-up. Capture browser HAR + `/ip dns cache print
   detail` + `/tool torch` through the full Maya→GCash→Alipay-cashier→return flow.
9. **Capture a real Google Pay checkout.** Repeat for GPay. Record whether GPay renders under the
   existing per-device checkout-access allow, or needs a distinct global host (→ conditional
   checkoutAccess.ts / PAYMENT_HOSTS GPay host — re-run collision guard first if adding one).
10. **Answer the three branch questions and record them as Stage C inputs:**
    - **Q1:** Is `payments.gcash.com` (or any `gcash.com`-family host) actually contacted by the
      browser at all during checkout? (from HAR SNI/host list)
    - **Q2:** If yes — does the ROUTER see that DNS query (appears in `/ip dns cache`) or is it
      DoH/DoT-hidden (never appears)?
    - **Q3:** Does GCash + GPay checkout ALREADY complete end-to-end via the codified cashier hosts
      alone (Alipay/mynt/googleapis), with the `gcash.com` rules still at 0 hits?
11. **Coverage-regression check (independent of the DoH block).** From the same HAR, confirm every
    SNI/host the browser contacted is covered by a codified `*.domain` rule — i.e. switching the old
    `*alipay*`/`*gcash*` substrings to enumerated forms dropped no working host. Any host caught by
    the old substring but missed by the enumerated set → add it before the operator retires the
    substring rules.
12. **Negative acceptance test (independent of the DoH block).** From an UN-granted captive device:
    `curl -v https://example.com` (a general non-payment, non-probe host) must be redirected to the
    portal, NOT reach the internet; and `curl -v http://connectivitycheck.gstatic.com/generate_204`
    → non-204 (`PROBE_DENIES` still holds). Proves the expanded `PAYMENT_HOSTS` did not open general
    internet access. (If Stage C ships, re-verify both here too — see step 16.)

### Stage C — CONDITIONAL DoH/DoT block (build + ship ONLY if Stage B proves it's needed)

**Branch decision from step 10:**

- **CASE 1 — SHIP (Q1=yes AND Q2=DoH-hidden):** `gcash.com`-family is contacted but its DNS query is
  DoH/DoT-hidden from the router → the DoH block is the correct root-cause fix. Proceed to steps
  13–16.
- **CASE 2 — DO NOT SHIP (Q3=yes / Q1=no):** checkout already completes via the cashier hosts and the
  browser never meaningfully contacts `gcash.com` → do NOT ship the DoH block (it would degrade every
  guest's encrypted DNS for zero benefit). Skip steps 13–16; do step 17 instead.
- **CASE 3 — INVESTIGATE (Q1=yes, Q2=router-sees-query, but rule still 0 hits):** different root
  cause (rule syntax/ordering) → do NOT ship the DoH block blindly; investigate the rule, file a
  finding, escalate per SPEC if unresolved. Do step 17 (document) with the investigation note.

13. **[CASE 1] `mikrotik.ts` — interfaces + `provisionDnsEnforcement()`.** Add `DnsEnforcementInput`
    (`{ dohProviderIps: string[]; tag?: string }`) and `DnsEnforcementResult`
    (`{ filterRules: {value;created}[]; addressListEntries: {value;created}[] }`) beside the
    `WalledGarden*` interfaces (~line 988–1018). Add the new exported async fn after
    `provisionWalledGarden` (~line 1115): open conn via `openConn(config)` in `try/finally { conn.close() }`;
    ensure address-list `doh-providers` (print-match-add per IP); ensure the 4 filter rows (DoT tcp/853,
    DoT udp/853, DoH tcp/443+list, DoH udp/443+list) with `place-before` the first non-tag forward rule;
    record `{value,created}`; `tag` defaults to `veent-dns-enforce`. Follow §Design Decisions (Stage C).
14. **[CASE 1] `network/index.ts` export + `setup-router.ts` DoH wiring.** Add
    `provisionDnsEnforcement` + its types to the `from './mikrotik'` re-export block (verify it reaches
    `@veent/core` root). Add the inline `DOH_PROVIDER_IPS` constant (D2) to the config module; after the
    existing `provisionWalledGarden` block in setup-router.ts, call
    `await provisionDnsEnforcement(config, { dohProviderIps: DOH_PROVIDER_IPS })` and log each result
    line. Verify live whether the router forwards IPv6 to guests before adding IPv6 twins to the seed set.
15. **[CASE 1] `mikrotik.spec.ts` idempotency + shape test (AC6).** New
    `describe('provisionDnsEnforcement')`. Extend the `vi.mock('node-routeros')` fake so `conn.write`
    returns a growing in-memory table for `/ip/firewall/filter` and `/ip/firewall/address-list`. Assert:
    first call creates 4 filter rows + N address-list entries (`created: true`); second call on the same
    fake state is a full no-op (`created: false`); each add carries `comment=veent-dns-enforce` and the
    correct chain/port/action params. Then run local gates:
    `cd packages/core && bunx vitest run src/integrations/network/mikrotik.spec.ts`; `bun run check`;
    scoped lint. Commit prep: `fix(mikrotik): v6 DoT/DoH enforcement for GCash walled-garden matching`.
16. **[CASE 1] Ship + re-capture + retire IP allow.** Run `setup:router` on staging (adds the DoT/DoH
    rows; second run all `already present` — AC6 live). Re-capture the GCash checkout and confirm the
    `gcash.com` `dst-host` rules flip 0→nonzero. Re-run the negative + coverage-regression checks
    (steps 11–12) under the block. Then retire the rotating `23.7.208.188` `gcash-test` IP allow
    (`/ip hotspot walled-garden ip remove [find where dst-address=23.7.208.188]`), re-verify checkout
    still completes, and document in `docs/mikrotik/walled-garden.md` (DoT/DoH section + version prereq
    + DoH-IP staleness/`:resolve` escalation + IP-allow retirement step).
17. **[CASE 2/3] Do NOT ship the block — document instead.** Record `provisionDnsEnforcement` as
    designed-but-not-shipped (fully specified in this plan, available if a future case needs it). KEEP
    or narrow the `23.7.208.188` IP allow and document why (checkout completes via cashier hosts / rule
    under investigation). Note in `docs/mikrotik/walled-garden.md` that the whole-network DoH block was
    evaluated and proven unnecessary (CASE 2) or deferred pending rule investigation (CASE 3) — this
    AVOIDS the whole-network DNS degradation. File the backlog note per SPEC escalation for CASE 3.

### Test-file placement note

`setup-router.ts` executes provisioning at import time (top-level `await provisionWalledGarden`). To
unit-test `PAYMENT_HOSTS`/`PROBE_DENIES` (Stage A step 3) and avoid running the script on import,
EXTRACT the constants into `apps/admin/scripts/walled-garden-config.ts` (Stage A step 1) that both the
script and the spec import. `DOH_PROVIDER_IPS` joins that module in Stage C if triggered. This is a
small, justified refactor — flag it explicitly in EXECUTE, not silent. If extraction proves larger
than expected, fall back to asserting the collision property against a hardcoded mirror + a comment
pinning it to the source — but prefer the real import.

---

## Operator Cleanup (manual — `setup:router` will NOT prune; D-PRUNE)

Provide the operator the exact rows to delete by hand. Stage A cleanup (substring wildcards) runs
AFTER the new script run confirms the codified `*.domain` allows are present. The IP-allow retirement
is GATED on the Stage C CASE 1 outcome (step 16) — do NOT retire it in Stage A.

```
# Inspect first — confirm the codified replacements exist and are matching before deleting originals:
/ip hotspot walled-garden print

# STAGE A — Remove the over-broad substring wildcards (replaced by enumerated *.domain forms):
/ip hotspot walled-garden remove [find where dst-host="*gcash*"]      ;# duplicate rows 30+31
/ip hotspot walled-garden remove [find where dst-host="*g-xchange*"]
/ip hotspot walled-garden remove [find where dst-host="*maya.ph*"]
/ip hotspot walled-garden remove [find where dst-host="*paymaya*"]
# Evaluate (0 hits, likely droppable):
/ip hotspot walled-garden remove [find where dst-host="*.accounts.google.com"]

# STAGE C CASE 1 ONLY — Retire the rotating GCash IP allow AFTER step 16 confirms the hostname path
# works under the DoH block (do NOT run this in Stage A or in CASE 2/3):
/ip hotspot walled-garden ip remove [find where dst-address=23.7.208.188]
```

Leave the disabled `*.gstatic.com`/`*.google.com`/`*.recaptcha.net` rows disabled (the flap fix).

---

## Verification Evidence

| Gate / Scenario | Stage | Strategy | Proves SPEC criterion |
|---|---|---|---|
| PAYMENT_HOSTS ∩ PROBE_DENIES = ∅ collision-guard unit test (D-CAUTION) | A | Fully-Automated | Guards AC4 (no accidental probe-host re-open) |
| `bun run check` + scoped `bun run lint` on touched files | A (and C if shipped) | Fully-Automated | Build integrity of the change |
| Idempotency live — 2nd `setup:router` all "already present" (walled-garden allows) | A | Agent-Probe | AC6 (Stage A live confirmation) |
| Staging live GCash checkout HAR + `/ip dns cache print detail` + torch (answers Q1/Q2/Q3) | B | Agent-Probe | AC1, AC2 (diagnosis) |
| Staging live Google Pay checkout capture (+ per-device-vs-global GPay host confirmation) | B | Agent-Probe | AC3 |
| Live HAR SNI/host inventory vs enumerated `*.domain` set (no coverage dropped) | B | Agent-Probe | Coverage-regression (guards AC1/AC2) |
| `curl https://example.com` from un-granted device → portal redirect (no internet grant) | B (re-verify C) | Agent-Probe | User-requested negative acceptance (guards AC4) |
| Captive-probe check (`curl generate_204` → non-204) | B (re-verify C) | Agent-Probe | AC4 |
| Browser return-trip observation (successUrl via ORIGIN) same session | B | Agent-Probe | AC5 |
| item-22 reconcile scoping test (mock `conn.write`, default-run-no-op / removes-absent-veent-tagged / never-touches-untagged-or-gcash-auto-or-deny-rows / dry-run-no-op) | A-follow-up | Fully-Automated | Guards AC4/D-CAUTION-adjacent (removal is tag-scoped AND action-scoped, never touches probe-deny or manual rows) |
| item-22 live `--reconcile --dry-run` then `--reconcile` confirmation on staging | A-follow-up | Agent-Probe | AC6 (scoped-prune correctness, live confirmation) |
| `provisionDnsEnforcement` idempotency unit test (mock `conn.write`, 2nd call no-op, correct chain/port/action/comment) | C (if shipped) | Fully-Automated | AC6 |
| Post-block re-capture: `gcash.com` `dst-host` hits flip 0→nonzero | C CASE 1 | Agent-Probe | AC1 (root-cause fixed) |
| General-browsing check on captive device, plain DNS unaffected under the block | C CASE 1 | Agent-Probe | AC7 |
| Idempotency live for DoH rules (2nd `setup:router` all "already present") | C CASE 1 | Agent-Probe | AC6 (live confirmation) |

Note: AC7 (only DoT/DoH newly blocked; non-payment plain DNS unchanged) is only in scope if Stage C
CASE 1 ships. In CASE 2/3 no DNS block ships, so AC7 is trivially satisfied (no encrypted-DNS change)
and is recorded as such.

## Test Infra Improvement Notes

- `provisionWalledGarden()` still has zero unit coverage after this work (SPEC constraint: do not widen the gap; Stage A adds coverage for the collision property only; Stage C, if it ships, adds coverage for the NEW function). Candidate backlog: an idempotency spec for `provisionWalledGarden` reusing the extended `fakeConn` in-memory-table mock Stage C introduces (if Stage C ships).
- Router `action=drop` correctness (does a mis-scoped drop black-hole guest traffic?) is NOT unit-testable — only the live torch/HAR session proves it. Documented as an Agent-Probe known limitation, acceptable per SPEC (live-only bug class). Relevant only if Stage C CASE 1 ships.
- The `*.googleapis.com` (98-hit) abuse-surface tightening is a follow-up requiring a live capture of exactly which subpaths checkout needs — backlog candidate, not this plan.

---

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Shipping a whole-network DoH block that degrades every guest's encrypted DNS for zero benefit | **Core reason for the diagnostic-first restructure** — Stage B proves whether the block is needed before Stage C builds/ships it; CASE 2 explicitly does NOT ship it. |
| Enumerated `*.domain` set drops a host the old substring caught | Explicit coverage-regression check (Stage B step 11) against live HAR before the operator retires substring rules. |
| New PAYMENT_HOSTS entry collides with a PROBE_DENIES host → reintroduces the captive flap | D-CAUTION automated collision guard (Stage A) fails the build. |
| Stage B inconclusive (checkout works via cashier hosts, gcash-hostname still 0 hits) | This is CASE 2 — a valid, documented outcome (keep IP allow, do not ship block), not a failure. |
| DoH IP blocklist is inherently stale (providers rotate/add IPs) — Stage C only | Documented staleness note; `:resolve` script is the named escalation (SPEC Out-of-Scope); seed set covers the dominant public resolvers. Only relevant if CASE 1 ships. |
| A device uses an unlisted DoH endpoint / DoH-over-non-443 → checkout still fails — Stage C only | SPEC-acknowledged residual; Stage B/re-capture discovers gaps → known-limitation or backlog, not a ship blocker. |
| Mis-scoped `action=drop` black-holes guest traffic — Stage C only | Rules are narrow (specific ports + address-list); tag-scoped and fully removable; validated live via torch before trusting; rollback = remove tagged rows. |
| Firewall rule ordering shadowed by an earlier forward accept → drop ineffective — Stage C only | `place-before` first non-tag forward rule; live torch/HAR confirms drops fire; move up if shadowed (step 16). |
| CASE 3 (gcash contacted, router sees query, rule still 0 hits) → shipping DoH block would not fix it | Explicit CASE 3 branch — do NOT ship the block; investigate rule syntax/ordering; escalate per SPEC. |
| Whole-network encrypted-DNS block is user-facing behavior change | SPEC flagged-assumption ACCEPTED by user as a ceiling; the diagnostic gate ensures it only ships if proven necessary (CASE 1); documented in runbook. |

## Dependencies

- Staging router `10.210.54.133` reachable over RouterOS API with `MIKROTIK_*` creds; `NETWORK_CONTROLLER=mikrotik`.
- Maya LIVE integration credentials on staging (sandbox cannot reproduce).
- A real test device that can be put in the captive state on the hotspot.
- Operator availability for the manual cleanup (Stage A) and, if CASE 1, the IP-allow retirement (Stage C step 16).

---

## Resume and Execution Handoff

1. **Selected plan file:** `process/general-plans/active/payment-walled-garden-v6_29-07-26/payment-walled-garden-v6_PLAN_29-07-26.md`
2. **Last completed step:** Stage A code shipped (`ec24ed4`). Stage B live diagnostic capture ran
   29-07-26 (see `payment-walled-garden-v6_REPORT_29-07-26.md`) — found GCash's real root cause
   (CNAME-to-Akamai, not DoH), fixed live on the router, and closed the Google Pay question
   (reachable but WebView-policy-blocked). Live fixes are NOT yet codified — checklist items 18–21
   (§Stage A Follow-Up Checklist Additions) are the next EXECUTE work.
3. **Validate-contract status:** PASS (below) for the ORIGINAL Stage A + diagnostic-first design.
   Checklist items 18–21 (added 29-07-26, post-diagnosis) have NOT been through their own VALIDATE
   pass — re-run VALIDATE (or at minimum a plan-supplement PVL cycle) before EXECUTing them, since
   they replace the Stage C design the existing contract validated.
4. **Supporting context loaded:** SPEC (same folder); `apps/admin/scripts/setup-router.ts` (`PAYMENT_HOSTS`/`PROBE_DENIES` to extract); `packages/core/src/integrations/network/mikrotik.ts` (`provisionWalledGarden` ~1031, `openConn`, `fakeConn` spec pattern); `packages/core/src/integrations/network/index.ts` (export chain); `packages/core/src/services/checkoutAccess.ts`; `docs/mikrotik/walled-garden.md`; `docs/problems/captive-connected-flap-on-free-time.md`; `process/context/tests/all-tests.md` (runner = `packages/core` Vitest, `bunx vitest run <file>` from inside the package dir).
5. **Next step for a fresh agent:** After VALIDATE PASS + `ENTER EXECUTE MODE`, start at **Stage A step 1** (extract config module). Do Stage A (steps 1–7: config + collision guard + docs + local gates + operator cleanup) in one pass — this is safe to ship immediately with NO DoH block. Then **Stage B** (steps 8–12: staging live capture, answer Q1/Q2/Q3, coverage + negative checks) — requires real hardware. Then **branch at step 10**: only build/ship Stage C (steps 13–16) in CASE 1 (`gcash.com` contacted AND DoH-hidden); in CASE 2/3 do step 17 (document, do not ship). Stages B/C require the High-Risk manual-first evidence handoff — do not mark VERIFIED without the live capture. Honor the CASE branch decision.

## Acceptance Criteria

Inherited verbatim from the locked SPEC (AC1–AC7) — see
`payment-walled-garden-v6_SPEC_29-07-26.md` §Acceptance Criteria. Each is mapped to a proving gate in
§Verification Evidence above. Note the diagnostic-first sequencing: AC1 is now proven by the Stage B
capture (diagnosis) and, in CASE 1 only, the Stage C post-block re-capture (0→nonzero flip):

- **AC1** — Live capture proves root cause fixed: in CASE 1, `dst-host` payment rule hits go 0→nonzero
  after the DoH block during a real Maya-LIVE GCash + Google Pay checkout (HAR + `/ip dns cache print
  detail` + torch). In CASE 2, root cause is host-coverage (already fixed by Stage A) and the block is
  proven unnecessary. proven by: Stage B capture + (CASE 1) Stage C re-capture · strategy: Agent-Probe.
- **AC2** — GCash checkout completes while captive. proven by: Stage B live capture (GCash leg) · strategy: Agent-Probe.
- **AC3** — Google Pay checkout completes while captive (+ confirms/corrects the per-device-vs-global GPay host assumption). proven by: Stage B live capture (GPay leg) · strategy: Agent-Probe.
- **AC4** — Stay-captive invariant holds: `PROBE_DENIES` still returns non-204 to un-granted devices; OS never shows "Connected" pre-auth. proven by: Stage B capture + un-granted-device probe curl · strategy: Agent-Probe. (Also guarded automated by the Stage A PAYMENT_HOSTS∩PROBE_DENIES collision test.)
- **AC5** — Browser return URL unaffected (successUrl/cancelUrl via ORIGIN). proven by: Stage B return-trip observation, same session · strategy: Agent-Probe.
- **AC6** — Idempotent provisioning: 2nd `setup:router` reports every rule "already present". proven by: Stage A live 2nd-run (walled-garden allows) + (CASE 1) `provisionDnsEnforcement` idempotency unit test + live 2nd-run · strategy: Fully-Automated (unit, CASE 1) / Agent-Probe (live).
- **AC7** — Non-payment plain DNS unchanged; only DoT/DoH newly blocked. In CASE 1: proven by general-browsing check on captive device under the block. In CASE 2/3: trivially satisfied (no DNS block ships). strategy: Agent-Probe.

Plus the two user-requested acceptance items (§Negative Acceptance Test in Stage B step 12, §Coverage-Regression Check in Stage B step 11).

## Phase Completion Rules

Single-plan (not a phase program). Diagnostic-first completion tiers:

- **STAGE A CODE-DONE** (independently shippable) — Stage A steps 1–7 complete: config module
  extracted, `PAYMENT_HOSTS` reconciled to codified `*.domain` forms, collision-guard spec green,
  `bun run check` green, scoped lint clean, docs (hosts + cleanup) synced, operator cleanup handed off.
  This carries NO DoH block and is safe to ship on its own. This is NOT VERIFIED.
- **VERIFIED** — additionally, Stage B captured against Maya LIVE (AC1–5,7 agent-probe evidence, Q1/Q2/Q3
  answered, negative + coverage-regression checks pass) AND the Stage C branch resolved:
  - CASE 1: `provisionDnsEnforcement()` shipped, idempotency unit test green, post-block re-capture
    shows `gcash.com` 0→nonzero, IP allow retired, operator confirms checkout on real hardware.
  - CASE 2: DoH block proven unnecessary and documented; checkout confirmed working via cashier hosts
    on real hardware; IP allow kept/narrowed + documented.
  Requires the High-Risk Execution Handoff manual-first evidence pack. Do NOT mark ✅ VERIFIED without
  user-confirmed live checkout — Stage A code + unit tests alone are STAGE A CODE-DONE only.
- **BLOCKED-live (CASE 3, or checkout fails both ways)** → investigate rule syntax/ordering; escalate
  per SPEC (deferred `:resolve` script or v7), file backlog, keep plan in `active/`.

## Next Step

Plan complete (restructured to diagnostic-first three-stage sequencing). Say **ENTER VALIDATE MODE**
to convert this into a validate-contract before EXECUTE (RIPER-5 requires VALIDATE before
implementation; VALIDATE is the next gate).

## Validate Contract

Status: PASS
Date: 29-07-26
date: 2026-07-29
generated-by: outer-pvl

Parallel strategy: sequential
Rationale: single plan, single validate-agent, no phase-program fan-out (score 0-1/7 — no
multi-package touch until Stage C conditionally ships, no phase-program classification).

Test gates (C3 5-column table):

| criterion id | behavior | strategy | proving test | gap-resolution |
|---|---|---|---|---|
| D-CAUTION | `PAYMENT_HOSTS` never collides with a `PROBE_DENIES` host | Fully-Automated | `cd apps/admin && bunx vitest run scripts/setup-router.spec.ts` (requires checklist step 1b's include-glob widening) | A |
| Stage A build integrity | `apps/admin` typechecks + lints clean on touched files | Fully-Automated | `cd apps/admin && bun run check`; scoped `bun run lint` on touched files | A |
| AC6 (Stage A) | 2nd `setup:router` run reports all walled-garden hosts "already present" | Hybrid | `bun run --filter radius-admin setup:router` run twice against staging — precondition: reachable RouterOS API, `NETWORK_CONTROLLER=mikrotik` | A |
| AC1/AC2 (Stage B) | GCash checkout completes captive; Q1/Q2/Q3 answered from HAR + `/ip dns cache print detail` + torch | Agent-Probe | Live Maya-LIVE GCash checkout capture on staging `10.210.54.133` | A |
| AC3 (Stage B) | Google Pay checkout completes captive; confirms/corrects per-device-vs-global GPay host assumption | Agent-Probe | Live Maya-LIVE GPay checkout capture, same session | A |
| Coverage-regression (Stage B) | Enumerated `*.domain` set drops no host the old `*keyword*` substrings caught | Agent-Probe | Cross-check live HAR SNI/host inventory against codified `PAYMENT_HOSTS` | A |
| AC4 | Stay-captive invariant holds; `PROBE_DENIES` still returns non-204 pre-auth | Agent-Probe (+ Fully-Automated guard) | `curl -v http://connectivitycheck.gstatic.com/generate_204` from an un-granted device → non-204; array-level guard = D-CAUTION row above | A |
| AC5 | Browser return URL unaffected (`event.url.origin`/`ORIGIN`, never `TUNNEL_ORIGIN`) | Agent-Probe | Same-session return-trip observation during Stage B capture | A |
| AC6 (Stage C, CASE 1 only) | `provisionDnsEnforcement()` idempotent — 2nd call is a full no-op | Fully-Automated | `cd packages/core && bunx vitest run src/integrations/network/mikrotik.spec.ts` | B — built in Stage C if CASE 1 triggers |
| AC1 (Stage C, CASE 1 only) | Post-block re-capture: `gcash.com` `dst-host` hits flip 0→nonzero | Agent-Probe | Re-capture GCash checkout on staging after the DoH block ships | B |
| AC7 (Stage C, CASE 1 only) | Non-payment plain DNS unaffected; only DoT/DoH newly blocked | Agent-Probe | General-browsing check on captive device under the block | B |
| Firewall ordering (Stage C's own flagged highest-risk item) | `place-before` drop rows evaluate ahead of any earlier forward-accept; not shadowed | Agent-Probe | Live torch/HAR during Stage C step 16 re-capture | B |

gap-resolution legend:
- A — proven now (gate passes in this cycle / at the scheduled stage)
- B — fixed in this plan (gate added by this plan's checklist, conditional on Stage C shipping)
- C — deferred to a named later phase/plan
- D — backlog test-building stub (named residual; keep-active; continue)

Legacy line form:
- Stage A config/collision: Fully-automated: `cd apps/admin && bunx vitest run scripts/setup-router.spec.ts` | Fully-automated: `cd apps/admin && bun run check` | Hybrid: `bun run --filter radius-admin setup:router` (precondition: staging router reachable)
- Stage B live diagnosis (AC1-AC5, AC7 partial, coverage-regression): Agent-probe: real Maya-LIVE GCash + Google Pay checkout capture on staging `10.210.54.133`, HAR + `/ip dns cache print detail` + `/tool torch`
- Stage C (CONDITIONAL, CASE 1 only): Fully-automated: `cd packages/core && bunx vitest run src/integrations/network/mikrotik.spec.ts` | Agent-probe: post-block re-capture + general-browsing check + firewall-ordering torch verification

Dimension findings:
- Infra fit: PASS — RouterOS v6 primitives (`/ip/firewall/filter`, `/ip/firewall/address-list`) are reachable through the existing generic `conn.write()` node-routeros wrapper; confirmed by reading the codebase — `/ip/firewall/connection/print`+`/remove` are already called the same way in this exact file (mikrotik.ts:412,422). No library/version blocker, no container/infra conflict.
- Test coverage: CONCERN — FIXED IN PLAN — the Stage A collision-guard spec at `apps/admin/scripts/setup-router.spec.ts` was empirically confirmed invisible to every vitest command ("No test files found") because admin's `server` project `include` glob only covers `src/**`; fixed by adding checklist step 1b (widen `vite.config.ts` include glob) and the exact run command in step 5. Verified the fix works (temporary probe spec ran green with the widened glob, then reverted — repo left clean).
- Breaking changes: PASS — all new exports (`provisionDnsEnforcement`, `DnsEnforcementInput`, `DnsEnforcementResult`) are additive; `provisionWalledGarden()` signature/body confirmed untouched by reading mikrotik.ts:1031-1115; `PAYMENT_HOSTS` content change is operator-visible config, not a versioned API contract.
- Security surface: PASS (residual honestly documented) — Stage C's `action=drop` firewall rows are the plan's own correctly self-flagged highest-risk item (a mis-scoped drop could black-hole guest traffic); mitigated by tag-scoped full reversibility, mandatory live torch verification before trust, phased CASE 1/2/3 diagnostic gating (ships only if Stage B proves it necessary), and the plan's own requirement for the High-Risk Execution Handoff manual-first evidence pack before Stage C is marked VERIFIED. D-CAUTION collision guard verified against the CURRENT codified arrays — zero collision found (`*.alipay.com`/`*.alipayobjects.com`/`*.alicdn.com`/`*.antgroup.com`/`*.mynt.xyz`/`*.g-xchange.com`/`pay.google.com`/`payments.google.com`/`*.googleapis.com` vs. the 11 `PROBE_DENIES` hosts — no exact-match overlap). `DOH_PROVIDER_IPS` (Stage C) is only public well-known DoH resolver anycast IPs — no secret exposure.
- Section A — Stage A (config extraction + PAYMENT_HOSTS + collision guard + docs + gates): PASS (after plan fix) — mechanically feasible: `PAYMENT_HOSTS`/`PROBE_DENIES` are pure side-effect-free const arrays today (confirmed by reading setup-router.ts), so extraction is a behavior-neutral move; current live PAYMENT_HOSTS array matches the SPEC's documented "current state" exactly (verified). Highest-risk item: the config-extraction refactor — mitigated by the existing idempotency print/log output (step 5) plus the newly added spec-discovery fix.
- Section B — Stage B (diagnostic capture): PASS — no code changes; pure live-hardware Agent-Probe session (Maya LIVE only, sandbox cannot reproduce, matches SPEC constraint); the Q1/Q2/Q3 branch questions are exhaustive against the CASE 1/2/3 decision tree (contacted+hidden / already-works-via-cashier-hosts / contacted+visible-but-still-0-hits covers the full outcome space).
- Section C — Stage C (conditional DoT/DoH block): CONCERN — FIXED IN PLAN — corrected the touchpoint's overstated claim that mikrotik.spec.ts already has a reusable growing-in-memory-table `fakeConn` fixture (it does not; the existing fake at lines 11-71 is a single-purpose `/ping`-only EventEmitter fixture for connection-error/concurrency testing — `provisionWalledGarden` itself has zero unit coverage today, confirmed). Execute-agent must build a NEW fake from scratch, reusing only the `vi.mock('node-routeros')` module-mock convention. RouterOS primitives themselves (firewall filter drop rules, address-list, `place-before` ordering) are mechanically sound — confirmed by the same generic `conn.write()` pattern already proven elsewhere in this file, and the `place-before` technique mirrors `provisionWalledGarden`'s own already-shipped idiom (mikrotik.ts:1045-1077) almost line-for-line. The genuine residual (does the drop actually fire ahead of the hotspot's own dynamic forward rules on THIS router) is correctly left to live torch verification — this is real live-router behavior, not a code-feasibility gap, and the plan already schedules it as Agent-Probe in step 16.

Open gaps: none blocking. Both CONCERNs found during this VALIDATE pass (vitest include-glob discovery gap; overstated mikrotik.spec.ts fixture-reuse claim) were fixed directly in the plan text (Touchpoints, Blast Radius, Implementation Checklist steps 1b/5) — see plan diff in this session. Carried-forward, SPEC-acknowledged residuals (not new gaps): DoH provider-IP blocklist staleness (Stage C only, escalation = deferred `:resolve` script per SPEC Out-of-Scope); `*.googleapis.com` (98-hit) abuse-surface tightening (backlog candidate, out of this plan's scope); `provisionWalledGarden()` remains uncovered beyond the new collision-property test (SPEC-acknowledged, not worsened).

What this coverage does NOT prove:
- The Fully-Automated collision-guard test proves array-level non-collision only; it does NOT prove the router actually enforces `PROBE_DENIES` correctly at runtime — only the live `curl`/torch Agent-Probe session proves that.
- The `mikrotik.spec.ts` idempotency unit test (Stage C) proves the `conn.write` call shape and no-duplicate-add logic against a MOCKED table; it does NOT prove the live RouterOS `/ip/firewall/filter action=drop` rules actually block real DoH/DoT traffic on the physical CCR1036, nor that `place-before` ordering is effective against the hotspot's own dynamic rules — only the live torch/HAR session in Stage C step 16 proves that.
- `bun run check` proves TypeScript soundness for `apps/admin` only. `packages/core` has no `check` script (pre-existing gap per `all-tests.md`, not introduced by this plan) — Stage C's new `mikrotik.ts`/`index.ts` code gets only incidental type-checking via the Vitest transform, not a full `tsc --noEmit` pass.
- No automated or hybrid gate proves GCash/Google Pay checkout UX actually completes for a real guest — only the Stage B/C live Agent-Probe sessions prove that, and those require real hardware + Maya LIVE credentials outside this VALIDATE pass's reach.
- The coverage-regression risk (enumerated `*.domain` forms silently dropping a host the old `*keyword*` substrings caught) is checked ONLY against the live HAR captured in Stage B — no static/automated check can substitute for it.
(Required until C3 is implemented — temporary C3 mitigation)

Execute-agent instructions:
- E1: Do Stage A checklist steps 1→1b→2→3→4→5→6→7 in order — step 1b (vitest include-glob widening) MUST land before step 5's spec run, or the "No test files found" failure will reappear.
- E2: Do not build or ship any Stage C code (`provisionDnsEnforcement`, firewall filter rules, DOH_PROVIDER_IPS) unless the Stage B live capture (step 10) resolves to CASE 1 exactly. CASE 2/3 → do step 17 (document, do not ship) instead.
- E3: Stage C is HIGH risk per the plan's own Blast Radius classification — the High-Risk Execution Handoff manual-first evidence pack (`process/development-protocols/orchestration.md` §High-Risk Execution Handoff) is required before marking Stage C VERIFIED, in addition to the plan's own Phase Completion Rules gate.
- E4: Honor the plan's own Public Contracts "Unchanged (hard)" list verbatim — never touch `PROBE_DENIES` content/ordering, the browser return-URL mechanism, `/ip dns allow-remote-requests=yes`, or `provisionWalledGarden()`'s signature/body.

Gate: PASS (no unresolved FAILs or CONCERNs — the 2 CONCERNs found during this VALIDATE pass were fixed directly in the plan text before this contract was written; see Touchpoints/Blast Radius/Implementation Checklist diffs)
Accepted by: N/A — Gate is PASS, not CONDITIONAL. The 2 CONCERNs found during this VALIDATE pass (vitest include-glob discovery gap; overstated mikrotik.spec.ts fixture-reuse claim) were fixed directly in the plan text before this contract was written, not accepted as open gaps.

## Inner Loop Refresh Note

Date: 29-07-26

This plan was materially revised after the Validate Contract above was written (checklist items
18–21, §Stage C Replacement Design, §Re-Scoped Acceptance Criteria — see
`payment-walled-garden-v6_REPORT_29-07-26.md` for the live diagnostic findings that drove the
revision). The original Stage C design (`provisionDnsEnforcement`, DoT/DoH block) this contract
validated is DEAD; the replacement design (checklist items 18–21) has not itself been through V1–V7.
Per `process/development-protocols/orchestration.md` §VALIDATE Gate / §Mode Detection — VALIDATE
Trigger: re-run VALIDATE (V1 will detect this note's date is newer than the contract's `date:
2026-07-29` — same calendar day, so compare by session order, not date alone; treat this note as
authoritative that a fresh PVL pass is required) before EXECUTing checklist items 18–21.

## Validate Contract — Checklist Items 18–21 Supplement (30-07-26)

Status: PASS
Date: 30-07-26
date: 2026-07-30
generated-by: outer-pvl
supersedes: 2026-07-29 (outer-pvl) — outer PVL has current evidence; this supplement covers ONLY
checklist items 18–21 (§Stage A Follow-Up Checklist Additions) — the original `## Validate
Contract` above remains the valid, unmodified record for Stage A steps 1–7 (shipped `ec24ed4`)
and Stage B (live diagnostic session, `payment-walled-garden-v6_REPORT_29-07-26.md`); its Stage C
DoT/DoH design section is superseded per §Stage C Replacement Design and was already marked DEAD
in-place, not re-litigated here.

Scope: this pass validates ONLY the replacement design driven by the 29-07-26 live diagnostic
findings — the `gcash-resolve` scheduler codification (item 18), the two Google host additions
(item 19), the walled-garden cleanup EXECUTE pass (item 20), and the AC4/AC5 re-verify (item 21).
Items 18–19 are code-provable this pass (Fully-Automated gates below); items 20–21 are fully
live-hardware-gated — no router access this VALIDATE pass, consistent with the plan's own
constraint that this bug class cannot be reproduced in sandbox.

Parallel strategy: sequential (executed in-session by a single validate agent; MEDIUM signal
score — see below — but no cross-agent coordination was needed: the infra/test/breaking/security
dimension checks and the 4 per-item feasibility checks are independent read-only analyses with no
inter-dependency, so a single sequential pass covers the same ground a parallel fan-out would).
Rationale: 7-signal score = 2/7 (S6 high-risk deploy/runtime/gateway class present; S7 blast
radius ≥5 files this pass — `walled-garden-config.ts`, `mikrotik.ts`, `index.ts`,
`mikrotik.spec.ts`, `setup-router.ts`, `docs/mikrotik/walled-garden.md`). No multi-package-3+
(S1, only 2 packages), no 3+ open design directions (S3 — mechanism is LOCKED per user decision),
not a phase program (S4).

Test gates (C3 5-column table):

| criterion id | behavior | strategy | proving test | gap-resolution |
|---|---|---|---|---|
| item-18a | New sibling scheduler-provisioning function (e.g. `provisionGcashResolveScheduler`, exact name is execute-agent's choice) idempotently adds the `gcash-resolve` `/system scheduler` item — 2nd call is a full no-op, matched by `name=gcash-resolve` | Fully-Automated | `cd packages/core && bunx vitest run src/integrations/network/mikrotik.spec.ts` — new `describe('provision<Name>Scheduler')` extending the `vi.mock('node-routeros')` fake with a growing in-memory table for `/system/scheduler`, mirroring the idempotency-test pattern already established for `provisionWalledGarden` | B — gate added by this plan's checklist (item 18) |
| item-18b | The on-event script body sent via the API matches the live-proven script text verbatim (no transcription drift) | Fully-Automated | Same spec file — string-equality assertion of the `=on-event=` param value against the exact script quoted in `payment-walled-garden-v6_REPORT_29-07-26.md` (§What Was Done, bullet 1) | B |
| item-18c | The RouterOS API transport does not corrupt the `=on-event=` script-string param (embedded `:`,`;`,`{`,`}`,newlines) | Fully-Automated (static evidence) | Confirmed this VALIDATE pass by reading `node-routeros@1.6.9`'s `Transmitter.encodeString()` (`node_modules/.bun/node-routeros@1.6.9/node_modules/node-routeros/dist/connector/Transmitter.js`) — the API wire protocol is length-prefixed word encoding, not delimiter/escaping-based, so embedded RouterOS script syntax characters are not a parsing hazard at the transport layer. Not a live-hardware unknown; resolved by source evidence. | A — proven now (static evidence, this cycle) |
| item-18d | The live RouterOS v6 script parser accepts and correctly executes an API-delivered (vs CLI-console-entered) `on-event` body — self-heals the `walled-garden ip` row on the 5-min cadence | Agent-Probe | Live on staging `10.210.54.133`: run `setup:router`, confirm `/system/scheduler/print` shows `gcash-resolve` present; since v6 has no `/system scheduler run`, exercise the resolve+upsert logic inline (per the plan's own v6 syntax note) rather than waiting a full cycle, then confirm `/ip hotspot walled-garden ip print` shows the `gcash-auto`-tagged row with a fresh IP | A — proven at the scheduled live EXECUTE stage |
| item-19a | `accounts.google.com` + `accounts.google.com.ph` added to `PAYMENT_HOSTS`; no collision with `PROBE_DENIES` | Fully-Automated | `cd apps/admin && bunx vitest run scripts/setup-router.spec.ts` (existing generic collision spec — no spec-file change needed, it iterates `PAYMENT_HOSTS` generically). Statically pre-checked this VALIDATE pass: neither new host string-matches any of the 11 `PROBE_DENIES` hosts. | A — mechanically pre-verified now; the spec's own green run at EXECUTE is the formal proof |
| item-19b | `apps/admin` typechecks + lints clean after the addition | Fully-Automated | `cd apps/admin && bun run check`; scoped `bun run lint` on touched files | A |
| item-20 | Walled-garden cleanup (dedupe + remove shadowing/dead rows) does not drop live coverage | Agent-Probe | Live on staging: coverage-regression check (confirm each codified `*.domain` rule catches the traffic the shadowing manual rule caught) BEFORE removing any manual rule, per the plan's own already-specified sequencing; document final canonical rule set in `docs/mikrotik/walled-garden.md` | A — proven at the scheduled live EXECUTE stage (router access required; none available this VALIDATE pass) |
| item-21 | AC4 (stay-captive invariant) and AC5 (browser return URL) still hold after this session's live changes | Agent-Probe | `curl -v http://connectivitycheck.gstatic.com/generate_204` from an un-granted device → non-204; same-session browser return-trip observation (`event.url.origin`/`ORIGIN`, never `TUNNEL_ORIGIN`) | A — proven at the scheduled live EXECUTE stage |

gap-resolution legend (as established by the original contract above):
- A — proven now (gate passes in this cycle / at the scheduled stage)
- B — fixed in this plan (gate added by this plan's checklist)
- C — deferred to a named later phase/plan
- D — backlog test-building stub (named residual; keep-active; continue)

Legacy line form:
- Items 18–19 code gates: Fully-automated: `cd packages/core && bunx vitest run src/integrations/network/mikrotik.spec.ts` | Fully-automated: `cd apps/admin && bunx vitest run scripts/setup-router.spec.ts` | Fully-automated: `cd apps/admin && bun run check`
- Items 18d/20/21 live gates: Agent-probe: live session on staging `10.210.54.133` — scheduler self-heal exercise, walled-garden cleanup coverage-regression check, AC4/AC5 re-confirm

Dimension findings:
- Infra fit: PASS — RouterOS v6's generic `/system/scheduler/*` menu is reachable through the existing `conn.write()` wrapper exactly like every other menu already called in this file (no new API surface at the transport level); idempotency-checking the scheduler item via a `?name=` API filter is safe by direct analogy to the already-live-proven `?dst-host=` filter in `provisionWalledGarden`'s hosts loop (Stage A's AC6 "2nd run all already present" was confirmed live). Confirmed by reading `node-routeros@1.6.9`'s `Transmitter.encodeString()`: the wire protocol is length-prefixed, not delimiter-based, so the multi-line on-event script string is not a transport-parsing hazard. Residual (item-18d, genuinely live-only): whether the ROUTER's own script parser executes an API-delivered on-event body identically to the CLI-console-entered body the report tested — this is router-side behavior, not a client-code question, and is correctly scheduled as an Agent-Probe gate, not a blocker.
- Test coverage: CONCERN — FIXED IN PLAN — items 18/19 get real Fully-Automated coverage (new `mikrotik.spec.ts` idempotency+shape test reusing the established `vi.mock('node-routeros')` growing-table pattern; the existing generic collision spec auto-covers the 2 new hosts with no spec edit). The mock-level test can only prove call-shape/idempotency against a MOCKED table, not that the live RouterOS script parser accepts the exact string unmodified — disclosed explicitly below in "What this coverage does NOT prove," matching this plan's own established precedent for router-behavior residuals (e.g. the original contract's identical treatment of `provisionDnsEnforcement`'s mock-vs-live gap).
- Breaking changes: PASS — the new sibling function is purely additive (new export, no signature change to `provisionWalledGarden`, confirmed untouched at `mikrotik.ts:1031-1115`); `PAYMENT_HOSTS` gains 2 entries (operator-visible config, not a versioned type change) — directly parallel to Stage A's already-shipped precedent.
- Security surface: CONCERN — FIXED IN PLAN — this is the first piece of ROUTER-RESIDENT AUTONOMOUS CODE this tooling has ever provisioned (a standing scheduled script that runs independently of the app every 5 minutes), a genuinely new class distinct from the existing static allow/deny/binding rows. Mitigated: the on-event body is a hardcoded, static script (no application data ever flows into it — confirmed by reading the verbatim script in the report, pure RouterOS control-flow, no secrets); idempotent add-if-absent matched by name prevents duplicate/accumulating scheduler items across re-runs; fully removable (`/system scheduler remove [find name=gcash-resolve]`), matching the plan's own D-PRUNE manual-removal philosophy. Execute-agent instruction added (E3 below): never templatize the on-event body from data structures without a RouterOS-script-injection review — it must stay hardcoded verbatim. Collision guard (D-CAUTION) re-verified statically this pass: neither `accounts.google.com` nor `accounts.google.com.ph` collides with any of the 11 `PROBE_DENIES` hosts.
- Section 18 — gcash-resolve scheduler codification: CONCERN — FIXED IN PLAN — the plan text left the provisioning mechanism as an open EXECUTE-time fork ("provision the scheduler item itself... or resolve+upsert directly at setup:router run time... pick one, documented") and used the scheduler item's two different match keys ambiguously. RESOLVED by the user's locked decision (scheduler-item provisioning, not runtime resolve+upsert) and a targeted plan-text clarification added in §Stage C Replacement Design (this VALIDATE pass) distinguishing `name=gcash-resolve` (the outer scheduler-item idempotency key) from `comment="gcash-auto"` (the inner on-event body's own walled-garden-ip upsert key, unchanged from the live-proven script). Highest-risk edit (the verbatim on-event script string) mitigated by requiring EXECUTE to copy it character-for-character from the report, plus an Agent-Probe gate (item-18d) that inline-exercises the resolve+upsert logic before trusting the 5-minute cadence (v6 has no manual scheduler-run command).
- Section 19 — Google host additions: PASS — mechanically trivial (2-line array addition, existing generic collision spec auto-covers it, no new test-infra needed); directly parallel to Stage A's already-shipped Google Pay host additions. Minor note: the docs-sync scope for the Google hosts + the `gcash-resolve` mechanism was left implicit in the existing Touchpoints table's `docs/mikrotik/walled-garden.md` row — captured explicitly as execute-agent instruction E4 below rather than editing the (already large) Touchpoints table.
- Section 20 — walled-garden cleanup EXECUTE pass: CONCERN — largely unfixable-in-plan by design (this item is entirely live-router manual work, no code touchpoint except the "document final canonical rule set" docs edit) — but not a gap in this VALIDATE pass: the plan already fully specifies the exact rows and the required coverage-regression-before-removal sequencing; correctly and honestly scoped as live-hardware-gated with no router access available this session (task instructions explicitly forbid assuming reachability to `10.210.54.133`). Captured as an Agent-Probe gate scheduled for the next live EXECUTE session, not a blocking finding.
- Section 21 — re-verify AC4/AC5: PASS — fully and honestly live-hardware-gated by the plan's own text already; no code touchpoint, low regression risk (this session's live changes never touched `PROBE_DENIES` content/ordering or the `ORIGIN`/`TUNNEL_ORIGIN` return-URL mechanism, per the report's own explicit statement).

Open gaps: none blocking. Every CONCERN found during this VALIDATE pass was either (a) fixed directly in the plan text (the mechanism/match-key clarification in §Stage C Replacement Design), (b) fixed via an added execute-agent instruction (no-templatization guardrail, verbatim-copy requirement, docs-sync note), or (c) is an inherent, honestly-disclosed live-hardware residual consistent with this plan's own established Agent-Probe pattern (item-18d's router-side script-parser behavior; items 20/21's full live-only scope) — none of these block items 18–19 from being code-complete-and-tested this EXECUTE pass, and items 20–21 were never claimed to be resolvable without router access.

What this coverage does NOT prove:
- The Fully-Automated `mikrotik.spec.ts` idempotency test (item-18a/18b) proves the `conn.write` call shape and no-duplicate-add logic against a MOCKED `/system/scheduler` table; it does NOT prove the live RouterOS v6 script parser accepts and correctly executes an API-delivered `on-event` body identically to the CLI-console-entered body the diagnostic session tested — only the live Agent-Probe session (item-18d) proves that.
- The static `node-routeros` transport-encoding evidence (item-18c) proves the wire protocol will not corrupt the script string in transit; it does NOT prove the ROUTER itself parses the received script correctly (a router-side RouterOS script-syntax question, not a transport question).
- The Fully-Automated collision-guard spec proves array-level non-collision only (item-19a); it does not prove the router actually enforces the two new host allows correctly at runtime, nor that Google's own SetSID/login flow still behaves as the diagnostic session found — only a live re-capture would prove that (not scheduled as a distinct gate here since the diagnostic session already confirmed it live on 29-07-26; regression risk is low, no related code has changed since).
- No automated or hybrid gate proves the walled-garden cleanup (item 20) preserves coverage — only the live coverage-regression check on staging proves that, and it requires router access outside this VALIDATE pass's reach.
- No automated or hybrid gate re-confirms AC4/AC5 (item 21) — only the scheduled live Agent-Probe session does, and per the report, neither was touched this session so regression risk is low but not zero.
(Required until C3 is implemented — temporary C3 mitigation)

Plan updates applied (this VALIDATE pass):

| # | What changed | Where in plan | Why |
|---|---|---|---|
| P1 | Added a "VALIDATE 30-07-26 resolution (locked — do not re-open)" clarification: mechanism = provision-the-scheduler-item (not runtime resolve+upsert); distinguished the two match keys (`name=gcash-resolve` outer scheduler idempotency vs `comment="gcash-auto"` inner walled-garden-ip upsert, unchanged from the live-proven script); added a no-templatization guardrail note | §Stage C Replacement Design, directly under the existing "`gcash-resolve` scheduler" bullet | Closes an open EXECUTE-time fork the plan text left ambiguous, and heads off a plausible match-key mix-up during EXECUTE |
| P2 | Updated `## Autonomous Goal Block`'s "Next phase" and "Validate contract" fields to reflect Stage A is shipped and the next EXECUTE target is checklist items 18–19 (20–21 live-gated) | `## Autonomous Goal Block` | Keeps the `/goal` resumption block accurate — the prior text still pointed at "Stage A step 1," which is already done |

Execute-agent instructions:
- E1: Do items 18 and 19 as code-complete, test-green EXECUTE work in this next pass — both are fully code-provable now, no live dependency for the code+unit-test portion.
- E2: Item 18's on-event script body MUST be copied character-for-character from `payment-walled-garden-v6_REPORT_29-07-26.md` (§What Was Done, bullet 1) — do not retype or paraphrase; a transcription error here only surfaces live, up to 5 minutes after `setup:router` runs.
- E3: Never templatize the on-event script body from data structures (e.g. looping over multiple hosts) without a RouterOS-script-injection review first — it must stay a hardcoded, static string. This is the security-surface mitigation for the new router-resident-scheduled-code class.
- E4: Sync `docs/mikrotik/walled-garden.md` for items 18–19 in the same EXECUTE pass: add a short "GCash CNAME resolve-script" section describing the `gcash-resolve` scheduler mechanism (mirroring the existing "reCAPTCHA is opened per-device" section's style), and add the 2 new Google hosts to §Hosts to allow. Item 20's "document the final canonical rule set" docs edit is separate and stays gated on live router access (do not attempt without it).
- E5: Items 20 and 21 require live access to staging `10.210.54.133` and are NOT part of this next code-only EXECUTE pass — do not attempt them without router access; when router access is available, follow the plan's own already-specified coverage-regression-before-removal sequencing for item 20.
- E6 (carried from the original contract, still binding): honor the plan's Public Contracts "Unchanged (hard)" list verbatim — never touch `PROBE_DENIES` content/ordering, the browser return-URL mechanism, `/ip dns allow-remote-requests=yes`, or `provisionWalledGarden()`'s signature/body.

Gate: PASS (no unresolved FAILs. Every CONCERN found was either fixed directly in the plan text this pass, fixed via an added execute-agent instruction, or is an honestly-disclosed live-hardware residual consistent with this plan's own established Agent-Probe pattern — none block items 18–19 from proceeding to EXECUTE as code-complete, test-green work; items 20–21 remain correctly and explicitly live-hardware-gated, not silently skipped.)
Accepted by: N/A — Gate is PASS, not CONDITIONAL. The CONCERNs found during this VALIDATE pass were fixed directly in the plan text / contract instructions before this contract was written, not accepted as open gaps.


## Inner Loop Refresh Note (30-07-26 — item 22 / D-PRUNE reconcile addition)

Date: 30-07-26

This plan was supplemented again after both Validate Contracts above were written: D-PRUNE (§Locked
Decisions) was revised — auto-prune of un-tagged rows stays rejected, but an opt-in, tagged-only
`--reconcile` prune is now IN SCOPE (new checklist item 22, §Stage A Follow-Up Checklist Additions),
per the user's explicit decision this session to reopen D-PRUNE rather than keep cleanup fully manual.
Touchpoints, Public Contracts, Blast Radius, and Verification Evidence were updated to cover item 22.
Neither the revised D-PRUNE decision nor item 22 has been through V1–V7 yet — per
`process/development-protocols/orchestration.md` §VALIDATE Gate / §Mode Detection — VALIDATE Trigger,
re-run VALIDATE (a fresh PVL pass) before EXECUTing item 22. Items 18–21 remain covered by the
30-07-26 items-18–21 supplement contract above and are unaffected by this addition.

## Validate Contract — Item 22 Supplement (--reconcile) (30-07-26)

Status: PASS
Date: 30-07-26
date: 2026-07-30
generated-by: outer-pvl
supersedes: 2026-07-30 (outer-pvl, Checklist Items 18–21 Supplement) — that contract remains the
valid, unmodified record for items 18–21; this is an ADDITIVE supplement covering ONLY item 22
(the `--reconcile` opt-in prune) and the revised D-PRUNE decision — neither had been through
V1–V7 before this pass. The original `## Validate Contract` and the items 18–21 supplement above
are both unaffected and remain the valid record for their own scope.

Scope: this pass validates ONLY checklist item 22 (§Stage A Follow-Up Checklist Additions) and the
revised D-PRUNE decision (§Locked Decisions) — the opt-in, tagged-only `--reconcile` prune added
30-07-26 per the user's explicit decision to reopen D-PRUNE. Items 18–21 are unaffected and remain
covered by the 30-07-26 items-18–21 supplement contract above.

Parallel strategy: sequential (single validate-agent pass; no cross-agent coordination needed —
the 4 dimension checks and the 1 per-item feasibility check are independent read-only analyses
against already-shipped code, covered in one pass).
Rationale: 7-signal score = 2/7 (S6 high-risk deploy/runtime/gateway class present — this is a
DELETE path on a payments-critical router; S7 blast radius = 5 files this item —
`setup-router.ts`, `mikrotik.ts`, `network/index.ts`, `mikrotik.spec.ts`,
`docs/mikrotik/walled-garden.md`). No multi-package-3+ (S1, still 2 packages), no 3+ open design
directions (S3 — mechanism is LOCKED per the user's D-PRUNE revision), not a phase program (S4).

Test gates (C3 5-column table):

| criterion id | behavior | strategy | proving test | gap-resolution |
|---|---|---|---|---|
| item-22a | Default `setup:router` run (no `--reconcile`) never removes any walled-garden row | Fully-Automated | `cd packages/core && bunx vitest run src/integrations/network/mikrotik.spec.ts` — new `describe('reconcile<Name>')` case (a), extending the `vi.mock('node-routeros')` fake with a growing in-memory table for `/ip/hotspot/walled-garden` + `/ip/hotspot/walled-garden/ip`, mirroring the pattern established for item 18's scheduler test | B — gate added by this plan's checklist (item 22) |
| item-22b | `--reconcile` removes a `veent-admin`-tagged, `action=allow` row whose host is absent from the desired set | Fully-Automated | Same spec file, case (b) | B |
| item-22c | `--reconcile` leaves an un-tagged row AND the differently-tagged `gcash-auto` IP row untouched even when their value is absent from the desired set | Fully-Automated | Same spec file, case (c) — exact-equality tag match, not substring | B |
| item-22d | `--reconcile --dry-run` removes nothing (log-only) | Fully-Automated | Same spec file, case (d) | B |
| item-22e (VALIDATE 30-07-26 finding) | `--reconcile` NEVER removes an `action=deny` row (a `PROBE_DENIES` row), even though `provisionWalledGarden` tags deny rows with the SAME comment tag as host-allow rows on the SAME menu | Fully-Automated | Same spec file, case (e) — proves the action-scoping fix added to the plan text this VALIDATE pass | B — gate added THIS pass, closing a real security-surface gap found during VALIDATE |
| item-22f | `apps/admin` typechecks + lints clean after the `--reconcile` CLI wiring; `packages/core` typechecks via the Vitest transform (no full `tsc` — pre-existing gap, unchanged) | Fully-Automated | `cd apps/admin && bun run check`; scoped `bun run lint` on touched files | A |
| item-22g | Live `--reconcile --dry-run` on staging prints the expected removal list; live `--reconcile` removes only the expected veent-tagged, action=allow rows; `PROBE_DENIES` rows and the `gcash-auto` row remain present and functional after | Agent-Probe | Live session on staging `10.210.54.133`: run `setup:router --reconcile --dry-run` first, confirm the printed list, then run `setup:router --reconcile` for real; re-run the AC4 negative check (`curl generate_204` → non-204) and confirm `/ip hotspot walled-garden ip print` still shows the `gcash-auto` row | A — proven at the scheduled live EXECUTE stage (router access required; none available this VALIDATE pass) |

gap-resolution legend (as established by the original contract above):
- A — proven now (gate passes in this cycle / at the scheduled stage)
- B — fixed in this plan (gate added by this plan's checklist)
- C — deferred to a named later phase/plan
- D — backlog test-building stub (named residual; keep-active; continue)

Legacy line form:
- Item 22 code gates: Fully-automated: `cd packages/core && bunx vitest run src/integrations/network/mikrotik.spec.ts` (5 scoping cases a–e) | Fully-automated: `cd apps/admin && bun run check`
- Item 22 live gate: Agent-probe: live `--reconcile --dry-run` then `--reconcile` confirmation session on staging `10.210.54.133`

Dimension findings:
- Infra fit: PASS — the print-then-index removal pattern this item needs is already proven live in this exact codebase: `cutConnectionsForIps` (`mikrotik.ts:409-430`) does `conn.write('/ip/firewall/connection/print', [])` then loops `.id` and calls `conn.write('/ip/firewall/connection/remove', [\`=.id=\${id}\`])` per row — directly transferable to `/ip/hotspot/walled-garden/print` and `/ip/hotspot/walled-garden/ip/print`. The existing `?dst-host=`/`?dst-address=` query-filter usage inside `provisionWalledGarden`'s own `print` calls (already live-proven, AC6 confirmed) shows v6's `find where` limitation the plan flags is specific to composite filter-remove clauses, not `print`'s simple `?param=` filter — consistent with, not contradicting, the plan's own v6 syntax note. No new library/version blocker; no container/infra conflict.
- Test coverage: CONCERN — FIXED IN PLAN — the plan's original 4-case test list (a–d) did not cover the mixed-menu action-scoping risk (see Security surface below); added test case (e) directly to the plan text this pass, alongside the implementation requirement it proves. With case (e) added, the 5 mocked cases now exhaustively cover the decision matrix (tagged-allow-in-set / tagged-allow-out-of-set / un-tagged / gcash-auto-tagged / tagged-deny) crossed with the two flags (`--reconcile` on/off, `--dry-run` on/off). Reusing the `vi.mock('node-routeros')` growing-table convention is mechanically sound (already proven for item 18's scheduler test this session); no test-infra blocker — the Stage A step 1b include-glob widening already covers `apps/admin/scripts/**`, and `packages/core`'s existing Vitest config already covers `mikrotik.spec.ts`.
- Breaking changes: PASS — the new sibling function and the new `--reconcile` CLI flag are purely additive; `provisionWalledGarden()`'s signature/body is untouched by any item-22 touchpoint (confirmed unchanged at `mikrotik.ts:1031-1115`); confirmed the pre-existing additive `provisionWalledGarden` call in `setup-router.ts` (lines 120-134) has no conditional wrapping proposed around it anywhere in the plan — the default (no-flag) run stays byte-for-byte unchanged, preserving D-PRUNE's revised guarantee.
- Security surface: CONCERN — FIXED IN PLAN — this is a genuine DELETE path on a payments-critical router, so it earned the closest read. Found and fixed two real risks: (1) `provisionWalledGarden()` tags PROBE_DENIES rows (`action=deny`) and host-allow rows (`action=allow`) with the SAME comment tag on the SAME `/ip/hotspot/walled-garden` menu (confirmed: `mikrotik.ts:1035`, one `tag` const shared across the denies/hosts/ips loops) — a tag-only-match reconcile implementation, as the plan text originally specified it, would treat PROBE_DENIES rows as removal candidates and delete them, silently reopening the exact captive-probe "Connected" flap the plan's own D1/D-CAUTION machinery exists to prevent, and violating the plan's own Public Contracts "Unchanged (hard)" guarantee for `PROBE_DENIES`. Fixed by adding an explicit action-scoping requirement (`action=allow` rows only) + test case (e) to the plan text this pass. (2) the `veent-admin` tag string is separately reused (with a `:<epochMs>` suffix, as `ADMIN_BYPASS_TAG`) for an unrelated resource — admin-device bypass rows on `/ip/hotspot/ip-binding` (confirmed: `mikrotik.ts:102`) — not a live bug (different RouterOS menu path, different function, no code path crosses them), but the tag-string overload is exactly the kind of thing a copy-paste implementation could get wrong; added an explicit menu-scoping guardrail to the plan text as a defense-in-depth measure. Otherwise: tag-scoped removal cannot touch un-tagged rows by construction (verified no other code in the repo writes the bare `veent-admin` comment to a walled-garden row); exact-equality tag matching (already correctly specified) naturally excludes the differently-tagged `gcash-auto` row; `--dry-run` gives live inspectability before any real removal.
- Section — Item 22 (`--reconcile` opt-in prune): PASS (after plan fix) — mechanical feasibility confirmed: the argv `Set` pattern in `setup-router.ts` (`--dry-run`/`--restrict-api`/`--disable-plain-api`) has a clear, uncollided insertion point for `--reconcile`; `mikrotik.ts` has a clear sibling-function insertion point after `provisionWalledGarden` (~line 1115) per D3; `network/index.ts`'s re-export block has a clear, uncollided extension point mirroring `provisionWalledGarden`'s existing export list. Gap found and disposed as an execute-agent instruction (not a plan-text edit — implementation detail, no design change): `DRY_RUN` is currently wired ONLY into the `--restrict-api` branch, not the pre-existing additive `provisionWalledGarden` call — execute-agent must thread `DRY_RUN` into ONLY the new reconcile call, never widen its scope to gate the pre-existing additive path (which must stay unconditional, matching D-PRUNE's byte-for-byte-unchanged-default guarantee even under a bare `--dry-run` with no `--reconcile`). Highest-risk edit: the new reconcile function's row-removal loop in `mikrotik.ts`. Mitigated by: tag-scoped AND (after this pass's fix) action-scoped removal, dry-run-inspectability, full mocked coverage of the scoping logic (5 cases), and a scheduled live Agent-Probe confirmation before item 22 can be claimed proven on real hardware. Sequencing: execute-agent should implement + unit-test the reconcile function before wiring the CLI flag, and always run `--reconcile --dry-run` on staging before ever running bare `--reconcile` for real (already specified in the plan's own "Live confirmation" bullet).

Open gaps: none blocking. Both CONCERNs found during this VALIDATE pass (missing action-scoping test case; the mixed-tag/mixed-menu security-surface risk it protects against) were fixed directly in the plan text before this contract was written (see Plan updates applied below) — not accepted as open gaps. The DRY_RUN-wiring-scope note and the ip-binding menu-scoping note were captured as execute-agent instructions rather than plan-text edits since they are implementation-level clarifications with no design change. Carried-forward, honestly-disclosed residual (not new, not worsened): item-22g's live confirmation is fully live-hardware-gated with no router access this VALIDATE pass, consistent with the plan's own established pattern for every other live-only gate in this plan (items 18d/20/21, Stage B/C).

What this coverage does NOT prove:
- The Fully-Automated `mikrotik.spec.ts` scoping tests (item-22a–e) prove the `conn.write` call shape, the desired-set comparison logic, and the action/tag-scoping guards against a MOCKED table; they do NOT prove the live RouterOS v6 `/ip/hotspot/walled-garden` menu behaves identically under real `print`/`remove` calls at scale (e.g. with the live router's full ~48-row mixed manual+codified rule set) — only the live Agent-Probe session (item-22g) proves that.
- The action-scoping fix (item-22e) proves the NEW reconcile function itself will not remove a deny row in the mocked test; it does NOT retroactively audit whether some OTHER future code path could ever write a differently-scoped removal against the same menu — this is a design property of the one new function this item adds, not a repo-wide guarantee.
- No automated or hybrid gate proves the live `--reconcile` run against the router's ACTUAL current ~48-row state (with its known duplicate/shadowing manual rows, per item 20's cleanup list) behaves as expected — only the scheduled live `--reconcile --dry-run` inspection (item-22g) proves that, and it requires router access outside this VALIDATE pass's reach.
- `bun run check` proves TypeScript soundness for `apps/admin` only (pre-existing gap, unchanged — see the original contract's equivalent note for `packages/core`).
(Required until C3 is implemented — temporary C3 mitigation)

Plan updates applied (this VALIDATE pass):

| # | What changed | Where in plan | Why |
|---|---|---|---|
| P1 | Added a "VALIDATE 30-07-26 finding (action-scoping — REQUIRED...)" bullet: reconcile must scope host-layer removal to `action=allow` rows only (never `action=deny`/PROBE_DENIES rows, which share the same tag on the same menu); must reuse the exact same desired-set arrays already computed for the just-completed `provisionWalledGarden` call; must use exact-equality tag matching; must never target the `/ip/hotspot/ip-binding` menu despite the `veent-admin` tag string being reused there for an unrelated purpose (`ADMIN_BYPASS_TAG`) | §Stage A Follow-Up Checklist Additions, item 22, inserted between the v6-syntax-constraint bullet and the Test gate bullet | Closes a real security-surface gap: without this, a literal reading of the plan's original tag-only-match spec would delete the `PROBE_DENIES` rows on the first `--reconcile` run, reopening the captive-probe "Connected" flap and violating the plan's own Public Contracts guarantee |
| P2 | Added test case (e) to item 22's Test gate bullet: `--reconcile` never removes an `action=deny` row | §Stage A Follow-Up Checklist Additions, item 22, Test gate bullet | Makes the action-scoping fix (P1) machine-provable, not just documented |
| P3 | Updated the item-22 row in §Verification Evidence to mention the deny-row guard | §Verification Evidence | Keeps the summary table consistent with the checklist-level fix |

Execute-agent instructions:
- E1: Implement item 22's reconcile function scoped to `action=allow` rows only on the host-layer menu (per P1 above) — this is a required correctness fix, not optional hardening.
- E2: Thread `DRY_RUN` into ONLY the new `--reconcile` call path. Do NOT widen `DRY_RUN`'s scope to gate the pre-existing additive `provisionWalledGarden` call in `setup-router.ts` — that call must remain unconditional so the default (no-flag) run, including a bare `--dry-run` with no `--reconcile`, stays byte-for-byte unchanged (D-PRUNE's revised guarantee).
- E3: Reconcile's `conn.write` calls must target ONLY `/ip/hotspot/walled-garden` and `/ip/hotspot/walled-garden/ip` — never `/ip/hotspot/ip-binding`, despite the `veent-admin` tag string being reused there (as `ADMIN_BYPASS_TAG`, with a `:<epochMs>` suffix) for an unrelated admin-device-bypass purpose.
- E4: Reconcile must reuse the exact `[...hosts]`/`[...ips]` arrays `setup-router.ts` already computed for the current run's `provisionWalledGarden` call as its desired set — do not recompute a second desired set.
- E5 (carried forward, still binding): honor the plan's Public Contracts "Unchanged (hard)" list verbatim — never touch `PROBE_DENIES` content/ordering, the browser return-URL mechanism, `/ip dns allow-remote-requests=yes`, or `provisionWalledGarden()`'s signature/body.

Gate: PASS (no unresolved FAILs. Both CONCERNs found this pass — the missing action-scoping test
case and the security-surface risk it guards against — were fixed directly in the plan text before
this contract was written, not left as open gaps. Item 22's live confirmation remains correctly and
explicitly live-hardware-gated, matching this plan's own established pattern for every other
live-only gate.)
Accepted by: N/A — Gate is PASS, not CONDITIONAL. The CONCERNs found during this VALIDATE pass were
fixed directly in the plan text / execute-agent instructions before this contract was written, not
accepted as open gaps.

## Autonomous Goal Block

SESSION GOAL: Fix RouterOS v6 GCash/Google Pay walled-garden payment-checkout failures, diagnostic-first (ship the proven-safe host codification now; only build the whole-network DoH/DoT block if a live capture proves it's needed).
Charter + umbrella plan: N/A — single plan (not a phase program).
Autonomy: Standard RIPER-5 autonomy — EXECUTE requires explicit "ENTER EXECUTE MODE"; Stage C requires the High-Risk Execution Handoff manual-first evidence pack before being marked VERIFIED (auto-stop rule per `process/development-protocols/orchestration.md` §High-Risk Execution Handoff — do not imply Stage C is proven without it).
Hard stop conditions / safety constraints:
- Never touch `PROBE_DENIES` content or its "above the allows" ordering (prevents the captive "Connected" OS flap regression) — item 22's `--reconcile` must be action-scoped (`action=allow` only) to honor this, per the item-22 supplement contract below.
- Never point the browser return URL (`successUrl`/`cancelUrl`) at `TUNNEL_ORIGIN`/`webhookOrigin` — always `event.url.origin`/`ORIGIN` (durable rule from `maya-return-url-revert_23-07-26`).
- Do not build or ship Stage C (`provisionDnsEnforcement`, DoT/DoH firewall block) unless the Stage B live capture resolves to CASE 1 exactly (gcash.com contacted AND DoH-hidden) — CASE 2/3 documents instead of shipping.
- Do not mark Stage C VERIFIED without a real Maya-LIVE checkout capture on staging hardware (`10.210.54.133`) plus the High-Risk evidence pack — sandbox cannot reproduce this bug class.
- Do not run `--reconcile` (non-dry-run) on staging before `--reconcile --dry-run` has been inspected first (item-22g).
Next phase: EXECUTE — `process/general-plans/active/payment-walled-garden-v6_29-07-26/payment-walled-garden-v6_PLAN_29-07-26.md`, starting at checklist item 18 (gcash-resolve scheduler codification) + item 19 (Google host additions) + item 22 (`--reconcile` opt-in prune) — all three are code-provable this next EXECUTE pass. Stage A (steps 1–7) is already shipped (`ec24ed4`); items 20–21 and item 22's live confirmation (item-22g) remain live-hardware-gated.
Validate contract: inline in plan (`## Validate Contract` section + `## Validate Contract — Checklist Items 18–21 Supplement (30-07-26)` + `## Validate Contract — Item 22 Supplement (--reconcile) (30-07-26)`, this file).

## Closeout (30-07-26) — items 18/19/20/21/22 resolved

Session `bde53d2` (items 18/19/22) + `252d748` (item 20 superseded) closed out the remainder of
this plan's checklist:

- **Item 18 — `gcash-resolve` scheduler codification.** DONE. `provisionGcashResolveScheduler()`
  shipped in `bde53d2`: idempotent `/system scheduler` item (`name=gcash-resolve`), on-event body
  hardcoded verbatim from the 29-07-26 live diagnostic. Live-verified this session: scheduler
  run-count still incrementing (231 at last check), `gcash-auto` row self-healing.
- **Item 19 — Google host additions.** DONE. `accounts.google.com` + `accounts.google.com.ph`
  added to `PAYMENT_HOSTS` in `bde53d2`. D-CAUTION collision guard re-run green.
- **Item 20 — walled-garden cleanup EXECUTE pass.** SUPERSEDED by `walled-garden-canonical`
  (`252d748`, plan folder `process/general-plans/active/walled-garden-canonical_30-07-26/`, now
  archived to `completed/`). That plan's hard-reset + rebuild-from-code achieved the same outcome
  by construction — a full wipe means no shadowing/duplicate/dead manual rule can survive — which is
  a stronger result than the originally-scoped manual deletion pass. Its own SPEC explicitly states
  this supersession (`walled-garden-canonical_SPEC_30-07-26.md` §Constraints: "This task supersedes
  item 20 ... That item is considered absorbed here"). Do not re-attempt item 20's manual cleanup —
  it is closed.
- **Item 21 — re-verify AC4/AC5 (probe-flap invariant + browser return URL).** DONE — live-exercised
  during the `walled-garden-canonical` rebuild verification (same session): the flap-fix
  `PROBE_DENIES` content/ordering was carried through the rebuild unchanged and the rebuild's live
  verification pass included the probe-deny invariant; the browser-return-URL mechanism was not
  touched by either session's diff and remains on `event.url.origin`/`ORIGIN` per the durable rule.
- **Item 22 — opt-in `--reconcile` prune.** DONE + live-verified. `reconcileWalledGarden()` +
  `setup:router --reconcile` shipped in `bde53d2`, then exercised live on staging by
  `walled-garden-canonical`'s family-prefix rework (`252d748`): `--reconcile --dry-run` → real run
  removed exactly 3 drifted rows; all safety invariants held (no `PROBE_DENIES` row touched, no
  un-tagged operator row touched, `gcash-auto` row untouched).

**Acceptance criteria final status:**
- AC1/AC2 (GCash root cause fixed, checkout completes captive) — **met**, user-confirmed live
  (`gcash-resolve` scheduler fix, 29-07-26 report + this session's rebuild).
- AC3 (Google Pay checkout completes captive) — **downgraded to documented known-limitation**
  (`OR_BIBED_15` WebView policy block, unfixable by network/DNS config; see §Re-Scoped Acceptance
  Criteria above) — not a gap, a scope correction accepted this plan.
- AC4 (stay-captive invariant / `PROBE_DENIES` holds) — **met**, item 21 above.
- AC5 (browser return URL unaffected) — **met**, item 21 above.
- AC6 (idempotent provisioning) — **met**, proven by the canonical rebuild's clean
  `--reconcile --dry-run` result this session.
- AC7 (non-payment plain DNS unaffected) — **met, trivially** — the Stage C DoT/DoH block was never
  shipped (CASE 2/3 outcome; superseded by the CNAME/`:resolve` root-cause fix instead).

**Archive-vs-keep recommendation: ARCHIVE.** Every checklist item (1-22) is closed and every
acceptance criterion is either met or explicitly downgraded to a documented known-limitation with no
further action required by this plan. No genuine remainder exists inside this plan's scope. The
QRPH / curated e-wallet reconciliation work the user is continuing (Track 1) is a SEPARATE,
ongoing effort — it was never part of this plan's SPEC (explicitly out-of-scope: "no QRPh-own-bank-app
path") and has no artifact under this plan folder, so archiving this plan does not lose track of it.
Execute start: Stage A fully-auto commands — `cd apps/admin && bunx vitest run scripts/setup-router.spec.ts` + `cd apps/admin && bun run check`; items 18/19/22 fully-auto commands — `cd packages/core && bunx vitest run src/integrations/network/mikrotik.spec.ts`; Stage B/C + items 20/21/22g e2e/probe scenario — live session on staging `10.210.54.133`; high-risk pack: yes (Stage C only, before VERIFIED).
