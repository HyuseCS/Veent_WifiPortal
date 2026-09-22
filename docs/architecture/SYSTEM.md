# Veent WiFi Portal — System Definition

_**This file is the living source of truth for the architecture.** The interactive atlas is built from the same data file._

_Question status: **2 open · 7 resolved**._

## One paragraph

Veent WiFi Portal sells WiFi time in a captive-portal shop. A guest joins the hotspot, a MikroTik router holds them behind a walled garden and redirects them to the customer portal. They log in with a phone code, get free time or pay through Maya (GCash or Maya wallet), and the portal tells the router to let that MAC address through. Staff run the shop from a separate admin dashboard: access points, finance, incidents. Everything writes to one Postgres database owned by @veent/db, and everything that talks to the router goes through one seam, NetworkController, so the router can be swapped for a stub in tests. There is no CI and no production deploy pipeline yet — staging is the frontier.

## Decisions locked

| Axis                    | Decision                                                                                                                                                                                                                       | ADR |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --- |
| Router seam             | Every router call goes through the `NetworkController` interface. Real provider is `mikrotik.ts`, tests use `stub.ts`. Nothing outside `packages/core/src/integrations/network/` speaks RouterOS.                              | —   |
| Walled garden ownership | The garden is code-owned. `setup:router` provisions three tagged groups — `veent-admin:probe`, `:payment`, `:portal` — in that order so denies land above allows.                                                              | —   |
| Provisioning safety     | Default `setup:router` is purely additive. `--reconcile` is an opt-in prune that removes only rows carrying the code tag AND `action=allow`. `--wipe` clears both menus for a hard rebuild.                                    | —   |
| GCash reachability      | A `/system scheduler` item (`gcash-resolve`, 5 min) resolves the host and upserts an IP row. Hostname rules cannot follow the CNAME to Akamai. The originally designed DoH/DoT block was proven unnecessary and never shipped. | —   |
| Payment surface         | GCash and Maya only. Google Pay is blocked by Android WebView in captive mode; PayMongo and Xendit had no integration code and were pruned.                                                                                    | —   |
| Browser return URL      | `successUrl`/`cancelUrl` use `event.url.origin` (the walled-gardened LAN portal address). `TUNNEL_ORIGIN` is for the server-to-server webhook only — the guest is still captive at redirect time.                              | —   |
| Access grant            | Paid guests are granted with `ip-binding type=bypassed`, which skips hotspot byte accounting. Per-AP guest throughput is therefore not measurable, by design.                                                                  | —   |
| Session→AP binding      | `resolveNetworkIdForMac` resolves the Option-82 circuit-id first, then falls back to interface name. A shared bridge fronting several APs must not capture the session.                                                        | —   |
| MAC trust               | A fallback-resolved MAC (device cookie, `last_known_mac`) is never treated as a verified binding, and never entrenches `last_known_mac`. The `?mac=` param is client-influenceable by nature.                                  | —   |
| Auth isolation          | Two separate `betterAuth()` instances with separate secrets and cookie prefixes — `veent-portal` and `radius-admin`. Never cross-wired.                                                                                        | —   |
| Schema authority        | `@veent/db` is the sole schema and migration source for all three apps. The dev DB is push-managed, so `db:migrate` drifts — apply DDL directly and still generate the migration file.                                         | —   |
| Time storage            | Finance and session columns are `timestamptz` (migration `0052`), with real Manila-day→UTC-instant maths in `period.ts`.                                                                                                       | —   |
| Scheduled work          | No cron app. Prod hits guarded HTTP endpoints from an external scheduler with an `x-cron-secret` header; `scripts/dev-cron.ts` polls them in dev.                                                                              | —   |

## Cost model

No cloud cost model. The costs that matter here are operational, not per-token:

| Cost         | Where it lands                       | Note                                                                                                             |
| ------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Router calls | Every grant, revoke and health probe | `node-routeros` over the API port; timeouts become `RouterUnreachableError` (warning-level in Sentry, not error) |
| SMS sends    | Every OTP                            | Only the Cast provider reports delivery status; itexmo/unisms/smsgate are write-only logs                        |
| Maya fees    | Every paid top-up                    | GCash and Maya wallet only — every other gateway was pruned from the walled garden                               |
| Manual gates | Every merge                          | No CI: `check` → `lint` → `test` → admin e2e are run by hand                                                     |

## Reading order (the atlas chapters)

1. **A guest and the router** — Strip everything away and this is the shop: a phone joins the WiFi, and a router decides whether it gets anywhere. _(adds G, MT)_
2. **The short list of allowed hosts** — Before paying, a guest can reach exactly two kinds of place: our portal, and the payment gateway. _(adds WG, CU)_
3. **Proving who you are** — A phone number and a six-digit code — no passwords, no accounts to remember. _(adds OT)_
4. **Giving out time** — Now the interesting part: the portal has to reach through and change the router. _(adds SS, NC)_
5. **Paying for more** — Free time runs out. Buying more means leaving the portal and coming back — while still captive. _(adds MY, LD)_
6. **Where everything is written** — Three apps, no shared code between them — one database instead. _(adds DB, LO)_
7. **Staff run the shop** — A completely separate dashboard, with its own login, its own cookie, its own secret. _(adds AD)_
8. **Watching the access points** — If an access point dies, nobody should lose the minutes they paid for. _(adds CR, HL)_
9. **When things break** — Errors are scrubbed before they leave, then staff turn the real ones into tracked work. _(adds SN)_
10. **The odd corners and what is next** — One live workaround that had to become code, and one thing not built yet. _(adds GS, MR)_
11. **The whole system** — Everything at once, with five flows to choose from.

## Structures

### The network edge

#### G · Guest device

**In one line.** A phone or laptop that just joined the WiFi and cannot reach the internet yet.

**What it does.** The customer. It associates with the hotspot, gets an address, and is held captive until someone grants it time. Its operating system quietly checks a few known URLs to decide whether to pop up the sign-in window.

**How it's built.** Identified by MAC address. The MAC arrives as a `?mac=` query param, which is client-influenceable and is **never treated as server-authoritative**. Captive probes hit `generate_204`, `gen_204`, `ncsi.txt`, `connecttest.txt`, `hotspot-detect.html` in `apps/customer/src/routes/`.

**Steps in execution.**

1. **Associate** — Joins the SSID, gets a DHCP lease.
2. **Probe** — The OS hits a known URL to test for a captive portal.
3. **Redirect** — Gets bounced to the portal and the sign-in window opens.
4. **Granted** — After a grant, the same MAC passes through freely.

**Questions.**

- ~~**Q-G1** Can the fallback MAC path (unverified banner, reconnect prompt) be reproduced live?~~ ✓ Not reproduced — it needs live IP→MAC resolution to fail on purpose. Proven by code and unit tests only (2026-07-23).

#### MT · MikroTik router

**In one line.** The RouterOS box that owns the hotspot and decides who gets through.

**What it does.** Runs the hotspot, hands out addresses, holds unpaid guests behind the walled garden, and lets granted devices past. It is also the source of truth for which access point a device is actually on.

**How it's built.** Reached over the RouterOS API with `node-routeros` from `packages/core/src/integrations/network/mikrotik.ts`. Grants are `/ip/hotspot/ip-binding` rows with **type=bypassed** — which skips byte accounting, so per-guest throughput is not measurable. Every physical AP MAC must also be bypassed or the router rejects its own ICMP and the dashboard reads a healthy AP as permanently DOWN.

**Steps in execution.**

1. **Hotspot** — Holds the guest at the login page.
2. **Walled garden** — Allows only the whitelisted hosts.
3. **Bind** — Adds an ip-binding row for a granted MAC.
4. **Report** — Answers health probes and reports Option-82 circuit-ids.

**Questions.**

- ~~**Q-MT1** Should the false-DOWN AP case have a code-level guard, not just a runbook?~~ ✓ Impossible as designed — online_since/offline_since are current-state stamps, not history. Deferred; the ip-binding runbook is the shipped mitigation (2026-07-21).

#### WG · Walled garden

**In one line.** The short list of hosts an unpaid guest is allowed to reach.

**What it does.** Everything a guest needs before paying: the portal itself, the payment gateway, and a few deliberate denies that stop the sign-in window from flapping. Nothing else. It is rebuilt from code, not edited by hand.

**How it's built.** Provisioned as three sequential tag groups by `provisionWalledGarden()`: `veent-admin:probe` (the captive-probe denies, first so they sit above the allows), `veent-admin:payment` (from `PAYMENT_HOSTS`), `veent-admin:portal` (from `ADMIN_WG_HOSTS`/`ADMIN_WG_IPS`/`PORTAL_LAN_IPS`). A separate `gcash-auto` IP row is scheduler-owned and never touched here. Canonical reference: `docs/mikrotik/walled-garden.md`.

**Steps in execution.**

1. **Probe denies** — Deny rows first so they win on a fresh garden.
2. **Payment allows** — Maya, GCash/Alipay/Mynt, googleapis.
3. **Portal allows** — Admin and portal origins plus the LAN portal IP.
4. **Reconcile** — Optional prune of drifted code-owned allow rows.

**Questions.**

- ~~**Q-WG1** Which extra wallets and banks should be onboarded?~~ ✓ Nine candidates listed UNVERIFIED in docs/mikrotik/walled-garden.md (GoTyme, SeaBank, GrabPay, ShopeePay, Coins.ph, BDO, BPI, Landbank, Security Bank). None whitelisted — each needs the ₱0 recon protocol first (2026-07-30).

#### GS · gcash-resolve scheduler

**In one line.** A five-minute job on the router that keeps GCash reachable by IP.

**What it does.** GCash hides behind a CDN, and the router can only match plain hostnames. So instead of naming the host, the router looks up its current address every few minutes and allows that address directly.

**How it's built.** An idempotent `/system scheduler` item named `gcash-resolve`, created by `provisionGcashResolveScheduler()`. It `:resolve`s the hostname and upserts the `gcash-auto` walled-garden-ip row. Root cause: `payments.gcash.com` CNAMEs to an Akamai edge and **v6 dst-host matching cannot follow a CNAME chain** — hostname rules always showed zero hits. The originally designed DoH/DoT firewall block was proven unnecessary and never built.

**Steps in execution.**

1. **Tick** — Fires every 5 minutes.
2. **Resolve** — Looks up the current edge address.
3. **Upsert** — Writes the gcash-auto IP row.
4. **Survive wipe** — Re-adds the row within 5 min of a hard reset.

**Questions.**

- **Q-GS1** Rule of thumb to keep applying: a host that CNAMEs to a CDN needs a resolve scheduler; a host that resolves to the provider’s own IP needs only a PAYMENT_HOSTS entry.

### The guest portal

#### CU · Customer portal

**In one line.** The page the guest lands on — sign in, see your time, buy more.

**What it does.** Phone login, a dashboard showing remaining time, and a top-up flow. It is the only app a guest ever sees, and it must be reachable from behind the walled garden, which is why its address is a LAN address and not a public one.

**How it's built.** `apps/customer`, SvelteKit with `adapter-node`. Its own `betterAuth()` instance, cookie prefix **veent-portal**, separate secret from admin. `ORIGIN` must be the guest-reachable walled-gardened LAN portal address — never `localhost` and never the tunnel.

**Steps in execution.**

1. **Land** — Captive redirect arrives with the MAC.
2. **Login** — Phone number, then a one-time code.
3. **Dashboard** — Shows time left and whether this device is bound.
4. **Top up** — Starts a Maya checkout.

#### OT · OTP and SMS

**In one line.** Sends the one-time code and watches whether it actually arrived.

**What it does.** The guest types a phone number, a code goes out over SMS, and every send attempt is logged. Only one of the SMS providers can tell us whether the message was really delivered.

**How it's built.** `apps/customer/src/lib/server/otp.ts` writes an append-only row to `customer_otp_delivery_log` per attempt — the insert is **awaited inside its own try/catch**, because an un-awaited rejection escapes onto the guest login path. Only **Cast** has real delivery receipts; itexmo, unisms and smsgate rows are written but never swept. `api/otp/sweep-delivery` alerts on rejected sends inside a 30-minute window and prunes rows after 48h.

**Steps in execution.**

1. **Send** — Gateway call, then log the attempt.
2. **Verify** — Guest types the code back.
3. **Sweep** — Cron checks Cast delivery receipts.
4. **Prune** — Rows older than 48h are dropped.

**Questions.**

- **Q-OT1** Is the Cast delivery-receipt response shape stable beyond the one observed REJECTD case? → _Blocked on Cast activating a real sender ID for live traffic_

### Money and grants

#### MY · Maya payments

**In one line.** The hosted checkout where the guest actually pays.

**What it does.** The guest is sent to Maya, pays with GCash or a Maya wallet, and comes back. Maya also calls us server-side to confirm, and a reconciler catches anything the callback missed.

**How it's built.** Hand-rolled HTTP in `packages/core/src/integrations/payments/maya.ts` — no SDK. Webhooks reach dev through a registered ngrok tunnel. **The browser return and the webhook use different origins**: the return uses `event.url.origin`, the webhook uses `TUNNEL_ORIGIN`. Crossing them fails with `ERR_CONNECTION_CLOSED` because the guest is still captive at redirect time.

**Steps in execution.**

1. **Checkout** — Portal creates the checkout and redirects.
2. **Pay** — Guest pays on Maya’s page.
3. **Webhook** — Maya calls the portal server-side.
4. **Reconcile** — Cron sweeps anything the webhook missed.

#### LD · Ledgers

**In one line.** Append-only records of money in and time out.

**What it does.** Credits bought, points earned, transactions recorded. Nothing is ever edited in place, so the finance page can always be rebuilt from the trail.

**How it's built.** `credit_ledger`, `points_ledger`, `payment_transactions`, `payment_checkouts` — all `timestamptz` since migration `0052`. Duplicate crediting is caught by walking the drizzle error cause-chain for SQLSTATE **23505**, checking both `constraint_name` and `constraint` because drivers differ.

**Steps in execution.**

1. **Credit** — A settled payment writes a credit row.
2. **Spend** — A grant draws it down.
3. **Report** — Finance reads a merged, deduped activity list.

#### SS · Sessions and grants

**In one line.** Decides how much time a device gets and when to take it back.

**What it does.** Free time for new guests, paid time for those who bought it, and an expiry sweep that revokes access when the clock runs out. It also pauses everyone’s clock when their access point goes down.

**How it's built.** `packages/core/src/services/` — `sessions.ts`, `credits.ts`, `points.ts`, `freeTime.ts`, `outage.ts`. Pause and resume select on `network_sessions.network_id`, which is why the circuit-id-first binding matters. Revocation runs from a cron endpoint, wrapped in `Sentry.withMonitor`.

**Steps in execution.**

1. **Resolve device** — Circuit-id first, then interface name.
2. **Grant** — Write the session row, call the router.
3. **Pause** — Freeze the clock during an AP outage.
4. **Revoke** — Expire the session and unbind the MAC.

### Shared foundations

#### NC · NetworkController

**In one line.** The one interface everything uses to talk to the router.

**What it does.** A single narrow door between the business logic and the network hardware. Swap the real router for a fake one and every test still runs, which is the only reason this codebase can be tested without hardware.

**How it's built.** `packages/core/src/integrations/network/` — `types.ts` defines the interface, `mikrotik.ts` is the real provider, `stub.ts` is the fallback, and `index.ts` picks one from `NETWORK_CONTROLLER`. `traceMethods()` wraps every method in a Sentry span at the factory seam. Timeouts throw `RouterUnreachableError`, which is **downgraded to warning level** because the cron monitor already alerts.

**Steps in execution.**

1. **Choose** — Env picks mikrotik or stub.
2. **Trace** — Each method is wrapped in a span.
3. **Call** — Grant, revoke, probe, provision, wipe.
4. **Degrade** — Timeout becomes a typed, warning-level error.

#### DB · Postgres

**In one line.** One database, one schema package, shared by all three apps.

**What it does.** Everything durable lives here — guests, staff, sessions, ledgers, incidents, rate limits, AP health. The apps never share code with each other; they share this.

**How it's built.** `@veent/db` is the sole schema and migration authority: `packages/db/src/schema/index.ts` plus **53 migrations**. The dev DB is push-managed, so `db:migrate` fails on journal drift — apply new DDL directly to verify locally, but still generate the migration file for the record.

**Steps in execution.**

1. **Define** — Schema files under src/schema/.
2. **Generate** — drizzle-kit writes the migration.
3. **Apply** — Direct DDL in dev; the runbook in prod.
4. **Share** — All three apps read the same tables.

#### LO · Locator map

**In one line.** A public map of where the hotspots are. No login.

**What it does.** The smallest app in the repo. It reads hotspot locations and draws them on a map for anyone who visits.

**How it's built.** `apps/locator`, Leaflet, two env vars (`DATABASE_URL`, `ORIGIN`), no auth surface at all. Reads the shared database directly.

**Steps in execution.**

1. **Read** — Query hotspot locations.
2. **Draw** — Render Leaflet markers.

#### CR · Scheduled jobs

**In one line.** There is no cron app — just guarded HTTP endpoints someone else calls.

**What it does.** Four jobs: revoke expired sessions, reconcile payments, sweep OTP delivery, refresh AP health. In production an external scheduler calls them; in development a script polls them.

**How it's built.** Endpoints guarded by an `x-cron-secret` header. `scripts/dev-cron.ts` polls on a single one-minute interval — but **the OTP sweep is designed for a five-minute prod cadence**, so that schedule must be set on the real scheduler, not inferred from dev. The sweep’s alert path has no atomic claim, so genuinely overlapping runs could double-alert.

**Steps in execution.**

1. **Revoke** — Expire finished sessions.
2. **Reconcile** — Catch payments the webhook missed.
3. **Sweep** — Check OTP delivery receipts.
4. **Refresh** — Re-probe AP health.

**Questions.**

- **Q-CR1** The five-minute OTP sweep cadence has to be configured on the external prod scheduler — nothing in the repo enforces it.

### Staff operations

#### AD · Admin dashboard

**In one line.** Where staff run the shop — networks, finance, incidents, staff accounts.

**What it does.** Access points and their health, the finance activity list and CSV export, the incident board, staff accounts with two-factor, and the router setup scripts. It is deliberately separate from the guest portal.

**How it's built.** `apps/admin`. Authed routes sit in the `(app)` route group; login, 2FA and password reset sit outside it. Its own `betterAuth()` instance, cookie prefix **radius-admin**, secret at least 32 characters. Every issue mutation runs in a transaction that appends an `admin_issue_event` row in the same transaction — never a fire-and-forget log write.

**Steps in execution.**

1. **Sign in** — Password, then TOTP.
2. **Operate** — Networks, finance, issues, staff, map.
3. **Provision** — Run setup:router against the live box.
4. **Audit** — Every mutation writes its own event row.

**Questions.**

- **Q-AD1** Does the manager issue board need row pagination? → _Backlog — lazy event loading shipped; row pagination still open (GH backlog)_

#### HL · AP health and outage

**In one line.** Watches the access points and freezes guest clocks when one dies.

**What it does.** Probes each access point, records whether it is up, and if it goes down, pauses the paid time of everyone connected to it so nobody loses minutes to an outage.

**How it's built.** `packages/core/src/services/networkHealth.ts` plus `outage.ts`, writing `network_health`. AP name collisions are retried by walking the drizzle cause-chain for a unique violation — which only works while the call sites stay **outside** a transaction. A static tripwire spec fails the build if either admin call site is ever wrapped in `db.transaction(`.

**Steps in execution.**

1. **Probe** — Ask the router about each AP.
2. **Record** — Upsert the health row, retry on name collision.
3. **Pause** — Freeze sessions bound to a down AP.
4. **Resume** — Unfreeze when it comes back.

**Questions.**

- **Q-HL1** Has the live down-AP case been observed end to end in production? → _Accepted known-gap — tracked in the general-plans backlog_

#### SN · Sentry and incidents

**In one line.** Errors come in, staff turn them into tracked incidents.

**What it does.** All three apps report errors. Staff can pull a Sentry issue onto the incident board, assign it, and work it. Personal data is stripped before anything leaves the building.

**How it's built.** `@sentry/sveltekit` in all three apps, `@sentry/core` in `packages/core`. A shared `scrubEvent` redactor is wired into every `beforeSend`: it drops secrets and masks emails, MACs and phone numbers. Tracking a Sentry issue **round-trips the Sentry API before persisting** and fails closed if the lookup fails. Permalink hosts are pinned to sentry.io.

**Steps in execution.**

1. **Capture** — Error is caught and scrubbed.
2. **Classify** — Router timeouts drop to warning level.
3. **Track** — Staff pull it onto the incident board.
4. **Resolve** — Assignment and events are audit-logged.

### Not yet switched on (designed for, not built)

#### MR · Multi-router support _(not switched on)_

**In one line.** Later: more than one router, and third-party APs that speak their own API.

**What it does.** Today the system assumes one MikroTik. The plan is to support several sites, and access points from a vendor whose API we do not have credentials for yet.

**How it's built.** Plan archived to `process/general-plans/completed/multi-router-support_13-07-26/` as deferred but revisitable. Phase B is blocked on Fatap AP-API credentials, tracked as GH #100.

**Steps in execution.**

1. **Credentials** — Get Fatap AP-API access.
2. **Generalise** — Make NetworkController multi-instance.
3. **Route** — Bind each session to its own router.

**Questions.**

- **Q-MR1** When do we get Fatap AP-API credentials? → _GH #100 — plan archived as deferred/revisitable (2026-07-30)_

## Flows (representative packets)

Payload shapes are what the design implies, not measured traffic.

### A guest gets online free

| #   | From → To | Packet           | Representative payload                        |
| --- | --------- | ---------------- | --------------------------------------------- |
| 1   | G → MT    | associate        | `{"mac":"AA:BB:CC:11:22:33","ssid":"Veent"}`  |
| 2   | MT → CU   | captive redirect | `{"mac":"AA:BB:CC:11:22:33","to":"/login"}`   |
| 3   | CU → OT   | send code        | `{"phone":"+639••••••123","provider":"cast"}` |
| 4   | OT → CU   | verified         | `{"ok":true}`                                 |
| 5   | CU → SS   | grant free time  | `{"minutes":30,"reason":"free_session"}`      |
| 6   | SS → NC   | allow mac        | `{"mac":"AA:BB:CC:11:22:33"}`                 |
| 7   | NC → MT   | ip-binding       | `{"type":"bypassed"}`                         |
| 8   | MT → G    | internet         | `{"state":"granted"}`                         |

### A guest pays

| #   | From → To | Packet          | Representative payload           |
| --- | --------- | --------------- | -------------------------------- |
| 1   | CU → MY   | create checkout | `{"amount":20,"currency":"PHP"}` |
| 2   | MY → CU   | webhook: paid   | `{"status":"PAYMENT_SUCCESS"}`   |
| 3   | CU → LD   | credit          | `{"credits":20,"ref":"chk_…"}`   |
| 4   | LD → SS   | spend           | `{"minutes":120}`                |
| 5   | SS → NC   | allow mac       | `{"mac":"AA:BB:CC:11:22:33"}`    |
| 6   | NC → MT   | ip-binding      | `{"type":"bypassed"}`            |

### Staff rebuild the walled garden

| #   | From → To | Packet              | Representative payload                  |
| --- | --------- | ------------------- | --------------------------------------- |
| 1   | AD → NC   | setup:router --wipe | `{"dryRun":false}`                      |
| 2   | NC → WG   | provision 3 groups  | `{"tags":["probe","payment","portal"]}` |
| 3   | WG → MT   | write rows          | `{"host":14,"ip":2}`                    |
| 4   | GS → WG   | gcash-auto ip       | `{"every":"5m"}`                        |

### An access point goes down

| #   | From → To | Packet         | Representative payload       |
| --- | --------- | -------------- | ---------------------------- |
| 1   | CR → HL   | refresh health | `{"secret":"x-cron-secret"}` |
| 2   | HL → NC   | probe aps      | `{"count":6}`                |
| 3   | NC → MT   | ping           | `{}`                         |
| 4   | MT → NC   | no reply       | `{"rtt":null}`               |
| 5   | HL → DB   | mark down      | `{"networkId":"ap-3"}`       |
| 6   | HL → SS   | pause clocks   | `{"sessions":4}`             |

### An error becomes an incident

| #   | From → To | Packet         | Representative payload             |
| --- | --------- | -------------- | ---------------------------------- |
| 1   | CU → SN   | scrubbed error | `{"level":"error","pii":"masked"}` |
| 2   | SN → AD   | track issue    | `{"verified":true}`                |
| 3   | AD → DB   | issue + event  | `{"tx":true}`                      |

## Questions — index

Reference by ID. ✓ resolved (with date) · otherwise open.

- ~~**Q-G1**~~ (G) ✓ Not reproduced — it needs live IP→MAC resolution to fail on purpose. Proven by code and unit tests only (2026-07-23).
- ~~**Q-MT1**~~ (MT) ✓ Impossible as designed — online_since/offline_since are current-state stamps, not history. Deferred; the ip-binding runbook is the shipped mitigation (2026-07-21).
- ~~**Q-WG1**~~ (WG) ✓ Nine candidates listed UNVERIFIED in docs/mikrotik/walled-garden.md (GoTyme, SeaBank, GrabPay, ShopeePay, Coins.ph, BDO, BPI, Landbank, Security Bank). None whitelisted — each needs the ₱0 recon protocol first (2026-07-30).
- **Q-GS1** (GS) Rule of thumb to keep applying: a host that CNAMEs to a CDN needs a resolve scheduler; a host that resolves to the provider’s own IP needs only a PAYMENT_HOSTS entry.
- **Q-OT1** (OT) Is the Cast delivery-receipt response shape stable beyond the one observed REJECTD case?
- **Q-CR1** (CR) The five-minute OTP sweep cadence has to be configured on the external prod scheduler — nothing in the repo enforces it.
- **Q-AD1** (AD) Does the manager issue board need row pagination?
- **Q-HL1** (HL) Has the live down-AP case been observed end to end in production?
- **Q-MR1** (MR) When do we get Fatap AP-API credentials?

## What the platform gives vs what we own

**Platform gives:** MikroTik RouterOS gives the hotspot, the walled garden, DHCP Option-82 circuit-ids and `ip-binding type=bypassed` for granting access. SvelteKit gives routing, form actions and server-only modules. better-auth gives sessions, TOTP and phone-OTP. Drizzle gives the schema and migration chain. Sentry gives error capture and cron check-ins.

**We own:** The walled-garden model (tag groups, additive provisioning, opt-in prune, hard reset), the MAC→session→AP binding logic, credits and points ledgers, free-time rules, the outage auto-pause, OTP delivery observability, the incident board, and the whole admin dashboard.

## Planned filesystem

```
apps/
  admin/          staff dashboard — networks, finance, issues, staff, map
    scripts/setup-router.ts
    scripts/walled-garden-config.ts
  customer/       captive portal — login, dashboard, top-up, probe endpoints
  locator/        public read-only hotspot map
packages/
  core/
    services/     sessions credits points freeTime outage networkHealth …
    integrations/ network/{mikrotik,stub} payments/maya email/{resend,stub}
  db/
    src/schema/   customer admin admin-issue auth-* …
    drizzle/      53 migrations
scripts/dev-cron.ts
docs/mikrotik/walled-garden.md
```

## How this file is maintained

Generated from `docs/architecture/atlas/data.mjs` by `node docs/architecture/atlas/build.mjs`, which also builds the interactive atlas (`atlas.html`). Edit the data file, rebuild, republish — never edit this file by hand.
