---
name: plan:conditional-checkout-access-spec
description: "Grant a paying guest's device full internet, scoped and time-bounded, during Maya checkout so every payment method (cards/3DS, GCash, QRPH, Billease, Google Wallet) can complete without walled-garden dead-ends"
date: 27-07-26
feature: general-plans
---

# Conditional Full Internet Access During Maya Checkout — SPEC

## Summary

Right now, guests paying through Maya sometimes can't finish paying. The captive portal only
lets traffic through to a manually curated list of payment-related domains, but some payment
methods (card 3-D Secure bank redirects, sometimes GCash/Alipay's CDN-heavy checkout) need to
reach domains that were never on that list and can't practically all be pre-listed — 3DS alone
can redirect to any of hundreds of issuing-bank domains. The result is a payment that silently
fails with a connection error, even though the guest did everything right.

This feature gives a guest's device temporary, full internet access — but only that one device,
only for a short window (targeting ~6 minutes) while completing a Maya checkout, and only after
they've already started paying. The device is not "logged in" or granted WiFi service; it's
simply allowed to reach whatever host the payment step needs. Access ends as soon as the payment
resolves (success or failure) — the short window is only a backstop for checkouts that are
abandoned and never resolve. Once access ends, the device goes back to being fully captive like
every other unpaid guest.

## User Stories / Jobs To Be Done

- As a guest paying with a credit/debit card, I want my bank's 3-D Secure verification page to
  load fully (including its redirects), so that I can actually complete authentication instead of
  getting stuck on a broken page.
- As a guest paying with GCash, I want the GCash/Alipay-powered checkout (and all the CDN assets
  it loads) to work every time, so that my payment doesn't randomly fail.
- As a guest using any other Maya-supported method (Maya wallet/credit, QRPH, Billease, Google
  Wallet), I want the same reliability — my checkout should not depend on which payment rail
  happens to already be on a hostname allowlist.
- As the business owner, I want this convenience limited strictly to the paying device and to the
  checkout window, so that I'm not accidentally giving free, unrestricted internet to guests who
  haven't paid (or to anyone else on the network).
- As the business owner, I want the guest's device to remain "not connected" from the portal's
  point of view during this window, so that nothing here creates a way to get WiFi without
  paying.
- As the business owner, I want access removed the moment a payment resolves (not just after a
  fixed timer), so exposure to free, unrestricted internet is minimized to the minutes it
  actually takes to pay.

## What The User Wants (Behavioral Outcomes)

- When a guest taps "Pay" and a Maya checkout is created for their device, that device becomes
  able to reach any host needed to complete that specific payment flow (bank 3DS pages, GCash/
  Alipay cashier + its CDN domains, Google Wallet, Billease, etc.) — regardless of whether that
  host was ever explicitly allowlisted.
- No other device on the network is affected. Only the one guest device that started the
  checkout gets this access.
- The access ends as soon as the payment resolves — success or failure/cancellation. If the
  guest abandons the checkout and never resolves it, a short backstop window (~6 minutes,
  target) ends the access automatically so nothing lingers open indefinitely.
- After access ends, the device returns to normal captive-portal behavior — it cannot browse the
  open internet without paying.
- Even during the access window, the OS's own "is this WiFi actually connected to the internet"
  connectivity checks (the little background checks phones/laptops do) continue to be blocked, so
  the guest's device still shows itself as "captive" / needing to log in, not as "online." (A
  known, accepted quirk: some Android phones may briefly show a stale "connected" icon due to
  caching an earlier check result — this is cosmetic only, grants no real access, and is not a
  target for this feature to fix.)
- The guest never becomes "logged in" or WiFi-authenticated purely by starting a checkout. Only
  actually completing and having the payment recognized grants WiFi access, exactly as today.
- A guest (or anyone spoofing repeated checkout attempts from the same account/session) cannot
  abuse this to repeatedly re-open the access window forever — the rate limit that already exists
  on starting a checkout continues to bound how often this can be triggered.

## Flow / State Diagram

```
 Guest device (unpaid, captive)
        │
        │  taps "Pay" on Top-Up page
        ▼
 ┌─────────────────────────────┐
 │ Checkout is created          │  (rate-limited: existing checkout_user limit, 20/window)
 │  -> device is granted        │
 │     temporary full-internet  │
 │     access, scoped to THIS   │
 │     device only, backstop    │
 │     TTL ~6 min                │
 └─────────────────────────────┘
        │
        │  guest is redirected to Maya's payment page
        ▼
 ┌─────────────────────────────┐
 │ Guest completes payment      │
 │  method of choice:            │
 │  - Card + 3DS bank redirect   │
 │  - GCash / Alipay cashier     │
 │  - Maya wallet/credit         │
 │  - QRPH                       │
 │  - Billease                   │
 │  - Google Wallet              │
 │  (all reachable — no dead     │
 │   ends from missing hosts)    │
 └─────────────────────────────┘
        │
        ├──> Payment SUCCEEDS ──> webhook resolves checkout
        │       │                  -> expanded access REVOKED immediately
        │       ▼                  -> normal existing grant flow runs
        │    (WiFi time/credit granted, as today)
        │
        ├──> Payment FAILS/CANCELLED ──> webhook resolves checkout
        │       │                          -> expanded access REVOKED immediately
        │       ▼
        │    guest returns to Top-Up page, no WiFi granted
        │
        └──> Guest abandons / does nothing (checkout never resolves)
                    │
                    ▼
        ~6-min backstop TTL expires
        (device access removed — no leftover access)
                    │
                    ▼
        Device is fully captive again,
        exactly like before checkout started

 Throughout the whole window:
   - OS connectivity-probe hosts stay BLOCKED -> device still shows "captive"
   - Device is NOT WiFi-authenticated -> starting a checkout, by itself,
     never grants network access
```

## Acceptance Criteria (Testable Outcomes)

1. A guest who starts a card payment and is redirected through their bank's 3-D Secure page can
   reach that page and complete authentication without a connection error, for any card-issuing
   bank Maya supports.
   `proven by:` Manual/agent-probe live test against a real Maya sandbox or live 3DS redirect
   (cannot be simulated by a code-only test since issuing-bank domains are unbounded).
   `strategy:` Agent-Probe.

2. A guest who starts a GCash payment can reach the GCash/Alipay-powered cashier and every CDN
   domain it loads, without a connection error, for the duration of the payment.
   `proven by:` Manual/agent-probe live test against a real device and the live GCash checkout
   flow (this is the same class of check that already confirmed the underlying mechanism works
   on real hardware this session).
   `strategy:` Agent-Probe.

3. A guest who starts a Maya wallet/credit, QRPH, Billease, or Google Wallet payment can
   complete that flow without encountering a walled-garden connection failure.
   `proven by:` Same live device probe as AC1/AC2, repeated per payment method at least once each.
   `strategy:` Agent-Probe.

4. Only the device that initiated a given checkout receives the expanded access — a second,
   different device on the same network does not gain expanded access as a side effect of the
   first device's checkout.
   `proven by:` Automated integration test asserting the granted access rule is scoped to the
   originating device's identifier (src-IP or equivalent), not network-wide.
   `strategy:` Fully-Automated.

5. Expanded access ends the moment a checkout resolves (success or failure), and independently,
   if a checkout is never resolved, the access ends automatically via the ~6-min backstop window
   with no residual access left behind.
   `proven by:` Automated integration test covering both paths: (a) resolve-triggers-revoke —
   webhook/reconcile resolution removes the device's access rule immediately; (b) abandoned
   checkout — grant-then-TTL-sweep-then-verify-removed (mirrors the existing TTL-sweep test
   pattern used for checkout access). Plus a live device probe confirming a removed rule actually
   blocks browsing (already demonstrated this session).
   `strategy:` Hybrid (Fully-Automated for both DB/rule-table lifecycle paths + Agent-Probe for
   the real network effect of removal).

6. While the expanded access is active, the device's OS connectivity-probe requests (the hosts
   used for `generate_204`/`ncsi.txt`/`connecttest.txt`-style checks) still return a "you are
   captive" response rather than a real "connected" response.
   `proven by:` Automated integration test asserting the probe-host deny rule is not affected by
   / is evaluated ahead of the new expanded-access rule.
   `strategy:` Fully-Automated.

7. Starting a checkout, by itself, never results in the device being treated as WiFi-authenticated
   or granted paid/free session time — only a resolved successful payment does that, unchanged
   from current behavior.
   `proven by:` Automated integration test confirming no session/grant record is created at
   checkout-open time, only at payment-success time.
   `strategy:` Fully-Automated.

8. The rate limit already governing how often a guest/session can start a new checkout (20 per
   window) continues to apply unchanged, bounding how often the expanded-access window can be
   (re-)triggered.
   `proven by:` Existing automated rate-limit test coverage for the checkout action, confirmed
   to still pass with this feature enabled (no new rate-limit surface introduced).
   `strategy:` Fully-Automated.

## Out Of Scope

- Any admin-facing UI for viewing, managing, or manually granting/revoking walled-garden access
  rules. Staff continue to have no dashboard control over this.
- Deciding which Maya payment methods are enabled/disabled in the Maya merchant dashboard — that
  toggle is a separate business decision made outside this codebase.
- Productionizing or removing the existing manual, temporary router-side IP allow for GCash
  hostname matching (tracked separately in
  `process/general-plans/backlog/gcash-walled-garden-ip-productionize_NOTE_23-07-26.md`). This
  feature is expected to make that manual workaround unnecessary, but formally retiring it is a
  separate follow-up, not part of this SPEC.
- The SMS test-mode toast feature (unrelated, separately queued work).
- Any change to how or when WiFi/session access is granted after a successful payment — that
  grant logic is unchanged by this feature.
- Fixing the cosmetic Android "stale connected icon" quirk noted above — it is explicitly
  accepted as a known, harmless display artifact, not a defect this feature must resolve.

## Constraints

- The guest device must remain unauthenticated (no `ip-binding type=bypassed` or equivalent) for
  the entire checkout window — the mechanism must not use the same trust tier as a paid grant.
- Access must be scoped to the single paying device (by source IP or equivalent device
  identifier), never network-wide.
- OS connectivity-probe hosts must remain blocked/denied throughout the window so the device
  continues to self-report as captive.
- **Revocation trigger is payment resolution, not time alone (CONFIRMED requirement).** Access
  must be revoked as soon as the checkout resolves (success or failure), not just left to expire
  on a timer. This requires recording the paying device's identifier (MAC/IP) against the
  `payment_checkouts` row so the resolution path (webhook/reconcile) can target and revoke that
  device's access rule. **This is a schema/migration touch and elevates this feature to the
  schema-migration high-risk class** — the risk-evidence-pack (`vc-risk-evidence-pack`) applies
  at PLAN/VALIDATE, per `orchestration.md §High-Risk Execution Handoff`.
- A short backstop TTL (~6 minutes, target) must still apply independently of the resolve-trigger
  revoke, so that checkouts which are abandoned and never resolve do not leave access open
  indefinitely. This backstop reuses the existing TTL-sweep pattern.
- The existing checkout-start rate limit (20 per window) must continue to bound how often this
  access can be triggered; no new unbounded trigger surface may be introduced.
- The device must be resolvable to a real network address at checkout-open time, before any
  payment confirmation exists — confirmed feasible on real hardware for unpaid/pre-payment
  devices this session.
- Whatever mechanism is chosen must not create a lasting revenue leak — once access ends (by
  resolve-trigger or by backstop TTL), the device must lose the expanded access with no gap that
  a guest could exploit to keep browsing for free.

## Open Questions

**All resolved — user-confirmed 27-07-26.**

1. **Grant window length — RESOLVED: SHORT (~6 minutes), used only as a backstop.** The window is
   tuned down from the existing 15-minute checkout-access default to roughly match Maya's natural
   checkout expiry, to minimize free-internet exposure. Note: Maya's exact checkout expiry is
   unverified in code (`createCheckout` does not appear to set an explicit expiry in the current
   integration; the `expiryTime=299` figure sometimes observed is Maya's own server-side default,
   not something our integration configures) — ~6 minutes is the chosen target for the backstop
   TTL and is adjustable if live testing shows Maya's real expiry differs. This backstop is
   secondary to the resolve-trigger revoke below, which is the primary mechanism.

2. **Revoke trigger — RESOLVED: revoke on payment resolution, not TTL-only.** Access is revoked
   immediately when the checkout resolves (success or failure), not merely left to expire. This
   requires recording the paying device's MAC/IP on `payment_checkouts` so the webhook/reconcile
   path can target the correct device — a confirmed **schema/migration** requirement. This
   elevates the feature to the schema-migration high-risk class; the risk-evidence-pack applies
   at PLAN/VALIDATE. The ~6-minute TTL sweep remains as the backstop for checkouts that are
   abandoned and never resolve.

3. **Business tradeoff — RESOLVED: CONFIRMED.** The business is comfortable that the paying
   device gets genuinely unrestricted internet during the ~6-minute window, bounded by the window
   length plus the existing checkout-start rate limit (20 per window).

## Background / Research Findings

- **Problem, from RESEARCH:** the portal grants payment-gateway reachability via per-hostname
  walled-garden rules today. This does not scale: card 3-D Secure redirects to unbounded
  issuing-bank ACS domains, and GCash/Alipay's cashier pulls in dozens of CDN domains — so cards
  and sometimes GCash fail outright with `ERR_CONNECTION_CLOSED`. The business needs every Maya
  payment method reachable: GCash, Maya wallet/credit, QRPH (called out as essential), Billease,
  Debit/Credit (Mastercard/Visa/Amex/JCB with 3DS), and Google Wallet.
- **Live feasibility evidence gathered this session, on real hardware (all four passed):**
  1. An unpaid device is resolvable pre-payment via the hotspot host table (`/ip hotspot host`
     showed the device with the `H` flag, no `A`/`P`), so a device-scoped rule can be created
     before payment resolves.
  2. A catch-all IP-layer allow scoped to the device's source IP
     (`/ip hotspot walled-garden ip add dst-address=0.0.0.0/0 src-address=<device-ip>
     action=accept`) delivered genuinely full internet to that device (browsing + video streaming
     confirmed).
  3. Removing that rule cleanly killed the device's internet — no leftover/leaked access.
  4. The existing top-placed `dst-host` deny rules for OS connectivity-probe hosts still won over
     the new catch-all IP-layer allow — the device stayed captive during the grant window (with
     the one cosmetic Android stale-icon caveat noted above, which grants no real access and is
     already documented project-wide as an accepted quirk).
- **Existing machinery discovered in RESEARCH (informs requirements only — not the chosen
  mechanism, which INNOVATE decides):**
  - `packages/core/src/services/checkoutAccess.ts` already implements a per-device,
    source-IP-scoped, `veent-checkout:<epoch>`-tagged, TTL-swept walled-garden rule pattern —
    currently used only for 3 reCAPTCHA hosts. `sweepCheckoutAccess()` reclaims by TTL; current
    TTL constant is 15 minutes (this SPEC's resolved decision tunes a backstop TTL for THIS
    feature down to ~6 minutes — whether that is a new constant or a parameter is an
    INNOVATE/PLAN decision, not decided here).
  - The checkout action in `apps/customer/src/routes/top-up/+page.server.ts` already calls
    `openCheckoutAccess` before `createCheckout`, and that action is already rate-limited
    (`checkout_user`, limit 20).
  - `provisionWalledGarden` is purely additive/idempotent and never touches `veent-checkout:*`
    rows, so it is safe to re-provision without disturbing this mechanism.
  - `payment_checkouts` does not currently store the paying device's MAC/IP. Per the resolved
    decision above, this feature now confirms a requirement to add that (a schema/migration
    change) so the resolution path can revoke the correct device's access — the exact column
    shape and migration are INNOVATE/PLAN's job, not decided here.
  - Maya's `createCheckout` integration neither sets nor reads an explicit checkout expiry; the
    ~5-minute figure sometimes seen (`expiryTime=299`) is Maya's own server-side default and is
    unverified by our code — this is why the resolved ~6-minute backstop target is described as
    "adjustable if live testing shows Maya's real expiry differs."
- **Context docs consulted:** `process/context/all-context.md` (Maya payments section — browser
  return vs webhook origin gotcha, GCash walled-garden IP note; MikroTik/RouterOS section —
  walled-garden and captive-probe endpoint gotchas; Gotchas section generally). No conflicting
  active plan exists for this exact feature; related-but-distinct active plans
  (`purchase-ap-attribution`, `tx-ap-name-snapshot`, `finance-timestamptz-migration`,
  `multi-router-support`) do not overlap this scope.
- **High-risk class flag (per `orchestration.md §High-Risk Execution Handoff`):** the resolved
  revoke-on-resolution requirement adds a schema/migration touch to `payment_checkouts` and
  targets the payment-resolution (webhook) code path — both are named high-risk classes (schema
  migration; payments/billing). PLAN and VALIDATE for this feature must apply the
  `vc-risk-evidence-pack` manual-first evidence handoff before this is treated as ready for
  finalize or review closure.
