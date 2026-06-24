**System**
- Make sidebar collapsible
- Make it responsive to all screen sizes
- Explore TOTP viability
- Make admins and owners activate TOTP/MFA on registration.

**Dashboard Page**
- Make the dashboard page even more responsive and update more often. 
- Remove Two Columns and Stacked Layout, only bento remains

- Active Sessions Table
  - make scrollable on all layouts
  - make it show which network the user is connected


- Network Health Table
  - make scrollable on all layouts
  - make the table scrollable

**Network Page**
- Add delete network button
- Add wipe network database button (similar to how its done in the wipe user database in /users)

**Map Page**
- Make adding a pin a double click so that no accidental pins appear on the map
- Modularize NetworkMap.svelte file, it is nearly 1.5k lines long💀

**Users Page**
- Add a column "Location" to the table, where it will show which network the user is connected to.
- The table is what should be scrollable not the page
- Change the "Wipe User Database" button to color red so that it will bring caution to users.

**Finance Page**
- Make table scrollable not page
- Move Export CSV Button else where
- Move time range filter else where
- Add which network locations the payments are comming from (if possible)

**Staff Page**
- Make table scrollable not page
- Add mass invite feature

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
- Check grant transactionality: `spendCredits` + `startSession` are two separate awaits — if the grant fails after the spend, the user pays and gets nothing. Wrap in one transaction / compensating path.
- Confirm the Maya webhook signature scheme (`maya.ts` `ponytail:` comment) against the Maya dashboard before go-live — it's the credit-granting trust boundary.
- Fail-fast config validation at boot for `CRON_SECRET`, `DATABASE_URL`, payment keys (same pattern already used for `BETTER_AUTH_SECRET`).
- Verify indexes: `rate_limits(mac_address)`/`(phone_number)`, `payment_transactions(status, created_at)`, active-session lookup on `network_sessions`.
- Observability: emit webhook success rate, OTP delivery-failure rate, open SSE connection count.
- Bound the primary Drizzle connection pool with an explicit max (LISTEN client is already isolated at max:1).
- Redis: not necessary at current scale — Postgres LISTEN/NOTIFY covers pub/sub, the `rate_limits` table covers counters, SSE is push so nothing to cache. Revisit only if rate-limit write contention, cross-instance distributed locks, or heavy SSE re-query cost appear.
  - Live admin dashboard does NOT change this: it's event-driven (trigger fires only on real writes, 250ms debounced), not a poll loop. Redis wouldn't remove the one real cost (the `dashboardSnapshot` re-query — data's in Postgres regardless). Fanout is already cross-instance via NOTIFY.
  - Cheaper dashboard optimizations first: (1) send deltas not the whole snapshot, (2) index/lighten `dashboardSnapshot`.
  - Dashboard would justify Redis only at horizontal scale (~10+ instances → one worker computes, pub/subs the result) or a new cross-instance presence feature ("who's viewing what").

