---
name: report:payment-walled-garden-v6-live-diagnostic-29-07-26
description: 'Live router diagnostic session (Stage B) for the RouterOS v6 payment walled-garden fix — GCash root cause found (CNAME-to-Akamai, not DoH), Google Pay reachability fixed but hard-blocked by WebView policy, Android captive-icon non-issue overturned, walled-garden cleanup debt catalogued'
date: 29-07-26
metadata:
  node_type: memory
  type: report
  feature: general-plans
  phase: 'stage-b-live-diagnostic'
---

# Payment Walled-Garden Fix (RouterOS v6) — Live Diagnostic Session Report

phase: stage-b-live-diagnostic
date: 2026-07-29
status: COMPLETE_WITH_GAPS
feature: general-plans
plan: process/general-plans/active/payment-walled-garden-v6_29-07-26/payment-walled-garden-v6_PLAN_29-07-26.md

## What Was Done

This session ran the Stage B live-router diagnostic capture called for by the plan (steps 8–12),
on the staging router (MikroTik_Wifi_Project, CCR1036-8G-2S+, RouterOS 6.49.18) plus additional
live investigation the plan did not originally anticipate (the Android captive-icon question, and
Google Pay reachability once GCash's root cause turned out not to be DoH-related).

1. **GCash / QRPH root cause found — and it invalidates the plan's Stage C DoH premise.**
   `payments.gcash.com` CNAMEs to Akamai (`cac_payments.gcash.com.edgekey.net` →
   `e9816.cj.akamaiedge.net`). RouterOS v6 `dst-host` walled-garden matching cannot follow a CNAME
   chain to a wildcard like `*.gcash.com` — so no dynamic IP allow is ever created, regardless of
   whether the query used encrypted or plain DNS. The router was never failing to _see_ the DNS
   query (the plan's DoH-hidden hypothesis); it was failing to _match_ a CNAME'd host. This means
   the whole-network DoT/DoH block designed in Stage C would not have fixed GCash at all — the
   answer to the plan's own branch question (Q1: contacted? yes. Q2: DoH-hidden? **no — the real
   problem is CNAME, not DoH**) is a new, fourth outcome the plan's CASE 1/2/3 branch didn't
   enumerate.
   - **Live fix applied and confirmed working:** a `/system scheduler` script (`gcash-resolve`,
     5-minute interval) that runs `:resolve payments.gcash.com` and upserts a single
     `/ip hotspot walled-garden ip` row (`comment=gcash-auto`) with the freshly resolved Akamai IP.
     No hardcoded IP — the script self-heals as Akamai's edge IP rotates. Script body:
     ```
     /system scheduler add name=gcash-resolve interval=5m on-event={
       :local ip [:resolve payments.gcash.com];
       :if ([:len [/ip hotspot walled-garden ip find comment="gcash-auto"]] = 0) do={
         /ip hotspot walled-garden ip add dst-address=$ip comment="gcash-auto"
       } else={
         /ip hotspot walled-garden ip set [find comment="gcash-auto"] dst-address=$ip
       }
     }
     ```
   - User-confirmed live: GCash/QRPH checkout completes end-to-end through this mechanism.
   - `mdap.paas.mynt.xyz` (GCash/Mynt infra, flagged in the SPEC background) is the **same class**
     — also CNAMEs to Akamai. Not yet given its own resolve-script row; noted as a likely follow-up
     if it turns out to be contacted and unmatched (not confirmed contacted this session).
   - v6 syntax notes recorded: no `/system scheduler run` on v6 (fire the on-event body manually
     inline to test); `walled-garden`/`walled-garden ip` `find where dst-address=X` and
     `find where action=deny` both return empty on v6 — operate rows by print-then-index-number,
     not by a `find where` filter expression.

2. **Android captive icon — investigated and closed as a non-issue.** The plan's SPEC background
   did not raise this, but it came up live this session: the green WiFi icon / apparently-missing
   "!" badge was investigated and found to be a UI-observation red herring — the "Sign in to
   network" notification was present the whole time; `*.googleapis.com` was NOT implicated. This
   **overturns** an item that had been floated for a "D-GAPI overturn" (dropping
   `*.googleapis.com` from `PAYMENT_HOSTS`) — that overturn is now cancelled. D-GAPI's original
   KEEP decision (98 live hits, proven needed) stands unchanged, and `*.googleapis.com` was
   re-enabled live during this session's investigation.

3. **Google Pay — reachability fixed live, but hit an unfixable Google-side policy wall.**
   - Fix 1: `accounts.google.com` (the BARE host) was missing from the walled-garden. Only the
     wildcard `*.accounts.google.com` existed (rule 40, 0 hits) — a `*.` wildcard does **not**
     match its own bare parent host. Adding the bare `accounts.google.com` host let the Google
     login step load.
   - Fix 2: Google's SetSID cross-domain cookie step bounces the browser to the localized PH ccTLD
     `accounts.google.com.ph` — a fully distinct literal hostname not covered by any existing rule.
     Adding it let SetSID complete.
   - **Contrast with GCash:** every Google domain touched (`accounts.google.com`,
     `accounts.google.com.ph`, `pay.google.com`, `payments.google.com`) resolves **directly** to a
     Google-owned IP — confirmed live (`accounts.google.com`→74.125.24.84,
     `pay.google.com`→142.251.12.92, `payments.google.com`→74.125.200.92). No CNAME-to-CDN
     indirection like GCash/Akamai — so Google only ever needed correct host rules, never a
     resolve-script.
   - Syntax correction recorded: the HOST-layer walled-garden (`/ip hotspot walled-garden`) uses
     `action=allow` (the default — omit it), **not** `action=accept`. `action=accept` is valid only
     on the `walled-garden ip` sublayer and throws a syntax error at the host layer.
   - **Hard wall found after reachability was fixed:** Google Pay refuses to proceed with error
     `OR_BIBED_15`. This is Google's own runtime-environment check rejecting the captive portal's
     Android WebView (CNA mini-browser) — a policy decision, not a network-reachability problem.
     No walled-garden rule, DNS fix, or firewall change can work around it. Google Pay only
     functions inside a real standalone browser (e.g. Chrome) with a user already signed into
     Google and a saved card — which a captive-portal CNA session structurally cannot provide.

4. **Walled-garden cleanup debt catalogued (owed, not yet executed).** The live rule set (48 rows)
   has real cruft beyond what the plan's original Operator Cleanup section already listed:
   duplicate `*gcash*` rows (29 + 30); redundant host/wildcard pairs (`*.maya.ph` vs `*maya.ph*`,
   `*.paymaya.com` vs `*paymaya*`, `*.mynt.xyz` vs `mynt.xyz`); five dead GCash hostname rules (all
   0 hits, now fully superseded by the `gcash-auto` IP-layer fix); and — the most consequential
   finding — manual `*keyword*` substring rules are **shadowing** the Stage A codified `*.domain`
   rules, because RouterOS walled-garden matching is first-match top-to-bottom and the old manual
   rules sit above the new ones. Confirmed live: rule 32 (`*alipay*`, manual) matches Alipay
   traffic first, so the Stage A `*.alipay.com` rules at positions 41–44 show 0 hits even though
   they are correct and would work if reached. Cleanup must therefore be sequenced as a
   coverage-regression-checked replacement (confirm the codified rule catches the same traffic
   BEFORE removing the shadowing manual rule), not a blind delete.

## What Was Skipped/Deferred

- Stage C's originally-designed DoT/DoH block (`provisionDnsEnforcement()`, `DOH_PROVIDER_IPS`,
  firewall-filter rows) is **not being built** — the diagnosis this session found makes it the
  wrong fix for GCash (CNAME, not DoH-hiding) and Google Pay is blocked by WebView policy
  regardless of network config. See Plan Deviations below.
- `mdap.paas.mynt.xyz` was not confirmed as contacted/uncovered this session — flagged as a
  possible same-class follow-up (Akamai CNAME) if a future live capture shows it's hit and
  unmatched. Not yet given its own resolve-script row.
- Credit/debit 3DS was not diagnosed this session (was already SPEC out-of-scope); still
  unaddressed, still decoupled-path-only by original SPEC scope (now reinforced by the Google Pay
  WebView finding — the same class of block likely applies).
- Walled-garden cleanup (item 4 above) was catalogued but not executed this session — added as an
  explicit plan checklist task; deferred to a future EXECUTE pass.
- The `gcash-resolve` scheduler script and the Google host additions were applied **live on the
  router only** this session — they are not yet codified into `apps/admin/scripts/setup-router.ts`
  / `walled-garden-config.ts` (Stage A's committed `ec24ed4` predates this session's findings). This
  is the primary remaining EXECUTE gap: the live router now has fixes the codebase does not know
  about, and a fresh `setup:router` run would not reproduce them.

## Test Gate Outcomes

No automated test gates were run this session — this was a live-router diagnostic capture (Stage
B), which the plan already classifies as Agent-Probe / manual, not Fully-Automated. No code was
changed. Prior Stage A gates (committed `ec24ed4`) were not re-run and are assumed still green
(untouched this session).

- GCash/QRPH live checkout: user-confirmed PASS (via `gcash-resolve` scheduler fix).
- Google Pay reachability (login + SetSID): confirmed reachable after host fixes; checkout itself
  BLOCKED by `OR_BIBED_15` (Google WebView policy) — not a walled-garden/DNS gate outcome, a
  platform-level hard stop.
- Android captive-icon investigation: confirmed non-issue (no gate, observational).

## Plan Deviations

**Material deviation — Stage C's designed root cause is wrong; the diagnostic branch tree drawn in
the plan (Implementation Checklist step 10, CASE 1/2/3) did not anticipate the actual outcome
found live.** The plan asked "is `gcash.com` contacted, and is its DNS query DoH-hidden or
router-visible?" (a binary DoH question). The real answer is a third dimension entirely: the query
IS visible to the router (Q2 answer is effectively "router-can-see-it"), but the walled-garden
`dst-host` mechanism still can't match it because the destination CNAMEs to a CDN whose IP the
`*.domain` rule was never written to catch. This is closest to the plan's own CASE 3 ("router sees
query, rule still 0 hits — investigate rule/ordering"), but the investigation this session
completed found a specific, fixable, non-DoH root cause (CNAME-to-Akamai) with a working live fix
(resolve-script), rather than an unresolved rule/ordering bug. The plan's CASE 3 language ("do NOT
ship the DoH block blindly; investigate the rule... escalate per SPEC if unresolved") is honored —
the DoH block is not shipped — but the outcome is now RESOLVED, not escalated, via a different
mechanism than any of the three cases the plan pre-wrote. See §Plan Revisions in the plan file for
how this is being folded back in.

Google Pay surfaced a genuinely new finding outside the plan's original branch tree: reachability
and checkout-completion are two separate axes, and Google Pay fails on the second (platform policy)
even after the first is fully fixed. The plan's AC3 language ("Google Pay checkout completes while
captive") is not achievable in the CNA/WebView captive-portal context, full stop — this is not a
temporary gap to close with more router config, it is a structural limitation of the payment
method inside a captive portal.

## Test Infra Gaps Found

None new. The plan's own "Test Infra Improvement Notes" section already correctly notes that
`provisionWalledGarden()` router-behavior correctness is not unit-testable and depends on live
Agent-Probe sessions — this session is exactly that kind of session, and nothing here changes that
assessment. The `gcash-resolve` scheduler script and the Google host rules currently exist only as
live router state, with no corresponding test coverage because they don't yet exist as code (see
"What Was Skipped/Deferred").

## SPEC Achievement

Scoring against the locked SPEC's AC1–AC7 (`payment-walled-garden-v6_SPEC_29-07-26.md`):

| AC  | Criterion                                   | Status this session                                                        | Note                                                                                                                                                                                                                                                                                          |
| --- | ------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1 | Live capture proves root cause fixed        | **MET for GCash, differently than SPEC's DoH mechanism**                   | Root cause was CNAME-to-Akamai, not DoH-hiding; fixed via `:resolve` scheduler, not the DoT/DoH block. The behavioral outcome (dst-host rules see nonzero-equivalent traffic via the IP-layer fix) is achieved for GCash.                                                                     |
| AC2 | GCash checkout completes while captive      | **MET**                                                                    | User-confirmed live.                                                                                                                                                                                                                                                                          |
| AC3 | Google Pay checkout completes while captive | **UNMET — structurally, not from a gap that more router config can close** | Reachability fixed; checkout itself blocked by Google's `OR_BIBED_15` WebView policy check. Backlog note required — see plan revision.                                                                                                                                                        |
| AC4 | Stay-captive invariant holds (PROBE_DENIES) | Not re-verified this session                                               | No PROBE_DENIES changes were made; carried forward as previously proven, not re-tested live this session — flag as a residual to re-confirm before calling the plan VERIFIED.                                                                                                                 |
| AC5 | Browser return URL unaffected               | Not directly re-tested this session                                        | No changes touched `ORIGIN`/`TUNNEL_ORIGIN`; carried forward as previously proven (see `maya-return-url-revert_23-07-26`).                                                                                                                                                                    |
| AC6 | Idempotent provisioning                     | **UNMET for this session's live changes**                                  | The `gcash-resolve` script and Google host rules were applied directly on the router, not through `setup:router` — so they are not yet idempotent-by-code; a fresh `setup:router` run would not reproduce or preserve them. This is the primary EXECUTE-phase gap this session leaves behind. |
| AC7 | Non-payment plain DNS unchanged             | **Trivially satisfied — no DNS block shipped**                             | Consistent with the plan's own CASE 2/3 fallback language; the DoT/DoH block was never built.                                                                                                                                                                                                 |

Unmet criteria → backlog notes (see plan revision §6 below for the walled-garden-cleanup task; AC3
and AC6 gaps are folded into the plan's Stage C replacement design and Implementation Checklist,
not filed as separate backlog notes, since they are directly actionable follow-up work within this
same plan's remaining scope).

## Closeout Packet

Not applicable — this is a mid-flight learnings capture for an ACTIVE plan, not a plan closeout.
Per the orchestrating instruction for this session: the plan is NOT archived, stays in
`process/general-plans/active/payment-walled-garden-v6_29-07-26/`. No `vc-generate-closeout` full
packet is produced here; see plan file's own `## Phase Completion Rules` for the plan's authoritative
completion-state tiers (still `STAGE A CODE-DONE`, not `VERIFIED` — this session's findings do not
change that; if anything they add more work before `VERIFIED` is reachable).

## Forward Preview

### Test Infra Found

None new (see §Test Infra Gaps Found above — this remains an Agent-Probe-only surface by design).

### Blast Radius Changes

Live-only changes this session (no code diff): 1 new `/system scheduler` entry (`gcash-resolve`) on
the staging router; 2 new `/ip hotspot walled-garden` host rows (`accounts.google.com`,
`accounts.google.com.ph`); 1 re-enabled `*.googleapis.com` rule (was disabled during the earlier
captive-icon investigation, re-enabled once confirmed non-implicated). None of this is yet reflected
in `apps/admin/scripts/walled-garden-config.ts` or `setup-router.ts` — codifying it is the next
EXECUTE-phase blast radius addition to the plan (see plan revision).

### Commands to Stay Green

Unchanged from the plan's existing Stage A gates:
`cd apps/admin && bunx vitest run scripts/setup-router.spec.ts`; `cd apps/admin && bun run check`.
No new automated commands from this session (all findings are live-router/manual by nature).

### Dependency Changes

None. No package.json changes this session.
