# Architecture Review — Veent WiFi Portal

> Senior-systems-developer review of the current system: improvements, optimizations,
> the Redis question, and what to rate limit. Grounded in the actual code paths, not
> generic best-practice boilerplate. Date: 2026-06-24.

> **✅ STATUS (2026-06-24): the actionable findings below have been implemented** in the
> backend-hardening pass (Phases 0–3 — roadmap at the bottom of `apps/admin/To_Improve.md`,
> risk ledger in `docs/SECURITY_RISKS.md`). The analysis is kept as the *rationale*; ✅ markers
> note what shipped. Still open by design: the Redis verdict (No — not built), and the
> dashboard delta/index optimizations (only-when-it-bites). OTP/SMS limiting is teammate-owned.

---

## The headline finding: the rate limiter is dead code

`consumeRateLimit` (`packages/core/src/services/rateLimit.ts`) is fully built — DB-backed
sliding window, one row per MAC/phone, transactional, exported from the barrel — and
**wired into nothing**. Repo-wide there is not a single call site. The grant endpoint
(`apps/customer/src/routes/api/network/grant/+server.ts`) and the email-send seam never
touch it.

That's the highest-leverage fix on the board: the hard part is already written. Wire it in
before anything else.

> **✅ Done.** A shared `rateLimit(scope, identifier, max, windowMs)` helper
> (`apps/{customer,admin}/src/lib/server/rateLimit.ts`) now wraps the core limiter (extended
> with additive `scope`/`identifier` columns, migration `0014`) and is wired into admin login,
> grant, finance export, the payment webhook, SSE, and admin email sends (`checkAdminEmailLimit`).
> See the ranked list below for the per-endpoint policies.

> **Out of scope here:** OTP / SMS rate limiting (`sendOtp` →
> `apps/customer/src/lib/server/otp.ts:106`, and OTP verify attempts) is owned by a teammate
> and handled separately — not covered by this doc.

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

- Rate-limit write contention becomes visible — thousands of writes/min hammering one
  counter row (email/grant). Not current traffic.
- A distributed lock is needed across instances that Postgres advisory locks can't express
  cheaply.
- The SSE re-query cost bites: every NOTIFY burst re-runs the *full* `dashboardSnapshot` once
  per instance. With a handful of operators it's nothing; with 50 open dashboards it's
  wasteful. The fix then is sending deltas / lighter payloads — **still not Redis**.

Adding Redis now is a second stateful system to run, back up, and monitor, bought with money
not currently being spent. Don't.

### "But the admin dashboard is live and constantly updating — surely *that* needs Redis?"

It's the strongest-looking case, and it still doesn't clear the bar — because the hard part is
already solved.

- **It's event-driven, not polling.** The cost Redis usually rescues you from is a poll loop
  (every client hits the DB every second regardless of change). The dashboard doesn't have one:
  `dashboard-feed.ts` only does work when a Postgres trigger fires on an *actual* write to
  `network_sessions` / `credit_ledger` / `network_health`, with a 250ms debounce coalescing
  bursts. A captive-portal dashboard changes at human/device pace — a handful of events/sec at
  a busy venue, not a firehose. No read-amplification for Redis to absorb.
- **Redis wouldn't remove the one real cost.** That cost is the `dashboardSnapshot` re-query
  per burst. The data lives in Postgres, so something still has to query it. Caching the
  *computed* snapshot buys nothing — it's invalid the moment the next session starts, which is
  exactly when the dashboard must update. You'd add a hop + a dependency to cache a value
  that's never stale-able.
- **Fanout is already cross-instance.** `NOTIFY` broadcasts to every Node instance's `LISTEN`
  connection; Redis pub/sub is the same shape with an extra dependency. No win.

**Cheaper optimizations if "constantly updating" starts to bite (in order):**
1. Send **deltas, not the whole snapshot** — today one session-start re-queries and re-pushes
   the entire dashboard; notify with the change type, re-query only the affected widget, push
   just that. Cuts query cost and payload.
2. Index / lighten `dashboardSnapshot` (it fans out to ~4 sub-queries); materialized view for
   KPI cards only if they get heavy.
3. Both keep you on one boring Postgres + in-memory subscriber `Set`.

**When the dashboard *would* justify Redis:**
- **Horizontal scale.** Every instance currently holds its own `LISTEN` and recomputes the
  snapshot per burst → `recompute × instance-count` DB load. At ~10+ instances, have *one*
  worker compute the snapshot and Redis pub/sub the **result** to the rest. Nowhere near that.
- **Cross-instance ephemeral presence** (a *new* feature, not the current dashboard): "which
  operator is viewing which network," live cursors — state that doesn't belong in Postgres.
  Redis is the natural home if/when that's built.

---

## What to rate limit (ranked by actual risk)

> **✅ All implemented** (policies in parentheses below reflect what shipped). Item 4 (`/register`)
> is moot — the route was deleted.

1. **Email send (Resend / SMTP) — top priority, it costs real money.** *(✅ `checkAdminEmailLimit`: 5/hr per recipient, 20/hr per actor.)* `mailer.send` hits
   Resend (staff invite `apps/admin/src/lib/server/auth.ts:45`; user notifications
   `apps/admin/src/routes/(app)/users/+page.server.ts:118`). With no throttle this is a
   cost-amplification / mail-bomb attack and risks the sender domain's reputation. Limit per
   **recipient** *and* per **sender/account**.
   *(OTP / SMS rate limiting is owned by a teammate — out of scope here.)*
2. **Login / register form actions** — per IP. Credential / enumeration throttle. *(✅ admin login: 10/15min per IP. Customer login is OTP — teammate-owned.)*
3. **`/api/network/grant` + free-time grant** — per user/MAC. `startFreeSession` enforces the
   12h cooldown logically, but the endpoint itself should be throttled so a client can't
   hammer the spend→grant path (see transactionality note below). *(✅ 20/hr per user.)*
4. **The `/register` admin hole** — ~~CLAUDE.md already flags it as temp-delete-before-prod.~~
   *(✅ Deleted — see SECURITY_RISKS R6.)*
5. **Admin Finance CSV export / range queries** — authenticated but heavy. Cap so one
   operator can't DoS the DB with export spam. *(✅ 20/hr per admin.)*
6. **Webhook + cron endpoints** — `verifyWebhook` already rejects bad signatures and the
   crons use `x-cron-secret`, so low-risk. Add a cheap per-IP cap on the webhook to keep
   unsigned junk from flooding logs/DB inserts, and IP-allowlist the cron endpoints. *(✅ webhook 120/min per IP; crons gated by optional `CRON_IP_ALLOWLIST`.)*
7. **SSE connections** (`/api/connected`) — cap concurrent streams per user. Each open stream
   holds a connection and participates in every snapshot fanout. *(✅ 6 streams per user, in-memory.)*

---

## Other improvements (leverage-ordered)

- **Check grant transactionality. ✅ Done.** ~~In `grant/+server.ts`, `spendCredits` and
  `startSession` are two separate awaits.~~ `startPaidSession`
  (`packages/core/src/services/sessions.ts`) now wraps spend + session + router grant in one
  `db.transaction`; a failed grant rolls back the spend. Wired into the grant endpoint + the
  dashboard buy-tier action (try/catch → 502/503 "credits were not charged"). Covered by
  `grant-atomic.spec.ts`.
- **Maya webhook verification — RESOLVED by design (no HMAC).** `verifyWebhook` no longer
  depends on an unconfirmed HMAC scheme: Maya Checkout webhooks are unsigned, so the provider
  takes only the payment id from the (untrusted) body and **re-fetches the authoritative
  payment from Maya's API with the secret key**, trusting that response. A spoofed webhook
  can't produce a real paid payment under our account. Covered by `maya-webhook.spec.ts`
  (status mapping, centavo conversion, re-fetch-required). Residual: the webhook endpoint is
  unauthenticated and does an outbound fetch per call → add a per-IP cap (see rate-limit #6)
  to blunt request-amplification.
- **Fail-fast config validation at boot. ✅ Done.** `validateEnv()` per app
  (`apps/{customer,admin}/src/lib/server/validateEnv.ts`), called in `hooks.server.ts`:
  hard-fails in prod on missing required vars (`DATABASE_URL`, `BETTER_AUTH_SECRET`,
  `CRON_SECRET`, payment + mikrotik keys as applicable), warns in dev, no-ops during build.
- **Indexes for the query shapes actually run. ✅ Verified present.** `payment_transactions(status)`
  + `(created_at)`, `network_sessions(status, expires_at)`, and the `rate_limits` lookups all
  already had covering indexes — no migration needed.
- **Observability. ✅ Done (structured logs).** Added one-line structured logs at the seams that
  page you: webhook outcome + verify-fail (`[webhook] …`), email-send failures (`[email] …`),
  and open SSE connection count (`[sse] …`). No metrics backend yet — logs are the lazy first
  step; wire to a collector when one exists.
- **Bound the main connection pool. ✅ Done.** `createDb` (`packages/db/src/client.ts`) sets an
  explicit pool `max` (default 10); the LISTEN client stays isolated at `max:1` in
  `dashboard-feed.ts`.

---

## Net assessment

The architecture is genuinely sound for its scale — NOTIFY-over-Redis and idempotent webhooks
are the calls a senior would make. The three gaps called out — a built-but-unwired rate limiter,
one non-transactional money path, and an unconfirmed signature assumption — **have all been
closed** (rate limiter wired, `startPaidSession` made the grant atomic, Maya verification
re-fetches instead of trusting a signature), **without adding a single new dependency**.

**Done.** The remaining open items are deliberate "only-when-it-bites" optimizations (dashboard
deltas/indexes) and the standing Redis verdict (No — not built at current scale).
