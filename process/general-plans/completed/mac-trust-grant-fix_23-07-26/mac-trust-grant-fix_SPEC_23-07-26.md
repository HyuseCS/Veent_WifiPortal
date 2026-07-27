---
name: spec:mac-trust-grant-fix
description: "Requirements — captive-portal grant binds wrong (stale/fallback) MAC; break the closed loop, be honest in UX, don't entrench fallback MAC"
date: 23-07-26
---

# SPEC — MAC-trust grant fix

TL;DR: When live IP→MAC resolution fails, the customer dashboard silently binds a stale/fallback MAC and then treats "matches DB" as permanent proof — a wrong binding becomes a closed loop a refresh can't fix. Three fixes: (1) distinguish live vs fallback provenance so a fallback match is not treated as verified; (2) tell the user "device not verified — reconnect" instead of a false "connected"; (3) stop entrenching a fallback MAC into the durable `last_known_mac`.

## Problem (confirmed root cause)

- `resolveMacForUser` (`network-location.ts:131-153`) silently falls back (device cookie → `customer_profile.last_known_mac` → most-recent session MAC) when live resolution (`resolveMac`: portal cookie → router IP→MAC) misses.
- Dashboard auto-bind (`dashboard/+page.server.ts:73`) and the client re-derive (`dashboard/+page.svelte:53-54`) treat "resolved MAC matches a bound device" as proof of connection — forever, without ever re-confirming against a live hit.
- Result: once a wrong MAC is bound, it keeps matching the DB, the UI shows `active=true, thisBound=true`, and the guest is shown "connected" while actually offline. Refresh cannot break it (instance 1); instance 2 recovered only by ARP/lease timing luck.
- `rememberAccountMac` entrenches even a fallback (device-cookie) MAC into durable `last_known_mac`, hardening the wrong value.

## Goals / Acceptance Criteria

- **AC1 (provenance):** MAC resolution reports whether the returned MAC came from a LIVE hit (portal cookie or router IP→MAC) or a FALLBACK tier. Threaded cleanly (return value, not a hidden global) to the dashboard auto-bind decision.
- **AC2 (loop-break):** On a FALLBACK-sourced load, a "matches DB" bound device is NOT treated as a verified/online binding — auto-bind of a possibly-wrong MAC is not performed, and the device is not reported as verifiably bound. A subsequent LIVE hit self-corrects the binding.
- **AC3 (UX honesty):** When live resolution fails for an account that already has a bound device (fallback match), the dashboard shows a "device not verified — reconnect through the WiFi portal" state instead of a misleading online/connected state. Reuses the existing `!hasMac` banner pattern.
- **AC4 (no nagging):** A correctly live-resolved device shows the normal connected state. An account with no bound device and no live MAC shows the normal "connect"/"not detected" state — the new unverified state fires ONLY on `fallback + matching prior binding`.
- **AC5 (persistence):** A FALLBACK-sourced MAC does not overwrite/entrench durable `customer_profile.last_known_mac`. A LIVE hit still persists as today.
- **AC6 (no checkout regression):** Checkout AP attribution is unchanged. Every reader of `last_known_mac` / `accountMac` is enumerated and confirmed unaffected.
- **AC7 (no MAC-rotation regression):** Legitimate MAC-rotation eviction (`sessions.ts:48`) and M-2 shared-MAC handling are unchanged.

## Out of scope / non-goals

- `activateSession: unknown host IP` warning (`sessions.ts:249-255`) — CONFIRMED COSMETIC; documented as a non-cause, not touched.
- Gating explicit user buy/grant actions (`resolveMacTrusted` in dashboard actions + grant endpoint) on provenance — explicit user action, keeps current behavior; documented non-goal.
- SSE stream (`api/account/stream`) and root `+page` verification gating — connect-time-fixed MAC; keep current behavior (default). Documented known-gap.
- Any schema/migration change — avoid a migration (YAGNI); reuse existing `last_known_mac`.
- Router-side lease/ARP repopulation and real client MAC-rotation behavior — documented known-gaps (not fixable in-app).

## Constraints

- Admin-scope override authorized: this is customer captive-portal grant path.
- No new dependency, no schema change preferred.
- Tests via `bunx vitest run <file>` from inside `apps/customer` (never `bun test <file>`).
