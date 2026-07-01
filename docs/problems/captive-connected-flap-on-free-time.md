# Bug: CNA briefly shows "Connected" then reverts to "Sign in to network" (intermittent)

> Status: **fix implemented (Option 1), pending live verification.** Flagged 2026-07-01; surgical
> walled-garden deny rules added the same day (see "Fix applied" below). The root-cause hypothesis is
> **still unconfirmed on the live router** — run the verification step before closing this out.
> Likely a walled-garden / captive-detector interaction, **not** the free-time button itself (which
> matches the reporter's own uncertainty).

## Fix applied (2026-07-01) — needs live verification

Implemented **Option 1** (surgical denies), the lowest-risk approach — the broad `*.google.com` /
`*.gstatic.com` reCAPTCHA allows are left untouched, and only the OS **probe** hosts are denied,
placed *above* the allows so they win (walled-garden is first-match, top-to-bottom):

- `provisionWalledGarden()` now supports `deny` entries with an optional `path`, inserted at the top
  via `place-before`, and is **idempotent** (a re-run detects an equivalent deny — host-insensitive,
  path-exact — and never duplicates it). — `packages/core/src/integrations/network/mikrotik.ts`
- `PROBE_DENIES` wired into the router setup script — `apps/admin/scripts/setup-router.ts`:
  `connectivitycheck.gstatic.com`, `clients3.google.com`, `connectivitycheck.android.com`, and
  `www.google.com` **path** `/generate_204`. None is a reCAPTCHA resource, so payments are unaffected.
- Runbook + verification: `docs/mikrotik/walled-garden.md` ("Deny the OS connectivity-check probes").

**Applied to the live router 2026-07-01.** `setup:router` (customer env, `10.210.0.1`) provisioned the
denies; a re-fetch confirms all deny rows sit **above** the `*.google.com` / `*.gstatic.com` allows,
including `www.google.com path=/generate_204`, which the router had been missing. Deny set now live:
`connectivitycheck.gstatic.com`, `clients1..4.google.com`, `connectivitycheck.android.com`,
`www.google.com` path `/generate_204`.

**Still to close this out (on-device):**
- Pre-auth `curl` test below on an un-granted Android device (204 → intercept).
- Reproduce the free-time flow and confirm the flap is gone.
- Maya-checkout smoke test — confirm reCAPTCHA still renders (the broad allows are untouched, so it
  should).

**Known limitation:** the `www.google.com` path deny is **HTTP-only** — the router matches `path` on
cleartext HTTP but sees only the SNI host on HTTPS, so an HTTPS `www.google.com/generate_204` probe
would still match the `*.google.com` allow. Android's *primary* probe is
`http://connectivitycheck.gstatic.com/generate_204` (plain HTTP, fully host-denied), so the main
vector is closed; if the flap persists, this HTTPS path is the next suspect, along with the secondary
contributor (Option 3) and grant-settle timing (Option 4).

## Reproduction

1. Connect a device (Android observed) to the WiFi for the first time; the OS captive sheet (CNA)
   opens on the portal.
2. Click **Connect → Get 15 minutes free**.
3. For a brief moment the CNA closes and the OS shows a **"Connected"** notification…
4. …then it flips back to **"Sign in to network."**

**Intermittent** — does not happen every time, and is hard to reproduce on demand.

## Why it's probably not the button

The button's server action (`startFreeTime` → `startFreeAccessAndBindDevice`) grants a MAC bypass
binding and returns `{ connected: true }` — a normal grant. The flap has the signature of a
**captive-portal *detector* false positive**, which is driven by what the OS can reach pre-auth,
not by our grant. The timing of the click just changes *when* the OS re-probes, which is why it
correlates loosely with the button but isn't caused by it.

## Root-cause hypothesis: the walled garden answers Android's connectivity probe pre-auth

The walled garden (hosts a guest device can reach **before** authenticating) intentionally allows
Google domains so Maya's checkout can load its reCAPTCHA:

```
# docs/mikrotik/walled-garden.md:64-68  (mirrors apps/admin/scripts/setup-router.ts PAYMENT_HOSTS)
/ip hotspot walled-garden add action=allow dst-host=*.google.com    comment=veent-admin
/ip hotspot walled-garden add action=allow dst-host=*.gstatic.com   comment=veent-admin
```

But **Android's own captive-portal probe hosts live under exactly those domains**:

- `connectivitycheck.gstatic.com/generate_204`  → matches `*.gstatic.com`
- `www.google.com/generate_204`, `clients3.google.com/generate_204` → match `*.google.com`

So, **before the device is granted**, when Android happens to probe one of those hosts the router
lets it straight through to Google, which returns a real **HTTP 204** → Android concludes "this
network has internet" and shows **"Connected"**, dismissing the sheet. But the device is *not*
actually authenticated — only walled-garden hosts are reachable. On the next validation (or the
first real request to a non-whitelisted host) Android sees the hotspot intercept again and reverts
to **"Sign in to network."**

**This explains every symptom:**

- **Intermittent** — Android rotates its probe target among `connectivitycheck.gstatic.com`,
  `www.google.com/generate_204`, `clients3.google.com/generate_204`, and the fallback
  `connectivitycheck.android.com` (which is **not** whitelisted). You only get the false
  "Connected" on attempts that happen to hit a whitelisted Google/gstatic probe.
- **Brief "Connected" then revert** — a whitelisted-probe 204 is a *false positive*; the
  subsequent full validation against the still-intercepted network fails.
- **Android-specific** — Apple's probe host is `captive.apple.com` (not whitelisted), so iOS
  doesn't false-positive the same way; the reporter saw this on the CNA/"Sign in to network" flow.
- **Loosely tied to the button** — the leak is button-independent; the grant timing only shifts
  when the re-probe lands.

## Secondary contributor (smaller, worth noting)

The portal serves its **own** unconditional-success probe responses:

- `apps/customer/src/routes/generate_204/+server.ts` → always `204`
- `apps/customer/src/routes/gen_204/+server.ts` → always `204`
- `apps/customer/src/routes/hotspot-detect.html/+server.ts` → always the Apple `Success` page
- `apps/customer/src/routes/ncsi.txt/+server.ts`, `connecttest.txt/+server.ts` → always the
  Windows success bodies

Each assumes *"reaching this handler at all means the router already decided this device is allowed
through"* (see the comment in `generate_204/+server.ts:11-14`). But the portal origin
(`10.210.0.9`) is itself in the walled garden (`walled-garden.md:96-97`), so a device can reach
these paths **pre-auth**. If any probe is ever directed at the portal host before the grant
settles, it too gets an unconditional success → another false "Connected." Lesser factor than the
gstatic leak (OS probes don't target the portal IP by default), but same class of problem: success
is returned without checking the device is actually granted.

## Verification (do this before fixing)

While reproducing on the affected Android device:

```
# On the router, watch what the device resolves during the flap:
/ip dns cache print
# Look for connectivitycheck.gstatic.com / www.google.com / clients3.google.com being resolved
# and reachable while the device is still un-granted.

# Confirm the leak directly from an un-granted device:
curl -v http://connectivitycheck.gstatic.com/generate_204   # a 204 here pre-auth == confirmed
```

If the pre-auth 204 reproduces, the walled-garden leak is confirmed.

## Suggested fix directions (not yet implemented — for discussion)

The tension: `*.google.com` / `*.gstatic.com` are needed for reCAPTCHA, but they also whitelist
Android's connectivity probe. Options:

1. **✅ IMPLEMENTED — deny the probe hosts ahead of the broad allows** (see "Fix applied" above).
   Kept the `*.google.com` / `*.gstatic.com` allows and added `action=deny` entries for
   `connectivitycheck.gstatic.com`, `clients3.google.com`, `connectivitycheck.android.com`, and
   `www.google.com` path `/generate_204`, placed above the allows (walled-garden is first-match). No
   reCAPTCHA host is touched. Still needs the live `curl` check + a Maya-checkout smoke test.
2. **Force Android onto a non-whitelisted probe** by leaving `connectivitycheck.android.com`
   un-whitelisted (already the case) and confirming the router intercepts it — but Android chooses
   its probe host, so this alone isn't reliable.
3. **Gate the portal's own probe endpoints** (`generate_204`, `hotspot-detect.html`, etc.) on
   actual grant state instead of returning unconditional success — e.g. only answer success when
   the requesting MAC/IP resolves to a live bypass binding; otherwise serve the portal redirect.
   Closes the secondary contributor and makes the "reaching this handler == granted" assumption
   true instead of assumed.
4. **Make the grant settle faster/more completely** before the OS re-probes (ensure
   `flushHotspotHost` + conntrack cut run and, where configured, `activateSession` logs the device
   into `/ip/hotspot/active`) so the real network passes validation the moment Android re-checks —
   shrinks the window in which a false positive can be contradicted.

Options 1 + 3 address the two independent leaks directly and are the most robust pair.

## Key files / references

- `docs/mikrotik/walled-garden.md:64-68,96-97` — the `*.google.com` / `*.gstatic.com` pre-auth
  allows and the portal-origin IP allow.
- `apps/admin/scripts/setup-router.ts` — `PAYMENT_HOSTS` (source of truth the runbook mirrors).
- `apps/customer/src/routes/{generate_204,gen_204,hotspot-detect.html,ncsi.txt,connecttest.txt}/+server.ts`
  — the unconditional-success probe responders.
- `packages/core/src/services/sessions.ts:184-212` — `afterBind()` (grant → `activateSession`), the
  post-grant settle path.
- `packages/core/src/integrations/network/mikrotik.ts:151-166,226-258` — `grant()` +
  `flushHotspotHost()` (how fast the bypass takes effect).
</content>
</invoke>
