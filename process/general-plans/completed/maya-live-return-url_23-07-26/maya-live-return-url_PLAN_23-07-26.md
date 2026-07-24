---
name: plan:maya-live-return-url
description: "Fix Maya live-mode browser return URLs (successUrl/cancelUrl) to use TUNNEL_ORIGIN public HTTPS, fixing GCash ERR_CONNECTION_CLOSED and Google Pay non-HTTPS refusal"
date: 23-07-26
feature: general
---

> **SUPERSEDED 23-07-26.** This plan's fix (browser return via `TUNNEL_ORIGIN`) was a misdiagnosis —
> live on-device testing proved the guest device is still captive at Maya-redirect time and can only
> reach walled-garden hosts, so returning to the public ngrok tunnel fails with
> `ERR_CONNECTION_CLOSED` (the tunnel is not walled-gardened). The original GCash failure this plan
> was chasing was a SEPARATE issue (hostname walled-garden rules don't match GCash HTTPS — fixed
> via a temporary router-side IP allow, not a code change). The code change here was reverted in
> full by `process/general-plans/completed/maya-return-url-revert_23-07-26/` — see that plan for the
> corrected design (`${origin}` = the walled-gardened LAN portal, driven by `ORIGIN` env;
> `TUNNEL_ORIGIN`/`webhookOrigin` stays webhook-only). Archived as a documented dead end, not deleted.

# Maya Live-Mode Browser Return URL Fix

Type: SIMPLE
Complexity: SIMPLE
Status: PLANNED (awaiting EXECUTE approval)
Date: 23-07-26
**Risk class:** billing / payments (high-risk) — money path adjacency, though the change itself touches only display redirect URLs.

## Overview / Context
Live Maya hosted-checkout browser return URLs (`successUrl`/`cancelUrl`) are built from `event.url.origin`, which on the captive portal resolves to `http://localhost:5173` / a LAN IP. Under LIVE Maya this breaks GCash (return to unreachable `http://localhost` → `ERR_CONNECTION_CLOSED`) and Google Pay (non-HTTPS origin refused). The server→server webhook already correctly uses `TUNNEL_ORIGIN` (public HTTPS). This plan makes the browser return URLs prefer `TUNNEL_ORIGIN` too, with a fallback to `event.url.origin` when it is unset (dev/sandbox unchanged).

## TL;DR
Under LIVE Maya, GCash returns the buyer's browser to `successUrl`/`cancelUrl` built from `event.url.origin` = `http://localhost:5173` (or a LAN IP) → `ERR_CONNECTION_CLOSED`; Google Pay refuses the non-HTTPS origin. Fix: build the browser return URLs from `TUNNEL_ORIGIN` (public HTTPS, already used for the server→server webhook), falling back to `event.url.origin` only when `TUNNEL_ORIGIN` is blank (preserves dev/sandbox). ~2-line diff plus a comment revision. No payment/grant/webhook logic changes.

## Problem
`apps/customer/src/routes/top-up/+page.server.ts`:
- Line 135: `webhookOrigin` = `TUNNEL_ORIGIN` (public HTTPS) — correctly used for the server→server webhook `originUrl` (line 196).
- Line 141: `origin` = `event.url.origin` — on the captive portal this resolves to `http://localhost:5173` / LAN IP.
- Lines 191-192: `successUrl` / `cancelUrl` are built from `origin` → unreachable / non-HTTPS on return under live Maya.

The comment block (137-141) documents a deliberate "return the buyer to their own origin" choice. That rationale predates live-mode GCash/Google Pay and is consciously revised here: live wallet redirects require a public, HTTPS, internet-reachable return origin.

## Chosen Approach
Reuse the already-computed `webhookOrigin` for browser return URLs, with a fallback to `origin`:

```ts
const returnOrigin = webhookOrigin || origin;
```

Then use `returnOrigin` in `successUrl` and `cancelUrl`. Leave the webhook `originUrl: webhookOrigin` untouched.

Fallback semantics: when `TUNNEL_ORIGIN` is blank (dev/sandbox), `webhookOrigin` is `''` → `returnOrigin` falls back to `origin` = current behavior, byte-identical. When `TUNNEL_ORIGIN` is set (live/staging), returns land on the public HTTPS tunnel.

## Touchpoints
- `apps/customer/src/routes/top-up/+page.server.ts` — add `returnOrigin` const (~after line 141), swap `origin` → `returnOrigin` in `successUrl` (191) and `cancelUrl` (192), revise the 137-141 comment block to state the live-mode rationale.

## Public Contracts
- None changed. `successUrl`/`cancelUrl` are per-transaction redirect targets passed to Maya Checkout (`redirectUrl` per-transaction — no return-URL whitelisting on Maya's side). The webhook `originUrl` contract is unchanged.
- MAC-threading query params (`macQuery` / `cancelMacQuery`) are unchanged and origin-independent — `capturePortalContext` re-stashes the MAC on return regardless of return origin.

## Blast Radius
- 1 file, 1 package (`apps/customer`). ~2 changed lines + comment revision.
- Risk class: billing/payments adjacency. The change alters only the browser redirect display origin, not amounts, grant atomicity, reconciliation, or webhook flow.

## Implementation Checklist
1. In `apps/customer/src/routes/top-up/+page.server.ts`, after the `origin` const (line ~141), add:
   `const returnOrigin = webhookOrigin || origin;`
2. Revise the comment block (lines 137-141) to state: browser return URLs prefer the public HTTPS tunnel origin (required by live GCash/Google Pay), falling back to the buyer's own origin only when `TUNNEL_ORIGIN` is unset (dev/sandbox).
3. In `successUrl` (line ~191), replace `${origin}` with `${returnOrigin}`.
4. In `cancelUrl` (line ~192), replace `${origin}` with `${returnOrigin}`.
5. Leave `originUrl: webhookOrigin` (line ~196) unchanged.
6. Do NOT touch MAC-threading, `openCheckoutAccess`, ledger watermark, `resolveCheckoutLocation`, `createCheckout` args other than the two URL strings, or grant/reconcile logic.

## Verification Evidence
| Gate / Scenario | Strategy | Proves SPEC criterion |
|---|---|---|
| `bun run --filter veent-customer check` (svelte-check/tsc) exits 0 | Fully-Automated | Change typechecks; no broken reference to `origin`/`webhookOrigin` |
| `bun run check` (repo-wide) exits 0 | Fully-Automated | No cross-package type break |
| Live Maya GCash checkout → browser returns to `https://<tunnel>/top-up/processing...` (not localhost); no ERR_CONNECTION_CLOSED | Hybrid (manual, live provider) | Core fix: live GCash return reaches a reachable HTTPS origin |
| Live Maya Google Pay checkout renders/accepts HTTPS return origin | Hybrid (manual, live provider) | Google Pay non-HTTPS refusal resolved (code portion) |
| Dev/sandbox with `TUNNEL_ORIGIN` blank → return URLs still use `event.url.origin` | Hybrid (manual dev) | Fallback preserves current dev/sandbox behavior |

## Acceptance Criteria
- AC1: When `TUNNEL_ORIGIN` is set, `successUrl` and `cancelUrl` use the public HTTPS tunnel origin (verified live: GCash return reaches the tunnel host, no `ERR_CONNECTION_CLOSED`).
- AC2: When `TUNNEL_ORIGIN` is blank, `successUrl`/`cancelUrl` fall back to `event.url.origin` (dev/sandbox behavior byte-identical).
- AC3: Webhook `originUrl`, MAC-threading, grant, and reconcile logic are unchanged.
- AC4: Both `check` gates exit 0.

## Phase Completion Rules
- CODE DONE: checklist items 1-4 applied, both `check` gates exit 0.
- VERIFIED: manual live GCash + Google Pay return verification confirmed by operator/user. Code-only completion is CODE DONE, not VERIFIED.

## Test Infra Improvement Notes
- No unit test exists for `top-up/+page.server.ts`; the URL construction is inline in the form action with no extractable pure function. Adding one would require heavy mocking of `payments.createCheckout`, `resolveMacForUser`, `openCheckoutAccess`, and the DB — disproportionate for a 2-line origin swap. Accepted known-gap; the origin-selection expression `webhookOrigin || origin` is trivially inspectable.

## Known Gaps
- Google Pay's remaining dependency (per-domain registration on the Google/Maya side) is OUT OF CODE SCOPE. This fix removes the non-HTTPS-origin blocker; live Google Pay success may still require domain registration by an operator.
- The live GCash/Google Pay return path cannot be reproduced in automated CI (requires a live Maya key + real wallet) — proven by code inspection + manual live verification only.

## Resume and Execution Handoff
1. Selected plan file: `process/general-plans/active/maya-live-return-url_23-07-26/maya-live-return-url_PLAN_23-07-26.md`
2. Last completed step: PLAN + VALIDATE written; awaiting ENTER EXECUTE MODE.
3. Validate-contract status: written (see below).
4. Supporting context loaded: CLAUDE.md, `process/context/all-context.md` (§Maya payments, dev webhooks via ngrok), target file lines 120-209.
5. Next step for a fresh agent: apply checklist items 1-4, leave 5-6 untouched, run the two `check` gates, then hand off for manual live GCash/Google Pay verification.

## Validate Contract

**Gate: PASS**
generated-by: outer-pvl
date: 2026-07-23

### V1 Pre-check
Plan file exists; Blast Radius present (1 file, apps/customer, ~2 lines + comment). No prior contract. Proceeding.

### V2 Layer 1 — Dimension checks (single-agent simulation)
| Layer 1 dimension | Status | Finding |
|---|---|---|
| Infra fit | PASS | `webhookOrigin` (line 135) and `origin` (line 141) both exist and are in scope at the `successUrl`/`cancelUrl` construction site (lines 191-192). `env.TUNNEL_ORIGIN` confirmed set to a public HTTPS ngrok URL. |
| Test coverage | CONCERN | No automated test covers the return-URL construction; verification is typecheck + manual live. Accepted as known-gap (billing high-risk class normally requires hybrid minimum — satisfied by the manual live GCash/Google Pay hybrid gate). |
| Breaking changes | PASS | No public contract changed. Webhook `originUrl` untouched. Maya takes `redirectUrl` per-transaction — no whitelisting. Dev/sandbox preserved via fallback. |
| Security surface | PASS | Return URLs are display redirects; no money math, grant, or auth change. MAC still in query param (already client-influenceable, unchanged). No new trust surface. |

### V2 Layer 2 — Section feasibility
| Section | Status | Notes |
|---|---|---|
| Implementation checklist | PASS | Edit targets `${origin}` at lines 191-192 are uniquely matchable; `webhookOrigin`/`origin` consts precede the use site. Highest-risk edit: swapping the wrong origin — mitigated by leaving `originUrl: webhookOrigin` (line 196) explicitly untouched. No collision. |

### V3 Synthesis
Totals: 0 FAILs / 1 CONCERN (test coverage, accepted as documented known-gap with a hybrid live gate) / 6 PASSes.

**Net Gate: PASS** — the single CONCERN is a documented known-gap satisfied by the manual live hybrid verification gate, consistent with the repo's captive-portal e2e limits.

### Test Gates (for execute-agent)
1. `bun run --filter veent-customer check` → exit 0
2. `bun run check` → exit 0
3. Manual live handoff: GCash + Google Pay live checkout return verification (operator/user).

### Execute-Agent Instructions
- E1: Apply only checklist items 1-4. Do NOT modify item-5/6 surfaces (webhook `originUrl`, MAC-threading, grant/reconcile).
- E2: After edit, confirm `origin` is still referenced by `returnOrigin` (no now-unused-var lint error) and that no other `${origin}` usage was accidentally swapped.
