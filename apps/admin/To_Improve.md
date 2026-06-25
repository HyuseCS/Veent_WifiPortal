**System**
- [x] Make sidebar collapsible — toggle in the sidebar header (PanelLeftClose/Open);
      collapses to icon-only `w-16`, persists in `localStorage` (`radius-admin-sidebar`)
- [x] Make it responsive to all screen sizes — owned by a teammate
- [x] Explore TOTP viability — viable on better-auth's two-factor plugin (no new dep);
      see `plan.md`
- [x] Make admins and owners activate TOTP/MFA on registration. — mandatory TOTP: the (app)
      layout gates unenrolled active staff to `/enroll-2fa`; two-step login via `/login/2fa`
      (TOTP or backup code). Schema migration `0020`; secret/backup-codes encrypted at rest.

**Dashboard Page**
- [x] Make the dashboard page even more responsive and update more often. 
- [x] Remove Two Columns and Stacked Layout, only bento remains — deleted the layout switcher,
      `dashboard-layout.ts`, layout cookie/context; dashboard grid is now bento-only

- Active Sessions Table
  - [x] make scrollable on all layouts — renders the full row set; Table body scrolls internally
  - [x] make it show which network the user is connected — new "Network" column;
        `listActiveSessions` left-joins `network_health` on the existing `network_id`


- Network Health Table
  - [x] make scrollable on all layouts — renders the full row set; Table body scrolls internally
  - [x] make the table scrollable

**Network Page**
- [x] Add delete network button — per-AP delete on `NetworkHealthCard` (owner-only, native
      confirm); `?/deleteNetwork` action → `deleteNetworkPlace` (loose-link safe, no FK)
- [x] Add wipe network database button (similar to how its done in the wipe user database in /users)
      — owner-only, step-up email-code flow via shared `WipeDialog`; `wipeNetworks` query

**Map Page**
- [x] Make adding a pin a double click so that no accidental pins appear on the map
      — `map.on('dblclick')` adds the pin; disabled Leaflet `doubleClickZoom` so it doesn't also zoom
- [x] Modularize NetworkMap.svelte file, it is nearly 1.5k lines long💀
      — Phase 0: extracted `clustering`/`reach`/`geocode` to tested `$lib` modules,
        split `PinPanel.svelte` + `networkMap.controller.ts`; 1419 → 929 lines

**Users Page**
- [x] Add a column "Location" to the table, where it will show which network the user is connected to.
      — `listUsers` left-joins `network_health` per active session; distinct AP names, comma-joined
- [x] The table is what should be scrollable not the page
- [x] Change the "Wipe User Database" button to color red so that it will bring caution to users.
      — new `danger`/`danger-solid` Button variants; trigger outlined-red, modal confirm solid-red
- [x] Sortable column headers (Staff-style) — clickable User/Balance/Time-Left/Devices/Location/Status
      headers (asc/desc toggle); dropped the status FilterTabs + sort button
- [x] Show the phone number as the user identity (customers register by phone, not names) —
      query selects `customerUser.phoneNumber`; seed scripts now populate phone-as-name + synthesized
      `@otp.veent.local` email, matching the customer app's better-auth signUpOnVerification

**Finance Page**
- [x] Make table scrollable not page — moved to dedicated `/finance/transactions`, capped internal scroll
- [x] Move Export CSV Button else where — Topbar dropdown (`FinanceHeaderControls`)
- [x] Move time range filter else where — Topbar dropdown (`FinanceHeaderControls`)
- [x] Add which network locations the payments are comming from (if possible) — owned by a teammate

**Staff Page**
- [x] Make table scrollable not page — full-height flex column; table body scrolls internally
- [x] Add mass invite feature — "Add staff" toolbar button opens a modal with add/remove rows
      (up to 10); `?/invite` loops, reporting per-row sent/failed (replaced the collapsible form)
- [x] Sortable columns — clickable Member/Role/Status/Last-active headers (asc/desc toggle,
      arrow indicator); added raw `lastActiveAt` to the row for chronological sort

---

**Backend / Systems** (from docs/ARCHITECTURE_REVIEW.md)
- Wire the dead rate limiter (`consumeRateLimit` is fully built but called nowhere) into the email-send + grant paths — highest-leverage fix.
- NOTE: OTP / SMS rate limiting is owned by a teammate — out of scope for us.
- Rate limit, ranked by risk:
  1. Email send (Resend/SMTP `mailer.send` — staff invite `auth.ts:45`, user notifications `users/+page.server.ts:118`) — per recipient AND per sender/account. Costs real money; unthrottled = mail-bomb / cost-amplification + sender-reputation risk.
  2. Login / register form actions — per IP.
  3. `/api/network/grant` + free-time grant — per user/MAC.
  4. `/register` admin hole — rate-limit or (better) delete; it mints an active owner per submit.
  5. Admin Finance CSV export / range queries — cap to prevent DB DoS via export spam.
  6. Payment webhook + cron endpoints — cheap per-IP cap on webhook; IP-allowlist the crons.
  7. SSE connections (`/api/connected`) — cap concurrent streams per user.
- ~~Check grant transactionality~~ — DONE: `startPaidSession` spends + grants in one transaction (a failed grant rolls back the spend); wired into the grant endpoint + dashboard buyTier. Covered by `grant-atomic.spec.ts`.
- ~~Confirm the Maya webhook signature scheme~~ — RESOLVED: `verifyWebhook` uses no HMAC; it re-fetches the authoritative payment from Maya with the secret key (unsigned body never trusted). Covered by `maya-webhook.spec.ts`. Residual: per-IP cap on the webhook endpoint (Phase 2).
- Fail-fast config validation at boot for `CRON_SECRET`, `DATABASE_URL`, payment keys (same pattern already used for `BETTER_AUTH_SECRET`).
- Verify indexes: `rate_limits(mac_address)`/`(phone_number)`, `payment_transactions(status, created_at)`, active-session lookup on `network_sessions`.
- Observability: emit webhook success rate, OTP delivery-failure rate, open SSE connection count.
- Bound the primary Drizzle connection pool with an explicit max (LISTEN client is already isolated at max:1).
- Redis: not necessary at current scale — Postgres LISTEN/NOTIFY covers pub/sub, the `rate_limits` table covers counters, SSE is push so nothing to cache. Revisit only if rate-limit write contention, cross-instance distributed locks, or heavy SSE re-query cost appear.
  - Live admin dashboard does NOT change this: it's event-driven (trigger fires only on real writes, 250ms debounced), not a poll loop. Redis wouldn't remove the one real cost (the `dashboardSnapshot` re-query — data's in Postgres regardless). Fanout is already cross-instance via NOTIFY.
  - Cheaper dashboard optimizations first: (1) send deltas not the whole snapshot, (2) index/lighten `dashboardSnapshot`.
  - Dashboard would justify Redis only at horizontal scale (~10+ instances → one worker computes, pub/subs the result) or a new cross-instance presence feature ("who's viewing what").

---

# 🗺️ ROADMAP — where we are

Backend/security work is phased; the UI/page items above are a separate, ongoing track.

### ✅ Phase 0 — NetworkMap refactor & fixes — DONE (committed `cc99bfb`)
- [x] Extract pure logic to tested `$lib` modules (`clustering`, `reach`, `geocode`); server reuses `reach`
- [x] Split components: `PinPanel.svelte` + Leaflet controller (`networkMap.controller.ts`); `NetworkMap.svelte` 1419 → 929 lines
- [x] Fix `/networks` → "Edit location" 404 (dead `setLocation` form → `/map?ap=<id>` deep-link)

### ✅ Phase 1 — Money/security backend — DONE (committed)
- [x] Grant transactionality — `startPaidSession` (spend + grant atomic) · `grant-atomic.spec.ts`
- [x] Admin email rate limiting — `rate_limits` (scope,identifier) migration `0014` + `checkAdminEmailLimit` on staff-invite & wipe-code · `rateLimit.test.ts`
- [x] Maya webhook — verified re-fetch design is sound (no HMAC needed); added `maya-webhook.spec.ts`

### ✅ Phase 2 — Rate-limiting breadth + remove temp hole — DONE
- [x] Admin login — per IP (10 / 15 min); customer auth is OTP (teammate-owned)
- [x] `/api/network/grant` — per user (20 / hr)
- [x] `/register` admin hole — **deleted** (route dir + login link removed)
- [x] Finance CSV export — per admin (20 / hr)
- [x] Payment webhook — per-IP flood cap (120 / min); crons — optional `CRON_IP_ALLOWLIST`
- [x] SSE `/api/connected` — concurrent-stream cap per user (6, in-memory)
- Helpers: `apps/{customer,admin}/src/lib/server/rateLimit.ts` · test `rateLimit.spec.ts`

### ✅ Phase 3 — Hardening — DONE
- [x] Fail-fast config validation at boot — `validateEnv()` per app (hard-fail prod / warn dev / no-op build), wired in `hooks.server.ts`
- [x] Indexes — **verified already present** (`payment_transactions(status)`+`(created_at)`, `network_sessions(status, expires_at)`, `rate_limits`); no migration needed
- [x] Observability — structured logs: webhook outcome + verify-fail, email-send failures, open SSE count
- [x] Explicit Drizzle pool `max` (10) in `createDb`; LISTEN client stays at `max:1`

**🎉 Backend hardening plan (Phases 0–3) complete.** Remaining: the frontend/page-polish track above, plus net-new features (e.g. admin TOTP/MFA).

### 🎨 Frontend / page polish — ongoing (separate track)
The per-page items at the top of this file (System, Dashboard, Network, Map, Users, Finance, Staff). Independent of the backend phases — pick up alongside or between them.

Done so far: Finance (table → `/finance/transactions`, filter + Export moved to Topbar dropdown), Users (table scroll, red wipe button), Network (wipe-database button) — plus shared `WipeDialog` component and `danger`/`danger-solid` Button variants.

_Out of scope for us: OTP / SMS rate limiting (teammate-owned, already landed)._
