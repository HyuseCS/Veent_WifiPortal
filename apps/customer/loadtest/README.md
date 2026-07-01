# Router stress test (k6)

Fires **N concurrent free-time grants** at the customer portal so each hits the **real
MikroTik** — measuring the end-to-end limit: SvelteKit → Drizzle pool (10) → `node-routeros`
→ the router's API. Answers "can we handle 100 people connecting at once?"

## ⚠️ Read first — this touches the live router

- Every grant creates a **real `ip-binding` on the router** and a `network_sessions` row.
  100 VUs ⇒ ~100 real bindings. **You must run `loadtest:cleanup` afterward.**
- The MikroTik here serves **live WiFi guests**. Run **off-peak** and coordinate with whoever
  owns the host laptop — a concurrent grant burst can disturb real users and briefly load the
  router's API (this is the point, but do it deliberately).
- The app must be running with `NETWORK_CONTROLLER=mikrotik` (already set in `apps/customer/.env`).

## Prerequisites

- **k6** installed on the machine you run the test from (it's a standalone binary, not a bun dep):
  - Arch: `sudo pacman -S k6`  ·  macOS: `brew install k6`  ·  or https://k6.io/docs/get-started/installation/
- Network reachability from the k6 machine to the **app host** (the teammate's laptop).
- `bun` + `apps/customer/.env` (DATABASE_URL, BETTER_AUTH_SECRET, ORIGIN, MIKROTIK_*) for seed/cleanup.

## Run it

**1. Seed sessions** (mints real phone-OTP sessions without SMS; writes `sessions.json`).
Run where it can reach the DB:
```bash
bun run --filter veent-customer loadtest:seed          # 100 users
COUNT=100 bun run --filter veent-customer loadtest:seed # explicit
```

**2. Run the spike** — point k6 at the app host. `sessions.json` must sit next to the script:
```bash
k6 run -e BASE_URL=http://<laptop-host> -e VUS=100 apps/customer/loadtest/grant-spike.js
# e.g. BASE_URL=http://10.210.0.9
```

**3. Clean up** — REQUIRED. Run on the **host laptop** (needs MIKROTIK_* to reach the router):
```bash
bun run --filter veent-customer loadtest:cleanup
```

## Reading the results

- **`grants_ok` / `http_req_failed`** — how many of the 100 actually got a router binding.
- **`http_req_duration` p95/p99** — grant latency under load. The router API call dominates.
- **Failure statuses** (printed live): `401` bad/expired cookie (re-seed), `429` cooldown or
  rate limit (`grant_user` = 20/window per user; distinct users avoid it — re-running the same
  users without cleanup trips the 12h free-time cooldown), `500` router/`node-routeros` error.

## Known bottlenecks this will surface

- **DB pool `max: 10`** (`packages/db/src/client.ts`) — 100 concurrent grants queue behind 10 connections.
- **`node-routeros` per-call connection** — 100 concurrent grants open ~100 API connections to the
  router at once; this is the real stress on the MikroTik and the most likely place to see timeouts.

## Files
- `seed-sessions.ts` — mints N `veent-portal` sessions (tagged `@loadtest.veent.local`) → `sessions.json`
- `grant-spike.js` — the k6 scenario
- `cleanup.ts` — deletes tagged users + reconciles router bindings
- `sessions.json` — generated (gitignored); the cookie list k6 replays
