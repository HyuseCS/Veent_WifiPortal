---
name: plan:gotyme-walled-garden-recon
description: "SPEC — recon and conditionally whitelist GoTyme e-wallet in the staging MikroTik walled garden"
date: 22-09-26
feature: none
---

## Summary

We want guests on the staging WiFi portal to be able to pay with the GoTyme e-wallet app,
the same way they can already pay with GCash and Maya. Right now GoTyme is untested — we
don't know which internet addresses ("hosts") its app needs to reach, so the router may be
silently blocking it. This work finds out, opens exactly those addresses on the staging
router, and proves — on a real phone — that the GoTyme payment flow now works. If it turns
out GoTyme's app refuses to work even with the right addresses open (some apps actively
detect and block captive WiFi portals), we record that clearly instead of leaving a
half-open, unverified whitelist entry behind. This is the first of 9 wallets/banks queued
for the same treatment; only GoTyme is in scope here.

## User Stories / Jobs To Be Done

- As a guest paying for WiFi with GoTyme, I want the GoTyme app to complete my payment while
  I'm still on the captive portal, so that I don't have to switch payment methods or leave
  the WiFi network to pay.
- As the operator investigating a new wallet, I want a documented, repeatable way to find out
  exactly which hosts GoTyme needs, so that I add only what's necessary and don't accidentally
  reopen the captive-probe bug (guests flashing "Connected" then reverting).
- As the operator, I want a clear, permanent record of whether GoTyme works or not, so that
  future work (or future me) doesn't re-attempt a dead integration or forget a working one.

## What The User Wants (Behavioral Outcomes)

- On the staging router, when a guest device (still behind the captive portal, not yet
  granted) opens the GoTyme app and drives it up to the payment/QRPH confirmation screen, the
  app's network calls succeed (no blocked/timeout errors caused by the walled garden).
- The specific hosts GoTyme's app talks to are captured from a live DNS-cache read, not
  guessed from documentation.
- Only the classified, confirmed hosts are added to the router's payment allowlist — no broad
  wildcard or CDN allow that would reopen the captive-probe flash bug.
- After the hosts are added and pushed to the staging router, a human re-drives the GoTyme
  flow on a real device to confirm it now completes (reaches/passes the confirm screen
  without a network-caused failure). This human retest is the only way to know "domain open"
  really means "app works" — some apps still refuse to work on captive WiFi even with every
  host reachable.
- If GoTyme still won't complete after the correct hosts are open, the added hosts are
  removed again (router state and code state end up clean, not half-open) and GoTyme is
  marked as a known dead end, matching how Google Pay was already handled.
- Either way — success or failure — the reference documentation (`docs/mikrotik/walled-garden.md`)
  is updated so the next person (or the same person, on a different candidate) can see
  GoTyme's real status at a glance instead of "UNVERIFIED".
- No other wallet/bank candidate is touched. No production router is touched — staging only.
- No customer-facing or admin-facing app code changes — this is router configuration and
  documentation only.

## Flow / State Diagram

```
                         ┌─────────────────────────┐
                         │ GoTyme: UNVERIFIED       │
                         │ (current state, no hosts)│
                         └────────────┬─────────────┘
                                      │
                     Step 1: operator flushes router DNS cache
                                      │
                     Step 2: operator drives GoTyme app on a
                     captive test device up to (not confirming)
                     the payment/QRPH screen
                                      │
                     Step 3: operator reads `/ip dns cache print`
                     on the router, pastes output back
                                      │
                     Step 4: agent classifies each new host
                       (direct-resolve  vs  CNAME-to-CDN)
                                      │
                     Step 5: agent adds classified host(s) to
                     PAYMENT_HOSTS (+ new :resolve scheduler if
                     any host is CNAME-to-CDN)
                                      │
                     Step 6: agent runs collision-guard + type
                     checks, then pushes via `setup:router`
                     (staging only)
                                      │
                     Step 7: operator retests the live GoTyme
                     flow on the captive device
                                      │
                        ┌─────────────┴─────────────┐
                        │                            │
                  flow completes              flow still fails
                  (payment/QRPH screen         (network reachable but
                   reached without a           app refuses / blocks /
                   network-caused error)        times out for other reasons)
                        │                            │
                        ▼                            ▼
          ┌───────────────────────────┐  ┌────────────────────────────┐
          │ GoTyme: VERIFIED           │  │ agent removes the added     │
          │ - hosts stay in            │  │ hosts from PAYMENT_HOSTS    │
          │   PAYMENT_HOSTS            │  │ - router/code back to       │
          │ - doc row → VERIFIED       │  │   pre-attempt state         │
          │ - tests still green        │  │ - doc row → KNOWN-DEAD      │
          └───────────────────────────┘  │ - tests still green         │
                                          └────────────────────────────┘
```

## Acceptance Criteria (Testable Outcomes)

1. **DNS recon is captured live, not assumed.** The set of GoTyme-related hosts used for this
   cycle comes from an actual `/ip dns cache print` read after driving the GoTyme app on a
   captive test device — not copied from the existing "candidate root" guess
   (`*.gotyme.com.ph`) in the doc without confirmation.
   - proven by: manual operator step (DNS flush → drive app → paste cache output) confirmed
     present in the session transcript / task-folder notes before any code edit is made.
   - strategy: Agent-Probe (inherently human-hands-on; cannot be automated — a real router and
     a real phone are required).

2. **Only classified hosts are added, correctly bucketed.** Each newly discovered host is
   explicitly classified as direct-resolve (added as a plain `dst-host` entry to
   `PAYMENT_HOSTS`) or CNAME-to-CDN (requires a new `:resolve` scheduler, modeled on
   `provisionGcashResolveScheduler`) before any router push happens.
   - proven by: the added `PAYMENT_HOSTS` lines (and any new scheduler function) are traceable
     1:1 to a host that appeared in the captured DNS cache output, with its classification
     noted in the plan/report.
   - strategy: Hybrid (classification logic is agent-driven; the underlying DNS-shape fact
     comes from the human-captured cache dump).

3. **The two hard rules from the recon protocol are respected.** No broad CDN/Google/
   Cloudflare wildcard host is added. If a bare-parent host and its wildcard subdomain form
   are both needed (e.g. `gotyme.com.ph` + `*.gotyme.com.ph`), both are added — a wildcard
   alone never covers its own bare parent.
   - proven by: `apps/admin/scripts/setup-router.spec.ts` collision-guard test
     (`PAYMENT_HOSTS ∩ PROBE_DENIES = ∅`) plus a manual diff review of the exact lines added.
   - strategy: Fully-Automated (collision guard) + Hybrid (bare-parent/wildcard pairing is a
     human-reviewed diff check).

4. **Existing safety/regression tests stay green after the code change.** The collision-guard
   test in `apps/admin/scripts/setup-router.spec.ts` and the admin package typecheck both pass
   after `PAYMENT_HOSTS` (and any new scheduler code) is edited — whether the outcome is
   VERIFIED or KNOWN-DEAD.
   - proven by: `bun run --filter radius-admin test -- setup-router` (or the admin test
     command that covers this spec file) and `bun run --filter radius-admin check` (or
     equivalent admin typecheck) both exit 0.
   - strategy: Fully-Automated.

5. **The staging router push is real and scoped to staging.** The classified hosts (and any
   new scheduler) are pushed to the router via `setup:router`, and this run targets the
   staging router only — no production router configuration is touched or attempted.
   - proven by: operator confirmation that the `setup:router` invocation ran against the
     staging `MIKROTIK_*` env target, plus a router-side check (e.g. re-running
     `/ip hotspot walled-garden print` or the relevant menu) showing the new rows present.
   - strategy: Agent-Probe (requires a live router session; not simulable).

6. **Success path — live retest confirms the flow completes.** After the push, a human
   operator re-drives the GoTyme app on a captive test device through the payment/QRPH flow.
   If it now reaches the confirm screen (or completes) without a network-caused failure
   (blocked host, timeout, connection reset), GoTyme is confirmed working.
   - proven by: operator's plain-language confirmation of the live retest result, recorded in
     the phase report.
   - strategy: Agent-Probe.

7. **Success path — documentation reflects VERIFIED.** On a successful retest,
   `docs/mikrotik/walled-garden.md`'s candidate table row for GoTyme is updated from
   `UNVERIFIED` to `VERIFIED`, and the added hosts remain permanently in `PAYMENT_HOSTS`.
   - proven by: diff of `docs/mikrotik/walled-garden.md` showing the status column change;
     `PAYMENT_HOSTS` diff showing the hosts retained.
   - strategy: Fully-Automated (diff can be grepped/asserted) + Hybrid (operator confirms the
     retest that triggers the doc update).

8. **Failure path — hosts are cleanly removed on a dead end.** If the live retest still fails
   after the correct hosts are open (app refuses to work on captive WiFi, e.g. cert-pinning or
   active captive-portal detection), the hosts added for this cycle are removed from
   `PAYMENT_HOSTS` again, returning the code and router state to their pre-attempt shape.
   - proven by: `git diff` (or the final state of `PAYMENT_HOSTS`) showing no GoTyme-specific
     hosts remain; re-run of the collision-guard/typecheck tests still green after the
     removal.
   - strategy: Hybrid (removal is agent-driven; the decision to remove is triggered by the
     human retest result).

9. **Failure path — documentation reflects KNOWN-DEAD.** On a failed retest,
   `docs/mikrotik/walled-garden.md`'s GoTyme row is updated from `UNVERIFIED` to
   `KNOWN-DEAD`, with a short note of what was tried and why it failed (mirroring the existing
   Google Pay `KNOWN-DEAD` writeup style).
   - proven by: diff of `docs/mikrotik/walled-garden.md` showing the status change and note.
   - strategy: Fully-Automated (diff-checkable) + Hybrid (content depends on the human-observed
     failure reason).

10. **No unrelated scope creep.** No other candidate wallet/bank (SeaBank, GrabPay, ShopeePay,
    Coins.ph, BDO, BPI, Landbank, Security Bank) is touched by this cycle's code or doc
    changes. No customer-app or admin-app source files outside
    `apps/admin/scripts/walled-garden-config.ts` (and, if needed,
    `packages/core/src/integrations/network/mikrotik.ts` for a new `:resolve` scheduler) are
    modified.
    - proven by: `git diff --stat` for this task shows only the expected file set.
    - strategy: Fully-Automated.

## Out Of Scope

- The other 8 candidate wallets/banks (SeaBank, GrabPay, ShopeePay, Coins.ph, BDO, BPI,
  Landbank, Security Bank) — each gets its own future recon cycle.
- Any production router changes. This cycle targets the staging MikroTik router only; no
  production `setup:router` run is authorized as part of this SPEC.
- Any customer-app or admin-app UI/business-logic code changes. This is router-config
  (`PAYMENT_HOSTS`, and possibly a new `:resolve` scheduler helper) plus documentation only.
- Building new "pending/candidate" scaffolding in `PAYMENT_HOSTS` (e.g. a staging-only flag or
  separate pending list) — out of scope unless a future SPEC asks for it; this cycle uses the
  existing flat, always-provisioned array as-is.
- A production `--reconcile` or `--wipe` run — not needed for this cycle, and not authorized
  on production.
- Testing GoTyme card/3-D-Secure or bank-transfer payment paths, if the app offers them — this
  SPEC covers the e-wallet/QRPH flow only, matching how GCash/Maya were verified.

## Constraints

- Staging only — no production MikroTik changes (user-stated).
- DNS cache flush/print stays a manual, user-driven router-console action; the agent never
  gets direct router console access for this step (user-confirmed this session).
- Recon proceeds one candidate at a time, wallets before banks — this cycle is GoTyme only
  (user-confirmed this session).
- On failure, the fix is exactly: remove the added hosts from `PAYMENT_HOSTS`, mark GoTyme
  `KNOWN-DEAD` in the doc, mirroring the existing Google Pay precedent (user-confirmed this
  session).
- `PAYMENT_HOSTS` is a flat, always-provisioned array — every entry is pushed live the moment
  `setup:router` runs; there is no "staged but not yet live" state before this SPEC changes
  that. `--reconcile` will not auto-remove an added-but-unverified host — removal must be a
  manual code edit + re-run.
- The existing collision-guard test in `apps/admin/scripts/setup-router.spec.ts`
  (`PAYMENT_HOSTS ∩ PROBE_DENIES = ∅`) automatically re-asserts against any new host added —
  it does not need to be modified for this cycle, only kept green.
- Two hard rules from the walled-garden doc apply unchanged: never add a broad CDN/Google/
  Cloudflare allowlist; if both the bare-parent and wildcard subdomain form are needed for a
  host, add both explicitly.
- This is inherently a hybrid human/agent workflow: DNS capture and the live app retest are
  strictly the user's hands-on actions on a real device/router console; classification, code
  edits, router push command, and automated test gates are agent-executable.

## Open Questions

None. All ambiguity was resolved by the user during this session's research/clarification
(DNS steps stay manual, one-candidate-at-a-time ordering, and the exact failure-path
procedure are all confirmed above).

## Background / Research Findings

- GoTyme currently sits in `docs/mikrotik/walled-garden.md`'s "Candidate wallets/banks
  (UNVERIFIED — recon required)" table as `*.gotyme.com.ph — UNVERIFIED`, with no cert-pin/
  captive-detection risk flag (unlike the 4 bank rows, which carry that caveat). It is first
  in the queue of 9 candidates, ahead of the other 4 wallets and the 4 higher-risk banks.
- The recon protocol is already fully documented in `docs/mikrotik/walled-garden.md`
  ("How to add a wallet/bank (₱0 recon protocol)", lines ~259-309): flush DNS cache → drive
  the app on a captive device to (not through) the pay/QRPH screen → read
  `/ip dns cache print` → classify each new host as direct-resolve (plain `dst-host` entry) or
  CNAME-to-CDN (needs a `:resolve` scheduler, following the `provisionGcashResolveScheduler`
  precedent in `packages/core/src/integrations/network/mikrotik.ts`) → add → re-run
  `setup:router` → retest live. Two hard rules: never add broad CDN allows (reopens the
  captive-probe flash bug that `PROBE_DENIES` fixes); a `*.domain` wildcard never matches its
  own bare parent (both forms are needed together, as already done for `gcash.com`/
  `*.gcash.com` and `alipay.com`/`*.alipay.com`).
  - "Domain open ≠ app works" is explicitly called out in the doc: some apps (Google Pay is
    the documented precedent) cert-pin or detect captive networks and refuse to proceed even
    with every host reachable — hence the mandatory live human retest as the final proof step,
    not just "hosts added, tests green."
- `PAYMENT_HOSTS` (`apps/admin/scripts/walled-garden-config.ts`) is a flat, side-effect-free
  array of strings, imported by both `setup-router.ts` (live provisioning) and
  `setup-router.spec.ts` (the collision-guard unit test). It is grouped into labeled blocks
  (Maya/PayMaya; GCash+Alipay+Mynt/G-Xchange; Google APIs) as of the 30-07-26
  `walled-garden-wallet-onboarding-prep` session. No "pending" or staging-only sub-list exists
  today — every entry provisions immediately on any `setup:router` run.
- Existing precedent for a CNAME-to-CDN case: `provisionGcashResolveScheduler()`
  (`packages/core/src/integrations/network/mikrotik.ts`) — an idempotent
  `/system scheduler` item that `:resolve`s a hostname every 5 minutes and upserts a
  walled-garden-ip row, because `payments.gcash.com` CNAMEs to an Akamai edge that plain
  `dst-host` rules can't follow. This is the template to reuse if any GoTyme host turns out to
  be CDN-fronted.
- Existing precedent for a dead-end candidate: Google Pay is documented as "KNOWN-DEAD
  (excluded on purpose)" in the same doc — Android WebView blocks it regardless of whitelisting
  (`OR_BIBED_15`), so its hosts were deliberately removed from `PAYMENT_HOSTS` rather than left
  half-open. This is the exact pattern the user asked to mirror for a GoTyme failure.
- Confirmed by the user this session (not previously documented): (1) DNS flush/print is a
  manual router-console action performed by the user and pasted back to the agent — the agent
  never gets direct router console access for that step; (2) recon proceeds one candidate at a
  time, wallets first, GoTyme is first; (3) on failure, the fix is: remove the added hosts,
  mark `KNOWN-DEAD` in the doc, mirroring Google Pay.
- No active plan folder previously existed for this work — `process/general-plans/active/`
  contained only the `_GUIDE.md` router file before this task folder was created.
