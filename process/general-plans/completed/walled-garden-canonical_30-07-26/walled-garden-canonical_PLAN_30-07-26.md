---
name: plan:walled-garden-canonical
description: "Hard-reset + rebuild the staging router's walled garden entirely from code, with 3 veent-admin:<group> tag families and a canonical doc, so no row is ever hand-guessed again"
date: 30-07-26
feature: general-plans
---

# PLAN — Canonical, Code-Owned Walled Garden (Hard Reset + Rebuild)

**Date**: 30-07-26
**Status**: ✅ VERIFIED — code shipped (`252d748`), staging hard-reset + rebuild executed and
user-confirmed live 30-07-26. See `walled-garden-canonical_REPORT_30-07-26.md` (same folder) for
the closeout packet.

Complexity: **SIMPLE** (small, well-bounded blast radius: 3 code files + 1 doc + tests; no schema,
no new dependency, no new agent/runtime surface — but the change touches a live payment-adjacent
walled garden on staging, so treat verification with COMPLEX-plan rigor per the risk class).

## Overview

Split `provisionWalledGarden`'s current single merged call into 3 sequential calls (probe → payment
→ portal), each tagged `veent-admin:<group>`. Make `reconcileWalledGarden`'s exact-tag match into a
`veent-admin:` family-prefix match so it manages all 3 groups uniformly. Add the missing
`alipay.com` bare-domain entry to `PAYMENT_HOSTS` and confirm the Google-login hosts are present.
Rewrite `docs/mikrotik/walled-garden.md` as the canonical, currently-true doc. Then hard-reset
staging (wipe both walled-garden menus) and rerun `setup:router` to rebuild from code, verifying
zero un-tagged rows, zero duplicates, a clean `--reconcile --dry-run`, and live GCash + Maya
checkout success.

## Goals

- `setup-router.ts` provisions the walled garden as 3 tagged groups instead of one flat call.
- `reconcileWalledGarden` recognizes and manages the whole `veent-admin:*` family (still add-only
  for deny rows; still skip disabled/dynamic/empty-dst-host rows).
- `PAYMENT_HOSTS` gains bare `alipay.com`; Google-login hosts confirmed present.
- `docs/mikrotik/walled-garden.md` is rewritten to describe the exact resulting live state,
  including the hard-reset runbook.
- Staging rebuild is executed and live-verified (GCash + Maya checkout, probe-deny flap invariant,
  clean reconcile dry-run).

## Scope

In scope: `apps/admin/scripts/walled-garden-config.ts`, `apps/admin/scripts/setup-router.ts`,
`packages/core/src/integrations/network/mikrotik.ts` (`provisionWalledGarden` call sites only —
its exported signature/body is UNCHANGED; `reconcileWalledGarden`'s tag-match logic), their unit
tests, `docs/mikrotik/walled-garden.md`, and the staging live rebuild + verification.

Out of scope: everything the SPEC lists as Out Of Scope (prod, card 3DS ACS hosts, Stage C
DoH/DoT, `--reconcile` redesign beyond tag-family matching, `ADMIN_WG_HOSTS`/`ADMIN_WG_IPS`/
`ORIGIN` reading logic).

## Locked Design (from INNOVATE — do not re-open)

- **Tag scheme:** `veent-admin:<group>` colon family — `veent-admin:probe`, `veent-admin:payment`,
  `veent-admin:portal`. `gcash-auto` (scheduler-maintained dynamic IP row) is untouched, keeps its
  own tag.
- **3-call split, zero provisioner signature change:** `setup-router.ts` calls
  `provisionWalledGarden` 3 times in this exact order — **probe → payment → portal**. This order is
  LOAD-BEARING: on a wiped/fresh garden, `provisionWalledGarden`'s `beforeId` logic (mikrotik.ts
  ~1045-1054) finds the first enabled, non-dynamic, non-empty-dst-host `action=allow` row and places
  denies before it. If payment/portal hosts were provisioned before probe denies, the denies would
  still land above them (each call re-derives `beforeId` fresh), but running probe first guarantees
  a clean "denies land at the very top of an empty garden" state and matches the doc's stated
  order — do not swap the order without re-verifying the beforeId derivation holds either way.
- **`walled-garden-config.ts` stays flat arrays.** No group-tagging logic in the config module —
  `setup-router.ts` decides which array goes with which tag at each of the 3 call sites.
- **Hard reset is a documented manual router-command sequence, not new code.** No `--rebuild` flag.
  Both menus must be wiped:
  ```
  /ip hotspot walled-garden remove [find]
  /ip hotspot walled-garden ip remove [find]
  ```
  followed by `bun run --filter radius-admin setup:router`.
- **`reconcileWalledGarden` family-prefix match:** replace `r.comment !== tag` (exact equality) with
  a family-prefix check (`comment startsWith tag + ':'` OR `comment === tag`), default `tag` stays
  `'veent-admin'`. Preserve verbatim: `action === 'allow'`-only filter (deny rows never touched),
  disabled/dynamic/empty-dst-host host-layer skips, disabled/invalid ip-layer skip, and menu scoping
  (`/ip/hotspot/walled-garden` + its `/ip` sublayer only — never `/ip/hotspot/ip-binding`, where
  `ADMIN_BYPASS_TAG = 'veent-admin'` also lives but is a different resource entirely).

## Touchpoints

| File                                                      | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/admin/scripts/walled-garden-config.ts`              | Add bare `alipay.com` to `PAYMENT_HOSTS`; confirm `accounts.google.com`/`accounts.google.com.ph` already present (they are, per 29-07-26 addition — verify, do not re-add)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/admin/scripts/setup-router.ts`                      | Replace the single `provisionWalledGarden(config, { hosts, ips, denies })` call with 3 sequential calls: `{ denies: PROBE_DENIES, tag: 'veent-admin:probe' }`, then `{ hosts: PAYMENT_HOSTS, tag: 'veent-admin:payment' }`, then `{ hosts: adminHosts, ips: adminIps, tag: 'veent-admin:portal' }` (adminHosts/adminIps = today's `ADMIN_WG_HOSTS`/`ADMIN_WG_IPS`/origin-derived `hosts`/`ips` Sets, MINUS `PAYMENT_HOSTS` which moves to its own call). Update the `--reconcile` block to reconcile against the union of all 3 desired sets, or call `reconcileWalledGarden` per-group — see Implementation Notes below for the exact resolution. Update console logging to reflect the 3-group provisioning.                    |
| `packages/core/src/integrations/network/mikrotik.ts`      | `reconcileWalledGarden`: change `r.comment !== tag` (line ~1221, HOST layer) and `r.comment !== tag` (line ~1244, IP layer) to a family-prefix match against the base tag `'veent-admin'`. `provisionWalledGarden` itself: NO signature or body change — only its call sites in `setup-router.ts` change.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `packages/core/src/integrations/network/mikrotik.spec.ts` | Update `reconcileWalledGarden` describe block (~line 232-334): existing tests use tag `veent-admin` — adapt fixtures/assertions to the family-prefix behavior; add 3 new cases: (1) a `veent-admin:payment` allow row IS matched/managed by the default bare-`veent-admin`-tag reconcile call; (2) a bare foreign tag (e.g. `veent-other`) or an unrelated `veent-admin-x` (no colon separator) is NOT matched; (3) [VALIDATE-added, 30-07-26] a sub-tag-scoped reconcile call (e.g. `veent-admin:payment`) does NOT manage a sibling sub-tag's row (e.g. `veent-admin:portal`) — proves the 3 real `setup-router.ts` reconcile call sites stay isolated to their own group, since none of them ever passes the bare default tag. |
| `apps/admin/scripts/setup-router.spec.ts`                 | Re-run existing D-CAUTION collision guard unmodified — `alipay.com` must not collide with any `PROBE_DENIES` host (it doesn't; confirmed by inspection, no `alipay`-family entry exists in `PROBE_DENIES`). No new test needed here unless the guard needs updating to check bare-domain forms too (see Implementation Notes).                                                                                                                                                                                                                                                                                                                                                                                                    |
| `docs/mikrotik/walled-garden.md`                          | Full rewrite: every group + tag + entries + why, disabled-hosts rationale (reCAPTCHA rows dropped per OQ-2 recommendation — see Design Decisions), exact hard-reset runbook (both menus), gcash-resolve scheduler description, how `--reconcile` now manages the `veent-admin:*` family.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `apps/admin/scripts/apply-probe-denies.ts`                | RECOMMEND DELETE (dead one-off per INNOVATE finding) — flagged explicitly in EXECUTE checklist, not silently removed. If deleted, confirm no other script imports it (`grep -rn apply-probe-denies` across the repo).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

## Public Contracts

- `provisionWalledGarden(config, input)` — **unchanged** exported signature and behavior
  (`WalledGardenInput` / `WalledGardenResult` untouched). Only its call-site _arguments_ change
  (now called 3× with different `tag` + subset of hosts/ips/denies instead of once with everything).
- `reconcileWalledGarden(config, input)` — signature unchanged (`ReconcileWalledGardenInput` /
  `ReconcileWalledGardenResult`); **behavior change**: `tag` now matches the whole
  `veent-admin:*` family by default instead of exact `veent-admin` equality. This is the one real
  public-contract behavior change in this plan — any other caller relying on exact-tag matching
  would be affected. Repo-wide grep confirms `reconcileWalledGarden` is only called from
  `setup-router.ts`, so this is safe.
- `PAYMENT_HOSTS` / `PROBE_DENIES` exported arrays — content grows (1 new entry), shape unchanged.
- No schema change. No new dependency. No new runtime surface. No API-route change (this is all
  operator-script + integration-library surface, not app request-handling code).

## Blast Radius

- **Files touched:** 6 (5 code/test + 1 doc), plus 1 optional deletion (`apply-probe-denies.ts`).
- **Packages:** `apps/admin` (scripts + spec), `packages/core` (integration + spec), `docs/`.
- **Risk class: MEDIUM.** Payments-adjacent (walled garden gates payment-gateway reachability) and
  it's a live-router rebuild — but staging-only ([[staging-not-public]], no live guests), fully
  reversible (rerun `setup:router` restores state; nothing destructive to persistent data), and the
  code-level diff is small and mechanical (call-site restructuring + a prefix-match tweak, not new
  logic). Per CLAUDE.md's high-risk-class list this touches "deploy/runtime" adjacent territory
  (router config) but not auth/billing/schema/migration/API-contract directly — a manual-first
  live-verification step is still required before calling this done (see Verification Evidence).

## Design Decisions Carried From SPEC/INNOVATE (not re-litigated here)

1. **Tag taxonomy = Option C** (`veent-admin:<group>` colon family) — the task's INNOVATE lock,
   distinct from the SPEC's own Option-B recommendation; SPEC explicitly left the final pick to the
   user and the colon-family scheme is what was locked for this PLAN. Reuses the existing
   `ADMIN_BYPASS_TAG`-style colon-suffix convention already used for admin-bypass bindings
   (`veent-admin:<epochMs>`), so no second tagging convention is invented.
2. **OQ-2 (disabled reCAPTCHA rows):** DROP them (SPEC's own recommendation, Option 2) — they do
   nothing live (the actual enforcement is `PROBE_DENIES`), and a disabled row that survives a
   from-scratch rebuild for no functional reason reintroduces exactly the "why is this here"
   guessing problem this task exists to close. Because the rebuild starts from a wipe and
   `provisionWalledGarden` never creates disabled rows, this requires NO code change — simply not
   re-adding them. The doc must explain WHY `*.google.com`/`*.gstatic.com`/`*.recaptcha.net` stay
   un-allowed (captive-probe flap risk), so a future operator doesn't "helpfully" re-add them.

## Implementation Notes (resolving ambiguity before EXECUTE)

**3-call split — exact `setup-router.ts` structure:**

Current code computes ONE `hosts` Set (`ADMIN_WG_HOSTS` ∪ `PAYMENT_HOSTS` ∪ origin-derived host)
and ONE `ips` Set (`ADMIN_WG_IPS` ∪ origin-derived ip), then calls `provisionWalledGarden` once
with `{ hosts, ips, denies: PROBE_DENIES }`. The 3-call split must separate `PAYMENT_HOSTS` out of
the merged `hosts` Set into its own call:

```
adminHosts = new Set([...splitList(ADMIN_WG_HOSTS)])   // PAYMENT_HOSTS removed from this Set
adminIps   = new Set([...splitList(ADMIN_WG_IPS)])
// origin-derived host/ip still added to whichever of adminHosts/adminIps matches its shape
// (unchanged derivation logic — just target the "portal" Set now, not the old merged Set)

call 1: provisionWalledGarden(config, { denies: PROBE_DENIES, tag: 'veent-admin:probe' })
call 2: provisionWalledGarden(config, { hosts: [...PAYMENT_HOSTS], tag: 'veent-admin:payment' })
call 3: provisionWalledGarden(config, { hosts: [...adminHosts], ips: [...adminIps], tag: 'veent-admin:portal' })
```

**`--reconcile` block — per-group reconcile (not a single merged reconcile call):** because each
group now has a DISTINCT desired set and a DISTINCT tag, `reconcileWalledGarden` must be called
3 times too — once per tag/desired-set pair — mirroring the 3 provision calls:

```
reconcile 1: reconcileWalledGarden(config, { hosts: [], ips: [], tag: 'veent-admin:probe', dryRun })
             // hosts/ips empty is fine — this group only has denies, which reconcile never removes anyway
reconcile 2: reconcileWalledGarden(config, { hosts: [...PAYMENT_HOSTS], ips: [], tag: 'veent-admin:payment', dryRun })
reconcile 3: reconcileWalledGarden(config, { hosts: [...adminHosts], ips: [...adminIps], tag: 'veent-admin:portal', dryRun })
```

Merge each call's `removed` array into one combined report for console output, matching today's
single-block log shape.

**Family-prefix match in `reconcileWalledGarden` — exact code change:**

```ts
// before (line ~1221 and ~1244):
if (r.comment !== tag) continue;

// after — family-prefix match, base tag = 'veent-admin' by default:
if (r.comment !== tag && !r.comment?.startsWith(`${tag}:`)) continue;
```

Callers that already pass a specific sub-tag (`'veent-admin:payment'`) get exact-match-only
behavior naturally (no rows start with `'veent-admin:payment:'` today), which is what the 3-call
reconcile split above relies on — each reconcile call only manages its own group. This is the
SAME `commentMatchesTag`-style pattern already used for `ADMIN_BYPASS_TAG` (mikrotik.ts line
~112) — reuse or mirror that helper rather than hand-rolling a new prefix check, per existing
codebase convention.

**`alipay.com` collision-guard re-check:** `setup-router.spec.ts`'s existing D-CAUTION guard
compares `PAYMENT_HOSTS` entries against `PROBE_DENIES` hosts case-insensitively, exact string
match. `alipay.com` (bare) does not equal any `PROBE_DENIES.host` value (`connectivitycheck.*`,
`clients[1-4].google.com`, `www.google.com`, `captive.apple.com`, `www.msftconnecttest.com`,
`www.msftncsi.com`, `detectportal.firefox.com`) — confirmed by inspection, guard passes unmodified,
no test change required for this specific addition.

**`apply-probe-denies.ts` deletion:** confirmed dead by INNOVATE — its own docstring says "safe to
delete after running" and it duplicates `PROBE_DENIES` inline rather than importing from
`walled-garden-config.ts` (so it can silently drift). Grep the repo for any import/reference before
deleting to be safe (expected: none, it's invoked only via its own `bun --env-file=... script.ts`
shebang comment, never imported).

## Acceptance Criteria (inherited from SPEC, verbatim numbering)

1. Zero un-tagged rows survive the rebuild (host-menu + ip-menu).
2. Zero duplicate rows (no two rows match the same host/IP).
3. `setup:router --reconcile --dry-run` reports "nothing to remove" post-rebuild.
4. Previously-un-tagged-but-load-bearing hosts (`pay.google.com`, `payments.google.com`,
   `*.googleapis.com`, `*.mynt.xyz`) present in canonical config, come back tagged post-rebuild.
5. Bare `alipay.com` reachable pre-auth post-rebuild.
6. `accounts.google.com` / `accounts.google.com.ph` present post-rebuild under `veent-admin:payment`.
7. Captive-probe flap fix intact — un-granted device probing a known OS endpoint does NOT get a
   real 204.
8. GCash checkout completes end-to-end post-rebuild.
9. Maya (non-GCash) checkout completes end-to-end post-rebuild.
10. `gcash-resolve` scheduler undisturbed — still runs, still self-heals `gcash-auto` row.
11. `docs/mikrotik/walled-garden.md` matches rebuilt state exactly (every row category, tag, reason
    — no undocumented live row, no documented-but-absent row).
12. Tag taxonomy applied consistently — every code-owned row uses `veent-admin:<group>`, no ad-hoc
    tags.

## Implementation Checklist

1. `apps/admin/scripts/walled-garden-config.ts`: add `'alipay.com',` to `PAYMENT_HOSTS` (near the
   existing `*.alipay.com` entry), with a comment explaining the bare-domain gap (AC5). Confirm
   `accounts.google.com`/`accounts.google.com.ph` are already present — they are (29-07-26 addition);
   no action needed beyond confirming.
2. `packages/core/src/integrations/network/mikrotik.ts`: change `reconcileWalledGarden`'s two
   `r.comment !== tag` checks (HOST layer ~line 1221, IP layer ~line 1244) to the family-prefix
   match shown in Implementation Notes. Update the function's JSDoc (currently says "exact-equality
   tag match") to describe the new family-prefix behavior and its safety implications (why a
   caller passing a specific sub-tag still only manages its own group).
3. `packages/core/src/integrations/network/mikrotik.spec.ts`: update the `reconcileWalledGarden`
   describe block's fixtures to use `veent-admin:payment`/`veent-admin:portal`/`veent-admin:probe`
   sub-tags where a specific group is being tested; add 3 new test cases (family-prefix match
   positive case; foreign/bare-tag negative case; sub-tag sibling isolation case — VALIDATE-added,
   30-07-26) per the Touchpoints row above. Run this file
   (`bunx vitest run packages/core/src/integrations/network/mikrotik.spec.ts`) until green.
4. `apps/admin/scripts/setup-router.ts`: restructure the single `provisionWalledGarden` call into
   the 3-call split (probe → payment → portal) per Implementation Notes, splitting `PAYMENT_HOSTS`
   out of the merged `hosts` Set into its own `payment` call. Restructure the `--reconcile` block
   into the matching 3-call `reconcileWalledGarden` split. Update the console logging (BOTH the
   pre-provisioning summary block and the post-provisioning result log) to report each of the 3
   groups distinctly (group name + tag + hosts/ips/denies touched). Add a code comment stating the
   probe-first call order is load-bearing (mirrors the PLAN's Locked Design note) so a future edit
   doesn't silently reorder the calls.
5. Run `bunx vitest run apps/admin/scripts/setup-router.spec.ts` (D-CAUTION collision guard) —
   confirm still green with the new `alipay.com` entry (no code change expected, verification only).
6. `bun run --filter radius-admin check` (typecheck) and the admin package's scoped lint — confirm
   0 errors from steps 1-4's diff.
7. Decide + act on `apps/admin/scripts/apply-probe-denies.ts`: grep the repo to confirm it is
   unreferenced, then delete it (recommended per INNOVATE finding) — call this out explicitly in
   the phase report, do not silently remove.
8. `docs/mikrotik/walled-garden.md`: full rewrite. Must cover: (a) the 3 tag groups
   (`veent-admin:probe`/`veent-admin:payment`/`veent-admin:portal`) + `gcash-auto`, what's in each
   and why; (b) the dropped-disabled-reCAPTCHA-rows rationale (OQ-2); (c) the exact hard-reset
   runbook — both menu wipe commands verbatim, then `bun run --filter radius-admin setup:router`;
   (d) the gcash-resolve scheduler mechanism (unchanged, just re-described in the new doc
   structure); (e) how `--reconcile` now manages the `veent-admin:*` family per-group.
9. **Staging execution — hard reset + rebuild** (Agent-Probe / live-hardware step, requires
   staging router access): run the documented wipe (both menus), then
   `bun run --filter radius-admin setup:router`. Confirm console output shows all 3 groups
   provisioned + scheduler present.
10. **Staging verification — structural** (AC1, AC2, AC3, AC10, AC12): inspect
    `/ip/hotspot/walled-garden print` + `/ip/hotspot/walled-garden/ip print` — confirm zero
    un-tagged rows, zero duplicate host/IP values, every code-owned row's tag matches one of the 3
    families. Run `setup:router --reconcile --dry-run` — confirm "nothing to remove" for all 3
    groups. Confirm `gcash-resolve` scheduler present and `gcash-auto` IP row self-heals within one
    ~5-minute cycle.
11. **Staging verification — content coverage** (AC4, AC5, AC6): confirm
    `pay.google.com`/`payments.google.com`/`*.googleapis.com`/`*.mynt.xyz`/`alipay.com`/
    `accounts.google.com`/`accounts.google.com.ph` are all present and tagged `veent-admin:payment`.
12. **Staging verification — behavioral** (AC7, AC8, AC9): confirm the captive-probe deny (curl a
    known OS probe host from an un-granted session, confirm non-204); run a live GCash checkout to
    completion; run a live non-GCash Maya checkout to completion.
13. **Doc verification** (AC11): cross-check the rewritten `docs/mikrotik/walled-garden.md` against
    the actual post-rebuild `/ip/hotspot/walled-garden print` output — every live row documented,
    every documented row live.
14. Update `process/general-plans/active/payment-walled-garden-v6_29-07-26/` — mark its item 20
    (manual walled-garden cleanup / canonical doc) as superseded by this plan, per the SPEC's
    Constraints section, so it isn't duplicated or re-attempted there.

## Dependencies / Sequencing

- Steps 1-8 (code + doc) have no external dependency and can be done in any reasonable order within
  the checklist sequence above; step 3 (test update) depends on step 2 (the code change it tests).
- Steps 9-13 depend on ALL of steps 1-8 being complete and merged/deployed to the staging box
  (`bun run --filter radius-admin setup:router` must run the NEW 3-call code, not the old single
  call) — do not run the staging rebuild against stale code.
- Step 14 (v6 plan supersession note) can happen any time after this plan is approved; not gated on
  execution completion.

## Risks

| Risk                                                                                                                         | Mitigation                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wiping the walled garden mid-rebuild briefly opens/closes reachability (payment hosts unreachable for the gap)               | Staging-only, no live guests ([[staging-not-public]]) — explicit SPEC constraint accepts this cost                                                                                                                                                                                                                                                                                                |
| Reconcile family-prefix match accidentally widens what a specific-subtag reconcile call manages                              | Each of the 3 reconcile calls in setup-router.ts passes its OWN specific sub-tag (`veent-admin:payment` etc), not the bare `veent-admin` family root — so each call's prefix-match only ever matches its own group's rows (no row today starts with e.g. `veent-admin:payment:`) — VALIDATE (30-07-26) confirmed by reading the code this is exact-match-only in practice at every real call site |
| Deleting `apply-probe-denies.ts` breaks something unexpectedly                                                               | Grep-confirm zero references before deleting; call out in phase report rather than silent removal                                                                                                                                                                                                                                                                                                 |
| Live checkout verification (AC8/AC9) touches real payment flows                                                              | Staging Maya sandbox / low-value (₱1-class) real GCash txn per existing project convention (see maya-live-return-url precedent); explicit Agent-Probe tier, not fully-automated                                                                                                                                                                                                                   |
| Call-order (probe→payment→portal) silently reordered in a future edit, breaking deny-above-allow guarantee on next full wipe | Explicit code comment at the 3-call site (checklist item 4) + this plan's Locked Design section documents WHY the order matters                                                                                                                                                                                                                                                                   |

## Verification Evidence

| Gate / Scenario                                                                                                                 | Strategy        | Proves SPEC criterion                              |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------- |
| `bunx vitest run packages/core/src/integrations/network/mikrotik.spec.ts` (updated reconcile describe block, incl. 3 new cases) | Fully-Automated | AC12 (tag consistency, code-level)                 |
| `bunx vitest run apps/admin/scripts/setup-router.spec.ts` (D-CAUTION collision guard, unmodified)                               | Fully-Automated | AC5 (no collision introduced by bare `alipay.com`) |
| `bun run --filter radius-admin check` (typecheck) + scoped lint                                                                 | Fully-Automated | General code-health gate for the diff              |
| Live router inspection — `/ip hotspot walled-garden print` + `.../ip print`, post-rebuild, count un-tagged/duplicate rows       | Hybrid          | AC1, AC2                                           |
| `setup:router --reconcile --dry-run` on staging, post-rebuild, per-group                                                        | Hybrid          | AC3                                                |
| Config diff review + live router inspection for the 5 previously-un-tagged-but-load-bearing hosts                               | Hybrid          | AC4                                                |
| Config content check (`alipay.com` literal present) + live router inspection                                                    | Hybrid          | AC5                                                |
| Config content check (Google-login hosts present) + live router inspection                                                      | Hybrid          | AC6                                                |
| Live curl from an un-granted session against a known OS probe host, before vs after rebuild                                     | Agent-Probe     | AC7                                                |
| Live GCash checkout end-to-end on staging post-rebuild                                                                          | Agent-Probe     | AC8                                                |
| Live non-GCash Maya checkout end-to-end on staging post-rebuild                                                                 | Agent-Probe     | AC9                                                |
| Live inspection of `/system scheduler print where name=gcash-resolve` + `gcash-auto` row self-heal timing                       | Agent-Probe     | AC10                                               |
| Manual cross-check: rewritten `docs/mikrotik/walled-garden.md` vs live router printout                                          | Hybrid          | AC11                                               |
| Code review of the 3 provisioning call sites + live router inspection of tag values                                             | Hybrid          | AC12                                               |

## Test Infra Improvement Notes

(none identified yet)

## Resume and Execution Handoff

1. **Selected plan file path:** `process/general-plans/active/walled-garden-canonical_30-07-26/walled-garden-canonical_PLAN_30-07-26.md`
2. **Last completed phase or step:** VALIDATE complete (Gate: PASS, 30-07-26); no EXECUTE work started.
3. **Validate-contract status:** written below — Gate: PASS.
4. **Supporting context files loaded:** `process/context/all-context.md`, `process/context/tests/all-tests.md`, `walled-garden-canonical_SPEC_30-07-26.md`, `apps/admin/scripts/walled-garden-config.ts`, `apps/admin/scripts/setup-router.ts`, `packages/core/src/integrations/network/mikrotik.ts` (lines ~80-140, ~960-1260), `packages/core/src/integrations/network/mikrotik.spec.ts` (full reconcile describe block), `apps/admin/scripts/setup-router.spec.ts`, `apps/admin/scripts/apply-probe-denies.ts`, `docs/mikrotik/walled-garden.md` (existence/length only), `process/general-plans/active/payment-walled-garden-v6_29-07-26/` (item-20/22 cross-reference confirmed).
5. **Next step for a fresh agent:** ENTER EXECUTE MODE against this plan — run the Implementation Checklist in order (steps 1-8 code/doc, then steps 9-13 staging live rebuild + verification gated on 1-8 being deployed, then step 14 v6-plan supersession note).

## Phase Completion Rules

This is a SIMPLE, single-phase plan — no phase table. The plan is complete when all Implementation
Checklist items (1-14) are done AND every row in Verification Evidence is green (Fully-Automated +
Hybrid gates pass; Agent-Probe scenarios confirmed live on staging). Code-only completion (checklist
1-8 done, gates green, but 9-13 staging verification not yet run) is `CODE DONE`, not `VERIFIED` —
do not report this plan as fully done until the live staging rebuild + verification steps (9-13)
have actually been executed and confirmed.

### ✅ VERIFIED — closeout (30-07-26)

- Checklist items 1-8 (code + doc) shipped in `252d748` (3-tag-family split, `alipay.com` bare host,
  `reconcileWalledGarden` family-prefix match, `docs/mikrotik/walled-garden.md` canonical rewrite,
  `apply-probe-denies.ts` deleted).
- Checklist item 9 (staging hard reset + rebuild) executed on staging (10.210.54.133 / router
  10.210.0.1) — user ran both-menu wipe + `bun run --filter radius-admin setup:router`.
- Checklist item 14 (mark v6 item 20 superseded) done in the companion `payment-walled-garden-v6`
  plan update this session — see that plan's status note.
- Checklist items 10-13 (structural / content / behavioral staging verification) — user directly
  confirmed the live rebuild "works" (staging router reconciles cleanly, GCash/Maya checkout
  functioning, walled-garden intact). Per user closeout instruction this session, classified
  VERIFIED. Known-gap: this closeout does not carry a granular per-AC (AC1-AC12) live evidence
  trail beyond the user's session-level confirmation — if a fresh per-criterion audit trail is
  needed later, re-run steps 10-13 explicitly and record each AC's evidence individually.

## Validate Contract

Status: PASS
Date: 30-07-26
date: 2026-07-30
generated-by: outer-pvl

Parallel strategy: sequential (single-agent deep read)
Rationale: 7-signal score = 3/7 (S5 user-requested depth, S6 payments/router-adjacent risk class,
S7 6 files in blast radius) → MEDIUM threshold would normally suggest parallel subagents, but every
one of the 4 dimensions + all Layer-2 sections turned on the SAME 2 source files
(`mikrotik.ts`/`mikrotik.spec.ts`) read with cross-cutting understanding (tag-match semantics,
call-site behavior, menu scoping) — partitioning that across parallel agents would have caused
redundant re-reads of the same ~300 lines with no independent-verification benefit. Per the
strategy-compare "fit note" (the right strategy is the one that fits the work, not the highest
tier), a single deep sequential read was used instead. No VC-FEASIBILITY-PROBE-NEEDED was required —
every infra-fit/breaking-change/security question was resolvable by reading source, per the user's
explicit instruction to "confirm by reading, not assuming."

Test gates (C3 5-column table):

| criterion id | behavior                                                                                                                                                                                                                               | strategy                                                                                                                                                                                        | proving test                                                                                                                                 | gap-resolution                                             |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| AC12-a       | Existing 8 `reconcileWalledGarden` test cases still pass unmodified under family-prefix matching (regression — exact-tag rows are unaffected by the widened check)                                                                     | Fully-Automated                                                                                                                                                                                 | `bunx vitest run packages/core/src/integrations/network/mikrotik.spec.ts`                                                                    | A                                                          |
| AC12-b       | Bare `veent-admin`-tag reconcile call DOES manage a `veent-admin:payment`-tagged allow row (family-prefix positive match)                                                                                                              | Fully-Automated                                                                                                                                                                                 | same file — new case (checklist item 3)                                                                                                      | B                                                          |
| AC12-c       | Bare `veent-admin`-tag reconcile call does NOT manage a foreign tag (`veent-other`) or a bare-no-colon lookalike (`veent-admin-x`) row                                                                                                 | Fully-Automated                                                                                                                                                                                 | same file — new case (checklist item 3)                                                                                                      | B                                                          |
| AC12-d       | A sub-tag-scoped reconcile call (`veent-admin:payment`) does NOT manage a sibling sub-tag's row (`veent-admin:portal`) — closes the gap this VALIDATE pass found; proves the 3 real setup-router.ts reconcile call sites stay isolated | Fully-Automated                                                                                                                                                                                 | same file — new case (checklist item 3, added by this VALIDATE pass)                                                                         | B                                                          |
| AC5          | Bare `alipay.com` in `PAYMENT_HOSTS` collides with no `PROBE_DENIES` host                                                                                                                                                              | Fully-Automated                                                                                                                                                                                 | `bunx vitest run apps/admin/scripts/setup-router.spec.ts`                                                                                    | A                                                          |
| general      | `apps/admin` typecheck + scoped lint clean on this diff                                                                                                                                                                                | Fully-Automated                                                                                                                                                                                 | `bun run --filter radius-admin check`                                                                                                        | B                                                          |
| AC1, AC2     | Zero un-tagged rows / zero duplicate host-or-IP rows survive the rebuild                                                                                                                                                               | Hybrid — precondition: staging router reachable (10.210.0.1) and steps 1-8 deployed                                                                                                             | live `/ip hotspot walled-garden print` + `/ip hotspot walled-garden/ip print` inspection on staging, post hard-reset + `setup:router` rerun  | B                                                          |
| AC3          | `--reconcile --dry-run` reports nothing-to-remove for all 3 groups post-rebuild                                                                                                                                                        | Hybrid — precondition: same as above                                                                                                                                                            | `bun run --filter radius-admin setup:router --reconcile --dry-run` on staging                                                                | B                                                          |
| AC4          | Previously-un-tagged load-bearing hosts (`pay.google.com`, `payments.google.com`, `*.googleapis.com`, `*.mynt.xyz`) preserved + tagged `veent-admin:payment` post-rebuild                                                              | Hybrid — config half already proven statically (confirmed present in `PAYMENT_HOSTS` by reading the file); live-tag half needs staging                                                          | config diff review (done) + live router inspection post-rebuild                                                                              | A (config) / B (live tag)                                  |
| AC6          | `accounts.google.com` / `accounts.google.com.ph` present + tagged `veent-admin:payment` post-rebuild                                                                                                                                   | Hybrid — config half already proven statically                                                                                                                                                  | config content check (done — both hosts confirmed present at lines 72-73 of `walled-garden-config.ts`) + live router inspection post-rebuild | A (config) / B (live tag)                                  |
| AC11         | Rewritten `docs/mikrotik/walled-garden.md` matches the live post-rebuild state exactly (no undocumented row, no documented-but-absent row)                                                                                             | Hybrid — precondition: doc rewritten (checklist item 8) and staging rebuilt                                                                                                                     | manual cross-check: doc content vs. live `/ip hotspot walled-garden print` output                                                            | B                                                          |
| AC12-full    | Every code-owned row's tag matches one of the 3 families consistently, live                                                                                                                                                            | Hybrid — precondition: staging rebuilt                                                                                                                                                          | code review of the 3 provisioning call sites (done) + live tag-value inspection                                                              | B                                                          |
| AC7          | Captive-probe flap fix intact — an un-granted device probing a known OS endpoint does NOT get a real 204 after rebuild                                                                                                                 | Agent-Probe — needs-live-provider (staging router + an un-granted session)                                                                                                                      | live curl from an un-granted device/session against a probe host, before vs. after rebuild                                                   | B                                                          |
| AC8          | GCash checkout completes end-to-end post-rebuild                                                                                                                                                                                       | Agent-Probe — needs-live-provider (real ₱1-class GCash payment; requires explicit double opt-in per feasibility-probe cost-class rules before dispatching)                                      | live checkout run on staging post-rebuild                                                                                                    | B                                                          |
| AC9          | Maya (non-GCash) checkout completes end-to-end post-rebuild                                                                                                                                                                            | Agent-Probe — needs-live-provider                                                                                                                                                               | live checkout run on staging post-rebuild                                                                                                    | B                                                          |
| AC10         | `gcash-resolve` scheduler undisturbed; `gcash-auto` IP row self-heals within one ~5-min cycle after the reset clears it                                                                                                                | Agent-Probe — needs-live-provider; scheduler mechanism itself is UNCHANGED by this plan's diff (confirmed by reading — `provisionGcashResolveScheduler`/`GCASH_RESOLVE_ON_EVENT` are untouched) | live `/system scheduler print where name=gcash-resolve` + timed `gcash-auto` row check                                                       | A (mechanism) / B (live self-heal confirmation post-reset) |

gap-resolution legend:

- A — proven now (gate passes in this cycle / verified true by static reading during this VALIDATE pass)
- B — fixed in this plan (gate added or exercised by this plan's checklist; requires EXECUTE to run it)
- C — deferred to a named later phase/plan
- D — backlog test-building stub (named residual; keep-active; continue)

Failing stub (AC12-b):

```
test("should let a bare veent-admin tag reconcile call manage a veent-admin:payment row", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub: family-prefix positive match")
})
```

Failing stub (AC12-c):

```
test("should NOT let a bare veent-admin tag reconcile call manage a foreign or bare-no-colon tag row", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub: foreign/bare-tag negative match")
})
```

Failing stub (AC12-d):

```
test("should NOT let a veent-admin:payment-scoped reconcile call manage a veent-admin:portal row", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub: sub-tag sibling isolation")
})
```

Legacy line form (retained so existing validate-contract consumers still parse):

- reconcileWalledGarden tag-match: `bunx vitest run packages/core/src/integrations/network/mikrotik.spec.ts` (Fully-Automated, incl. 3 new cases) | staging live inspection (Hybrid, AC1/AC2/AC12)
- PAYMENT_HOSTS collision guard: `bunx vitest run apps/admin/scripts/setup-router.spec.ts` (Fully-Automated)
- code health: `bun run --filter radius-admin check` (Fully-Automated)
- live rebuild structural/content proof: staging router inspection + `--reconcile --dry-run` (Hybrid, AC1-AC6/AC11/AC12)
- live payment/probe behavior: GCash + Maya checkout, probe-deny curl, scheduler self-heal (Agent-Probe, AC7-AC10)

Dimension findings:

- Infra fit: PASS — confirmed by reading `mikrotik.ts` that `provisionWalledGarden` stamps `comment=<tag>` independently per call (deny/host/ip add sites all use `input.tag ?? 'veent-admin'`), so the 3-call split is fully honored by existing code with zero signature change. `beforeId` deny-ordering is re-derived fresh per call; on a wiped garden the probe-first call produces denies as the first N rows via simple append (beforeId ends up `undefined` since the garden is empty), and — independently verified — even the REVERSED order (hosts before denies) would still place denies above them via the `place-before` mechanism finding the first allow row. Both paths are correct; the plan's "LOAD-BEARING" wording slightly overstates necessity (either order works) but the checklist's probe-first choice is still the right one for a clean/documented starting state — advisory only, not a functional risk.
- Test coverage: PASS (after plan amendment) — verified ALL 8 existing `reconcileWalledGarden` test cases use exact bare-`veent-admin` tags on exact-`veent-admin`-tagged rows, which are unaffected by the family-prefix widening (De Morgan's-equivalent to the existing `commentMatchesTag` helper) — no regression. Found one real gap: the plan's original 2 new test cases only proved the bare-tag family-widening behavior, not that the 3 REAL setup-router.ts reconcile call sites (which each pass a full specific sub-tag, never the bare default) stay isolated from sibling sub-tags. Closed via this VALIDATE pass: amended the Touchpoints row + Implementation Checklist item 3 to add a 3rd test case (AC12-d above) proving sub-tag sibling isolation.
- Breaking changes: PASS — grepped the repo; `reconcileWalledGarden` has exactly one caller outside its own module/spec (`apps/admin/scripts/setup-router.ts`, plus its barrel export in `network/index.ts`). `provisionWalledGarden`'s exported `WalledGardenInput`/`WalledGardenResult` types are byte-for-byte unchanged; only call-site arguments change at 3 sites in one file.
- Security surface: PASS — confirmed the deny-add-only invariant (`action !== 'allow'` skip, line ~1222) and menu scoping (`/ip/hotspot/walled-garden` + `/ip` sublayer only — zero references to `/ip/hotspot/ip-binding` anywhere in the function body) are pre-existing and untouched by this plan's one-line diff; the disabled/dynamic/empty-dst-host and disabled/invalid skip guards are likewise pre-existing and unchanged. One design-intent note (not a security gap): the family-prefix widening's actual "manage the whole family with one bare-tag call" behavior is NEVER exercised by the 3 concrete reconcile call sites this plan ships (each passes a full specific sub-tag) — so the wider blast-radius risk the user asked about is not actually present in the shipped call paths; this also means the SPEC's OQ-1 "manage uniformly" framing is realized structurally (3 groups, one taxonomy) but not via the family-match code path specifically. Documented, not actionable.
- Section — walled-garden-config.ts (bare alipay.com + google-login confirm): PASS — mechanical, single-line array literal addition; google-login hosts confirmed already present at lines 72-73; collision guard confirmed non-colliding by inspection.
- Section — reconcileWalledGarden family-prefix match: PASS (after amendment) — exact edit targets confirmed present at the cited lines; mathematically equivalent to reusing the existing `commentMatchesTag` helper (De Morgan's) — plan already recommends reuse; one implementation nuance flagged as an execute-agent instruction (E2) since `commentMatchesTag` expects a non-optional `string`, `r.comment` is `string | undefined`.
- Section — setup-router.ts 3-call restructure: PASS — confirmed the merged `hosts`/`ips` Set computation and both console-log blocks (pre- and post-provisioning) are the only places needing restructuring; Implementation Notes' pseudocode correctly excludes `PAYMENT_HOSTS` from `adminHosts`. Highest-risk edit (correctly splitting the merged Set without a host ending up double-tagged) is mitigated by the plan's explicit pseudocode.
- Section — docs/mikrotik/walled-garden.md rewrite: PASS — file exists (308 lines), full-rewrite scope is well-specified in checklist item 8; no code dependency risk.
- Section — apply-probe-denies.ts deletion: PASS — grep-confirmed zero references anywhere else in the repo; safe to delete as planned.
- Section — staging live rebuild + verification (steps 9-13): Agent-Probe / hardware-gated, correctly tiered — per the user's explicit instruction, staging (10.210.54.133) / router (10.210.0.1) reachability was NOT assumed or probed this VALIDATE pass; these are execution-time verification steps, not unresolved design-feasibility questions, so no VC-FEASIBILITY-PROBE-NEEDED was warranted.

Open gaps: none unresolved. (The one real gap found — missing sub-tag-sibling-isolation test case — was closed by amending the plan's Touchpoints row and Implementation Checklist item 3 above, during this VALIDATE pass, per V3/V4 "Proposed Plan Updates.")

What This Coverage Does NOT Prove:

- The Fully-Automated `mikrotik.spec.ts` tests prove the fake in-memory router-table's interpretation of the tag-match/action/skip-guard logic — they do NOT prove real RouterOS 6.49.18 honors `comment`/`action`/`place-before` semantics identically. The Hybrid AC1/AC2/AC3/AC12 live-inspection gates are what prove that on the actual staging hardware.
- The `setup-router.spec.ts` collision guard proves only string-level non-collision between the `PAYMENT_HOSTS` and `PROBE_DENIES` arrays in code — it does NOT prove `alipay.com` is actually reachable pre-auth on the live router; AC5's live-inspection half covers that separately.
- `bun run --filter radius-admin check` proves TypeScript/svelte-check compile cleanliness — it does NOT prove the 3-call restructure is runtime-correct (e.g., that `adminHosts` truly excludes every `PAYMENT_HOSTS` entry at execution time, or that the 3 provisioning calls run in the documented probe→payment→portal order at import time). Only the live AC1/AC2/AC4/AC12 hybrid gates prove that.
- None of the Fully-Automated or Hybrid gates prove GCash or Maya checkout actually succeeds end-to-end after the rebuild — only the Agent-Probe AC7-AC10 live runs prove that, and per the user's explicit scope instruction those are NOT executed as part of this VALIDATE pass (staging/router treated as hardware-gated, not assumed reachable).
- The reconcile family-prefix widening's theoretical "one bare-tag call sweeps the whole `veent-admin:*` family" behavior is proven correct in isolation by the new unit tests, but is never exercised by production code today (every real call site passes a full specific sub-tag) — so this VALIDATE pass proves the FUNCTION is correct, not that the originally-motivating use case (SPEC OQ-1's "manage uniformly") is actually exercised by the shipped call paths. This is a documented design-intent note, not a coverage gap requiring further action.
  (Required until C3 is implemented — temporary C3 mitigation)

Execute-Agent Instructions:
| # | Instruction | Trigger condition |
|---|---|---|
| E1 | Add the 3rd `reconcileWalledGarden` test case (sub-tag sibling isolation: a `veent-admin:payment`-scoped reconcile call must NOT remove a `veent-admin:portal`-tagged row) in addition to the original 2 new cases, per the amended Touchpoints row and checklist item 3. | Editing `mikrotik.spec.ts` (checklist item 3) |
| E2 | Prefer reusing/mirroring the existing `commentMatchesTag(comment, tag)` helper (mikrotik.ts ~line 112) for the negated family-prefix check rather than hand-rolling the inline boolean — they are mathematically equivalent (De Morgan's). Handle the `string \| undefined` mismatch: `commentMatchesTag` expects non-optional `string`, so call it as `!commentMatchesTag(r.comment ?? '', tag)`. | Editing `reconcileWalledGarden`'s two tag-match lines (checklist item 2) |
| E3 | Confirm the pre-provisioning console-log block (today's lines ~121-125 in `setup-router.ts`, BEFORE the `provisionWalledGarden` calls) is restructured to report the 3-group breakdown too — not just the post-provisioning per-row result log (lines ~138-141). Checklist item 4's "update the console logging" language covers both blocks; make this explicit in the diff. | Editing `setup-router.ts` (checklist item 4) |
| E4 | Immediately before deleting `apps/admin/scripts/apply-probe-denies.ts`, re-run `grep -rn apply-probe-denies` across the repo to reconfirm zero references (repo state may have changed since this VALIDATE pass). | Checklist item 7 |
| E5 | When splitting the merged `hosts`/`ips` Set into `adminHosts`/`adminIps` + `PAYMENT_HOSTS`, verify no operator-set `ADMIN_WG_HOSTS` value accidentally duplicates a `PAYMENT_HOSTS` entry (would create the same host under 2 different tags — harmless functionally, since `provisionWalledGarden`'s idempotency check is per-call/per-tag, but confusing for AC12/doc accuracy). If found, note it in the phase report rather than silently resolving it. | Checklist item 4 |
| E6 | For the Agent-Probe rows AC8/AC9 (live GCash/Maya checkout), obtain explicit double opt-in before dispatching per the `needs-live-provider` cost-class rule — do not run these against staging without operator go-ahead, even under autonomous execution. | Checklist items 9-13 (staging execution phase) |

Gate: PASS (no FAILs; 1 CONCERN found and resolved via in-plan amendment during this VALIDATE pass — see Test coverage dimension finding above)
Accepted by: N/A — Gate: PASS, no unresolved concerns requiring acceptance.

## Autonomous Goal Block

SESSION GOAL: Rebuild the staging MikroTik walled garden entirely from code (3 `veent-admin:<group>` tag families — probe/payment/portal) so every row is traceable, tagged, and documented, closing the "guessing" problem; then hard-reset staging and verify live (structural, content, and payment-behavioral).
Charter + umbrella plan: N/A — single plan (`process/general-plans/active/walled-garden-canonical_30-07-26/walled-garden-canonical_PLAN_30-07-26.md`)
Autonomy: CONDITIONAL findings apply-and-proceed; BLOCKED items go to backlog + continue with remaining checklist items. The live staging hard-reset (checklist item 9) and real GCash/Maya checkout runs (checklist item 12) are irreversible/outward-facing actions — require explicit operator go-ahead before dispatch, not silent autonomy, per `needs-live-provider` cost-class rules (see Execute-Agent Instruction E6).
Hard stop conditions / safety constraints:

- Staging only (10.210.54.133 / router 10.210.0.1) — no production walled-garden change is authorized by this plan.
- `PROBE_DENIES` content and the deny-above-allow ordering must be preserved exactly (the captive-portal "Connected"-then-reverts flap fix) — never regress.
- Browser return URLs must never point at `TUNNEL_ORIGIN`/`webhookOrigin` (unrelated durable rule; must not be broken by this change).
- The `gcash-resolve` scheduler and its `gcash-auto` row must never be manually recreated, hand-edited, or removed — leave it to self-heal on its own ~5-minute cadence.
- Do not run checklist steps 9-13 (staging execution/verification) without confirming staging router reachability AND explicit operator go-ahead — the hard reset briefly makes payment hosts unreachable, and steps 8/9 real checkouts involve live money movement.
  Next phase: EXECUTE — `process/general-plans/active/walled-garden-canonical_30-07-26/walled-garden-canonical_PLAN_30-07-26.md` (Implementation Checklist items 1-14)
  Validate contract: inline in plan (`## Validate Contract` section, this file)
  Execute start: code steps 1-8 fully-automated/local (`bun run --filter radius-admin check`, `bunx vitest run packages/core/src/integrations/network/mikrotik.spec.ts`, `bunx vitest run apps/admin/scripts/setup-router.spec.ts`) | steps 9-13 Hybrid/Agent-Probe on staging (10.210.54.133 / router 10.210.0.1), gated on 1-8 being deployed | high-risk pack: yes (payments-adjacent live router change + real checkout runs — manual-first evidence recommended before calling steps 9-13 done)
