# Integrations

## MikroTik / RouterOS

- Client: `node-routeros` in `packages/core` (`packages/core/src/integrations/network/mikrotik.ts`).
- Admin routes: `apps/admin/src/routes/api/network/`. Setup script: `apps/admin/scripts/setup-router.ts`.
- Docs: `docs/mikrotik/` (walled-garden.md, ap-liveness-bypass.md, admin-lan-access.md, adding-a-remote-router.md, hotspot-activation.md, and more).
- Rule: RouterOS templating, walled-garden limits, OS captive-probe endpoints, and the CNA mini-browser are easy to break. Test guest onboarding end to end after any change here.

### AP liveness bypass

Every new physical AP MAC must be `type=bypassed` in `/ip/hotspot/ip-binding`. If not, the hotspot rule `hs-unauth-to` rejects the router's ICMP to the AP. The admin dashboard then shows a healthy AP as permanently DOWN. A false DOWN can freeze paid guests through outage auto-pause. This runbook is the main mitigation: `docs/mikrotik/ap-liveness-bypass.md`.

A code-level guard was found impossible. `online_since` and `offline_since` are current-state stamps, not history. Background: `process/general-plans/backlog/ap-outage-false-down-code-safeguard_NOTE_21-07-26.md`.

### Guard test

`packages/core/src/services/networkHealth.transaction-tripwire.spec.ts` reads source text. It fails if either admin call site of `refreshNetworkHealth` is wrapped in `db.transaction(`. Those sites are `apps/admin/src/routes/(app)/networks/+page.server.ts` and `apps/admin/src/routes/api/network/health/refresh/+server.ts`. A transaction would break the AP name-collision retry, which needs standalone statements.

### Walled garden

Canonical reference: **`docs/mikrotik/walled-garden.md`**. Read it first for any walled-garden work. It has the tag model, the hard-reset runbook, the scheduler mechanism, and the wallet/bank recon procedure. Do not duplicate it here. Key facts:

**Three tagged groups.** `setup:router` runs `provisionWalledGarden()` and creates three groups in order:

| Tag | Source | Content |
| --- | --- | --- |
| `veent-admin:probe` | `PROBE_DENIES` | Captive-probe deny rows. Created first so denies sit above the allows. |
| `veent-admin:payment` | `PAYMENT_HOSTS` | Payment allow hosts. |
| `veent-admin:portal` | `ADMIN_WG_HOSTS`, `ADMIN_WG_IPS`, `ORIGIN`, `PORTAL_LAN_IPS` | Admin and portal origin allows. |

Config lives in `apps/admin/scripts/walled-garden-config.ts`. `PORTAL_LAN_IPS` lists the LAN IPs that must always be reachable pre-auth (dev box and deploy VM, for example `10.210.54.133`). Edit it when a box's LAN IP changes.

Scheduler-maintained rows use a different tag family. No provisioning or reconcile call touches them.

**Reconcile.** `reconcileWalledGarden()` matches the whole `veent-admin:` family by prefix. In practice each call site passes its own sub-tag. Removal is limited to `action=allow` rows. `PROBE_DENIES` deny rows are never removed. This keeps `--reconcile` from re-opening a probe host.

**`setup:router` flags.**

| Flag | Effect |
| --- | --- |
| (none) | Additive only. |
| `--reconcile [--dry-run]` | Removes only rows that carry the code's tag, are `allow`, and are not in the desired set. Never touches un-tagged manual rows, scheduler rows, or deny rows. |
| `--wipe [--dry-run]` | Clears every static row from both walled-garden menus, then rebuilds. |
| `--wipe-only [--dry-run]` | Clears both menus and stops. Takes precedence over `--wipe` and `--reconcile`. |
| `--restrict-api [--disable-plain-api] [--dry-run]` | Locks api-ssl to this IP. See `docs/deploy/` router docs. |

`wipeWalledGarden()` is not tag-scoped. It skips dynamic (`dynamic=true`) auto-shadow rows, which RouterOS does not allow to be removed. It does not touch the resolve schedulers. They re-add their rows within 5 minutes.

**Why CNAME-to-CDN hosts need a `:resolve` scheduler.** RouterOS v6 `dst-host` matching cannot follow a CNAME chain. A host that CNAMEs to a CDN edge shows `hits=0` on its hostname rule. The fix is an idempotent `/system scheduler` item. Every 5 minutes it runs `:resolve` on the host and upserts a `walled-garden ip` row. Rule of thumb:

- Host CNAMEs to a CDN: needs a `:resolve` scheduler.
- Host resolves directly to the provider's own IP: needs only a `PAYMENT_HOSTS` (`dst-host`) entry.

If the CDN returns several A records but `:resolve` returns one, one IP is open per run. The login may fail at times. Known and accepted for GoTyme. See `process/general-plans/backlog/gotyme-followups_NOTE_02-10-26.md`.

**Resolve schedulers** (all in `packages/core/src/integrations/network/mikrotik.ts`):

| Scheduler | Resolves | Row comment |
| --- | --- | --- |
| `gcash-resolve` | `payments.gcash.com` (CNAME to Akamai) | `gcash-auto` |
| `gotyme-resolve` | `aws-gate.licelus.com` (ELB-fronted) | `gotyme-auto` |
| `seabank-resolve` | `httpdns.seabank.ph` | `seabank-auto` |
| `gcash-app-resolve` | `login`, `api`, `mdap`, `acm`, `customer-segment` `.mynt.xyz` | `gcash-app-*-auto` |

Each `provision*ResolveScheduler()` is idempotent. It matches by scheduler `name`. The `gcash-auto` row keeps the last 4 distinct resolved IPs. Background: `process/general-plans/completed/payment-walled-garden-v6_29-07-26/` (GCash diagnosis; it replaced a DoH/DoT block that was never built).

**`PAYMENT_HOSTS` (current).**

- Maya/PayMaya: `maya.ph`, `*.maya.ph`, `paymaya.com`, `*.paymaya.com`
- GCash, Alipay, Mynt: `gcash.com`, `*.gcash.com`, `alipay.com`, `*.alipay.com`, `*.alipayobjects.com`, `*.alicdn.com`, `*.antgroup.com`, `*.mynt.xyz`, `*.g-xchange.com`
- Google APIs: `*.googleapis.com` (98 live hits in checkout; not Google Pay)
- GoTyme: `*.gotyme.com.ph`

Dropped on purpose:

- Google Pay hosts (`pay.google.com`, `payments.google.com`, `accounts.google.com`, `accounts.google.com.ph`). Android WebView blocks Google Pay (`OR_BIBED_15`) in a captive portal. Whitelisting cannot fix it.
- `*.paymongo.com` and `*.xendit.co`. No integration code uses them.

Live GCash web checkout goes through Maya's hosted checkout, not PayMongo.

**Wildcard rule.** `*.domain` does not match the bare `domain`. Add both. Never add broad CDN allowlists.

**Wallet and bank status** (adding a new one: follow the recon protocol in `docs/mikrotik/walled-garden.md`):

| Wallet or bank | Status |
| --- | --- |
| GCash web checkout, Maya web checkout | Live |
| GoTyme | Verified (needs both the `*.gotyme.com.ph` host rule and the `gotyme-resolve` scheduler) |
| SeaBank | Verified (scheduler only, no host rule) |
| GCash app | Verified (`gcash-app-resolve` scheduler) |
| Maya app | Failed. It breaks pre-auth even with all traffic open. It works after portal login. |
| GrabPay, ShopeePay, Coins.ph, BDO, BPI, Landbank, Security Bank | Unverified. Not whitelisted. Banks may pin certificates or detect captive portals. |

Known gap: `bun run --filter radius-admin check` does not typecheck `apps/admin/scripts/`.

**Router access.** The router drops port 53 on the WAN (`setup:router` handles it). Router services are address-restricted.

## Maya payments

- Client: `packages/core/src/integrations/payments/maya.ts`. Hand-rolled HTTP, no SDK.
- Customer side: `apps/customer/src/lib/server/payments.ts`, `paymentWebhook.ts`.
- Routes: `apps/customer/src/routes/api/webhooks/maya/payment-status`, `api/webhooks/payment`, `api/payments/reconcile`.
- Docs: `docs/maya-do-webhook-relay.md`, `docs/deploy/README.md`.
- Dev webhooks reach local dev through a registered ngrok tunnel. Do not assume localhost is unreachable from Maya sandbox.
- `payments.ts` accepts only `MAYA_SANDBOX` of `'true'` or `'false'`. Anything else throws.

**Browser return origin versus webhook origin.**

- The browser return (`successUrl`, `cancelUrl` in `apps/customer/src/routes/top-up/+page.server.ts`) must use `event.url.origin`. That comes from the `ORIGIN` env.
- In production, `ORIGIN` must be the guest-reachable, walled-gardened LAN portal address (for example `http://10.210.59.11:5173`). Never `localhost`. Never the tunnel.
- Reason: the guest device is still captive when Maya redirects. It can reach only walled-garden hosts. A return to a public tunnel domain fails with `ERR_CONNECTION_CLOSED`.
- `TUNNEL_ORIGIN` (`webhookOrigin`) is only for the server-to-server webhook `originUrl`.
- Background: `process/general-plans/completed/maya-return-url-revert_23-07-26/`.

**GCash e-wallet checkout** works through the `gcash-resolve` scheduler (see Walled garden above).

## Sentry

- `@sentry/sveltekit` in all three apps. `@sentry/core` in `packages/core`.
- Admin: `apps/admin/src/lib/server/sentry/`, routes `(app)/issues/**` and `(app)/sentry/**`.
- PII: shared `scrubEvent` in each app's `beforeSend`.
- `beforeSend` in `packages/core/src/observability.ts` lowers `RouterUnreachableError` to `warning`. Both `withTimeout()` helpers (`mikrotik.ts`, `adminAccess.ts`) throw it on a router timeout. The cron `Sentry.withMonitor('customer-network-revoke')` check-in still alerts, so this cuts noise but does not hide the failure. `scrubEvent` still runs.
- Admin `?/track` checks the Sentry issue ID with the Sentry API before it saves a "Tracked from Sentry" incident. It fails closed if the lookup fails. `httpsUrl()` pins permalink hosts to `sentry.io` and regional subdomains.

## SMS / OTP delivery

- Table `customer_otp_delivery_log` (`packages/db/src/schema/customer.ts`, migration `0048`). Append-only. No unique constraint. Every provider writes a row when the gateway accepts a send (`apps/customer/src/lib/server/otp.ts`, `logDeliveryAttempt`).
- The insert must be awaited inside its own `try/catch`. An un-awaited insert that rejects becomes an unhandled promise rejection on the guest login path.
- Providers: Cast, iTexMo, UniSMS, SMSGate. Selected by `SMS_PROVIDER`.
- Sweep: `apps/customer/src/routes/api/otp/sweep-delivery/+server.ts` (cron only, `requireCron()`). Only **Cast** has delivery-report data (`GET /api/v1/sms/status/{message_id}`). The other providers are logged but never swept. This is by design.
- Alerts (`captureHandled`, fixed Sentry fingerprint) fire only on `dlr_status === 'REJECTD'` or `status === 'undelivered'` within 30 minutes. Unresolved rows age to `unknown` with no alert. Rows older than 48 hours are deleted on every sweep.
- Unproven: Cast report shape beyond the one `REJECTD` sample. Blocked until Cast activates a real sender ID.
- Background: `process/general-plans/completed/otp-delivery-observability_20-07-26/`. Other docs: `docs/sms-provider-integration.md`, `docs/cast-sms-integration-analysis.md`.

## Resend email

- `resend` in `packages/core`. Templates in `apps/admin/src/lib/server/emails/`.
- If `RESEND_API_KEY` is blank, the factory uses the stub (no real send). Same factory-and-stub pattern as network and payments.
