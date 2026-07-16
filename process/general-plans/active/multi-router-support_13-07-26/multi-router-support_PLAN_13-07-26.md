---
name: plan:multi-router-support
description: "Convert Veent WiFi Portal from single-router to central multi-router/multi-site (Option B) — controller registry, DB-backed encrypted router registry, per-site session tagging, multi-controller cron. COMPLEX review artifact."
date: 13-07-26
feature: network-infrastructure-ops
phase: "review"
---

# Multi-Router / Multi-Site Support (Option B) — Implementation Plan

> **Status:** REVIEW ARTIFACT — not immediate-execute. Complexity: **COMPLEX** and, for the real build, a **PHASE PROGRAM** (5 dependent phases, each with its own validation gate + high-risk evidence pack). This single document is the detailed umbrella-style plan for the user to read and confirm. Nothing here is implemented.
>
> **TL;DR:** Today one app instance talks to exactly one MikroTik router (env `MIKROTIK_*` → one singleton `network` controller). Option B makes one central app instance manage N routers across N sites: a DB-backed **router registry** (encrypted creds) replaces the env singleton, a **`getController(siteId)` factory** resolves the right router per request, every grant/revoke/session gets a **`site_id`** so money and attribution land on the correct router, and the revoke/health crons **fan out over all enabled sites**. The conversion is strictly additive — seeding one "default site" from the existing env means behavior is identical until later phases activate multi-site, so it never breaks mid-migration.

---

**Date**: 13-07-26
**Status**: REVIEW ARTIFACT (not immediate-execute)
**Complexity**: COMPLEX (real build = PHASE PROGRAM, 5 dependent phases)
**Feature**: network-infrastructure-ops (deferred candidate — stays in general-plans until 5+ artifacts)

## Overview

This plan is a detailed **review artifact** for converting Veent WiFi Portal from single-router to central multi-router/multi-site operation ("Option B"). It is written to be read and confirmed by the user before any build begins. The real build should run as a phase program (umbrella + 5 per-phase plans), with VALIDATE and a high-risk evidence pack before each execute phase. See the DECISIONS section for the three open choices that must be confirmed first.

**Context loaded for this plan:** `process/context/all-context.md` (root router), `process/context/database/all-database.md` (schema/migration workflow), `docs/mikrotik/adding-a-remote-router.md` (Option A/B topology + per-site attribution), `process/development-protocols/implementation-standards.md`. Post-phase testing follows `process/context/tests/all-tests.md` (test runners + the pglite fixture pattern) — each phase's FA/Hybrid gates below are the post-phase test procedure.

## Architecture — What This Does and How It Changes

### 1.1 What the feature does (plain language)

A **central captive portal** manages many hotspot sites at once instead of one. Concretely, one deployed `apps/customer` + `apps/admin` instance can:

1. **Know which site a guest is on** at request time (a guest at Site A behind Router A must be granted access *on Router A*, not Router B).
2. **Grant / revoke / report per-site** — buying WiFi time pushes an `ip-binding` to the *correct* router; the revoke cron expires each site's sessions against *that site's* router; the admin dashboard shows which site each session and each AP belongs to.
3. **Manage routers as data, not env** — operators add/edit/disable routers from an admin CRUD screen; router API credentials live (encrypted) in the database rather than in a single app's `.env`.

This is the doc's **Option B** (`docs/mikrotik/adding-a-remote-router.md` §"What centralized multi-site (Option B) would require"). Option A (one app instance per site + shared DB) works *today* with zero code; Option B is only justified when a single central "single pane of glass" deploy is a real business requirement (see DECISION C).

### 1.2 Current vs Target

| Dimension | Current (single-router) | Target (Option B multi-router) |
|---|---|---|
| Controller | One `network` singleton per app, built from `env.MIKROTIK_*` (`apps/{admin,customer}/src/lib/server/network.ts`) | `getController(siteId)` registry factory; N stateless controllers, one per enabled site |
| Router config source | Env vars (`MIKROTIK_HOST/USER/PASSWORD/…`) | `sites` DB table (host/user/pw/tls/hotspot creds/exclude-interfaces/WG/origin/enabled) with **encrypted** secrets; env seeds ONE default site |
| Which router for a grant/revoke | Implicit — there is only one | `resolveSiteId(event, userId)` at request time → controller for that site |
| Session attribution | `network_sessions.networkId` → a `network_health` row (per-interface, no site dimension) | `network_sessions.site_id` (+ `network_health.site_id`); `network_health` unique key becomes composite `(site_id, name)` |
| Health table key | `network_health_name_key` UNIQUE on `name` (`admin.ts:158`) — two sites' `vlan70 hotspot` collide | composite UNIQUE `(site_id, name)` — same interface name allowed per site |
| Revoke / health cron | Acts on the single `network` singleton | Iterates all enabled sites; each sweep scoped to its own router + its own sessions |
| Admin UI | Global networks/health list; map pins global | Per-site grouped/filtered networks + map; NEW Sites/Routers CRUD screen |
| Credential exposure | Router API password in env only (process memory) | Secrets-at-rest in Postgres → **requires encryption** (new risk, see §Risk) |

### 1.3 How the architecture shifts (the load-bearing insight)

**`@veent/core` is already dependency-injected.** Every service takes `network: NetworkController` as an explicit parameter — verified at `packages/core/src/services/sessions.ts` (grant/revoke/reconcile all receive `network`). There is **no singleton inside core**. The only two singletons in the whole system are the app-side module exports:

- `apps/admin/src/lib/server/network.ts:32` → `export const network = createNetworkController(buildConfig())`
- `apps/customer/src/lib/server/network.ts:26` → same shape

So the conversion is **narrow**: replace those two module singletons with a registry factory, and change every call site that today reads the module `network` to first *resolve* the site then *pass* the resolved controller into the same unchanged core service. Core does not change its signatures. MikroTik connects **per-call / stateless** (`mikrotik.ts` opens a connection per operation), so having N controllers looped over is cheap — no connection-pool redesign, no long-lived sockets.

Four moving parts change, in dependency order:

1. **Storage** — a `sites` registry table mirroring `MikrotikConfig` + both `buildConfig()` bodies; existing env becomes the seed for one "default site".
2. **Resolution** — `getController(siteId)` (registry) and `resolveSiteId(event, userId)` (request→site), the latter mirroring the working layered pattern in `resolveCheckoutNetworkId` (`network-location.ts:205`).
3. **Tagging** — `site_id` stamped onto sessions at bind time so downstream reporting/cron act on the right router.
4. **Fan-out** — crons loop enabled sites instead of the singleton.

---

## DECISIONS (INNOVATE-style — CONFIRM ON REVIEW)

Three open decisions. Each has a RECOMMENDED answer + rationale + rejected alternatives. **All flagged CONFIRM ON REVIEW** — the user must confirm before Phase 1+ begins.

### DECISION A — Site-resolution primary signal · CONFIRM ON REVIEW

**Recommended: parse the MikroTik `link-login-only` host as the primary site key**, with a layered fallback chain mirroring `resolveCheckoutNetworkId`.

- **Why:** `link-login-only` (captured today at `portal.ts:34-42,48` into `PortalContext.callbackUrl`) is the router's *own* hotspot login URL, containing the router's LAN IP/host. It is **server-derivable at request time** and requires **no per-site router template change** — every MikroTik hotspot already sends it. It is the strongest signal that does not require touching `login.html` at every site.
- **Fallback chain (in order):** (1) `link-login-only` host → site; (2) per-site portal ORIGIN / subdomain (host-based, cookie-independent — good hybrid secondary, needs per-site DNS/vhost); (3) `?ap=/?ssid=` (needs a `login.html` template change per site — weaker); (4) persisted `network_sessions`/`customer_profile.lastSiteId` fallback (already the last-resort pattern in `resolveCheckoutNetworkId:246-253`).
- **Rejected — source-IP→subnet map:** fragile; the hotspot NATs guests to the router IP, so the observed source IP is the router's, and cross-site VPN routing muddies it further.
- **Rejected — `?ap=` as primary:** MikroTik does not send `ap` by default; it is zone-level not site-level and needs a template edit at every site (the exact per-site friction we want to avoid).

### DECISION B — Router credential storage · CONFIRM ON REVIEW

**Recommended: app-level envelope encryption of router secrets in the `sites` table, with a legacy-env fallback.**

- **Why:** moving router API passwords from env-only into the DB is a **secrets-at-rest** change — plaintext columns would be an auth/trust-boundary *regression* versus today. Envelope encryption (a master key from env/secret store encrypts each row's `password`/`hotspotLoginPassword`; only ciphertext is stored) keeps the master secret out of the DB while letting the registry hold N routers. Legacy-env fallback (if a site row has no encrypted creds, fall back to the `MIKROTIK_*` env trio) preserves Phase-0 behavior and a break-glass path.
- **Alternatives considered:** (1) **pgcrypto** (DB-side encryption) — viable but puts the key nearer the data and couples secret handling to Postgres; app-level envelope keeps the trust boundary in the app. (2) **External secret store** (Vault / cloud secrets manager) — strongest, but heavyweight for current team scale; recommend as a *future* upgrade, not a Phase-1 blocker. (3) **Plaintext columns — REJECTED** — a clear regression; explicitly out of scope.
- **Note:** this decision gates Phase 1 (encryption lands *with* the registry, before any real secret moves to the DB).

### DECISION C — Option B vs Option A (build-or-not) · CONFIRM ON REVIEW

**Recommended: confirm the business need before building Phase 1+.** The canonical doc (`adding-a-remote-router.md:37`) currently recommends **Option A** (one app instance per site + one shared Postgres over Tailscale/VPN) because it works **today with zero code** and unifies reporting via a shared DB + a `site_id` label. Option B (this plan) is only justified if a **single central deploy managing all routers from one instance** is a real, stated business driver (e.g. one operator, many sites, wants one grant/revoke control plane and cannot run a box per site).

- **If the driver is only unified *reporting*:** Option A + shared DB + a `site_id` column already delivers it — build Phase 0 (the `sites` table + `site_id` tagging) and STOP; do not build Phases 1–4.
- **If the driver is central *management* (grant/revoke remote routers from the center):** proceed to Phases 1–4, and note the network prerequisite — the central server needs a VPN path to each router's API (WireGuard/IPsec or a Tailscale subnet-router per site; `adding-a-remote-router.md:176-181`). No amount of app code substitutes for that path.

---

## Touchpoints

Files/packages this program changes or reads (full per-phase detail in each phase block below):

- **`packages/db`** — NEW `schema/sites.ts`; `schema/admin.ts` (`network_health` +`site_id`, composite unique); `schema/customer.ts` (`network_sessions`/`customer_profile` +`site_id`/`last_site_id`); barrel `schema/index.ts`; new migrations under `drizzle/`; `seed.ts`.
- **`packages/core`** — NEW `integrations/network/registry.ts` (`getController`), NEW `services/crypto.ts` (envelope encryption); `services/sessions.ts` (bind stamps `site_id`; `reconcileGuestBindings` per-router).
- **`apps/customer`** — `lib/server/network.ts`, `lib/server/network-location.ts` (`resolveSiteId`), `lib/server/validateEnv.ts`, `routes/api/network/grant`, `routes/api/network/revoke`, `routes/dashboard`, `routes/top-up`.
- **`apps/admin`** — `lib/server/network.ts`, `lib/server/validateEnv.ts`, NEW `routes/(app)/sites/` CRUD, `routes/(app)/networks`, `routes/(app)/map`, `routes/(app)/users`, `routes/api/network/health/refresh`, `routes/api/router-log`, `lib/server/adminBypass.ts`, `lib/server/postLogin.ts`.
- **`apps/locator`** — map read of `network_health` (must group by site; read-only).

## Implementation Checklist / Phased Delivery Plan

Strictly additive. Each phase leaves the system fully working; nothing breaks mid-migration. Phase 0 is a safe pre-req even under Option A. Phases 1–4 are the actual Option B build (gated on DECISION C).

Legend for verification tier: **FA** = Fully-Automated · **HY** = Hybrid (needs precondition) · **AP** = Agent-Probe (judgment) · **KG** = Known-Gap.

---

### Phase 0 — `sites` table + seed default from env (schema-only)

**Goal:** Introduce the router registry table and backfill one "default site" from existing env. Behavior identical; nothing reads `site_id` for control yet.

**Touchpoints:**
- NEW `packages/db/src/schema/sites.ts` — `sites` table; export from `packages/db/src/schema/index.ts` barrel.
- `packages/db/src/schema/admin.ts:106-163` — `network_health`: add nullable `site_id` FK column (do NOT change the unique key yet — that's Phase 2, to keep Phase 0 behavior identical).
- `packages/db/src/schema/customer.ts` — `network_sessions` (:251, `networkId`:265): add nullable `site_id`; `customer_profile` (:30, `lastNetworkId`:81, `accessPausedNetworkId`:74): add nullable `lastSiteId` (or derive via join — see blast radius).
- NEW migration under `packages/db/drizzle/` via `db:generate` (dev DB push-managed — generate for the record, apply DDL directly to verify per `all-database.md:127-139`).
- NEW seed logic (in `packages/db/src/seed.ts` or a one-off script): insert one `sites` row from `MIKROTIK_*` env; backfill existing `network_health`/`network_sessions` rows to that default `site_id`.

**Schema DDL sketch (`sites`):**
```
sites(
  id            serial primary key,
  label         text not null,              -- operator name, e.g. "Main Site"
  host          text not null,
  api_user      text not null,
  api_password  text not null,              -- Phase 0: nullable/plaintext-from-env placeholder; Phase 1 encrypts
  port          integer,                    -- 8728 plain / 8729 api-ssl
  tls           boolean not null default false,
  insecure_tls  boolean not null default false,
  hotspot_login_user     text,
  hotspot_login_password text,              -- Phase 1 encrypts
  exclude_interfaces     text,              -- comma-joined, mirrors HEALTH_EXCLUDE_INTERFACES
  wg_hosts      text,                        -- optional, mirrors ADMIN_WG_HOSTS
  wg_ips        text,                        -- optional, mirrors ADMIN_WG_IPS
  origin        text,                        -- portal URL guests at this site hit
  enabled       boolean not null default true,
  created_at    timestamp not null default now(),
  updated_at    timestamp not null default now()
)
-- network_health:   ADD COLUMN site_id integer REFERENCES sites(id)  (nullable in P0)
-- network_sessions: ADD COLUMN site_id integer REFERENCES sites(id)  (nullable in P0)
-- customer_profile: ADD COLUMN last_site_id integer REFERENCES sites(id)  (nullable)
```

**Blast radius:** `packages/db` only (schema + migration + seed). No app or core logic reads `site_id` yet. Risk class: **schema/migration** (high-risk — additive nullable columns are the safest form; the one live-DB concern is the push-managed drift, handled by direct-DDL-apply).
- *Derive-vs-store note:* `lastSiteId` can be derived by joining `customer_profile.lastNetworkId → network_health.site_id`. Recommend **storing** `last_site_id` explicitly to avoid a join on the hot resolution path and to survive a `network_health` row deletion. CONFIRM.

**Backward-compat guarantee:** All new columns nullable; a single default site seeded and backfilled. With exactly one site, every downstream resolution (added later) returns the default — identical to today.

**Verification:**
| Surface | Tier | Evidence |
|---|---|---|
| `sites` table + barrel export compiles, `db:generate` diff is additive-only | FA | `bun run db:generate` produces a migration with only `CREATE TABLE`/`ADD COLUMN`; `bunx tsc` clean |
| Seed inserts exactly one default site from env; backfill sets `site_id` on all existing rows | FA | pglite fixture: run seed, assert 1 site row + all `network_health`/`network_sessions` rows non-null `site_id` |
| Direct DDL applies cleanly on drifted dev DB | HY | precondition: local Postgres up; apply migration SQL directly, assert columns exist |

---

### Phase 1 — Controller registry + credential encryption

**Goal:** Replace the two `network.ts` singletons with a `getController(siteId)` factory backed by the `sites` table; add credential encryption (secrets move to DB here). Default site preserves current behavior.

**Touchpoints:**
- NEW `packages/core/src/integrations/network/registry.ts` (or app-side `$lib/server/networkRegistry.ts`) — `getController(db, siteId): Promise<NetworkController>`; reads the `sites` row, decrypts creds, builds `MikrotikConfig` (mirrors `buildConfig()` at `admin/network.ts:6-30` and the identical customer body), calls `createNetworkController`. Caches by `siteId` (controllers are stateless config holders — safe to memoize).
- NEW `packages/core/src/services/crypto.ts` (or similar) — envelope encrypt/decrypt for `api_password` + `hotspot_login_password`, master key from env (`SITES_ENCRYPTION_KEY`).
- `apps/admin/src/lib/server/network.ts:32` and `apps/customer/src/lib/server/network.ts:26` — replace the `export const network = …` singleton with a thin `getController(siteId)` re-export + a legacy-env fallback (if no sites in DB, synthesize default from env — preserves Phase 0/Option-A behavior).
- `apps/{admin,customer}/src/lib/server/validateEnv.ts` — relax the hard `MIKROTIK_*` requirement to "≥1 enabled site in DB OR legacy env trio present"; require `SITES_ENCRYPTION_KEY` when sites carry encrypted creds.
- Env: add `SITES_ENCRYPTION_KEY` to `.env.example` (admin + customer).

**Blast radius:** `packages/core` (new registry + crypto), both apps' `network.ts` + `validateEnv.ts`. Call sites still import a resolved controller — but at this phase they all resolve the **default** site, so no call-site logic changes yet. Risk class: **secrets/trust-boundary + auth** (HIGH — credential-at-rest is the single biggest new risk). `@veent/db` reads no env itself → unaffected.

**Backward-compat guarantee:** `getController(defaultSiteId)` returns a controller byte-identical to today's `buildConfig()` output. Legacy-env fallback means a deploy with no `sites` rows still works exactly as before. Encryption round-trips the same plaintext the env held.

**Verification:**
| Surface | Tier | Evidence |
|---|---|---|
| `getController(siteId)` builds a MikrotikConfig equal to `buildConfig()` for the default site | FA | unit: seed default site, assert resolved config deep-equals env-derived config |
| Credential encryption round-trip (encrypt→store→decrypt = original) | FA | unit on `crypto.ts`: `decrypt(encrypt(pw)) === pw`; ciphertext ≠ plaintext in the row |
| Legacy-env fallback when no sites in DB | FA | pglite empty `sites` → `getController` synthesizes from env stub |
| `validateEnv` accepts (≥1 site) XOR (legacy env); rejects neither | FA | unit table over env/DB permutations |
| Registry never leaks a decrypted secret into logs/Sentry | AP | probe: grep controller build path for password logging; confirm `scrubEvent` coverage |

---

### Phase 2 — Site resolution + session tagging

**Goal:** Resolve which site a request belongs to and stamp `site_id` on every session at bind time. Flip `network_health` unique key to composite `(site_id, name)`.

**Touchpoints:**
- NEW `apps/customer/src/lib/server/network-location.ts` (extend) — `resolveSiteId(event, userId): Promise<number>` mirroring `resolveCheckoutNetworkId:205-273` layered pattern: (1) `link-login-only` host → site; (2) ORIGIN/subdomain; (3) `?ap/?ssid`; (4) active session `site_id`; (5) `customer_profile.lastSiteId`; (6) single-site short-circuit (if only one enabled site, return it — the Option-A/default path).
- `packages/core/src/services/sessions.ts` — `bindDevice` (:273-281 `resolveNetworkIdForMac`): also resolve+stamp `site_id` onto `network_sessions.site_id` and `customer_profile.lastSiteId`, in the SAME transaction as the existing `networkId` stamp (audit-trail/atomicity pattern). Grant/revoke entry points (`startPaidAccessAndBindDevice`/`startFreeAccessAndBindDevice` :244,385,742) receive the resolved controller from `resolveSiteId`→`getController`.
- Customer call sites that pass the singleton `network` → resolve-then-pass: `routes/api/network/grant/+server.ts:62,78`; `routes/dashboard/+page.server.ts:78,155,200,243,262,277,293`; `routes/top-up/+page.server.ts:162`; `network-location.ts:41,225`.
- `packages/db/src/schema/admin.ts:158` — change `uniqueIndex('network_health_name_key').on(t.name)` → composite `(t.siteId, t.name)`; make `site_id` NOT NULL now (backfilled in P0). Migration for the record + direct DDL apply.

**Schema DDL sketch:**
```
DROP INDEX network_health_name_key;
ALTER TABLE network_health ALTER COLUMN site_id SET NOT NULL;
CREATE UNIQUE INDEX network_health_site_name_key ON network_health(site_id, name);
```

**Blast radius:** `packages/core/sessions.ts` (money-critical bind path), customer app grant/dashboard/top-up call sites, `network_health` unique key. Risk class: **billing/money-grant atomicity + schema** (HIGH — a wrong `site_id` = grant on the wrong router = charge-without-access or revoke-on-wrong-router). MAC still resolved server-side via `resolveMacTrusted` — never trust body MAC (M-1/L-1 tripwire, per memory `mac-trust-residual`).

**Backward-compat guarantee:** With one site, `resolveSiteId` always returns the default via the single-site short-circuit → identical grants. Composite unique key with one `site_id` value behaves exactly like the old single-column key. The `network_health` upsert switches to `onConflict (site_id, name)`.

**Verification:**
| Surface | Tier | Evidence |
|---|---|---|
| `resolveSiteId` returns correct site per signal, in priority order | FA | pglite 2-site fixture: table-drive each signal (link-login-only host, ORIGIN, ap, active-session, last-known, single-site) |
| Grant lands on the CORRECT router across 2 sites | FA | 2-stub-controller fixture: grant for a Site-B guest calls only the Site-B stub; Site-A stub untouched |
| Revoke targets the same router the grant used | FA | grant→revoke round-trip asserts same `site_id`/controller |
| `site_id` stamped atomically in the bind transaction (rollback on failure) | FA | inject a failing grant; assert no orphan `network_sessions` row and no `site_id` half-write |
| `network_health` composite-unique allows same interface name per site; rejects dup within a site | FA | insert `(1,'vlan70 hotspot')` + `(2,'vlan70 hotspot')` OK; second `(1,'vlan70 hotspot')` rejected |
| Real MAC→AP→site on live 2-router hardware | KG | blocked on hardware (memory `ap-detection-issue`); documented gap, not a blocker |

---

### Phase 3 — Multi-controller cron

**Goal:** Revoke and health-refresh crons iterate all enabled sites; each sweep scoped to its own router + its own sessions. Reconcile stays strictly per-router.

**Touchpoints:**
- `apps/customer/src/routes/api/network/revoke/+server.ts:35-47` — wrap `sweepOutagePauses`, `expireDueAccounts`, `reconcileGuestBindings`, `sweepCheckoutAccess`, `sweepAdminAccess` in a loop over enabled sites; pass each site's `getController(siteId)` + scope each sweep's session query to that `site_id`.
- `apps/admin/src/routes/api/network/health/refresh/+server.ts:29` — loop enabled sites; `refreshNetworkHealth` upserts on composite `(site_id, name)`.
- `packages/core/src/services/sessions.ts:960` — `reconcileGuestBindings` MUST run per-router (scoped to one site's sessions + that site's router bindings) or it drops orphans wrongly (a Site-A session looks "orphaned" against Site-B's router).
- `scripts/dev-cron.ts` — unchanged if the endpoints fan out internally (endpoints hit once/minute; the loop lives server-side).
- Payment reconcile (`api/payments/reconcile`) — **no change** (does not touch the network controller).

**Blast radius:** two cron endpoints + `reconcileGuestBindings`. Risk class: **billing/atomicity + MikroTik surface** (HIGH — a mis-scoped reconcile revokes paid guests on the wrong router). Cron auth (`x-cron-secret`) unchanged.

**Backward-compat guarantee:** With one enabled site the loop runs exactly once against the default router — identical to today's single-pass sweep. Per-site session scoping is a WHERE-clause addition that is a no-op when all sessions share one `site_id`.

**Verification:**
| Surface | Tier | Evidence |
|---|---|---|
| Revoke cron fans out: each enabled site's sweep hits only its own router/sessions | FA | 2-site + 2-stub fixture: due session at Site A expired via Site-A stub only; Site-B stub not called |
| `reconcileGuestBindings` scoped per-router does NOT drop cross-site "orphans" | FA | seed a Site-A active session; run reconcile against Site-B router; assert Site-A session untouched |
| Health refresh upserts per-site without collision | FA | two sites both report `vlan70 hotspot`; assert two distinct rows updated |
| Disabled site is skipped by all sweeps | FA | mark a site `enabled=false`; assert no controller call for it |
| Full multi-router cron against live hardware | KG | blocked on hardware; documented gap |

---

### Phase 4 — Admin CRUD UI + map/networks site dimension

**Goal:** Operators manage routers from the admin UI; networks/health list + map gain a site dimension.

**Touchpoints:**
- NEW `apps/admin/src/routes/(app)/sites/` (or `routers/`) — Sites/Routers CRUD: add/edit/disable + a "test connectivity" action. Owner-gated, mirroring the wipe/owner gates at `routes/(app)/networks/+page.server.ts:24-29`.
- `apps/admin/src/routes/(app)/networks/+page.server.ts:54,119,121` + `listNetworkHealth` (queries.ts:345) — group/filter health by site.
- `apps/admin/src/routes/(app)/map` — pins gain a site dimension; locator reads the same `network_health` table (`packages/db/network-health.ts`) → must NOT merge two sites' identically-named APs (composite key from Phase 2 already prevents the row-merge; the map read must group by site).
- Dashboard sessions list — add a **Site** column.
- Admin call sites passing the singleton `network` → per-site resolve: `routes/(app)/users/+page.server.ts:45,61,81,105,154`; `routes/api/router-log/+server.ts:28,30`; `lib/server/adminBypass.ts:68,89`; `lib/server/postLogin.ts:56,58`.

**Blast radius:** admin routes (new CRUD + networks/map/users/dashboard), locator map read. Risk class: **auth (owner-gated CRUD writes router creds) + UI**. Credential fields in the CRUD form write through the Phase-1 encryption path — the form never displays stored secrets in plaintext.

**Backward-compat guarantee:** With one site the CRUD screen shows one row; networks/map render as today (single group). Locator unaffected until a 2nd site exists.

**Verification:**
| Surface | Tier | Evidence |
|---|---|---|
| Sites CRUD create/edit/disable persists; secrets stored encrypted, never rendered | FA + AP | FA: server-action test asserts encrypted column; AP: probe the form never echoes a stored password |
| Owner-gate blocks non-owner from Sites CRUD | FA | governance e2e pattern (admin e2e harness) — non-owner 403 |
| "Test connectivity" action reports reachable/unreachable per site | HY | precondition: a reachable stub/live router; asserts pass/fail surfaced |
| Networks/map group by site; no cross-site AP merge | FA | 2-site fixture with dup interface names → two distinct pins/rows |
| Visual: admin Sites screen + Site column render correctly | AP | agent browser pass + human verification handoff (memory `verification`) |

---

## Phase Completion Rules

A phase is `CODE DONE` when its checklist items are implemented and its Fully-Automated (FA) gates pass. A phase is only `VERIFIED` when: (a) all in-blast-radius FA + Hybrid gates are green, (b) its validate-contract is written and satisfied, (c) the high-risk manual-first evidence pack is recorded for the phase's risk class, and (d) for browser-visible surfaces (Phase 4), both an agent browser pass and a human verification handoff are done (memory `verification`). Known-Gap items (live 2-router hardware) never block a phase from VERIFIED — they are recorded as residual gaps, not silent passes. Nothing is marked `✅ VERIFIED` on code-completion alone.

## Acceptance Criteria

The program (all 5 phases) is accepted when:

1. One central app instance grants/revokes/reports against N routers, each resolved by site at request time.
2. `getController(siteId)` fully replaces both `network.ts` singletons; the default-site path is byte-identical to today (backward-compat proven by FA test).
3. Router credentials live encrypted at rest in the `sites` table; no plaintext secret in DB, logs, or Sentry (FA + Agent-Probe proven).
4. `resolveSiteId` correctly attributes each guest to their site via the layered signal chain (FA proven across a 2-site fixture).
5. Grant/revoke land on the CORRECT router across 2 sites; wrong-router charge/revoke is impossible (FA proven with 2-stub controllers).
6. `network_health` composite-unique `(site_id, name)` lets two sites share an interface name without collision (FA proven).
7. Revoke + health crons fan out over enabled sites, each sweep scoped to its own router/sessions; disabled sites skipped; reconcile is per-router (FA proven).
8. Admin Sites/Routers CRUD is owner-gated; networks/map carry a site dimension without cross-site AP merge.
9. Each phase carries a written validate-contract and a high-risk evidence pack for its risk class.
10. Live multi-router end-to-end remains a documented Known-Gap until hardware is available — not a blocker.

## Public Contracts

- **NEW** `getController(db, siteId): Promise<NetworkController>` — replaces the `network` module singleton; all app call sites migrate to it. Legacy-env fallback contract: no sites in DB ⇒ synthesize default from `MIKROTIK_*`.
- **NEW** `resolveSiteId(event, userId): Promise<number>` — request→site resolver; layered, always returns a site (single-site short-circuit guarantees non-null).
- **CHANGED** `network_health` unique key: `(name)` → `(site_id, name)`. Any external SQL/BI reading `network_health` by name alone must add `site_id`.
- **CHANGED** `bindDevice` now stamps `site_id` alongside `networkId` (same transaction; signature may add a `siteId` param — CONFIRM whether to derive inside vs pass in).
- **NEW** env var `SITES_ENCRYPTION_KEY` (admin + customer). `validateEnv` contract relaxes `MIKROTIK_*` from required → "one-of (sites row | legacy env)".
- **NEW** admin routes under `(app)/sites/` — owner-gated CRUD.

## Blast Radius (whole program)

- **Packages:** `packages/db` (schema/migrations/seed), `packages/core` (registry, crypto, sessions bind + reconcile), `apps/customer` (network.ts, network-location.ts, grant/dashboard/top-up/revoke, validateEnv), `apps/admin` (network.ts, sites CRUD, networks/map/users/dashboard/router-log, adminBypass, postLogin, validateEnv), `apps/locator` (map read only).
- **File count:** ~30 touchpoints across 4 packages. **Risk class: HIGH** on all four surfaces below.

## Risk

Four HIGH-risk classes. The real build must run the **high-risk manual-first evidence pack** (`vc-risk-evidence-pack`) at each execute phase before the phase is treated as finalize-ready.

1. **Schema / migration (Phases 0, 2)** — additive nullable columns are safe; the composite-unique flip (P2) is the sharp edge. Dev DB is push-managed (`all-database.md:127`) — generate the migration for the record but apply DDL directly to verify; never trust `db:migrate` locally.
2. **Money / grant atomicity (Phases 2, 3)** — wrong `site_id` = grant on the wrong router (charge-without-access) or revoke-on-wrong-router. Mitigation: `site_id` stamped in the SAME transaction as the grant (existing audit-trail pattern); 2-site + 2-stub fixtures assert the correct controller is called and the other is untouched.
3. **Credential-at-rest / auth (Phase 1)** — the biggest NEW risk. Router API passwords move env→DB. Mitigation: envelope encryption + legacy-env fallback (DECISION B); never log/Sentry decrypted secrets (verify `scrubEvent` coverage); CRUD form never echoes stored secrets.
4. **Captive-portal / MikroTik surface (all phases)** — RouterOS templating, walled-garden, OS captive-probe endpoints, CNA behavior are easy to break (project Gotchas). Mitigation: guest-onboarding end-to-end re-verify after touching grant/bind; the `link-login-only` primary signal deliberately avoids per-site `login.html` template edits.

## Verification Evidence

Consolidated test plan. All FA gates are automatable with a **pglite 2-site + 2-stub-controller fixture** (pattern: `@electric-sql/pglite` per-core-tests + the `stub.ts` network provider). Real multi-router connectivity = **Known-Gap**, blocked on hardware (memory `ap-detection-issue`). Use `bunx vitest run <file>` (never `bun test` — memory `unit-test-runner-gotcha`).

| Gate / Scenario | Strategy | Proves SPEC criterion |
|---|---|---|
| `resolveSiteId` returns correct site per signal in priority order | Fully-Automated | Central portal knows which site a guest is on (Phase 2 goal) |
| Registry `getController(siteId)` == env `buildConfig()` for default site; legacy-env fallback | Fully-Automated | Singleton→registry swap is behavior-preserving (Phase 1 goal) |
| Grant/revoke land on the CORRECT router across 2 sites (2-stub fixture) | Fully-Automated | Per-site grant/revoke correctness; money lands on right router (Phase 2/3 goal) |
| Cron fan-out: each site's sweep hits only its own router/sessions; disabled site skipped | Fully-Automated | Multi-controller cron scoping (Phase 3 goal) |
| `network_health` composite-unique: same name per site OK, dup within site rejected | Fully-Automated | Two sites' identical AP names no longer collide (Phase 2 goal) |
| Credential encryption round-trip; no plaintext at rest; no secret in logs | Fully-Automated + Agent-Probe | Secrets-at-rest is not a regression (DECISION B / Phase 1) |
| `reconcileGuestBindings` per-router does not drop cross-site orphans | Fully-Automated | Reconcile safety under multi-router (Phase 3 goal) |
| Owner-gate on Sites CRUD; secrets never rendered | Fully-Automated + Agent-Probe | Router-registry writes are owner-only (Phase 4 goal) |
| Direct DDL applies on drifted dev DB; migration diff additive-only | Hybrid | Migration safety (Phase 0/2) |
| "Test connectivity" per site | Hybrid | Operator can validate a router before enabling (Phase 4) |
| Live 2-router grant/revoke/cron on real hardware | Known-Gap | End-to-end multi-site on real routers — blocked on hardware |

## Test Infra Improvement Notes

- A reusable **2-site + 2-stub-controller pglite fixture** does not exist yet — building it once (a `NetworkController` stub that records which site's controller was invoked) unlocks all FA gates above and is the single highest-leverage test-infra add for this program. Recommend creating it in Phase 2 and reusing through Phase 4.
- Real multi-router connectivity remains a **Known-Gap** until hardware is back online (memory `ap-detection-issue`); revisit the live-e2e checklist (`adding-a-remote-router.md:223-231`) then.

## Resume and Execution Handoff

1. **Selected plan file path:** `process/general-plans/active/multi-router-support_13-07-26/multi-router-support_PLAN_13-07-26.md`
2. **Last completed phase/step:** PLAN written (review artifact). No execution performed. No phase started.
3. **Validate-contract status:** PENDING — not written (this is a review artifact). See placeholder below.
4. **Supporting context loaded:** `all-context.md`, `database/all-database.md`, `docs/mikrotik/adding-a-remote-router.md`, `implementation-standards.md`; verified file:line claims in `apps/{admin,customer}/src/lib/server/network.ts`, `packages/core/src/integrations/network/mikrotik.ts`, `apps/customer/src/lib/server/{portal.ts,network-location.ts}`, `packages/db/src/schema/admin.ts`.
5. **Next step for a fresh agent:** This is a PHASE PROGRAM. Before any code: (a) get user confirmation on DECISIONS A/B/C; (b) if Option B confirmed, re-scaffold as a phase program (umbrella + 5 per-phase plans via `vc-generate-phase-program`), running VALIDATE + the high-risk evidence pack before each execute phase; (c) start with Phase 0 (safe under Option A too). Do NOT execute all 5 phases as one pass.

**Program-execution note:** Recommend the real build run as a phase program (`process/development-protocols/phase-programs.md`) — one umbrella + one plan per phase, each with its own validate-contract and inner loop (`R → I → P → PVL → E → EVL → UP`). VALIDATE and the high-risk manual-first evidence pack precede each execute phase.

## Validate Contract

(placeholder — vc-validate-agent writes this section before EXECUTE)
