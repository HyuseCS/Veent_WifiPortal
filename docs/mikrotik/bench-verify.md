# Bench-router verification — network-access lifecycle (Checkpoint 3)

Hands-on runbook to verify the audit's **router-touching** changes against a real MikroTik before
production. Covers **B3.2** (admin-bypass 4h sliding expiry + guest/admin mutual exclusion, commit
`1446353`), **B3.1** (DB-first unbind + reconcile safety net), and **B3.6** (checkout walled-garden
tag-guard). The app logic is unit-tested; what only a real router can confirm is the RouterOS
command execution — the checks below. Tick each box; anything red stops the ship gate.

> These run against a **bench** router, not production. Clean up the test bindings at the end.

## Setup

- Customer app running with `NETWORK_CONTROLLER=mikrotik` and `MIKROTIK_HOST/USER/PASSWORD` set;
  `CRON_SECRET` set. (Admin app too, if testing sign-in flows.)
- A real **test device** (phone/laptop) joined to the hotspot — gives a MAC + IP the router
  actually sees, and lets you observe the captive banner and real internet.
- A **router terminal**: Winbox → *New Terminal*, or SSH to the router.

**Fire the sweep on demand** (don't wait for the 1-minute cron tick). The customer revoke cron runs
`expireDueAccounts → reconcileGuestBindings → sweepCheckoutAccess → sweepAdminAccess`:

```bash
curl -sS -X POST http://127.0.0.1:5173/api/network/revoke -H "x-cron-secret: $CRON_SECRET"
# → { "revoked": n, "reconciled": n, "sweptCheckoutAccess": n, "sweptAdminAccess": n }
```
(Adjust the port to your customer dev server. `sweptAdminAccess` is the count of admin bindings reaped.)

**Inspect router state** (RouterOS terminal):
```
/ip/hotspot/ip-binding/print detail      # mac-address · type · comment  ← the bypass bindings
/ip/hotspot/walled-garden/print detail   # pre-auth allow/deny rules (checkout + admin dashboard)
/ip/hotspot/active/print                 # logged-in hotspot sessions
```

**Fast-forward the 4h clock.** The reap decision is `now − comment_epoch ≥ 4h`, so don't wait — edit
a binding's timestamp to an old epoch (`1000000000000` = Sept 2001, always "expired"):
```
/ip/hotspot/ip-binding/set [find comment~"veent-admin"] comment="veent-admin:1000000000000"
```

---

## B3.2 — admin-bypass expiry + mutual exclusion

### Expiry + grandfather (router-only, fast — no device flows needed)
- [ ] **Grandfather a legacy binding.** Add a *bare* admin binding, then sweep:
  ```
  /ip/hotspot/ip-binding/add mac-address="DE:AD:00:00:00:01" type=bypassed comment="veent-admin"
  ```
  `curl … /api/network/revoke` → the bare binding **survives** (only timestamped `veent-admin:<epoch>`
  is reaped). `sweptAdminAccess` does not count it.
- [ ] **Reap a timestamped binding.** Sign into the admin dashboard on the device (creates
  `comment=veent-admin:<recent-epoch>`), fast-forward its comment to `veent-admin:1000000000000`, sweep
  → binding **removed**, response `sweptAdminAccess:1`, the device's live connections drop, and the
  **admin dashboard still loads** (walled-garden — never a lockout).

### Grant precedence / no-clobber (device + app flows)
- [ ] **Admin then guest.** Sign into admin (`veent-admin` binding) → buy a package on the *same*
  device → binding **stays `veent-admin`** (the guest grant no-ops; it never demotes the admin bypass).
- [ ] **Guest then admin.** Buy a package first (`veent-portal` binding) → sign into admin on the same
  device → binding **stays `veent-portal`** (admin rides the existing bypass; paid time is untouched).

### Tag-scoped revoke (security-critical isolation)
- [ ] **Guest expiry leaves the admin bypass.** Sign into admin (`veent-admin`) **then** buy a short
  guest package (creates an active session row + a window). Let the window lapse (or set
  `customer_profile.access_expires_at` to the past), then sweep → the **`veent-admin` binding survives**
  (the guest-lifecycle revoke is scoped to `veent-portal` and can't match it). *Without the fix it
  would be gone.*
- [ ] **Security lever cuts fully.** From admin, Block or Kick that customer → the binding is
  **removed regardless of tag** (`{all:true}` full cut — defeats a MAC-spoofer riding an admin bypass).

### Restore across the expiry (mutual exclusion holds through the reap)
- [ ] Admin-first (`veent-admin`) + buy a guest package on the same device (live window; binding stays
  `veent-admin`) → fast-forward the comment → sweep → the **`veent-admin` binding is removed AND a fresh
  `veent-portal` binding is added** for the MAC, so the still-paid device doesn't go dark.

### Sign-out + sliding
- [ ] **Logout revokes.** Sign in (`veent-admin` binding) → click logout → binding **gone immediately**.
- [ ] **Sliding window.** Sign in, note the epoch in the comment; sign out and back in → the epoch
  **advances** (a fresh 4h). *(The on-activity slide from the `(app)` layout is throttled ~2h; to watch
  it live, temporarily lower `REFRESH_INTERVAL_MS` in `apps/admin/src/lib/server/adminBypass.ts`.)*

---

## B3.1 — reconcile drops orphaned bindings (the DB-first swallow's safety net)
- [ ] Add an orphan portal binding (no backing DB session), then sweep:
  ```
  /ip/hotspot/ip-binding/add mac-address="DE:AD:00:00:00:02" type=bypassed comment="veent-portal"
  ```
  `curl … /api/network/revoke` → binding **removed**, response `reconciled:1`. This is what makes the
  DB-first unbind safe: a failed router revoke strands a binding, and reconcile drops it next pass. (The
  swallow/ordering itself is unit-pinned; this is the live half.)

---

## B3.6 — checkout walled-garden tag-guard
- [ ] Ensure the walled garden is provisioned: `bun run setup:router` (admin app).
- [ ] Add an **operator** rule for a reCAPTCHA host, scoped to the device IP, **un-tagged**:
  ```
  /ip/hotspot/walled-garden/add action=allow dst-host="www.google.com" src-address="<device-ip>" comment="ops-keepme"
  ```
- [ ] Start a checkout on that device (reach the Maya checkout page → fires `openCheckoutAccess`, which
  opens the reCAPTCHA hosts scoped to the device IP, tagged `veent-checkout:<ts>`).
- [ ] `/ip/hotspot/walled-garden/print detail` shows **both** the `ops-keepme` rule (survived) **and** a
  new `veent-checkout:<ts>` rule. Re-run the checkout → the `veent-checkout` row **refreshes** (old
  removed, new added — no duplicate accumulation for the same host/IP); the operator rule is **still
  there**. *Without the guard the operator rule would be deleted on re-checkout.*

---

## Cleanup
Remove any bindings/rules added by hand:
```
/ip/hotspot/ip-binding/remove [find comment~"veent-admin" or comment="veent-portal"]   # test-added only — verify first!
/ip/hotspot/walled-garden/remove [find comment="ops-keepme"]
```
Reset any test data touched in the DB (e.g. a `access_expires_at` you set to the past). Confirm the
test device's real bindings are back to a correct state before leaving the bench.
