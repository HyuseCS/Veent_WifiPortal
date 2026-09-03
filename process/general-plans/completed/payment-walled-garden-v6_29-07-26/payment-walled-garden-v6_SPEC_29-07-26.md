---
name: spec:payment-walled-garden-v6
description: "Fix GCash/Alipay walled-garden matching on the RouterOS v6 CCR1036 by blocking DoH/DoT so guest DNS falls back to the router's snooped resolver, plus expand PAYMENT_HOSTS — no v7 upgrade"
date: 29-07-26
feature: general-plans
---

# Payment Walled-Garden Fix (RouterOS v6, Path A) — SPEC

## Revision Note 29-07-26 (SPEC is locked — this note records a re-scope, does not reopen it)

A live diagnostic session (Stage B; see the plan's `payment-walled-garden-v6_REPORT_29-07-26.md`)
found two things that change what "done" means for AC3 and the DoH mechanism this SPEC originally
specified, without changing the SPEC's core problem statement (GCash checkout failing while
captive):

1. **The root cause is not DoH-hiding.** `payments.gcash.com` CNAMEs to Akamai; the v6 `dst-host`
   walled-garden mechanism can't follow a CNAME to a wildcard rule, regardless of plain vs.
   encrypted DNS. The DoT/DoH-block mechanism this SPEC's Flow/State Diagram and AC1 describe is
   **not built** — GCash is fixed instead via a `:resolve`-scheduler pattern that resolves the
   CNAME target directly and upserts an IP-layer allow. The _behavioral outcome_ AC1/AC2 describe
   (GCash checkout completes while captive) is still the goal and is confirmed live-working; the
   _mechanism_ is different from what this SPEC's Flow diagram depicts.
2. **AC3 (Google Pay checkout completes while captive) is downgraded to a known-limitation, not an
   achievable acceptance criterion.** Reachability was fixed live (missing `accounts.google.com` +
   `accounts.google.com.ph` host rules), but Google Pay itself refuses to run inside the captive
   portal's Android WebView (`OR_BIBED_15` — a Google policy check, not a network-reachability
   gap). Meeting AC3 as originally written would require the decoupled-payment-path redesign that
   is explicitly already listed below in **Out Of Scope** ("The decoupled-payment path... a later,
   separate phase"). AC3 is therefore reclassified from a shippable criterion to a documented
   known-limitation of the captive-portal payment surface, consistent with this SPEC's own
   Out-of-Scope boundary — not a scope change, a scope _clarification_ forced by live evidence.

This SPEC is otherwise still locked and still governs the plan. See the plan's own
§Re-Scoped Acceptance Criteria (added 29-07-26) for the corresponding plan-side detail.

## Summary

Guests paying by GCash (and, less confirmed, Google Pay) on the live WiFi portal sometimes see
the Maya checkout page fail to load or hang mid-payment, even though the guest is still supposed
to be allowed to reach payment sites while unauthenticated. The router (a RouterOS **v6** device —
too old for the clean v7 fix) currently decides which sites to let through by watching the
hostname a device asks for over plain DNS. Modern phones increasingly skip that plain DNS step
(they use encrypted DNS instead), so the router never sees the hostname and never opens the door —
this is the confirmed root cause of the GCash failure captured live on 23-07-26. This SPEC defines
a v6-compatible fix: force guest devices back onto the router's own DNS (by blocking the encrypted
DNS paths) so the existing allow-list mechanism can see and match payment hostnames again, and
expand that allow-list to include hosts discovered missing (notably GCash's `mdap.paas.mynt.xyz`
infrastructure host, which isn't covered by any existing wildcard).

## User Stories / Jobs To Be Done

- As a **guest paying for WiFi**, I want the GCash checkout page (and its bank/Alipay-cashier
  screens) to load and complete without a broken connection, so that I can pay and get online
  without asking staff for help or retrying repeatedly.
- As a **guest paying with Google Pay**, I want that checkout flow to load and complete the same
  way, so that Google Pay is a reliable option alongside GCash.
- As the **site operator**, I want the fix to work on the router hardware already installed
  (RouterOS v6, no upgrade), so that I don't need a hardware/firmware migration project just to
  keep payments working.
- As the **site operator**, I want the fix verified against a real GCash/Google Pay transaction on
  the actual staging router, not just in code review, so that I can trust it before it goes live
  for paying guests.
- As the **developer maintaining `setup-router.ts`**, I want the new firewall rules to be
  idempotent and documented in the existing operator runbook (`docs/mikrotik/walled-garden.md`),
  so that re-running the provisioning script is safe and the router config stays understandable.

## What The User Wants (Behavioral Outcomes)

- A guest device that is still "captive" (not yet authenticated / not yet paid) can reach GCash's
  checkout, redirect, and Alipay-cashier pages, and Google Pay's checkout pages, over HTTPS — and
  nothing else that isn't already allowed. The device must **not** appear "connected" to the
  operating system while still captive (this must not regress the earlier fix that kept the OS
  captive-portal popup working).
- To make that hostname-matching mechanism reliable again, the router additionally refuses guest
  devices' attempts to use encrypted DNS (DNS-over-HTTPS and DNS-over-TLS) — those attempts fail
  closed, causing the device's browser/OS to fall back to ordinary DNS, which the router already
  intercepts and already uses to build its allow-list matches.
- This is a whole-network behavior: **every guest**, not just guests mid-checkout, loses the
  ability to use encrypted DNS while connected to this hotspot (see the flagged assumption below —
  this is presented for explicit user sign-off, not assumed silently).
- The browser return trip after payment (success/cancel redirect back to the portal) keeps working
  exactly as it does today — this SPEC does not touch that mechanism.
- Staff re-running the router provisioning command does not create duplicate rules or otherwise
  change router behavior beyond adding whatever is newly missing.

## Flow / State Diagram

```
Guest device (captive, unauthenticated)
        │
        │ 1. Device tries encrypted DNS (DoH :443 to known provider IP, or DoT :853)
        ▼
  ┌─────────────────────────────────────────────┐
  │ Router: DoT (tcp/853) DROPPED                │
  │ Router: DoH provider IPs (tcp/443) DROPPED   │
  └─────────────────────────────────────────────┘
        │
        │ 2. Device/browser falls back to plain DNS (port 53)
        ▼
  ┌─────────────────────────────────────────────┐
  │ Router hotspot: intercepts port-53 DNS       │
  │ (already forced + allow-remote-requests=yes) │
  │ Router snoops the hostname the device asked  │
  └─────────────────────────────────────────────┘
        │
        │ 3. Guest opens GCash / Google Pay checkout (HTTPS)
        ▼
  ┌─────────────────────────────────────────────┐
  │ Walled-garden dst-host rule now MATCHES      │
  │ (router saw the hostname via step 2)          │
  │ → dynamic IP allow is created for that host   │
  └─────────────────────────────────────────────┘
        │
        │ 4. Payment pages load, checkout completes
        ▼
  Guest still shows "captive" to the OS the whole time
  (PROBE_DENIES untouched — no "Connected" flap)
        │
        │ 5. Maya redirects browser back to successUrl (ORIGIN, walled-gardened LAN address)
        ▼
  Guest lands back on portal, sees payment result
        │
        │ 6. (Non-GCash/GPay paths e.g. bank QR scan via separate bank app) — OUT OF SCOPE,
        │    documented as a known limitation, not fixed here
        ▼
  Guest completes top-up / gets online
```

Branch — a device that does NOT fall back to plain DNS after DoH/DoT is dropped (e.g. it has a
hardcoded DoH IP outside the blocklist, or bootstraps DoH over an unblocked port): checkout may
still fail. This residual risk is called out explicitly in Constraints/Open Questions, not hidden.

## Acceptance Criteria (Testable Outcomes)

1. **Live-capture proves the root cause is fixed.** On the staging router (10.210.54.133), after
   the fix is applied, a real GCash checkout and a real Google Pay checkout (using Maya's LIVE
   integration, not sandbox — this bug class does not reproduce in sandbox) are captured with a
   browser HAR, `/ip dns cache print detail`, and `/tool torch`, and the existing `dst-host`
   payment rules show `hits` going from `0` to a nonzero count during the transaction.
   `proven by:` staging live-checkout capture (manual/agent-probe session on real router + real
   Maya live wallet) · `strategy: Agent-Probe`
2. **GCash checkout completes while captive.** A guest device that starts a GCash top-up completes
   the full Maya→GCash→Alipay-cashier→return flow, the checkout UI renders and accepts payment
   input at every step, and the device is confirmed captive (not OS-"connected") throughout.
   `proven by:` staging live-checkout capture (GCash leg) · `strategy: Agent-Probe`
3. **Google Pay checkout completes while captive.** Same as #2 for the Google Pay path — this is
   currently UNCONFIRMED whether Google Pay checkout even renders reCAPTCHA/other Google hosts
   under this router's existing per-device checkout-access allow, so this criterion also confirms
   or corrects that assumption.
   `proven by:` staging live-checkout capture (Google Pay leg) · `strategy: Agent-Probe`
   **[REVISED 29-07-26 — see Revision Note above]: CONFIRMED UNACHIEVABLE in captive scope.**
   Live capture found Google Pay reachable (after adding `accounts.google.com` +
   `accounts.google.com.ph`) but blocked by Google's own `OR_BIBED_15` WebView policy check —
   reclassified as a documented known-limitation, not a criterion this SPEC's scope can meet.
4. **Stay-captive invariant holds.** Throughout DoH/DoT blocking + the expanded/matched
   walled-garden rules, the existing `PROBE_DENIES` set (Android/Apple/Windows/Firefox
   captive-probe hosts) still returns non-204 to an unauthenticated device — i.e. the OS never
   shows "Connected" before the guest has actually paid/authenticated. This directly guards
   against repeating the earlier invalidated `0.0.0.0/0` catch-all mistake.
   `proven by:` staging live-checkout capture, probe-host check (`curl` from an un-granted test
   device per the existing `walled-garden.md` "Verify" recipe) · `strategy: Agent-Probe`
5. **Browser return URL unaffected.** After a completed or canceled payment, the browser
   successfully returns to the portal's `successUrl`/`cancelUrl` (driven by `ORIGIN`, the
   walled-gardened LAN address) — this SPEC introduces no change to that mechanism and this
   criterion is a regression check, not new behavior.
   `proven by:` staging live-checkout capture (return-trip observation, same session as #1–2)
   · `strategy: Agent-Probe`
6. **Idempotent provisioning.** Re-running `bun run --filter radius-admin setup:router` after the
   DoT/DoH-block + expanded-`PAYMENT_HOSTS` change does not create duplicate firewall or
   walled-garden entries — a second run reports every rule as "already present," matching the
   existing print-then-add idempotency pattern used by `provisionWalledGarden()`.
   `proven by:` unit test on the extended provisioning function (mock RouterOS `conn.write`,
   assert second-call no-op) · `strategy: Fully-Automated`
7. **Non-payment guest DNS behavior is otherwise unchanged.** A guest device using ordinary
   (unencrypted) DNS continues to resolve and browse exactly as before — only encrypted-DNS paths
   (DoT/DoH) are newly blocked; plain port-53 DNS resolution for non-payment hosts is unaffected.
   `proven by:` staging live-capture session (general browsing check on the same captive test
   device, DoH/DoT disabled in browser to simulate normal fallback) · `strategy: Agent-Probe`

## Out Of Scope

- **[ADDED 29-07-26]** Google Pay checkout inside the captive-portal WebView — confirmed live
  unfixable by network/DNS/walled-garden config (`OR_BIBED_15`, a Google runtime-policy check
  against the CNA WebView, not a reachability gap). Falls under the decoupled-payment-path item
  below, same as 3DS cards.
- 3-D Secure / credit-card checkout support (existing known gap, documented in
  `docs/mikrotik/walled-garden.md` — unchanged by this SPEC).
- The decoupled-payment path (paying without staying captive on the same device) — a later,
  separate phase.
- Upgrading the router to RouterOS v7 — kept only as the escalation path if Path A proves
  insufficient live; not part of this work.
- A scheduled `:resolve`-to-address-list script to handle CDN low-TTL IP churn for the DoH
  provider-IP blocklist — build only if the live test in AC1 proves hostname/DNS-snoop matching
  alone cannot hold a full checkout together.
- QR-code payments where the guest scans with their own separate banking app on the same captive
  phone — the resulting traffic goes to an unpredictable bank domain that cannot be pre-allowed;
  this is a known, documented limitation, not something this SPEC fixes.
- Any admin dashboard UI changes.
- Card payments' bank-ACS 3DS redirect domains (per-deployment, already documented as a manual
  follow-up in the existing runbook).

## Constraints

- Router is RouterOS **6.49.18** on a CCR1036-8G-2S+ — no v7-only features (e.g.
  `/ip dns static address-list`) are available. Any implementation must use only v6-available
  RouterOS primitives (firewall filter rules, address lists, existing walled-garden mechanism).
- `/ip dns allow-remote-requests=yes` and hotspot DNS-redirect-to-self are already confirmed live
  and must not be disabled or altered by this work.
- The existing `PROBE_DENIES` deny-list and its "ABOVE the allows" ordering must be preserved —
  this is what prevents the "Connected"-then-reverts OS flap; nothing in this SPEC may reorder or
  weaken it.
- The browser return URL must continue to use `event.url.origin` (`ORIGIN`), never
  `TUNNEL_ORIGIN`/`webhookOrigin` — this is a durable rule from a prior incident
  (`maya-return-url-revert_23-07-26`) and is explicitly NOT to be touched by this work.
- `setup:router` is a manual operator step (`bun run --filter radius-admin setup:router`), not
  part of automated deploy — the fix must fit that same manual-run, idempotent-rerun model.
- `docs/mikrotik/walled-garden.md` is the operator-facing mirror of the provisioning script and
  must be kept in sync with whatever host/firewall changes ship.
- This bug class (hostname walled-garden rules not matching) is confirmed to only reproduce
  against Maya's **live** wallet integration — sandbox testing cannot validate the fix.
- `provisionWalledGarden()` currently has zero unit-test coverage; any code change to it should
  not make that gap worse without at least covering the new idempotency behavior (AC6).

## Open Questions

**None blocking** — the one substantive judgment call (whole-network DoH/DoT blocking) is captured
below as a flagged decision for explicit user sign-off at SPEC review, with a stated default. If
the user vetoes the default, Path A's design changes materially and this SPEC would need to be
revised before PLAN/INNOVATE proceeds.

- **Flagged assumption — owner: user.** Blocking DoT (tcp/853) and known DoH provider IPs (tcp/443)
  is a **whole-network** change: it disables private/encrypted DNS for **every** guest on the
  hotspot, not only guests who are mid-checkout. Default stance taken in this SPEC: **ACCEPTED**
  (this is a standard, common trade-off for captive hotspots, which already intercept and inspect
  plain DNS by design). If the user does not accept this trade-off, Path A as described here does
  not work and an alternative (e.g. the deferred scheduled-resolve script, or the v7 upgrade
  escalation) must be selected instead.
- **Unconfirmed — owner: live-capture (AC1/AC3).** Whether Google Pay's checkout actually needs
  `www.google.com` reCAPTCHA in this deployment is unconfirmed; the live-capture session will
  confirm or correct this and the host list may need a follow-up tweak based on what's observed.
- **Residual risk — owner: live-capture (AC1).** A device using a DoH endpoint not covered by the
  IP blocklist (e.g. a browser with a built-in unlisted DoH resolver, or one that bootstraps DoH
  over a non-443 port) may still fail to fall back to plain DNS. This SPEC does not claim 100%
  coverage of every possible encrypted-DNS implementation — the live-capture test is how coverage
  gaps get discovered, and any gap found becomes a documented known-limitation or backlog item,
  not a blocker to shipping Path A.

## Background / Research Findings

- **Confirmed live incident (23-07-26):** GCash checkout failed with `ERR_CONNECTION_CLOSED`
  loading `payments.gcash.com`. The `dst-host` walled-garden rules for `gcash.com`/`*.gcash.com`
  showed `hits=0` — the router never matched the traffic. Root cause is believed to be that modern
  phones bypass plain port-53 DNS via DoH/DoT, so the router's hostname-snooping mechanism (which
  depends on seeing the port-53 query) never fires and the dynamic allow never gets created. The
  operator worked around this live with a temporary manual IP allow
  (`/ip hotspot walled-garden ip add dst-address=<resolved IP>`), documented as non-durable in
  `process/general-plans/backlog/gcash-walled-garden-ip-productionize_NOTE_23-07-26.md`.
  Alipay-cashier supporting hosts (`*.alipay.com`, `*.alipayobjects.com`, `*.alicdn.com`) are
  equally unmatched by hostname rules and untested for completeness.
- **This is a separate root cause from the browser-return-URL incident** investigated the same
  session (`maya-return-url-revert_23-07-26`) — do not conflate the two; that incident's fix (never
  point `successUrl`/`cancelUrl` at `TUNNEL_ORIGIN`) is already shipped and is a hard constraint
  here, not something to revisit.
- **Router hardware confirmed:** RouterOS 6.49.18, CCR1036-8G-2S+. The clean v7 forced-DNS +
  `/ip dns static address-list` design (which would let dst-host rules always match regardless of
  DoH/DoT) is unavailable on v6 — that mechanism is 7.6/7.7-only. User explicitly chose Path A
  (v6-compatible fix, no upgrade) over upgrading firmware.
- **Existing mechanism already in place:** the MikroTik hotspot already force-redirects guest
  port-53 DNS to the router's own resolver, and `/ip dns allow-remote-requests=yes` is already
  set — these are prerequisites for Path A and are already confirmed live, not something this work
  needs to add.
- **Current `PAYMENT_HOSTS`** (`apps/admin/scripts/setup-router.ts`): `maya.ph`, `*.maya.ph`,
  `paymaya.com`, `*.paymaya.com`, `gcash.com`, `*.gcash.com`, `*.paymongo.com`, `*.xendit.co`.
  Research (this session's input) surfaces gaps: no entry for `*.alipay.com` /
  `*.alipayobjects.com` / `*.alicdn.com` / `*.antgroup.com` (Alipay-cashier dependency, currently
  covered informally at best), and **no entry at all** for `mdap.paas.mynt.xyz` (GCash/Mynt
  infrastructure host — not covered by any existing wildcard). Google Pay hosts (`pay.google.com`,
  `google.com`) are also not currently in `PAYMENT_HOSTS` at all — today Google-related access
  during checkout comes only from the narrower, per-device `CHECKOUT_ACCESS_HOSTS`
  (`www.google.com`, `www.gstatic.com`, `www.recaptcha.net` in
  `packages/core/src/services/checkoutAccess.ts`), which is deliberately NOT global (to avoid the
  documented "Connected"-then-reverts OS flap — see `docs/problems/captive-connected-flap-on-free-time.md`
  and the in-code comment in `setup-router.ts`). Any Google-host additions from the corrected list
  in this task must respect that existing per-device-vs-global split, not just be dumped into the
  global `PAYMENT_HOSTS` array — this nuance is a PLAN/INNOVATE-level design decision, not decided
  here.
- **No existing firewall-filter provisioning code.** `provisionWalledGarden()`
  (`packages/core/src/integrations/network/mikrotik.ts`) currently only touches
  `/ip/hotspot/walled-garden` (host layer) and `/ip/hotspot/walled-garden/ip` (IP layer) — it has
  no `/ip/firewall/filter` calls today. Blocking DoT (tcp/853) and DoH provider IPs (tcp/443) is
  new provisioning surface; `node-routeros`'s `conn.write()` is confirmed capable of creating
  `/ip/firewall/filter` and address-list rules (no library blocker), but the code to do so does not
  exist yet.
- **Two-layer walled-garden mechanism (existing, unchanged by this SPEC):**
  `/ip hotspot walled-garden` matches on `dst-host` (hostname/SNI, wildcards ok);
  `/ip hotspot walled-garden ip` matches on `dst-address` (IP/CIDR). Both are first-match,
  top-to-bottom, with `PROBE_DENIES` intentionally placed above payment/checkout allows.
- **`provisionWalledGarden()` has zero unit-test coverage today** — noted as a gap this task should
  not widen without at least covering new idempotency behavior.
- **QRPh caveat (research-confirmed, out of scope):** a guest scanning a QR code with their own
  bank's separate app on the same captive phone generates traffic to an unpredictable bank domain
  that cannot be pre-allowed — same unresolvable class as unknown 3DS ACS domains.
- Test-context routing consulted: `process/context/tests/all-tests.md` confirms `packages/core`
  uses Vitest for server-side logic (where `provisionWalledGarden`-style unit tests already live)
  and that live-hardware/live-provider behavior is outside any existing automated suite —
  consistent with marking the router-behavior criteria above as `Agent-Probe`, not
  `Fully-Automated`.
