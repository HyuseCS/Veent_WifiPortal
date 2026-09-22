---
name: plan:walled-garden-canonical-spec
description: "Hard-reset + rebuild the staging router's walled garden entirely from code, with every row tagged and one canonical doc, so it's never guessed at again"
date: 30-07-26
feature: general-plans
---

# SPEC — Canonical, Code-Owned Walled Garden (Hard Reset + Rebuild)

## Summary

Right now the router's walled garden (the list of websites a guest phone can reach _before_ it
pays or logs in) is a mix of things our code put there, things a person typed in by hand months
ago, and duplicates left over from earlier fixes. Some of those hand-typed rules are doing real
work today (payments would break without them) but nothing in the code says so — you'd have to go
read the live router to find out. That's the "guessing" problem.

This task throws away every row on the router and rebuilds the walled garden from scratch, using
only what our code says should be there. Every row that comes back is something the code put
there on purpose, tagged so anyone can tell why it exists, and written down in one doc that always
matches reality. Nothing is added by hand afterward. If a payment stops working after the rebuild,
that's a signal the code is missing something — not "go SSH into the router and add another
mystery rule."

Staging has no live guests yet, so a short rebuild gap (the walled garden empty for a few minutes)
is an acceptable cost for getting this right once.

## User Stories / Jobs To Be Done

- As the operator, I want to wipe the router's walled garden and rebuild it from one script, so
  that I never again have to reverse-engineer which rows are load-bearing before I touch anything.
- As the operator, I want every surviving row to carry a tag that tells me what group it belongs
  to (payment gateway, captive-probe fix, portal/admin access, etc.), so I can read the live router
  and understand _why_ each row exists without opening the code.
- As a developer maintaining the walled garden, I want one document that always matches the code
  (not "mostly matches, last synced a few weeks ago"), so I can add a new payment host with
  confidence I'm not creating a duplicate or shadowing an existing rule.
- As the operator, I want confirmation that GCash and Maya checkout still complete successfully
  after the rebuild, so that fixing the mess doesn't quietly re-break payments.
- As the operator, I want the un-tagged manual rules that are currently doing real work (e.g. the
  Google Pay hosts nobody ever codified) to be identified and folded into the canonical code
  config, so the reset doesn't delete something that was silently load-bearing.
- As the operator, I want the captive-portal-probe "flap" fix (the deny rules that stop phones
  flashing "Connected" then reverting) to survive the rebuild untouched in behavior, so guests
  still see the correct "Sign in to network" prompt.

## What The User Wants (Behavioral Outcomes)

- The router's walled garden, after the rebuild, contains **only** rows the code created. No row
  exists on the router that isn't traceable to a specific line in the codebase.
- Every row (host or IP) carries a tag that groups it by purpose. Reading the tag alone tells a
  human what category of thing that row is for — the current situation (every code-owned row using
  one generic tag) is explicitly re-evaluated as part of this task (see Open Question).
- The dynamic/self-healing pieces (the GCash IP-resolver scheduler and its `gcash-auto` row)
  continue to run and self-heal without any code or config change — the rebuild does not disturb
  them structurally, only clears their current row so the scheduler recreates it.
- A guest phone still gets the correct captive-portal behavior after the rebuild: the OS
  "Sign in to network" prompt fires normally, with no flash of false "Connected" state.
- A guest can still complete a real Maya top-up purchase through GCash, and separately through any
  other supported payment method, end-to-end, after the rebuild — with no walled-garden-caused
  dead end.
- One document (the walled-garden runbook) is the single place a human reads to understand the
  full live rule set, its tags, and the reasoning behind each entry — and it is provably in sync
  with the code, not a stale snapshot.
- Running the reconciliation check after the rebuild reports "nothing to remove" — proof the live
  router state and the code's desired state are identical, not just similar.

## Flow / State Diagram

```
BEFORE (today)                                   AFTER (this task)
┌─────────────────────────────┐                  ┌─────────────────────────────┐
│ Router walled garden         │                  │ Router walled garden        │
│  - code-owned rows (tagged)  │                  │  - ALL rows code-owned      │
│  - un-tagged manual rows,    │   hard reset +   │  - every row tagged by      │
│    some load-bearing         │  ───rebuild───▶  │    purpose (taxonomy TBD)   │
│    (Google Pay hosts, etc.)  │                  │  - zero un-tagged rows      │
│  - duplicate/shadowing rows  │                  │  - zero duplicates          │
│  - doc partially stale       │                  │  - doc == code, provably    │
└─────────────────────────────┘                  └─────────────────────────────┘

Rebuild sequence (behavioral view — no implementation prescribed):

  1. Canonical config updated in code
     (adds: bare alipay.com, Google-login hosts, any other gap found — see Coverage Traps)
              │
              ▼
  2. Operator/agent triggers a hard reset on staging
     (wipes host-menu + ip-menu walled-garden rows)
              │
              ▼
  3. Rebuild runs from the updated canonical code config
     (all payment allows, all probe denies, all portal/admin IP allows recreated, tagged)
              │
              ▼
  4. Scheduler self-heals the dynamic GCash IP row
     (within its normal ~5-minute cadence — no manual step)
              │
              ▼
  5. Live verification
     ├─ GCash checkout completes end-to-end ─────────────┐
     ├─ Maya checkout completes end-to-end ───────────────┼─ all must pass
     ├─ Captive-probe flap fix still holds (no false 204) ┤  before this is
     └─ Reconcile dry-run reports "nothing to remove" ────┘  considered done
              │
              ▼
  6. Canonical doc rewritten to describe the exact resulting state
```

## Acceptance Criteria (Testable Outcomes)

1. **Zero un-tagged rows survive the rebuild.** Every row in both the host-menu and the ip-menu
   walled garden on the rebuilt staging router carries a code-assigned tag; none are attributable
   to manual operator entry.
   `proven by:` live router inspection after rebuild (`/ip hotspot walled-garden print`, `/ip hotspot walled-garden ip print`) — manual/scripted count check.
   `strategy:` Hybrid (scripted count + human read of the printed table).

2. **Zero duplicate rows.** No two rows match the same host (or same IP) after the rebuild — the
   live duplicates seen today (e.g. the `*gcash*` row appearing twice) do not reappear.
   `proven by:` live router inspection — duplicate-host scan on the printed table.
   `strategy:` Hybrid.

3. **Reconcile reports a clean match.** Running the existing reconcile-dry-run check against the
   rebuilt router reports nothing to remove — proof the router's code-owned rows exactly equal the
   code's desired set.
   `proven by:` `setup:router --reconcile --dry-run` on staging, post-rebuild.
   `strategy:` Fully-Automated (the dry-run command itself; result read by a human/agent).

4. **Previously-un-tagged-but-load-bearing hosts are preserved with coverage.** The hosts proven
   live-necessary this session but currently missing a code-owned counterpart — `pay.google.com`,
   `payments.google.com`, `*.googleapis.com`, `*.mynt.xyz` — are present in the canonical config
   and come back on the rebuilt router with the correct tag.
   `proven by:` config diff review (code) + live router inspection post-rebuild confirming each host is present.
   `strategy:` Hybrid.

5. **The bare-Alipay coverage gap is closed.** `alipay.com` (without a subdomain) is reachable
   pre-auth after the rebuild — not just `*.alipay.com`.
   `proven by:` canonical config contains `alipay.com` as a literal entry; live router inspection confirms the row exists post-rebuild.
   `strategy:` Hybrid.

6. **Google-login hosts are folded into the canonical, tagged config.** `accounts.google.com` and
   `accounts.google.com.ph` are present post-rebuild under the chosen tag scheme, not as a
   leftover hand-added row.
   `proven by:` canonical config review + live router inspection post-rebuild.
   `strategy:` Hybrid.

7. **The captive-probe flap fix is intact after the rebuild.** An un-granted guest device querying
   a known OS probe endpoint (e.g. `connectivitycheck.gstatic.com/generate_204`) does NOT get a
   real 204 response — it is intercepted, exactly as before the rebuild.
   `proven by:` live curl from an un-granted device/session against a probe host, before vs. after rebuild.
   `strategy:` Agent-Probe (requires live staging router + a session not yet granted).

8. **GCash checkout completes end-to-end after the rebuild.** A real ₱1-class GCash payment through
   the customer portal, initiated on staging after the rebuild, completes and grants access —
   with no walled-garden-caused connection failure.
   `proven by:` live checkout run on staging post-rebuild (manual or agent-browser-assisted).
   `strategy:` Agent-Probe (live-provider payment flow; needs explicit opt-in per feasibility-probe cost-class rules if a real charge is involved).

9. **Maya (non-GCash) checkout completes end-to-end after the rebuild.** At minimum one other
   supported payment path completes successfully post-rebuild.
   `proven by:` live checkout run on staging post-rebuild.
   `strategy:` Agent-Probe.

10. **The GCash IP-resolver scheduler is undisturbed.** The `gcash-resolve` scheduler item still
    exists, still runs on its ~5-minute cadence, and repopulates the `gcash-auto` IP row without
    any manual intervention after the reset.
    `proven by:` live inspection of `/system scheduler print where name=gcash-resolve` and the
    `gcash-auto` walled-garden-ip row, timed to confirm self-heal within one cycle.
    `strategy:` Agent-Probe.

11. **One canonical doc matches the rebuilt state exactly.** `docs/mikrotik/walled-garden.md` (or
    its replacement) lists every row category present on the router post-rebuild, its tag, and the
    reason it exists — with no row on the live router left undocumented and no documented row
    absent from the router.
    `proven by:` manual cross-check: doc content vs. live `/ip hotspot walled-garden print` output.
    `strategy:` Hybrid.

12. **The chosen tag taxonomy is applied consistently.** Every code-owned row's tag matches the
    scheme agreed at the Open Question below — no row uses an ad-hoc or inconsistent tag.
    `proven by:` code review of the provisioning call sites + live router inspection.
    `strategy:` Hybrid.

## Out Of Scope

- Retiring the disabled reCAPTCHA rows' _decision_ is scoped here (see Open Question), but any
  broader reCAPTCHA-handling redesign (e.g. changing how per-device checkout access opens
  `www.google.com`/`www.gstatic.com`) is out of scope — that mechanism is unchanged.
- The dead Stage C DoH/DoT block from `payment-walled-garden-v6` is NOT being resurrected or
  revisited — it is out of scope for this task and stays dead.
- Card-payment 3-D Secure bank ACS host coverage remains a per-deployment, capture-when-it-breaks
  concern — this task does not attempt to enumerate or pre-provision bank ACS hosts.
- No `--reconcile`-style pruning logic changes are in scope beyond what already exists — this task
  uses the existing reconcile/rebuild machinery as a tool for verification, it does not redesign
  it (that redesign, if any, belongs to a separate INNOVATE/PLAN decision).
- Production router is explicitly out of scope for the live rebuild and live verification steps —
  this task operates against staging only. A prod rollout, if wanted later, is a separate task.
- No change to how `ADMIN_WG_HOSTS`/`ADMIN_WG_IPS`/`ORIGIN` are read or validated — this task only
  changes what those existing inputs cause to be provisioned and how it's tagged/documented.
- Walled-garden behavior for apps other than the customer captive portal (e.g. locator, admin
  itself) is out of scope — this is scoped to the guest hotspot walled garden only.

## Constraints

- **Reset method is locked**: hard reset (wipe all walled-garden rows, host menu + ip menu) and
  full rebuild from code. This is not open for re-litigation in this SPEC or downstream phases.
- **Every surviving row must be tagged and code-owned.** No un-tagged row may remain after the
  rebuild — this is a hard acceptance bar, not a nice-to-have.
- `PROBE_DENIES` content and its ordering (denies placed above the allows) must be preserved
  exactly — this is the fix for the captive-portal "Connected"-then-reverts flap
  (`docs/problems/captive-connected-flap-on-free-time.md`) and must not regress.
- Browser return URLs for payment flows must never point at `TUNNEL_ORIGIN`/`webhookOrigin` — this
  existing durable rule is unaffected by this task but must not be broken by any change made here.
- The `gcash-resolve` scheduler and its self-healing `gcash-auto` IP row must not be manually
  recreated, hand-edited, or removed as part of the rebuild procedure — it must be left to self-heal
  on its own schedule.
- The dead Stage C DoH/DoT design from `payment-walled-garden-v6` must not be reintroduced.
- This task supersedes item 20 ("document the final canonical rule set" / manual walled-garden
  cleanup) of `process/general-plans/active/payment-walled-garden-v6_29-07-26/`. That item is
  considered absorbed here and should be marked superseded in the v6 plan, not duplicated.
- Staging only. No production walled-garden change is authorized by this SPEC.
- Staging has no live guests currently ([[staging-not-public]]) — this is what makes a brief
  rebuild gap (walled garden empty for a few minutes mid-rebuild) an acceptable cost; this
  constraint does not extend to production.

## Open Questions

**OQ-1 (the tag taxonomy — needs a user decision before PLAN):**

Today, every code-owned row (payment allows, probe denies, and the admin/portal IP allow) uses one
single tag: `veent-admin`. That already tells you "the code put this here," but it does not tell
you _which_ group a row belongs to without reading the code. The user's brainstorm explicitly asks
for "include tags" as part of making the garden self-explanatory, so this is the central decision
this SPEC surfaces for review.

- **Owner:** user (final pick), informed by this SPEC's recommendation below.

Options:

**A — Single tag, all code-owned rows (`veent-admin`).** Keeps exactly today's behavior. Simplest,
lowest risk, but reading the live router still doesn't tell you _why_ a given row exists — you'd
still need the doc or the code to know "is this a payment host or a probe-flap fix." Weakest fit
for "so it won't get confusing."

**B — Descriptive per-group tags (RECOMMENDED).** Split the single `veent-admin` tag into a small,
fixed set of purpose-named tags, e.g.:

- `veent-payment` — payment-gateway allow hosts (Maya, GCash, Alipay/Ant, Google Pay, etc.)
- `veent-probe` — the OS captive-probe deny rows (the flap fix)
- `veent-portal` — admin/portal origin allows (host or IP layer)
- `gcash-auto` — the dynamic scheduler-maintained IP row (already a distinct tag today — keep as-is)
- (Google-login hosts fold into `veent-payment` since they exist to support the Google Pay
  checkout path — no separate tag needed for them)

This directly satisfies "read a row, know why it's there" without opening the doc or the code.
The tradeoff is: every provisioning call site and the reconcile logic that currently matches on
a single hardcoded tag string needs to know about (or accept a parameter for) multiple tags —
more surface area than option A, but still small and mechanical (this is an INNOVATE/PLAN
concern, not a SPEC concern — the SPEC only fixes the _desired end-state taxonomy_, not how the
code gets there).

**C — One tag for everything code-owned, PLUS a documented-only sub-category in the comment
string** (e.g. `veent-admin:payment`, `veent-admin:probe` — a single tag _family_ using a
colon-suffix convention, similar to the existing timestamped-tag pattern already used elsewhere in
this codebase for admin-bypass bindings). This gets most of Option B's readability while keeping a
single top-level tag namespace (useful if some downstream code matches broadly on "is this ours at
all" without caring which sub-group). Slightly more consistent with an existing codebase
convention (`veent-admin:<epochMs>` for admin bypass) than inventing wholly new tag names.

**Recommendation:** Option B (or C as a close second) — a plain single tag does not resolve the
actual complaint ("so it won't get confusing" / "won't have to keep guessing"), since a human
reading the live router still can't tell a payment host from a probe-deny row without external
context. Option C is worth the user's consideration specifically because it reuses an existing
codebase pattern (colon-suffix tag families) rather than introducing a second convention — but
either B or C resolves the core ask; Option A does not. This SPEC does not lock the final choice;
it is presented to the user for the Phase-End Recommendation Gate.

**OQ-2 (disabled reCAPTCHA rows — keep as disabled documentation, or drop):**

- **Owner:** user, secondary to OQ-1.
- Today three reCAPTCHA-domain allow rows (`*.gstatic.com`, `*.google.com`, `*.recaptcha.net`)
  exist on the router but are DISABLED — they do nothing (the actual flap-fix enforcement is the
  `PROBE_DENIES` deny rows). They function only as an on-router note-to-self that "these are the
  domains reCAPTCHA needs, don't add them live."
  - Option 1: keep them, disabled, as documentation-in-the-router.
  - Option 2: drop them — the canonical doc already explains why they're excluded; a disabled row
    that does nothing is itself a small piece of "guessing" (why is a disabled rule sitting here?).
  - **Recommendation:** drop them (Option 2) — consistent with "every row has a reason a human can
    see without extra explanation"; the canonical doc is the place for this reasoning, not a
    disabled router row a future operator might puzzle over or accidentally enable.

Both open questions are surfaced at the Phase-End Recommendation Gate for the user's explicit
pick; neither blocks writing this SPEC (both have a stated recommendation the user can accept by
default), so `SPEC_INTENT_BLOCKED` is not warranted — but the user's actual pick on OQ-1 in
particular should be confirmed before PLAN, since it changes the shape of the provisioning code.

## Background / Research Findings

This SPEC is built entirely from a live diagnostic session against the staging router (RouterOS
6.49.18, CCR1036) on 30-07-26, plus the existing `payment-walled-garden-v6` plan/report from
29-07-26. Key facts:

- **Live router state (46 host-menu rows, 4 ip-menu rows):** a mix of code-owned rows tagged
  `veent-admin` (payment allow hosts, probe deny hosts, and one Google-login group added by hand
  this session under a distinct `veent-gpay` tag), dynamic mirror rows generated from the ip-menu,
  and a block of 12 completely un-tagged manual substring rules — some genuinely dead (0 hits),
  some duplicated (`*gcash*` appears twice), and some quietly load-bearing: `pay.google.com` (31
  hits), `payments.google.com` (17 hits), `*.googleapis.com` (274 hits), `*.mynt.xyz` (3 hits),
  and a 41-hit `*alipay*` substring that SHADOWS the codified `*.alipay.com` rule (because it
  additionally covers the bare `alipay.com` parent domain, which the enumerated `*.` form does
  not match).
- **The `gcash-resolve` scheduler** (`/system scheduler`, interval 5m, run-count 231 at time of
  research) is live and working: it re-resolves `payments.gcash.com`'s CNAME-to-Akamai target
  every 5 minutes and upserts a single `gcash-auto` walled-garden-ip row. This is unrelated to the
  dead Stage C DoH/DoT design — GCash's root cause was proven to be a CNAME-to-CDN matching gap,
  not DNS-hiding (see the `payment-walled-garden-v6` live diagnostic report, 29-07-26).
- **`PAYMENT_HOSTS`** (`apps/admin/scripts/walled-garden-config.ts`) already codifies most of the
  payment-gateway allow list (Maya, PayMaya, GCash, Alipay/Ant cashier hosts, Mynt/G-Xchange,
  Google Pay's `pay.google.com`/`payments.google.com`, and — as of the 29-07-26 session —
  `accounts.google.com`/`accounts.google.com.ph`). It does NOT yet include a bare `alipay.com`
  entry, which is why the un-tagged `*alipay*` substring is still doing real work live.
- **`PROBE_DENIES`** codifies the captive-portal-probe flap fix: deny rules for Android, Apple,
  Windows, and Firefox OS connectivity-check endpoints, deliberately placed above the payment/portal
  allow rules so a probe request never leaks a false 204. This is unrelated to payments and must
  survive the rebuild unchanged (`docs/problems/captive-connected-flap-on-free-time.md`).
- **`provisionWalledGarden()`** (`packages/core/src/integrations/network/mikrotik.ts`) currently
  tags every row it creates with a single default tag, `veent-admin` (parameterizable, but always
  called with the default today). `setup:router --reconcile [--dry-run]` already exists and can
  prune code-owned rows whose host/IP has drifted out of the desired set — but by design it never
  touches un-tagged rows (that's why the manual substrings above have survived every prior cleanup
  attempt). This existing reconcile logic is the acceptance-criteria tool for proving "router ==
  code" post-rebuild (AC3), not something this task needs to redesign.
- **`docs/mikrotik/walled-garden.md`** already documents most of this (two-layer host/IP model, the
  per-device reCAPTCHA design, the GCash resolve-script mechanism, the probe-deny ordering
  requirement, and an "Operator cleanup" section describing manual deletion of the substring rows)
  — but it does not yet reflect the Google-login hosts, the newly-found coverage gaps (bare
  `alipay.com`, the un-tagged-but-load-bearing Google/Mynt hosts), or a descriptive tag taxonomy.
  It is the doc this task rewrites to be the single, currently-true source.
- **This task explicitly supersedes item 20** of `process/general-plans/active/
payment-walled-garden-v6_29-07-26/` ("document the final canonical rule set" / manual
  walled-garden cleanup, which that plan deferred pending live router access — now available and
  used here). The v6 plan's `--reconcile` opt-in flag (item 22 in that plan) is reused, not
  reinvented, as the verification mechanism for AC3 here.
- **User-locked decisions** carried into this SPEC verbatim (not re-opened): (1) hard reset +
  rebuild from code as the reset method, justified by staging having no live users yet
  ([[staging-not-public]]) and by the `gcash-resolve` scheduler self-healing the dynamic row within
  its normal cadence; (2) every surviving row must be tagged and code-owned, with the specific
  taxonomy left open for this SPEC's review (OQ-1 above).
