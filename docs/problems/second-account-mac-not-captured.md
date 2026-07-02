# Bug: buying time on a *second* account (after logout) doesn't grant the device internet

> Status: **open, to be fixed later.** Flagged 2026-07-01 for the next dev testing the portal.
> This is an application-logic bug in the customer app's MAC-resolution chain — not a router/ops
> blocker (contrast `captive-portal-router-issues.md`, which is router-side).

## Reproduction

1. New device connects to the WiFi. The captive-portal redirect lands with `?mac=<device MAC>`,
   so the device's real MAC is captured (see "How the MAC is supposed to flow" below).
2. User logs in with **phone number A**. They do **not** buy time.
3. User **signs out** and logs in with **phone number B** (same physical device, a different /
   brand-new account).
4. On B, buying time reports success and the session shows **active** in the logs — but the
   device **does not actually get internet**.
5. User signs out of B, logs back into **A**, buys time → the device **is** granted internet.

## Symptom the user observed

- On the **second** login (number B) the MAC is **not present in the URL**, and the logs show the
  device MAC as unresolved (the `[mac] unresolved — no portal cookie; router IP→MAC returned null`
  warning in `apps/customer/src/lib/server/network-location.ts:38`, paraphrased by the reporter as
  "portal cookie unresolved").
- "The MAC is only saved from the first number they logged in." — i.e. the device identity is
  captured for account A but lost for account B.

## How the MAC is *supposed* to flow

The router only ever injects `?mac=` **once**, on the initial captive redirect. From there the app
re-threads it through every hop:

1. Captive redirect `…?mac=AA:BB:…` → `hooks.server.ts:32` `capturePortalContext()` stashes it in
   the browser-scoped **`veent_portal`** cookie (`apps/customer/src/lib/server/portal.ts:70`,
   httpOnly, `path=/`, 30-min TTL).
2. Login action reads `getPortalContext(event)?.mac` and copies it into the **pending-OTP cookie**
   (`apps/customer/src/routes/login/+page.server.ts:36,52`).
3. After OTP verify, it redirects to `/dashboard?mac=<mac>`
   (`apps/customer/src/routes/auth/verify/+page.server.ts:54`), which re-runs
   `capturePortalContext()` and re-stashes the `veent_portal` cookie.
4. Dashboard/top-up resolve the MAC via `resolveMacForUser()`
   (`apps/customer/src/lib/server/network-location.ts:74`): portal cookie → router IP→MAC →
   **per-user** durable fallback (`customer_profile.last_known_mac`) → last session's MAC.

The router grant itself is **MAC-only** (`grant()` adds an `/ip/hotspot/ip-binding` bypass for the
MAC — `packages/core/src/integrations/network/mikrotik.ts:226`). It is **not** tied to any account
identity. So access works **iff the correct device MAC is bound** — which makes the whole thing
hinge on MAC resolution being correct for whichever account is active.

## Root cause (analysis)

Every layer of the chain that carries the device MAC is either **browser-scoped** or
**per-user**, and both fail for a fresh second account:

- **`veent_portal` cookie is browser-scoped and not re-established for account B.** The initial
  `?mac=` redirect lands in the OS captive popup (CNA), whose cookie jar is separate from the real
  browser the user often uses to log in as B. So when B logs in, `getPortalContext()` returns
  `null` — nothing gets threaded into the pending cookie, and verify redirects to a **bare**
  `/dashboard` with no `?mac=`. (This is the "MAC not in the URL" the reporter saw.) The cookie is
  also **not cleared on sign-out** (`signOut` action, `dashboard/+page.server.ts:283`) and only
  lives 30 min, so its presence/absence across the logout→login boundary is incidental, not
  designed.
- **IP→MAC lookup is defeated by the NAT'ing hotspot** — the router sees its own IP, not the
  device, so `resolveDeviceMac` returns `null` (documented at `network-location.ts:34-38`).
- **The per-user durable fallbacks are empty for a brand-new account B.** `resolveMacForUser`
  falls back to `customer_profile.last_known_mac` then the last `network_sessions.mac_address`
  — both keyed by `userId` (`network-location.ts:86-97,53-61`). Account B has never bound a
  device, so **both are null**.

Result for account B: the MAC resolves to `null` (hard "device not detected" on
`buyTier`/`startFreeTime`, which reject a non-matching MAC at `dashboard/+page.server.ts:151`), or,
in deployments where IP→MAC *does* resolve, a grant is issued but the OS captive banner / device
never actually settles onto the bypass — either way the second account's buy does not put **this
device** online.

**Why going back to account A works:** on A's first pass the real MAC *was* captured and
`rememberAccountMac()` persisted it to `customer_profile.last_known_mac`
(`network-location.ts:76-80,104-118`). So `resolveMacForUser(A)` recovers the MAC from A's durable
per-account fallback even with the cookie gone — a durable signal account B simply never had.

## Suggested fix directions (not yet implemented — for discussion)

The core problem is that once the OS-captive-popup cookie jar is out of the picture, the app has
**no account-independent, device-scoped** memory of the MAC. Options, roughly in order of
robustness:

1. **Re-thread the MAC across the logout→login boundary.** On `signOut`, redirect to
   `/login?mac=<mac>` (resolve it before destroying the session) so the next account's login
   re-captures it into `veent_portal` + the pending cookie. Cheap; fixes the common same-browser
   case. Doesn't help if the second login happens in a genuinely different browser.
2. **Keep a device-scoped (not user-scoped) MAC hint** that survives sign-out — e.g. a separate
   long-lived `veent_device` cookie set from any successful `?mac=` capture, read by
   `resolveMac()` *before* the per-user fallbacks. Makes MAC resolution independent of which
   account is logged in.
3. **Prefer live IP→MAC over the per-user fallback when they disagree**, and make the per-user
   fallback the *last* resort only (it already is), but *also* seed a freshly-resolved MAC onto the
   new account so B stops being empty. (Requires IP→MAC to work, which the NAT defeats today.)
4. **Detect the mismatch and warn instead of silently granting.** If the resolved MAC came only
   from a *different* account's history, surface "reconnect through the WiFi portal" rather than
   binding a possibly-stale MAC — avoids the "active in logs but no internet" confusion.

Option 1 + option 2 together cover both the same-browser and cross-browser variants and keep the
grant path MAC-correct regardless of account.

## Key files / line references

- `apps/customer/src/lib/server/portal.ts` — `veent_portal` cookie capture/read (browser-scoped).
- `apps/customer/src/lib/server/network-location.ts` — `resolveMac` / `resolveMacForUser` and the
  per-user fallbacks; the "unresolved" warning at line 38.
- `apps/customer/src/routes/login/+page.server.ts:36,52` — MAC read from portal cookie into the
  pending cookie at login.
- `apps/customer/src/routes/auth/verify/+page.server.ts:54` — MAC re-threaded into `/dashboard?mac=`.
- `apps/customer/src/routes/dashboard/+page.server.ts` — `signOut` (line 283, does not clear the
  portal cookie), `buyTier`/`startFreeTime` MAC gate (lines 122,146,151).
- `packages/core/src/integrations/network/mikrotik.ts:226` — `grant()` is MAC-only (no account
  identity), confirming access hinges entirely on the correct MAC being resolved.
</content>
</invoke>
