# Architecture Review — Veent WiFi Portal

> Senior-systems-developer review of the current system: improvements, optimizations,
> the Redis question, and what to rate limit. Grounded in the actual code paths, not
> generic best-practice boilerplate. Date: 2026-06-24.

---

## The headline finding: the rate limiter is dead code

> **Update 2026-06-24 — partly resolved.** `consumeRateLimit` is now wired into the OTP
> send path (`/login` + verify-page `resend`) via
> `apps/customer/src/lib/server/otpRateLimit.ts`. The **grant endpoint** still doesn't use
> it — see "Other improvements" below. Tracked in [`SECURITY_RISKS.md`](./SECURITY_RISKS.md) R1/R2.

`consumeRateLimit` (`packages/core/src/services/rateLimit.ts`) is fully built — DB-backed
sliding window, one row per MAC/phone, transactional, exported from the barrel. As of the
review it was **wired into nothing**: `sendOtp`
(`apps/customer/src/lib/server/otp.ts:106`) and the grant endpoint
(`apps/customer/src/routes/api/network/grant/+server.ts`) never touched it.

That was the highest-leverage fix on the board — the hard part was already written. The OTP
send path is now done; the grant path remains.

---

## Is Redis necessary? No — with reasoning

There is no Redis-shaped problem here yet. Every place a junior would reach for it already
has a native equivalent that's correct at this scale:

| What Redis is usually for | What's already in place | Verdict |
|---|---|---|
| Pub/sub for real-time fanout | Postgres `LISTEN/NOTIFY` (`dashboard-feed.ts`, migration 0006 triggers) | **Keep.** NOTIFY broadcasts to *every* listening connection, so it already works across multiple Node instances — each holds its own `LISTEN` and all receive the event. No single fanout point to replace. |
| Rate-limit counters | `rate_limits` table, one row + transaction | **Keep.** A captive portal does tens of OTP/grant writes per second at peak. Postgres handles that trivially. |
| Hot-read cache | Dashboard is *push*-based via SSE; no polling hot path | **Nothing to cache.** Read-amplification was already solved with NOTIFY instead of a cache. |
| Session store | better-auth on Postgres | Fine. |

### When Redis would actually earn its place (the thresholds)

- Rate-limit write contention becomes visible — thousands of OTP attempts/min hammering one
  row per phone. Not current traffic.
- A distributed lock is needed across instances that Postgres advisory locks can't express
  cheaply.
- The SSE re-query cost bites: every NOTIFY burst re-runs the *full* `dashboardSnapshot` once
  per instance. With a handful of operators it's nothing; with 50 open dashboards it's
  wasteful. The fix then is sending deltas / lighter payloads — **still not Redis**.

Adding Redis now is a second stateful system to run, back up, and monitor, bought with money
not currently being spent. Don't.

---

## What to rate limit (ranked by actual risk)

1. **OTP send — top priority, it costs real money.** `sendOtp` hits Semaphore, which bills
   per SMS. With no throttle this is a cost-amplification / SMS-bomb attack: a script POSTs
   the login form 10k times → 10k billed texts to a victim's number. Limit per **phone**
   *and* per **MAC/IP** (the limiter already accepts either key).
2. **OTP verify attempts.** better-auth's phoneNumber plugin claims to own attempt-limiting
   (comment in `otp.ts`) — *verify it's actually configured*. A 6-digit code is 10⁶;
   unlimited guesses crack it in minutes.
3. **Login / register form actions** — per IP. Credential / enumeration throttle.
4. **`/api/network/grant` + free-time grant** — per user/MAC. `startFreeSession` enforces the
   12h cooldown logically, but the endpoint itself should be throttled so a client can't
   hammer the spend→grant path (see transactionality note below).
5. **The `/register` admin hole** — CLAUDE.md already flags it as temp-delete-before-prod.
   Until it's gone it mints an active owner per submit; at minimum rate-limit it, ideally
   just delete it.
6. **Admin Finance CSV export / range queries** — authenticated but heavy. Cap so one
   operator can't DoS the DB with export spam.
7. **Webhook + cron endpoints** — `verifyWebhook` already rejects bad signatures and the
   crons use `x-cron-secret`, so low-risk. Add a cheap per-IP cap on the webhook to keep
   unsigned junk from flooding logs/DB inserts, and IP-allowlist the cron endpoints.
8. **SSE connections** (`/api/connected`) — cap concurrent streams per user. Each open stream
   holds a connection and participates in every snapshot fanout.

---

## Other improvements (leverage-ordered)

- **Check grant transactionality.** In `grant/+server.ts`, `spendCredits` and `startSession`
  are two separate awaits. If `startSession` (or the firewall drop) fails after credits are
  deducted, the user paid and got nothing. Wrap them in one DB transaction with a
  compensating path, or make the grant claim the spend the way the webhook claims the
  checkout. Same idempotency discipline already applied on the payment side
  (`creditCheckoutIfUnsettled`) — it just hasn't reached the grant path.
- **Confirm the Maya webhook signature scheme.** `maya.ts` carries a `ponytail:` comment: the
  HMAC algorithm + header name is an *assumption*. That's the credit-granting trust boundary
  — verify against the Maya dashboard before go-live. Wrong → either reject all real webhooks
  or (worse) accept forged ones.
- **Fail-fast config validation at boot.** Already done for `BETTER_AUTH_SECRET`
  (`otp.ts:36`). Extend the same pattern to `CRON_SECRET`, `DATABASE_URL`, and the payment
  keys — validate once at startup, not on first request, so a misconfigured deploy dies
  immediately instead of half-working.
- **Indexes for the query shapes actually run.** Verify indexes on
  `rate_limits(mac_address)` / `(phone_number)` (point lookup per request),
  `payment_transactions(status, created_at)` (every Finance range query filters this), and
  the active-session lookup on `network_sessions`. Cheap; the difference between fine and
  falling over.
- **Observability.** No structured logging or metrics anywhere. The three numbers that page
  you at 3am: webhook success rate, OTP delivery-failure rate, open SSE connection count.
  Emit them.
- **Bound the main connection pool.** The LISTEN client is correctly isolated
  (`postgres(url, { max: 1 })` in `dashboard-feed.ts`). Confirm the primary Drizzle pool has
  an explicit max so a connection leak under load can't exhaust Postgres.

---

## Net assessment

The architecture is genuinely sound for its scale — NOTIFY-over-Redis and idempotent webhooks
are the calls a senior would make. The gaps are: a built-but-unwired rate limiter, one
non-transactional money path, and an unconfirmed signature assumption. Fix those three and the
system is in good shape **without adding a single new dependency**.

**First thing to do:** wire `consumeRateLimit` into the OTP send + grant paths.
