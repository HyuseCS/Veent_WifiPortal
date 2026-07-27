---
name: plan:maya-return-url-revert
description: "Revert the misdirected Maya browser return-URL change; restore ${origin} for success/cancel URLs"
date: 23-07-26
feature: general-plans
---

> **VERIFIED 23-07-26.** User live-confirmed the full ₱1 GCash loop on real hardware end-to-end after
> this revert + the `ORIGIN=<walled-gardened LAN portal>` env fix: GCash loads (after a temporary
> manual router IP allow for the separate walled-garden hostname issue), payment succeeds, and the
> browser return lands correctly on the local processing page. See
> `process/general-plans/completed/maya-live-return-url_23-07-26/` for the superseded prior attempt
> this plan corrects.

# Maya Browser Return-URL Revert — SIMPLE PLAN

**TL;DR:** Revert the uncommitted `returnOrigin = webhookOrigin || origin` change in
`apps/customer/src/routes/top-up/+page.server.ts`. The buyer's browser must return to its OWN
reached origin (`${origin}` = `event.url.origin` = the walled-gardened LAN portal in prod), NOT the
public ngrok tunnel. Live on-device testing proved the tunnel return fails with ERR_CONNECTION_CLOSED
because the device is still captive mid-webhook-grant and can't reach the non-walled-garden ngrok
domain. Result: file returns to committed (HEAD) state. Supersedes
`process/general-plans/active/maya-live-return-url_23-07-26/`.

## Context

- The added `returnOrigin` line and the swapped `successUrl`/`cancelUrl` are the file's ONLY
  uncommitted delta from HEAD (`cab32e0`) — confirmed via `git diff HEAD`.
- Root cause (live-verified, not re-litigated): at Maya-redirect time the guest device is still
  captive; only walled-garden hosts are reachable. The ngrok public domain is NOT walled-gardened →
  return failed at `https://…ngrok-free.dev/top-up/processing?...`. The original GCash failure was a
  SEPARATE hostname/walled-garden issue (fixed router-side via IP allow), not the return URL.
- Correct design: browser return → the origin the guest actually reached the portal on
  (`event.url.origin`, i.e. the LAN portal `10.210.59.11` once `ORIGIN` env is the LAN address).
  The tunnel (`TUNNEL_ORIGIN` / `webhookOrigin`) serves ONLY the server→server webhook
  (`originUrl`) and stays untouched.

## Touchpoints

- `apps/customer/src/routes/top-up/+page.server.ts` (~lines 137–197) — comment block +
  `returnOrigin` line + `successUrl`/`cancelUrl` interpolation.

## Public Contracts

- None changed. Maya `createCheckout` payload shape unchanged; only the value of `successUrl`/
  `cancelUrl` reverts from the tunnel origin back to the buyer's own origin. `originUrl: webhookOrigin`
  (server→server webhook) is unchanged.

## Blast Radius

- 1 file, `apps/customer` (veent-customer). Risk class: LIVE PAYMENTS (browser return leg only —
  not money math, grant, or webhook). No schema, no migration, no API contract, no auth change.

## Implementation Checklist

1. In `apps/customer/src/routes/top-up/+page.server.ts`, restore the comment block above
   `const origin = event.url.origin...` (~137–141) to its ORIGINAL rationale: the buyer's browser
   returns to its OWN origin (`event.url.origin`), which in production is the walled-gardened LAN
   portal; independent of the webhook `originUrl` (server→server DO relay, stays public tunnel).
2. DELETE the added line `const returnOrigin = webhookOrigin || origin;` (~142).
3. `successUrl` (~192): change `${returnOrigin}` → `${origin}`.
4. `cancelUrl` (~193): change `${returnOrigin}` → `${origin}`.
5. Leave untouched: `webhookOrigin` (~135), `originUrl: webhookOrigin` (~197), MAC threading,
   `openCheckoutAccess`, grant/reconcile, buyer details.
6. Confirm `git diff HEAD -- apps/customer/src/routes/top-up/+page.server.ts` is EMPTY (file matches
   committed state).

## Verification Evidence

| Gate / Scenario | Strategy | Proves SPEC criterion |
|---|---|---|
| `bun run --filter veent-customer check` exits 0 | Fully-Automated | Reverted code typechecks (no dangling `returnOrigin` ref) |
| `bun run check` exits 0 | Fully-Automated | Whole-repo typecheck clean |
| `git diff HEAD -- apps/customer/src/routes/top-up/+page.server.ts` is empty | Fully-Automated | File byte-identical to committed HEAD state (revert complete) |

## Test Infra Improvement Notes

(none identified yet) — no automated unit test covers this inline SvelteKit action return-URL path;
accepted known-gap per task, do not invent one.

## Out-of-Scope / Follow-Up Known-Gaps

1. **Operator config (deploy, not code):** `ORIGIN` env for `apps/customer` MUST be the LAN portal
   address (`http://10.210.59.11:<port>`), NOT localhost — that is what makes `event.url.origin`
   reachable by the still-captive device. Code cannot set this; required deploy/config step.
2. **Separate open follow-up (do NOT do here):** productionize GCash/Alipay walled-garden entries in
   `apps/admin/scripts/setup-router.ts` — hostname rules don't match GCash HTTPS; needs IP-based
   allows, replacing the operator's temporary manual `gcash-test` IP rule.

## Resume and Execution Handoff

1. Selected plan: `process/general-plans/active/maya-return-url-revert_23-07-26/maya-return-url-revert_PLAN_23-07-26.md`
2. Last completed step: PLAN written; VALIDATE run inline (see below)
3. Validate-contract status: written (see `## Validate Contract`)
4. Context loaded: CLAUDE.md, `process/context/all-context.md`, target file, prior plan folder, `git diff HEAD`
5. Next step for a fresh agent: apply checklist items 1–4 (surgical Edit), then run the 3 gates.

## Validate Contract

- generated-by: outer-pvl
- date: 2026-07-23
- **Gate: CONDITIONAL** — 1 accepted known-gap (no automated test for the inline return-URL action
  path; explicitly accepted per task).
- Test gates (run in EXECUTE/EVL):
  1. `bun run --filter veent-customer check` → exit 0
  2. `bun run check` → exit 0
  3. `git diff HEAD -- apps/customer/src/routes/top-up/+page.server.ts` → empty output
- Execute-agent instructions: apply checklist 1–4 as surgical edits only. Do NOT touch
  `webhookOrigin`, `originUrl`, MAC threading, `openCheckoutAccess`, or grant/reconcile. Final file
  must be byte-identical to HEAD.
- Known-gaps carried: (1) operator `ORIGIN`=LAN config (out of code scope); (2) GCash walled-garden
  productionization in `apps/admin/scripts/setup-router.ts` (separate follow-up).
