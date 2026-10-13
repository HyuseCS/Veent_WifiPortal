# Gotchas

Read before you change the router, payments, auth, or sessions.

## Router and captive portal

- RouterOS templating, walled-garden limits, OS captive-probe endpoints (`generate_204`, `gen_204`, `ncsi.txt`, `connecttest.txt`, `hotspot-detect.html`), and CNA mini-browser behavior break easily in cleanups. Test guest onboarding end to end after any change.
- A new physical AP MAC must be `type=bypassed` in `/ip/hotspot/ip-binding`. If not, the dashboard shows the AP DOWN and outage auto-pause can freeze paid guests. See `docs/mikrotik/ap-liveness-bypass.md`.
- `dst-host` rules cannot follow a CNAME chain. CDN-fronted hosts need a `:resolve` scheduler. See `integrations.md`.
- `*.domain` does not match bare `domain`. Add both.
- Do not add broad CDN allowlists to the walled garden.
- `*.googleapis.com` stays in `PAYMENT_HOSTS`. Checkout needs it (98 live hits). Do not drop it without a live capture.
- Do not wrap `refreshNetworkHealth` call sites in `db.transaction(`. A guard test fails if you do.

## Payments

- Maya money math, grant atomicity, and webhook flows are high risk. Treat them like auth and billing.
- Never point Maya `successUrl` or `cancelUrl` at `TUNNEL_ORIGIN`. The captive guest cannot reach it. Use `event.url.origin`. In production, `ORIGIN` must be the walled-gardened LAN portal address.
- `MAYA_SANDBOX` must be `'true'` or `'false'`. Other values throw.

## Auth

- Never cross-wire or unify the two `betterAuth()` instances. Separate cookie prefixes, secrets, and tables. See `auth.md`.
- Do not describe the portal `?mac=` query param as server-authoritative. It is client-influenceable. This is a captive-portal limit. Only M-2 is fully closed. M-1 and L-1 are mitigated, not removed.
- `resolveMacForUser` (`apps/customer/src/lib/server/network-location.ts`) returns `{ mac, live }`. A fallback MAC (device cookie or `last_known_mac`) is not a verified binding. Dashboard auto-bind and `thisDeviceBound` use `live`. Fallback MACs must not overwrite `customer_profile.last_known_mac` (seed it only when null). Do not bring back "fallback match means verified". Background: `process/general-plans/completed/mac-trust-grant-fix_23-07-26/`. The fallback-to-unverified-banner path is proven by code and unit tests only. It was never reproduced live.
- `resolveNetworkIdForMac` (`packages/core/src/services/networkHealth.ts`) must resolve the Option-82 circuit-id first. Never put a raw interface-name lookup first. Otherwise a session on a shared hotspot bridge binds to the bridge row, not the physical AP row. That breaks the admin Network column and outage auto-pause. Background: `process/general-plans/completed/ap-session-binding-circuitid-first_23-07-26/`. A real 2-SSID router can differ from the test double.

## Database

- The dev DB is push-managed. `db:migrate` fails on journal drift. Apply new migration DDL directly to test locally. Still run `db:generate`. See `database.md`.
- Use `timestamptz` for new finance and session timestamp columns.
- Never point the admin e2e `DROP SCHEMA` seed at the dev DB.

## Tests

- Never run `bun test <file>`. Use `bunx vitest run <file>` from the app directory.
- A clean run of the client Vitest project proves nothing. It has no specs.
- Playwright merges the owner `storageState` into every context. Override it for non-owner sessions.
- Customer e2e has no safe harness. See `testing.md`.

## Misc

- `scripts/dev-cron.ts` runs everything every minute. Production `otp/sweep-delivery` needs a 5-minute schedule.
- Insert into `customer_otp_delivery_log` with `await` inside `try/catch`.
- `bun run --filter radius-admin check` does not typecheck `apps/admin/scripts/`.
- `TEST_MODE` is blocked at boot in production unless `ALLOW_TEST_MODE_IN_PROD` is set (`apps/customer/src/lib/server/validateEnv.ts`).
