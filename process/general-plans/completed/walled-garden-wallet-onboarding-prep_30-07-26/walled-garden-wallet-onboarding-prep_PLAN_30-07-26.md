---
name: plan:walled-garden-wallet-onboarding-prep
description: 'Behavior-neutral PAYMENT_HOSTS regroup + two new walled-garden.md doc sections (recon procedure + curated UNVERIFIED candidate table). No new domains whitelisted.'
date: 30-07-26
---

# Walled-Garden Wallet-Onboarding Prep — SIMPLE Plan

**TL;DR:** Two deliverables — (1) regroup `PAYMENT_HOSTS` into 3 per-wallet/gateway comment blocks AND
**deliberately remove 6 hosts** vs current HEAD: the 4 Google-Pay-flow hosts (abandoned — Android
WebView `OR_BIBED_15` blocks it captive) + `*.paymongo.com` + `*.xendit.co` (proven dead — no
integration uses them; live GCash redirect is via Maya's hosted checkout). Keep `*.googleapis.com`
(98 live checkout hits, NOT Google Pay). (2) Add a "how to add a wallet/bank" recon procedure +
curated UNVERIFIED candidate table (9 apps incl. 4 big banks) + Google-Pay KNOWN-DEAD note to
`docs/mikrotik/walled-garden.md`. NO new domain whitelisted. Regroup neutral; the 6 removals are
documented deliberate changes. Collision guard spec stays green.

## Goal

Make onboarding a new e-wallet/bank fast and safe by codifying the ₱0 recon protocol and a curated
candidate shortlist, and by giving `PAYMENT_HOSTS` readable per-wallet structure — without changing
any provisioning behavior.

## Touchpoints

- `apps/admin/scripts/walled-garden-config.ts` — `PAYMENT_HOSTS` (line 41): reorder into 3 blocks +
  headers (the Google-Pay block is dropped); preserve all existing load-bearing per-line comments.
- `docs/mikrotik/walled-garden.md` — add two new sections.

Read-for-context only (NOT edited): `apps/admin/scripts/setup-router.ts`,
`apps/admin/scripts/setup-router.spec.ts`, `packages/core/src/integrations/network/mikrotik.ts`
(`provisionGcashResolveScheduler`, `reconcileWalledGarden`), `process/context/all-context.md`.

## Public Contracts

`PAYMENT_HOSTS` remains a `string[]`. The new set = current-HEAD set MINUS exactly 6 hosts:
`pay.google.com`, `payments.google.com`, `accounts.google.com`, `accounts.google.com.ph`,
`*.paymongo.com`, `*.xendit.co` — nothing else changes; `*.googleapis.com` stays.
`provisionWalledGarden` / `reconcileWalledGarden` / `provisionGcashResolveScheduler` signatures
untouched. `PROBE_DENIES` untouched. `veent-admin:<group>` tag model untouched.

**Live-router note:** a subsequent `setup:router --reconcile` will now prune those 6 tagged
`veent-admin:payment` allow rows from the live garden — intended cleanup of abandoned/dead options,
not a regression.

## Blast Radius

2 files, 1 package (`apps/admin`) + 1 docs file. Risk class: **low** — comment + ordering regroup
plus a deliberate removal of 6 allow hosts (4 abandoned Google Pay + 2 unused PayMongo/Xendit);
additive prose in docs. No schema/auth/API/billing/migration surface. Google Pay is proven
non-functional captive (WebView `OR_BIBED_15`); PayMongo/Xendit have no integration code (only config

- one `seed.ts` comment) and the live GCash redirect goes via Maya's hosted checkout — so no working
  path is broken.

## Implementation Checklist

### Deliverable 1 — regroup `PAYMENT_HOSTS` (`apps/admin/scripts/walled-garden-config.ts`)

1. Replace the `PAYMENT_HOSTS` array body (lines 41–82) with the retained hosts in exactly 3 blocks.
   **REMOVE exactly these 6 hosts and their now-orphaned per-line comments:** `pay.google.com`,
   `payments.google.com`, `accounts.google.com`, `accounts.google.com.ph`, `*.paymongo.com`,
   `*.xendit.co`. Remove the now-empty "Generic gateways" block entirely. All OTHER host strings stay
   byte-identical; none added. Final layout (exactly 3 groups):
   - `// Maya / PayMaya` — `maya.ph`, `*.maya.ph`, `paymaya.com`, `*.paymaya.com`
   - `// GCash + Alipay cashier + Mynt/G-Xchange infra` — `gcash.com`, `*.gcash.com`, `alipay.com`,
     `*.alipay.com`, `*.alipayobjects.com`, `*.alicdn.com`, `*.antgroup.com`, `*.mynt.xyz`,
     `*.g-xchange.com`
   - `// Google APIs (reCAPTCHA/assets — NOT Google Pay)` — `*.googleapis.com`
2. Fix the GCash comment (~line 46): "Maya/PayMongo redirect the buyer to GCash" →
   "Maya's hosted checkout redirects the buyer to GCash" (drop `/PayMongo` — not in the flow).
3. KEEP `*.googleapis.com` and its "KEEP — 98 hits, do NOT silently drop" rationale comment verbatim.
   Preserve the bare `alipay.com` "`*.` does not match its bare parent" note within the GCash block.
   The "Google Pay + login" and "Generic gateways" rationale comments are removed with their hosts.
4. Add a one-line comment (Google-APIs block header or removal site) noting Google Pay hosts were
   deliberately dropped — abandoned (WebView `OR_BIBED_15` blocks it captive).
5. Do NOT touch the top-of-file docblock (lines 12–40) or `PROBE_DENIES` (lines 84+).

### Deliverable 2 — two doc sections (`docs/mikrotik/walled-garden.md`)

4. Add section **"How to add a wallet/bank (₱0 recon protocol)"** after the `veent-admin:payment`
   section (after line 255, before the `veent-admin:portal` heading). Content:
   - Steps: `/ip dns cache flush` → open the app on the captive device (pull-to-refresh dashboard +
     walk the QRPH/pay flow to the confirm screen, do NOT confirm) → `/ip dns cache print` → classify
     each NEW domain.
   - Classification rule: **direct-resolve → plain `dst-host` entry in `PAYMENT_HOSTS`**;
     **CNAMEs-to-CDN → needs a `:resolve` scheduler like `gcash-resolve`** (reference
     `provisionGcashResolveScheduler`) → add → re-run `setup:router` → retest.
   - Two hard rules: (a) `*.domain` never matches its bare parent — add both when a flow needs the
     bare host; (b) do NOT add broad CDN allows (`*.google.com`, `*.gstatic.com`, `fonts.*`,
     `googletagmanager`, `cdnjs`) — they re-open the captive-probe flap that `PROBE_DENIES` fixes.
   - Durable caveat: **domain open ≠ app works** (cert-pinning / captive-detection) — each candidate
     needs a live pass/fail, not just a resolving rule.
5. Add section **"Candidate wallets/banks (UNVERIFIED — recon required)"** after section 4. A curated
   table (NOT all 24) sourced from `docs/external_research/Top 20+ Philippine Banking App API
Domains.md`:

   | App           | Candidate root(s)                                       | Status     |
   | ------------- | ------------------------------------------------------- | ---------- |
   | GoTyme        | `*.gotyme.com.ph`                                       | UNVERIFIED |
   | SeaBank       | `*.seabank.ph`, `*.seabank.com.ph`                      | UNVERIFIED |
   | GrabPay       | `*.grab.com`                                            | UNVERIFIED |
   | ShopeePay     | `*.shopeepay.ph`, `*.shopee.ph`                         | UNVERIFIED |
   | Coins.ph      | `*.coins.ph`                                            | UNVERIFIED |
   | BDO           | `*.bdo.com.ph`                                          | UNVERIFIED |
   | BPI           | `*.bpi.com.ph`                                          | UNVERIFIED |
   | Landbank      | `*.landbank.com`, `*.landbank.com.ph`, `lbpiaccess.com` | UNVERIFIED |
   | Security Bank | `*.securitybank.com`, `*.securitybank.com.ph`           | UNVERIFIED |

   Each row note: "candidate root — run the recon protocol above; classify direct vs CNAME-to-CDN
   before adding." Add a note on the 4 bank rows: banks support QR Ph but are especially likely to
   cert-pin / detect captive networks and refuse even with domains open — live pass/fail required per
   app. Updated out-of-scope note: only the OTHER traditional banks (Metrobank, RCBC, PNB, China
   Bank, EastWest, AUB, PSBank, etc.) remain out of scope; BDO/BPI/Landbank/Security Bank are now
   curated candidates.

6. Add a **Google Pay = KNOWN-DEAD** note (in the recon section or near the candidate table): Google
   Pay is excluded on purpose — Android WebView blocks it (`OR_BIBED_15`), so it can never work in
   the captive CNA regardless of whitelisting. This is a WebView limitation, NOT a walled-garden gap.
   Do NOT list Google Pay as a candidate.

### Verify

6. `bunx vitest run apps/admin/scripts/setup-router.spec.ts` — collision guard green.
7. `bun run --filter radius-admin check` scoped to the touched file — clean (no new TS errors from
   the edit).
8. Confirm the sorted host set post-edit = current-HEAD sorted set MINUS exactly the 6 hosts
   (4 Google-Pay + `*.paymongo.com` + `*.xendit.co`) — nothing else added or removed.

## Verification Evidence

| Gate / Scenario                                                            | Strategy                    | Proves SPEC criterion                                                                            |
| -------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------ |
| `bunx vitest run apps/admin/scripts/setup-router.spec.ts` exits 0          | Fully-Automated             | Collision guard preserved (`PAYMENT_HOSTS ∩ PROBE_DENIES = ∅`); removal can't create a collision |
| Sorted host set post = HEAD set MINUS the 6 hosts, nothing else            | Fully-Automated (grep/sort) | Regroup neutral + only the intended 6 removed                                                    |
| `bun run --filter radius-admin check` clean on touched file                | Fully-Automated             | No TS regression from the edit                                                                   |
| Doc sections render with recon steps + candidate table + out-of-scope note | Agent-Probe (read)          | Deliverable 2 completeness                                                                       |

## Test Infra Improvement Notes

(none identified yet)

## Resume and Execution Handoff

1. Selected plan: `process/general-plans/completed/walled-garden-wallet-onboarding-prep_30-07-26/walled-garden-wallet-onboarding-prep_PLAN_30-07-26.md` (archived).
2. Last completed step: EXECUTE done, UPDATE PROCESS complete — plan archived.
3. Validate-contract status: `Gate: PASS`; all 3 test gates re-run green in UPDATE PROCESS (VERIFIED).
4. Context loaded: `walled-garden-config.ts`, `setup-router.spec.ts`, `walled-garden.md`, research doc, `all-context.md` MikroTik section.
5. Next step for fresh agent: none — session complete. See the colocated `_REPORT_30-07-26.md`.

## Validate Contract

generated-by: outer-pvl
date: 2026-07-30
Gate: PASS

### Change framing (deliberate removal, not pure neutrality)

The regroup of RETAINED hosts is behavior-neutral: `PAYMENT_HOSTS` are all `action=allow`,
provisioned as one tagged group (`veent-admin:payment`, call 2); first-match ordering only decides
allow-vs-deny for the same host, so reordering distinct allow hosts is neutral. SEPARATELY, **6 hosts
are deliberately removed**: 4 Google-Pay-flow hosts (`pay.google.com`, `payments.google.com`,
`accounts.google.com`, `accounts.google.com.ph`) — Google Pay abandoned (WebView `OR_BIBED_15` blocks
it captive) — plus `*.paymongo.com` and `*.xendit.co` (proven dead: only config + one `seed.ts`
comment reference them, no integration code; live GCash redirect is via Maya's hosted checkout). The
new sorted host set = current-HEAD set MINUS exactly those 6; `*.googleapis.com` retained (98 live
checkout hits, NOT Google Pay). A later `setup:router --reconcile` prunes those 6 tagged allow rows —
intended cleanup, not a regression.

### Test gates

| Gate                    | Command                                                   | Expected                                                     |
| ----------------------- | --------------------------------------------------------- | ------------------------------------------------------------ |
| Collision guard         | `bunx vitest run apps/admin/scripts/setup-router.spec.ts` | 1 passed (baseline green; removals can't create a collision) |
| TS check                | `bun run --filter radius-admin check`                     | no NEW errors from touched file                              |
| Deliberate-removal diff | Compare sorted host set of `PAYMENT_HOSTS` pre/post       | post = HEAD MINUS exactly the 6 hosts, nothing else          |

### Execute-agent instructions

- E1: Remove EXACTLY these 6 hosts + their orphaned comments: `pay.google.com`,
  `payments.google.com`, `accounts.google.com`, `accounts.google.com.ph`, `*.paymongo.com`,
  `*.xendit.co`. Remove the now-empty "Generic gateways" block. Every OTHER host string stays
  byte-identical; none added. Final = exactly 3 blocks (Maya / GCash+Alipay / Google APIs).
- E2: Fix the GCash comment (~line 46): "Maya/PayMongo redirect" → "Maya's hosted checkout redirects"
  (drop `/PayMongo`).
- E3: KEEP `*.googleapis.com` and its "KEEP — 98 hits, do NOT silently drop" comment verbatim.
  Preserve the bare-`alipay.com` "`*.` does not match its bare parent" comment. Block header
  `// Google APIs (reCAPTCHA/assets — NOT Google Pay)`; add a one-liner that Google Pay hosts were
  dropped (abandoned, WebView `OR_BIBED_15`).
- E4: Do NOT touch the top docblock, `PROBE_DENIES`, provisioning signatures, the tag model, or
  `docs/mikrotik/login.html`.
- E5: Doc must add a Google-Pay KNOWN-DEAD note; extend candidate table with BDO/BPI/Landbank/Security
  Bank (all UNVERIFIED, with the cert-pin/captive-detect caveat) and update the out-of-scope note.
  Candidates go ONLY into the doc table, never into `PAYMENT_HOSTS`.

### Known gaps

None.
