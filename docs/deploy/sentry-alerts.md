# Sentry — error tracking & go-live alerts

Shared reference for **both** deploy paths (see [`README.md`](README.md)). The apps report handled
failures and cron check-ins to **Sentry**; the alerting on top is what makes a dead scheduler or a
charged-but-uncredited buyer *visible*. Two independent pieces:

- **Build-time source maps** (optional) — makes client stack traces readable. See below.
- **Runtime capture + alerts** — the DSN wiring and go-live alert rules.

## Runtime DSN (per app)

Set `PUBLIC_SENTRY_DSN` in each app's `.env` to its Sentry project DSN. **Fail-open:** an empty DSN
means Sentry never initializes and the app runs normally — which is why dev (empty DSN) emits nothing.
Point all three at ONE project, or give each its own; the alert rules then live where each app's
events land:

- `apps/customer/.env` — money-path + network captures, and the `customer-network-revoke` /
  `customer-payments-reconcile` cron monitors.
- `apps/admin/.env` — the `admin-network-health-refresh` cron monitor + admin crashes.
- `apps/locator/.env` — crashes only.

Optional: `PUBLIC_SENTRY_TRACES_SAMPLE_RATE` (client) / `SENTRY_TRACES_SAMPLE_RATE` (server) tune
performance-trace sampling — default `0.2`, clamped to `[0,1]`; leave empty to accept the default.

## Alert rules — a go-live task

The full capture taxonomy and **click-by-click Sentry-UI steps** live in
[`../dev/sentry-alert-rules.md`](../dev/sentry-alert-rules.md). This is a **deploy-time ops task, not a
dev task** — there's no live telemetry to alert on in dev. Do it on **staging first** to tune
thresholds, then replicate to prod. The cron monitors auto-create on their first check-in, so they
only appear once the scheduled crons are running (see [`README.md`](README.md) cron section).

Set at least these two at go-live (both threshold-independent — no tuning needed):

- **A1** — page on any unattributed **paid** event (a buyer charged but not credited; count-1, real money).
- **A4** — the cron monitors' **missed/failed** check-ins (a dead revoke/reconcile cron is invisible to
  error tracking — page the two `customer-*` ones).

Volume alerts (A2/A3) go in with the spec's default thresholds and get retuned after the staging soak.

## Build-time source maps (optional)

Client stack traces in Sentry are minified unless source maps are uploaded at build time. This is
**opt-in**: the upload plugin (admin + customer `vite.config.ts`) only activates when **all three** of
`SENTRY_AUTH_TOKEN`, `SENTRY_ORG_SLUG`, and `SENTRY_PROJECT_ID` are present in the **build**
environment. Without them the build is unchanged — no maps generated, so none can be served to
browsers. When configured, maps are uploaded then deleted from the build output
(`filesToDeleteAfterUpload`), so they never ship to clients.

> ⚠️ The build-time `SENTRY_AUTH_TOKEN` is a **different credential** from the runtime dashboard token,
> even though they share the env var name. The build token needs the **`project:releases`** scope; the
> runtime `/sentry` dashboard token (admin app) needs `event:read` + `event:write` + `org:read`. Provide
> the build token only to the build/CI step — never commit it, never put it in the systemd
> `EnvironmentFile` or compose env that runs the servers. Set `PUBLIC_SENTRY_RELEASE` and
> `SENTRY_RELEASE` to the same value (e.g. the git SHA) so uploaded maps match the running release.
