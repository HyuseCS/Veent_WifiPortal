---
name: plan:otp-delivery-observability
description: "Persist Cast OTP send attempts to a new delivery-log table, sweep for carrier rejection via Cast's DLR status endpoint, alert on confirmed rejection with a stable Sentry fingerprint, prune after 48h, and fix the silent SMS_PROVIDER fallback."
date: 20-07-26
feature: general-plans
---

# OTP Delivery Observability — Implementation Plan

**Date**: 20-07-26
**Status**: ✅ CLOSED — archived 2026-07-20 via UPDATE PROCESS. All 4 phases VERIFIED, all gates
green (25/25 otp.spec.ts, 20/20 sweep-delivery.spec.ts, 117/117 full customer suite, `bun run
check` 0 errors). Gate: CONDITIONAL (C1/C2, both closed via Execute-Agent Instructions E1/E2 —
empirically confirmed non-vacuous, see execute report). Two accepted deviations: spec file renamed
`sweep-delivery.spec.ts` (SvelteKit reserves `+` prefixes); migration 0048 applied via `psql`
instead of `db:push` (push-managed dev-DB gotcha, diff reached unrelated `admin_*` tables). Work
NOT YET COMMITTED at archival time — user commits himself.
**Complexity**: COMPLEX

## Overview

`sendOtp` (`apps/customer/src/lib/server/otp.ts`) only checks the synchronous gateway-accept
response from the SMS provider. Live testing on 2026-07-20 showed Cast (the default provider)
accepts every OTP send but the carrier then rejects 100% of them (`dlr_status: "REJECTD"`) — the
guest is told "code sent," a credit is consumed, and nothing arrives. There is no log, no alert,
no visibility. This is the entire guest-login path failing while every dashboard stays green.

This plan closes that gap for Cast specifically (the only provider with a DLR status endpoint)
while keeping the storage shape provider-agnostic so `itexmo`/`unisms`/`smsgate` can plug into the
same table later without a migration. It also fixes a small, independent, silent-routing bug in
`sendOtp`'s provider dispatch.

Source: RESEARCH + INNOVATE already complete. All open design questions (Q1–Q5) are DECIDED —
see prompt context. This PLAN operationalizes those decisions; it does not re-open them.

## Goals

1. Each successful gateway-accepted OTP send (all 4 providers) writes an append-only row recording
   provider, provider message id (nullable), masked phone, and delivery status. A send that throws
   before gateway acceptance is not logged (the row is written only after the gateway accepts).
2. A 5-minute sweep cron checks Cast's DLR status endpoint for pending Cast rows and classifies
   them as `rejected` (alert), still-pending (no action), or `unknown` (30-min give-up, no alert).
3. A confirmed-rejected send fires one stable-fingerprint Sentry `captureHandled` warning per
   message — never per-message-id-unique, so a full outage groups into one rising-count issue.
   (Once-per-row holds under non-overlapping sweep runs: the alert fires on seeing `REJECTD` and the
   status update does not atomically gate it, so two overlapping sweep runs could double-alert a row.
   Acceptable because a single external scheduler triggers the sweep on a 5-minute cadence and each
   run is fast — no lock added by design.)
4. Rows are pruned unconditionally after 48h regardless of status, in the same sweep run.
5. `sendOtp`'s provider dispatch throws on an unrecognized non-empty `SMS_PROVIDER` instead of
   silently falling through to Cast; unset/empty still defaults to Cast (unchanged).
6. A DB insert failure in the send path never fails the OTP send itself (fail-open logging, not
   fail-open auth).

## Non-Goals (explicitly out of scope)

- No status-checker abstraction/interface for the other 3 providers — only Cast has a DLR endpoint
  today. `itexmo`/`unisms`/`smsgate` rows are written (satisfying the `provider` discriminator) but
  never swept.
- No unique constraint / idempotency key on the delivery-log table — it is an append-only attempt
  log; a resend is a new row.
- No change to `validateEnv.ts` — SMS vars remain deliberately unvalidated there (prior design
  decision, see `otp-cast-default-while-undeliverable_NOTE_20-07-26.md`).
- No guest-facing UX change (no "delivery uncertain" messaging, no resend-on-failure flow) — this
  plan is observability only, per Q3/Q4 scope.
- No change to the OTP code generation, expiry, or verification logic (owned by better-auth's
  phoneNumber plugin) — this plan only touches the delivery seam.

## Complexity Classification

**COMPLEX** — touches the DB schema (new table + migration), a cron-authenticated HTTP endpoint,
the guest-auth send path (`sendOtp`), Sentry alerting fingerprint stability, and PII-adjacent
retention/masking. Auth-path risk (this note: "the entire guest login path can fail 100% while
looking healthy") plus a new migration and a new externally-triggered endpoint push this past
SIMPLE even though the total file count is moderate (4 phases, ~6 touched/created files).

## Phase Ordering

1. **Phase 1 — Migration**: new `customer_otp_delivery_log` table (no deps)
2. **Phase 2 — Send-path persistence hook**: non-blocking insert after Cast accept in `sendOtp`
   (deps: Phase 1)
3. **Phase 3 — Sweep + prune cron endpoint**: `POST /api/otp/sweep-delivery` (deps: Phase 1;
   parallel-safe with Phase 2 — different files)
4. **Phase 4 — `SMS_PROVIDER` dispatch throw fix** (no deps; can run anytime, sequenced last only
   because it's the smallest/lowest-risk item)

Dependency ordering verified: Phase 2 and 3 both depend only on Phase 1's table existing; neither
depends on the other. Phase 4 is fully independent. No phase depends on a later phase's output.

## Touchpoints

| File | Change |
|---|---|
| `packages/db/src/schema/customer.ts` | Add `customerOtpDeliveryLog` table export |
| `packages/db/drizzle/0048_*.sql` | Generated migration (new table + composite index) |
| `apps/customer/src/lib/server/otp.ts` | Add persistence hook in `sendOtp`/`sendViaCast`; fix provider dispatch (Q5) |
| `apps/customer/src/lib/server/otp.spec.ts` | Extend with persistence + dispatch-fix + classifier tests |
| `apps/customer/src/routes/api/otp/sweep-delivery/+server.ts` | NEW — sweep + prune cron endpoint |
| `apps/customer/src/routes/api/otp/sweep-delivery/+server.spec.ts` | NEW — endpoint tests (classifier, transient-failure, prune) |
| `scripts/dev-cron.ts` | Add the new endpoint to the dev poller's hit list |
| `apps/customer/.env.example` | No new vars required (reuses `CAST_API_KEY`, `CRON_SECRET`) — confirm no addition needed |

## Public Contracts

- **New DB table** `customer_otp_delivery_log` — internal only, no app reads it except the sweep
  endpoint and (future, out of scope) an admin observability view. Not exposed via any public API.
- **New HTTP endpoint** `POST /api/otp/sweep-delivery` — cron-only, same `requireCron()` guard as
  `/api/network/revoke` and `/api/payments/reconcile` (`x-cron-secret` header, `CRON_IP_ALLOWLIST`).
  Not part of the guest-facing surface. Response shape: `{ ok: true, checked, rejected, unknown,
  pruned }`.
- **`sendOtp` signature unchanged** — `(phone: string, code: string) => Promise<void>`. The
  persistence hook is purely internal side-effect logging; it does not change the function's
  contract, return type, or thrown-error behavior for the success/failure paths already covered by
  `otp.spec.ts`.

## Blast Radius

- **Packages touched:** `packages/db` (schema + migration), `apps/customer` (send path, new route,
  spec files), `scripts/` (dev-cron poller) — 3 packages/apps.
- **Files touched/created:** ~7 (1 schema edit, 1 generated migration, 1 otp.ts edit, 1 otp.spec.ts
  edit, 2 new route files, 1 dev-cron.ts edit).
- **Risk class: HIGH** — this is the guest authentication path (Q1 in the prompt: "the whole guest
  login path can fail 100% while looking healthy"). A bug in the persistence hook that throws
  synchronously, or a migration that breaks `db:push`, directly breaks every guest login. The
  try/catch swallow around the insert (Goal 6) is the primary mitigation; Phase 2's test suite must
  prove the swallow holds under a simulated DB failure.
- **Signal score for `vc-agent-strategy-compare` (informational, not required at PLAN):** S2 (schema
  surface touched) + S6 (high-risk class: auth path) + S7 (7 files) present → score ≥ 3. Sequential
  execution is appropriate given phases have real dependency ordering (1 → 2/3 → done) rather than
  independent fan-out breadth.

## Data Flow

1. **Send path:** `sendOtp(phone, code)` → provider dispatch (Q5 fix applied) → `sendViaCast`
   → Cast accepts (`res.ok && body.success`) → **NEW:** fire-and-forget insert into
   `customer_otp_delivery_log` with `{ provider: 'cast', providerMessageId: body.message_id ?? null,
   phoneMasked: maskPhone(phone), status: 'pending', createdAt: now() }`, wrapped in try/catch →
   `captureHandled` on insert failure (never thrown) → `sendOtp` returns normally either way.
   Non-Cast providers (`itexmo`/`unisms`/`smsgate`) also insert a row on accept, with
   `providerMessageId: null` (Q1 — the column is nullable for providers with no message id in their
   accept response) and `status: 'pending'` — satisfying the "all four providers write a row"
   requirement, but never swept (Q1 "Cast-only sweep logic").
2. **Sweep path (every 5 min, cron-triggered):** `POST /api/otp/sweep-delivery` → `requireCron()` →
   `Sentry.withMonitor('customer-otp-sweep', ...)` (never-throw pattern) → select rows WHERE
   `provider = 'cast' AND status = 'pending' AND created_at > now() - interval '30 minutes'` (index
   on `(provider, status, created_at)`) → for each row, `GET
   https://api.cast.ph/api/v1/sms/status/{provider_message_id}` (bounded `AbortSignal.timeout`) →
   classify (see Failure Modes) → update row status in place → after the sweep loop, unconditionally
   `DELETE WHERE created_at < now() - interval '48 hours'` (Goal 4 — runs even if the sweep loop
   above throws, per the never-throw + explicit try/catch around the sweep-vs-prune boundary).
3. **Classification → Sentry:** only `dlr_status === 'REJECTD' || status === 'undelivered'` fires
   `captureHandled(err, { level: 'warning', tags: { area: 'otp-delivery' }, extra: {
   providerMessageId, phoneMasked } })` where `err = new Error('OTP delivery rejected by carrier')`
   — a CONSTANT message string (Carried-forward flag 1), with the variable data only in `extra`.

## Failure Modes

| Failure | Handling |
|---|---|
| DB insert fails after Cast accepts | try/catch around insert; `captureHandled` (warning, no PII, tag `area: 'otp-send-log'`); `sendOtp` still returns normally — guest login is never blocked by a logging failure |
| Cast status-endpoint returns non-2xx or network error during sweep | Classify as TRANSIENT — leave row status unchanged (`pending`), do not alert, retry next sweep cycle; still bounded by the 30-min cutoff below |
| Cast status-endpoint returns an unrecognized/unknown `dlr_status`/`status` value | Treat as "not yet known-failed" — leave `pending`, no alert, keep sweeping until 30-min cutoff |
| Row reaches 30 minutes from `created_at` with no `REJECTD`/`undelivered` classification | Set `status = 'unknown'`, stop sweeping this row (excluded by the `created_at > now() - 30min` sweep filter — a row past cutoff is naturally excluded, no separate "stop" flag needed), fire NO alert |
| Sweep endpoint itself throws (e.g. malformed row, unexpected schema drift) | `Sentry.withMonitor` never-throw pattern (copied from `apps/customer/src/routes/api/payments/reconcile/+server.ts`) — the monitor check-in still completes; error still bubbles to `handleError` per the existing cron pattern, never silently swallowed at the route level |
| Prune step (48h delete) runs after a sweep-loop error | Prune is a separate, always-executed step — wrap sweep-loop body in its own try/catch that logs+continues per-row, so one bad row doesn't abort the whole sweep, and the prune DELETE runs unconditionally after the loop regardless of per-row outcomes |
| `SMS_PROVIDER` set to an unrecognized non-empty value (Q5) | `sendOtp` rejects before any network call — it is `async`, so the `throw` surfaces as a rejected promise; was previously silently routed to Cast |
| `SMS_PROVIDER` unset or empty-after-trim | Unchanged — defaults to `cast` (standing team decision, do not regress) |

## Decisions Locked (from INNOVATE — do not re-open)

- **Q1 Table shape:** provider-agnostic columns `provider text not null` + `provider_message_id
  text` nullable. Cast-only sweep (`WHERE provider = 'cast'`). No checker interface.
- **Q2 Key:** surrogate `id` serial primary key only. No unique constraint. Append-only — a resend
  is a new row, never an upsert. Insert wrapped in try/catch, swallowed to `captureHandled`, never
  thrown into `sendOtp`'s caller. Deliberately does NOT reuse the `isNameUniqueViolation` cause-chain
  retry pattern from `networkHealth.ts`/`reconcilePayments.ts` — a 23505 here must never lock out a
  guest login, so there is nothing to retry.
- **Q3 Classification:** alert only on `dlr_status === 'REJECTD'` or `status === 'undelivered'`.
  Everything else (unknown strings, missing fields, `delivered`, `pending`) = not-yet-known-failed,
  keep sweeping. 30-minute give-up bound from send timestamp (independent of the 5-min OTP expiry).
  On cutoff: terminal `unknown` status, no sweep, no alert. Non-2xx/network error from the status
  endpoint = TRANSIENT, never a rejection — unchanged classification, retry next sweep, still
  bounded by the 30-min cutoff. Repeated check failures alone never trigger an alert.
- **Q4 Retention/PII:** store `maskPhone()` output only, never raw E.164. Prune
  `WHERE created_at < now() - 48h` unconditionally, every sweep run. Sweep cadence: every 5 minutes
  (not the 1-minute revoke/reconcile cadence).
- **Q5:** explicit `cast` branch in `sendOtp`'s dispatch; throw on unrecognized non-empty
  `SMS_PROVIDER`. Unset/empty still defaults to Cast. Do not touch `validateEnv.ts`.

## Carried-Forward Flags — Explicit Handling

1. **Sentry fingerprint stability (highest priority).** `provider_message_id` and `phoneMasked` go
   in `extra` only, never interpolated into the `Error` message/title. Checklist item 8 below is
   this exact requirement; Test (f) below asserts the Error message string is byte-identical across
   two different message ids.
2. **Sweep endpoint must not throw uncaught.** Copy `Sentry.withMonitor` structure verbatim from
   `apps/customer/src/routes/api/payments/reconcile/+server.ts` (checklist item 11).
3. **Index on `(provider, status, created_at)`** so the sweep query never full-table-scans
   (checklist item 2).
4. **Prune runs unconditionally.** The 48h delete is not gated on sweep-loop success (checklist item
   12; Failure Modes table row 6).

## Implementation Checklist

### Phase 1 — Migration (no deps)

1. Add `customerOtpDeliveryLog` to `packages/db/src/schema/customer.ts`, following the file's
   existing `pgTable` + composite-index array convention (see `paymentTransactions`/
   `networkSessions` for the pattern):
   ```
   export const customerOtpDeliveryLog = pgTable(
     'customer_otp_delivery_log',
     {
       id: serial('id').primaryKey(),
       provider: text('provider').notNull(),
       providerMessageId: text('provider_message_id'),
       phoneMasked: text('phone_masked').notNull(),
       status: text('status').notNull().default('pending'), // pending | rejected | unknown
       createdAt: timestamp('created_at').defaultNow().notNull()
     },
     (t) => [index('customer_otp_delivery_log_provider_status_created_idx').on(t.provider, t.status, t.createdAt)]
   );
   ```
   Match existing import style (`pgTable, serial, text, timestamp, index` from `drizzle-orm/pg-core`
   — all already imported in `customer.ts`; no new imports needed). No `uniqueIndex` per Q2.
2. Generate the migration: `cd packages/db && bunx drizzle-kit generate` (repo alias:
   `bun run --filter @veent/db generate`, or root `bun run db:generate`). This produces
   `packages/db/drizzle/0048_<generated-name>.sql` (the 48th file — `0000`...`0047` already exist,
   confirmed via `ls packages/db/drizzle/*.sql | wc -l` = 48). Do not hand-write the SQL.
3. **Apply locally per the documented dev-DB gotcha:** the dev DB is push-managed;
   `bun run db:migrate` will fail on journal drift. Verify locally with
   `bun run db:push` (applies the DDL directly against the local dev Postgres) — but still keep the
   generated `0048_*.sql` file committed for the record (per `process/context/database/all-database.md`
   and the project-level gotcha in `all-context.md`: "apply new migration DDL directly to verify
   locally, but still generate the migration file"). Do not run `db:migrate` as the verification
   step.
4. Confirm the generated SQL contains: `CREATE TABLE "customer_otp_delivery_log" (...)` with
   `id serial PRIMARY KEY`, `provider text NOT NULL`, `provider_message_id text` (nullable, no
   `NOT NULL`), `phone_masked text NOT NULL`, `status text NOT NULL DEFAULT 'pending'`,
   `created_at timestamp DEFAULT now() NOT NULL`, plus
   `CREATE INDEX "customer_otp_delivery_log_provider_status_created_idx" ... USING btree
   ("provider", "status", "created_at")`. No unique index anywhere in this migration.

### Phase 2 — Send-path persistence hook (deps: Phase 1)

5. In `apps/customer/src/lib/server/otp.ts`, import `db` (the customer app's Drizzle client —
   confirm the exact import path via `apps/customer/src/lib/server/db.ts`, matching how
   `apps/customer/src/routes/api/payments/reconcile/+server.ts` imports `db` from
   `$lib/server/db`) and `customerOtpDeliveryLog` from `@veent/db/schema`.
6. Add a private helper `logDeliveryAttempt(provider: string, providerMessageId: string | null,
   phone: string): Promise<void>` in `otp.ts` that wraps a single `db.insert(customerOtpDeliveryLog)
   .values({ provider, providerMessageId, phoneMasked: maskPhone(phone) })` call in try/catch,
   calling `captureHandled(err, { level: 'warning', tags: { area: 'otp-send-log' } })` from
   `@veent/core` (`packages/core/src/observability.ts`, already imported elsewhere via
   `@veent/core`) on failure. Never throws.
7. Call `void logDeliveryAttempt('cast', body.message_id ?? null, phone)` in `sendViaCast`
   immediately after the existing success check (`otp.ts:167`, right after the `if (!res.ok ||
   !body?.success) throw ...` block passes) — fire-and-forget (`void`, not `await`), so a slow or
   failing insert never adds latency to the guest's login request. Add the equivalent
   `void logDeliveryAttempt('<provider>', null, phone)` call at the corresponding success point in
   `sendViaITexMo` (after `otp.ts:238` check passes), `sendViaUniSMS` (after `otp.ts:286` check
   passes), and `sendViaSMSGate` (after `otp.ts:343` check passes) — all four providers write a row
   per Q1, only Cast populates `providerMessageId`.
8. **Fingerprint-stability guard (Carried-forward flag 1):** confirm no `providerMessageId` or
   `phoneMasked` value is ever interpolated into an `Error` message/title anywhere in this plan's
   new code — grep the diff for `message_id` / `phoneMasked` / `providerMessageId` appearing inside
   a template literal passed to `new Error(...)` before merging. This applies to both this phase's
   send-path logging (which never throws to Sentry directly — it logs insert failures, a distinct
   concern) and Phase 3's rejection alert.

### Phase 3 — Sweep + prune cron endpoint (deps: Phase 1; parallel-safe with Phase 2)

9. Create `apps/customer/src/routes/api/otp/sweep-delivery/+server.ts` modeled directly on
   `apps/customer/src/routes/api/payments/reconcile/+server.ts`'s structure: `requireCron(event)`
   first, then `Sentry.withMonitor('customer-otp-sweep', async () => {...}, { schedule: { type:
   'crontab', value: '*/5 * * * *' }, checkinMargin: 5, maxRuntime: 5, timezone: 'UTC' })` — note
   the `*/5 * * * *` cadence (every 5 min per Q4), distinct from the `* * * * *` used by
   revoke/reconcile.
10. Inside the monitor callback: `SELECT * FROM customer_otp_delivery_log WHERE provider = 'cast'
    AND status = 'pending' AND created_at > now() - interval '30 minutes'` (Drizzle query using the
    composite index from Phase 1). For each row (sequential loop, wrapped per-row in try/catch so
    one bad row doesn't abort the sweep): `GET
    https://api.cast.ph/api/v1/sms/status/{providerMessageId}` with the same `x-api-key: CAST_API_KEY`
    header pattern as `sendViaCast`, `AbortSignal.timeout(10_000)`. Skip rows where
    `providerMessageId` is null (shouldn't happen for Cast rows given step 7, but guard defensively).
11. Classify per Q3 exactly as specified in the Failure Modes table above: non-2xx/network error →
    leave `pending`, continue (transient); `dlr_status === 'REJECTD' || status === 'undelivered'` →
    `UPDATE ... SET status = 'rejected'` + fire the Carried-forward-flag-1-compliant
    `captureHandled` alert with a CONSTANT message and `extra: { providerMessageId, phoneMasked:
    row.phoneMasked }`; anything else → leave `pending`, continue. This 30-min-bounded loop is the
    ONLY place `status` transitions to `'rejected'`; the cutoff-driven `'unknown'` transition is
    step 12.
12. After the sweep loop (in its own try/catch so a sweep-loop-level failure doesn't block prune):
    `UPDATE customer_otp_delivery_log SET status = 'unknown' WHERE provider = 'cast' AND status =
    'pending' AND created_at <= now() - interval '30 minutes'` (rows that just aged out of the sweep
    filter — no alert). Then, unconditionally (outside any try/catch that could skip it — this is
    the last statement in the handler, always reached): `DELETE FROM customer_otp_delivery_log WHERE
    created_at < now() - interval '48 hours'`.
13. Return `json({ ok: true, checked, rejected, unknown, pruned })` with real counts from the loop
    and the delete's row count.
14. Add `POST /api/otp/sweep-delivery` to `scripts/dev-cron.ts`'s poller list (matching the existing
    pattern for `/api/network/revoke` and `/api/payments/reconcile`), noting the different 5-minute
    cadence if `dev-cron.ts` supports per-endpoint intervals — if it only supports a single interval
    for all endpoints, document in the phase report that dev-cron hits this endpoint more often than
    prod (harmless — the sweep is idempotent and the 30-min/48h windows are still respected).

### Phase 4 — `SMS_PROVIDER` dispatch fix (no deps)

15. In `sendOtp` (`otp.ts:120-126`), replace the fall-through dispatch:
    ```
    const provider = (env.SMS_PROVIDER ?? 'cast').trim().toLowerCase();
    if (provider === 'smsgate') return sendViaSMSGate(phone, code);
    if (provider === 'unisms') return sendViaUniSMS(phone, code);
    if (provider === 'itexmo') return sendViaITexMo(phone, code);
    return sendViaCast(phone, code);
    ```
    with an explicit `cast` branch plus a throw for any other non-empty value:
    ```
    const provider = (env.SMS_PROVIDER ?? 'cast').trim().toLowerCase();
    if (provider === '' || provider === 'cast') return sendViaCast(phone, code);
    if (provider === 'smsgate') return sendViaSMSGate(phone, code);
    if (provider === 'unisms') return sendViaUniSMS(phone, code);
    if (provider === 'itexmo') return sendViaITexMo(phone, code);
    throw new Error(`Unrecognized SMS_PROVIDER: "${provider}"`);
    ```
    Note: `env.SMS_PROVIDER ?? 'cast'` already makes an unset var equal to `'cast'` before `.trim()`,
    so the `provider === ''` check only matters if someone sets `SMS_PROVIDER=""` explicitly
    (whitespace-only) — keep that guard so an explicitly-blank env var still defaults to Cast rather
    than throwing, matching "unset/empty-after-trim MUST still default to Cast."

## Test Coverage (per `vc-test-coverage-plan` tiering)

All new/changed behavior in this plan is **Fully-Automated tier** — deterministic Vitest unit
tests with mocked `fetch`/DB, following the existing `otp.spec.ts` pattern (`vi.hoisted` mocks for
`$app/environment` and `$env/dynamic/private`, `vi.stubGlobal('fetch', ...)`). No Hybrid/Agent-Probe
tier is needed — there is no real Cast API call, no container dependency, and no UI/judgment
surface in this plan's scope.

**Run command (mandatory — repo gotcha):** `cd apps/customer && bunx vitest run
src/lib/server/otp.spec.ts` and `cd apps/customer && bunx vitest run
src/routes/api/otp/sweep-delivery/+server.spec.ts`. **Never** `bun test <file>` directly — bun's
native runner silently no-ops `vi.setSystemTime`, which several of these tests need for the
30-min/48h cutoff logic.

| Area | Tier | Scenario | Command | Proves | Does NOT prove |
|---|---|---|---|---|---|
| `otp.ts` — persistence | Fully-Automated | (a) message id persisted after successful Cast accept | `bunx vitest run src/lib/server/otp.spec.ts` | insert is called with correct provider/messageId/maskedPhone after a 2xx+success Cast response | real DB round-trip (mocked `db.insert`) |
| `otp.ts` — persistence | Fully-Automated | (b) DB insert failure does not fail the OTP send | same | `sendOtp` still resolves when the mocked insert rejects; `captureHandled` called with `area: 'otp-send-log'` | real Postgres constraint behavior |
| `otp.ts` — dispatch | Fully-Automated | (c) unrecognized `SMS_PROVIDER` throws; unset still routes to Cast | same | dispatch throw + unchanged default behavior for the 4 known values | — |
| sweep endpoint — classifier | Fully-Automated | (d) `REJECTD`/`undelivered` → rejected + alert; unknown status string → stays pending, no alert | `bunx vitest run src/routes/api/otp/sweep-delivery/+server.spec.ts` | classifier boundary exactly matches Q3 | live Cast DLR endpoint behavior/shape stability |
| sweep endpoint — transient failure | Fully-Automated | (e) status-endpoint 500/network error does not classify as rejection | same | transient failures leave status unchanged, no alert fired | — |
| sweep endpoint — fingerprint stability | Fully-Automated | (f) Sentry `Error` message is byte-identical across two different message ids | same | fingerprint stability (Carried-forward flag 1) — asserts `captureHandled` (mocked from `@veent/core`) is called with the same `error.message` string across two rows with different `providerMessageId`/`phoneMasked` | actual Sentry grouping in production |
| sweep endpoint — prune | Fully-Automated | prune runs unconditionally even when the sweep loop throws mid-iteration | same | the 48h DELETE still executes after a simulated per-row sweep failure | — |
| sweep endpoint — 30-min cutoff | Fully-Automated | a `pending` row past 30 minutes transitions to `unknown` with no alert | same | cutoff bound is enforced independent of the 5-min OTP expiry | — |
| requireCron guard | Fully-Automated | endpoint rejects requests without a valid `x-cron-secret` | same | auth guard reused correctly (same pattern as revoke/reconcile) | — |

## Verification Evidence

| Gate / Scenario | Strategy | Proves SPEC criterion |
|---|---|---|
| (a) message id persisted after successful Cast accept | Fully-Automated | Goal 1 — every send attempt writes a row |
| (b) DB insert failure does not fail the OTP send | Fully-Automated | Goal 6 — insert failure is fail-open logging, not fail-open auth |
| (c) unrecognized SMS_PROVIDER throws; unset defaults to Cast | Fully-Automated | Goal 5 — Q5 dispatch fix |
| (d) REJECTD/undelivered → rejected+alert; unknown string → not-failed | Fully-Automated | Goal 3 — Q3 classification boundary |
| (e) status-endpoint 500 is transient, not a rejection | Fully-Automated | Goal 3 — Q3 transient-vs-rejection rule |
| (f) Sentry Error message constant across message ids | Fully-Automated | Carried-forward flag 1 — fingerprint stability |
| prune runs unconditionally after sweep-loop failure | Fully-Automated | Goal 4 / Carried-forward flag 4 — prune independence |
| 30-min cutoff transitions row to `unknown`, no alert | Fully-Automated | Goal 3 — Q3 give-up bound |
| requireCron rejects unauthenticated sweep requests | Fully-Automated | Public Contracts — sweep endpoint is cron-only |
| `bun run check` (svelte-check, customer app) | Fully-Automated | Type-safety of new schema/route/otp.ts changes |
| `bun run lint` | Fully-Automated | Style/format compliance |
| Manual: `bun run db:push` applies migration 0048 cleanly against local dev DB | Hybrid (precondition: local Postgres running via `db:start`) | Goal 1 — table exists and matches schema |

## What Must NOT Regress

- **Every existing `otp.spec.ts` test must stay green** — this is the guest auth path; a bug here
  locks every guest out. In particular: the 4 provider dev-fallback-to-console tests, the 4
  provider production-throws-when-unconfigured tests, and the Cast/iTexMo happy-path body-shape
  assertions (`otp.spec.ts` lines 63-189) must be unaffected by the new persistence hook and
  dispatch change.
- `sendOtp`'s return type and thrown-error behavior for provider-level failures (non-2xx, non-success
  body) must be byte-identical to today — the persistence hook is additive-only and never changes
  what `sendOtp` throws or resolves for the existing paths.
- The `requireCron` guard behavior on `/api/network/revoke` and `/api/payments/reconcile` must be
  unaffected — this plan only adds a new endpoint reusing the same guard function, never edits it.

## Acceptance Criteria

1. Every successful send across all 4 providers (`cast`, `itexmo`, `unisms`, `smsgate`) writes exactly one row to `customer_otp_delivery_log` with the correct `provider` discriminator.
2. A Cast row whose DLR status resolves to `REJECTD`/`undelivered` within 30 minutes is marked `rejected` and fires exactly one `captureHandled` warning with a constant (non-interpolated) error message.
3. A Cast row that never resolves within 30 minutes is marked `unknown` and fires no alert.
4. A transient (non-2xx/network-error) status-check response never changes a row's classification and never fires an alert.
5. Every sweep run unconditionally deletes rows older than 48 hours, regardless of sweep-loop outcome.
6. A DB insert failure in the send-path logging hook never causes `sendOtp` to throw or otherwise block guest login.
7. `sendOtp` throws on an unrecognized non-empty `SMS_PROVIDER`; unset/blank still defaults to `cast`.
8. All existing `otp.spec.ts` tests remain green (no regression to the guest auth path).
9. `bun run check` and `bun run lint` pass with no new errors introduced by this plan's changes.

## Phase Completion Rules

- A phase is **CODE DONE** when its checklist items are implemented and the phase's own Fully-Automated test gates (see Test Coverage table) pass locally via `bunx vitest run <file>` (never `bun test <file>`).
- A phase is **VERIFIED** only after CODE DONE plus: (a) the phase's row(s) in Verification Evidence are green, and (b) the "What Must NOT Regress" checks for the surfaces this phase touches have been re-run and pass.
- Phase 1 (migration) is VERIFIED only after `bun run db:push` applies cleanly against the local dev DB (per the documented push-managed-dev-DB gotcha) AND the generated `0048_*.sql` file is committed.
- Phase 2 and Phase 3 may execute in either order or in parallel (no shared files) once Phase 1 is VERIFIED, but both must be VERIFIED before Phase 4 is considered part of a complete EXECUTE pass (Phase 4 itself has no dependency and may run at any point).
- The plan as a whole is VERIFIED only when every row in Verification Evidence is green and every item in "What Must NOT Regress" has been re-confirmed post-implementation.

## Test Infra Improvement Notes

(none identified yet)

## Resume and Execution Handoff

1. **Selected plan file path:** `process/general-plans/completed/otp-delivery-observability_20-07-26/otp-delivery-observability_PLAN_20-07-26.md`
2. **Last completed phase or step:** SHIPPED — all phases executed; plan archived 20-07-26.
3. **Validate-contract status:** PASS (completed before EXECUTE); see the closeout report in this folder.

> Historical handoff below is retained for provenance only — this plan is complete; the resume steps no longer apply.
4. **Supporting context files loaded:** `process/context/all-context.md`,
   `process/context/database/all-database.md`, `process/context/tests/all-tests.md`,
   `process/context/planning/all-planning.md`, `process/development-protocols/implementation-standards.md`,
   `process/development-protocols/plan-lifecycle.md`,
   `process/general-plans/backlog/otp-delivery-unobservable_NOTE_20-07-26.md`,
   `process/general-plans/backlog/otp-cast-default-while-undeliverable_NOTE_20-07-26.md`,
   `apps/customer/src/lib/server/otp.ts`, `apps/customer/src/lib/server/otp.spec.ts`,
   `apps/customer/src/lib/server/cron.ts`,
   `apps/customer/src/routes/api/payments/reconcile/+server.ts`,
   `apps/customer/src/routes/api/network/revoke/+server.ts`,
   `packages/core/src/observability.ts`, `packages/db/src/schema/customer.ts`,
   existing migration `packages/db/drizzle/0047_aberrant_agent_zero.sql` (pattern reference).
5. **Next step for a fresh agent picking up mid-execution:** Run `ENTER VALIDATE MODE` against this
   plan file first (mandatory before EXECUTE per repo CLAUDE.md). If VALIDATE has already produced a
   PASS/accepted-CONDITIONAL gate below, resume at Phase 1 checklist item 1 (schema edit) — Phase 1
   has no dependencies and should always execute first regardless of which later phase was last
   touched.


## Validate Contract

Status: CONDITIONAL
Date: 20-07-26
date: 2026-07-20
generated-by: outer-pvl

Parallel strategy: sequential
Rationale: Score 3/7 (S2 schema/API surface, S6 high-risk auth-adjacent class, S7 7 files) — MEDIUM band, but the plan's own Phase Ordering shows a real dependency chain (Phase 1 → Phase 2/3 → Phase 4) rather than independent fan-out breadth, and the auth-critical fire-and-forget insert pattern (see CONCERN C1 below) benefits from one agent holding full cross-phase context. Optional 2-way parallel (Phase 2 + Phase 3 as separate vc-execute-agent calls, both depending only on Phase 1) is a legitimate alternative once Phase 1 is VERIFIED — see Execute-Agent Instructions E3.

### Execution Strategy for EXECUTE (vc-agent-strategy-compare)

| Signal | Present? | Evidence |
|---|---|---|
| S1 — multi-package scope (3+ packages) | No | 2 workspace packages touched (`packages/db`, `apps/customer`) + `scripts/` (not a workspace package) |
| S2 — schema/API/auth surface touched | Yes | New table + new cron HTTP endpoint |
| S3 — 3+ viable directions | No | Q1–Q5 already DECIDED in INNOVATE; no open design choices |
| S4 — phase-program classification | No | Single plan file with internal phase ordering, no umbrella plan |
| S5 — user requests depth | No | — |
| S6 — high-risk class in plan | Yes | Guest-auth send path (Q1 in prompt) |
| S7 — 5+ files in blast radius | Yes | ~7 files touched/created |

**Score: 3/7 (MEDIUM band)**

| Strategy | Agent count | Fit |
|---|---|---|
| Sequential (recommended) | 1 agent, opus, all 4 phases in order | Best fit — small file count, tight dependency chain, single-context coherence reduces the exact class of bug flagged in C1 |
| Parallel subagents | 2 agents (Phase 2 + Phase 3) once Phase 1 VERIFIED, opus each | Legitimate alternative — Phase 2/3 touch disjoint files; modest time savings only, not required |
| Workflow | Not warranted — item count fixed and small (4 phases), no per-item fan-out need | — |
| Agent team | Not warranted — no mid-execution cross-phase coordination needed (dependencies are file-level, not decision-level) | — |

Cost guard: not triggered (≤2 agents either way).
Model: opus for the execute leg (EXECUTE = opus per repo Model Selection Policy); this VALIDATE pass ran on sonnet.

Test gates (C3 5-column table — ADDITIVE; existing consumers still parse the legacy line form below it):

| criterion id | behavior | strategy | proving test | gap-resolution |
|---|---|---|---|---|
| AC1 | Every successful send (all 4 providers) writes exactly one row with correct `provider` discriminator | Fully-Automated | `cd apps/customer && bunx vitest run src/lib/server/otp.spec.ts` — scenario (a) | A |
| AC6 | DB insert failure in the persistence hook never fails/blocks `sendOtp` | Fully-Automated | same file — scenario (b) (see E1/E2 for microtask-flush + await requirement) | A |
| AC7 | Unrecognized non-empty `SMS_PROVIDER` throws; unset/blank still defaults to `cast` | Fully-Automated | same file — scenario (c) | A |
| AC2 | Cast row resolving `REJECTD`/`undelivered` within 30 min is marked `rejected` and fires exactly one constant-message `captureHandled` warning | Fully-Automated | `cd apps/customer && bunx vitest run src/routes/api/otp/sweep-delivery/+server.spec.ts` — scenario (d) | A |
| AC4 | Transient (non-2xx/network-error) status-check response never changes classification or fires an alert | Fully-Automated | same file — scenario (e) | A |
| Fingerprint | Sentry `Error` message is byte-identical across two different message ids (Carried-forward flag 1) | Fully-Automated | same file — scenario (f) | A |
| AC5 | Every sweep run unconditionally deletes rows older than 48h regardless of sweep-loop outcome | Fully-Automated | same file — prune-unconditional scenario | A |
| AC3 | A `pending` row past 30 minutes transitions to `unknown`, no alert | Fully-Automated | same file — 30-min cutoff scenario | A |
| Auth | Endpoint rejects requests without a valid `x-cron-secret` | Fully-Automated | same file — requireCron guard scenario | A |
| AC8 | All existing `otp.spec.ts` tests remain green (no regression to guest-auth path) | Fully-Automated | `cd apps/customer && bunx vitest run src/lib/server/otp.spec.ts` (full file) | A |
| AC9 | `bun run check` and `bun run lint` pass with no new errors | Fully-Automated | `bun run check` (customer app) / `bun run lint` (repo-wide — pre-existing 297-file prettier drift is a known, unrelated repo issue; verify no NEW files added to the failing count) | A |
| Migration | `customer_otp_delivery_log` table + composite index exist and match schema after migration 0048 | Hybrid — precondition: local Postgres running (`bun run db:start`) | `bun run db:push` from repo root (applies DDL directly per the push-managed dev-DB gotcha) | A |

gap-resolution legend:
- A — proven now (gate passes in this cycle)
- B — fixed in this plan (gate added by this plan's checklist)
- C — deferred to a named later phase/plan
- D — backlog test-building stub (named residual; keep-active; continue)

C-4 reconciliation: the `strategy:` column carries ONLY the 3 proving strategies (Fully-Automated / Hybrid / Agent-Probe). Known-Gap is NEVER a `strategy:` value — it is a named residual row carried via gap-resolution D, never a strategy that proves a behavior. (No Known-Gap rows in this plan's blast radius — every developed behavior has Fully-Automated or Hybrid coverage.)

Legacy line form (retained so existing validate-contract consumers still parse):
- otp.ts persistence + dispatch: Fully-automated: `cd apps/customer && bunx vitest run src/lib/server/otp.spec.ts`
- sweep-delivery endpoint (classifier, transient, fingerprint, prune, cutoff, auth guard): Fully-automated: `cd apps/customer && bunx vitest run src/routes/api/otp/sweep-delivery/+server.spec.ts`
- repo tooling: Fully-automated: `bun run check` (apps/customer) + `bun run lint`
- migration apply: hybrid: `bun run db:push` + precondition: local Postgres running via `bun run db:start`

#### Failing stubs (Fully-Automated rows only)

```
Failing stub:
test("should persist message id after successful Cast accept", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub: (a) message id persisted after successful Cast accept")
})
```

```
Failing stub:
test("should not fail the OTP send when the DB insert fails", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub: (b) DB insert failure does not fail the OTP send")
})
```

```
Failing stub:
test("should throw on unrecognized SMS_PROVIDER and still default unset/blank to Cast", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub: (c) unrecognized SMS_PROVIDER throws; unset still routes to Cast")
})
```

```
Failing stub:
test("should mark REJECTD/undelivered rows as rejected and alert once; leave unknown status strings pending with no alert", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub: (d) classifier boundary per Q3")
})
```

```
Failing stub:
test("should treat a non-2xx or network error from the status endpoint as transient, never a rejection", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub: (e) transient failure does not classify as rejection")
})
```

```
Failing stub:
test("should emit a byte-identical Sentry Error message across two different message ids", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub: (f) fingerprint stability — constant Error message")
})
```

```
Failing stub:
test("should unconditionally prune rows older than 48h even when the sweep loop throws mid-iteration", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub: prune runs unconditionally after sweep-loop failure")
})
```

```
Failing stub:
test("should transition a pending row past 30 minutes to unknown with no alert", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub: 30-min cutoff transitions row to unknown, no alert")
})
```

```
Failing stub:
test("should reject sweep-delivery requests without a valid x-cron-secret", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub: requireCron guard rejects unauthenticated sweep requests")
})
```

Dimension findings:
- Infra fit: PASS — schema/route additions follow existing `packages/db/src/schema/customer.ts` and `apps/customer/src/routes/api/payments/reconcile/+server.ts` conventions exactly (verified against live file contents, not inferred); no new env vars needed (`CAST_API_KEY`/`CRON_SECRET` already in `apps/customer/.env.example`); no port/container/proxy surface touched.
- Test coverage: CONCERN — all-Fully-Automated tiering is correct and matches `otp.spec.ts`'s `vi.hoisted` pattern, but two precision gaps found (C1, C2 below) that could let an execute-agent ship a subtly-wrong implementation that still passes a loosely-written test. Both resolved via concrete Execute-Agent Instructions (E1–E3), not a design flaw.
- Breaking changes: PASS — additive-only (new table, new cron-only endpoint, `sendOtp` signature unchanged); "What Must NOT Regress" explicitly protects the existing `otp.spec.ts` suite and `requireCron` behavior on the two existing cron endpoints.
- Security surface: PASS — new endpoint reuses `requireCron` (timing-safe secret + optional IP allowlist) with no new auth surface; `provider_message_id` used in the Cast status-check URL originates from Cast's own send-response, not guest input (no injection vector); PII path (mask-before-store, mask-only-in-`extra`) cross-checked against `scrubEvent` in `packages/core/src/observability.ts` — consistent and redundant-safe; new table has no unique constraint (deliberate, Q2) so no new DoS/lockout vector on the guest-login path.
- Section 1 — Migration feasibility: PASS — mechanical: `packages/db/src/schema/customer.ts` already imports `pgTable, serial, text, timestamp, index` (no new imports needed, confirmed by reading the file); migration count confirmed 48 files (`0000`–`0047`), so `0048` is the correct next filename; composite index identifier `customer_otp_delivery_log_provider_status_created_idx` is 53 chars, under Postgres's 63-byte limit (no truncation risk). Gaps: none. Conflicts: none — purely additive, no existing table touched. Highest-risk edit: none in this phase (schema-only, no data migration).
- Section 2 — Send-path persistence hook feasibility: CONCERN (C1, C2) — see below. Mechanical: edit targets (`otp.ts:167`, `238`, `286`, `343` success-check points) are real and uniquely matchable against the live file. Gaps: the checklist doesn't explicitly say the insert must be `await`-ed *inside* the try block. Conflicts: none. Highest-risk edit: `logDeliveryAttempt`'s try/catch — see C1.
- Section 3 — Sweep + prune cron endpoint feasibility: PASS, with an execute-agent instruction (E3) — mechanical: `Sentry.withMonitor` (confirmed via reading `@sentry/core`'s `exports.js` source, not a live call) synchronously invokes its callback when no Sentry client is initialized, so the new endpoint spec needs NO explicit Sentry mock — this is the first `+server.ts` cron-endpoint spec in the repo, but chain-mocking Drizzle verbs (`db.select().from().where()`, `.update().set().where()`, `.delete().where()`) is an established pattern (`network-location.spec.ts` already does `db.update().set().where()`). Gaps: none blocking. Conflicts: none. Highest-risk edit: the unconditional-prune-after-sweep-failure ordering (checklist item 12) — correctly specified (per-row try/catch, then its own try/catch around the unknown-transition, then an unguarded final DELETE).
- Section 4 — SMS_PROVIDER dispatch fix feasibility: PASS — mechanical: exact diff target (`otp.ts:120-126`) matches the live file byte-for-byte; the `provider === ''` guard is correctly reasoned (SvelteKit's `$env/dynamic/private` returns `''` for an explicit `SMS_PROVIDER=""`, which `??` does not replace); confirmed `validateEnv.ts` is untouched and its "SMS vars deliberately unvalidated" comment matches the plan's Non-Goals. Gaps: none. Conflicts: none. Highest-risk edit: none — smallest, most isolated change in the plan.

Open gaps:
- C1 (Send-path persistence hook, HIGH priority — guest-auth critical path): the checklist text "wraps a single `db.insert(...).values(...)` call in try/catch" does not explicitly require the insert to be `await`-ed *inside* the try block. If an execute-agent writes `db.insert(customerOtpDeliveryLog).values({...})` without `await` inside the try, the try/catch will NOT catch the eventual rejection (Drizzle query builders are thenable, not synchronous) — the rejection becomes a genuine unhandled promise rejection, which is a real Node.js failure mode (can crash the process depending on runtime config), not merely a missed log line. `void logDeliveryAttempt(...)` at the call site is only safe if `logDeliveryAttempt` itself never lets a rejection escape — resolved via Execute-Agent Instruction E1.
- C2 (Send-path persistence hook, test precision): Test (b) as scoped ("`sendOtp` still resolves when the mocked insert rejects; `captureHandled` called...") is correct in principle but risks a flaky/false-negative result if the test asserts `captureHandled` immediately after `await sendOtp(...)` returns — because the insert is fire-and-forget (`void`-ed, not part of `sendOtp`'s own await chain), `sendOtp` can resolve before the mocked-rejected insert's `.catch` handler has run. Resolved via Execute-Agent Instruction E2.
- Repo-wide `bun run lint` pre-existing 297-file prettier drift (tracked in `process/features/incident-management/backlog/repo-wide-lint-prettier-drift_NOTE_10-07-26.md`) is unrelated to this plan — AC9's lint gate should be read as "no NEW failures introduced," not "lint exits 0," until that backlog item is separately resolved.

What this coverage does NOT prove:
- `otp.spec.ts` / `sweep-delivery/+server.spec.ts` (mocked DB + mocked `fetch`): does not prove real Postgres constraint/transaction behavior, the real Cast DLR status-endpoint response shape stability, or real network latency/timeout behavior in production.
- `bun run db:push` (Hybrid, local dev DB): proves the schema applies to the drifted local dev DB; does NOT prove the committed `0048_*.sql` migration file replays cleanly via `db:migrate` against a clean/prod-shaped DB chain — this is a pre-existing, repo-wide, documented limitation (`process/context/database/all-database.md` "push-managed dev DB" note), not specific to this plan.
- Test (f) proves the `Error.message` string is byte-identical across two rows — it does NOT prove Sentry's actual server-side issue-grouping algorithm groups them into one issue in production (that also depends on stack-trace shape and Sentry's own fingerprinting logic, both outside this plan's test boundary).
- No test covers two overlapping/concurrent sweep-cron invocations (e.g. a slow sweep still running when the next 5-min trigger fires) — `Sentry.withMonitor`'s `maxRuntime: 5` bounds a single run's reported duration but does not itself prevent overlap. Low risk given the append-only, no-unique-constraint design (Q2), but not empirically tested here.
- No test covers a total DB outage occurring before the initial `SELECT` in the sweep handler — per the Failure Modes table this causes the whole handler to throw (matching the existing revoke/reconcile pattern: `Sentry.withMonitor` never silently swallows), so that sweep cycle's prune step does not run. This is documented/accepted behavior, not independently tested.

Execute-Agent Instructions:

| # | Instruction | Trigger condition |
|---|---|---|
| E1 | In `logDeliveryAttempt`, the `db.insert(customerOtpDeliveryLog).values({...})` call MUST be `await`-ed *inside* the try block (`try { await db.insert(...).values({...}); } catch (err) { captureHandled(err, ...); }`). Do NOT write the insert as a fire-and-forget statement inside the try — an un-awaited thenable's rejection is NOT caught by a surrounding try/catch and becomes a genuine unhandled promise rejection. This is the single highest-risk edit in this plan (guest-auth critical path). | Phase 2, checklist item 6 |
| E2 | When writing test (b) ("DB insert failure does not fail the OTP send"), after `await sendOtp(PHONE, CODE)` resolves, explicitly flush pending microtasks before asserting `captureHandled` was called — e.g. `await vi.waitFor(() => expect(captureHandled).toHaveBeenCalled())`, or `await new Promise((r) => setImmediate(r))` before the assertion. Do not assert `captureHandled` immediately after the `await sendOtp(...)` line without a flush — because the insert is `void`-ed (fire-and-forget, not part of `sendOtp`'s own await chain), the assertion can run before the mocked-rejected promise's catch handler executes, producing a flaky/false-negative test that does not actually prove E1 was implemented correctly. | Phase 2, Test Coverage table row (b) |
| E3 | `sweep-delivery/+server.spec.ts` is the first `+server.ts` cron-endpoint spec in this repo — no explicit `Sentry.withMonitor` mock is needed (confirmed by reading `@sentry/core`'s `withMonitor` source: it synchronously invokes its callback and its `captureCheckIn` calls are safe no-ops with no initialized Sentry client, matching the existing `RouterUnreachableError`/`reconcile` comment "No-op passthrough when Sentry isn't initialised"). Mock `db` with a resolving/rejecting method chain per verb needed (`select().from().where()`, `update().set().where()`, `delete().where()`), following the established chain-mocking convention in `apps/customer/src/lib/server/network-location.spec.ts` (`db.update().set().where()`). Do NOT mock `requireCron`/`$lib/server/cron` — set `env.CRON_SECRET` via the existing `$env/dynamic/private` mock pattern and vary the request's `x-cron-secret` header instead, so the auth-guard test (row "Auth" above) exercises the real `requireCron` function. | Phase 3, new spec file creation |
| E4 (optional, Phase 2+3 parallel path) | If executing Phase 2 and Phase 3 as two separate `vc-execute-agent` calls (see Parallel strategy alternative above), both must confirm Phase 1's migration is VERIFIED (`bun run db:push` applied locally) before starting — neither phase's spec can compile/run against the new table otherwise. | Only if the parallel-subagents alternative is chosen over sequential |

Backlog Artifacts: none — no new backlog artifact required; the repo-wide lint drift note already exists and covers AC9's caveat.

Gate: CONDITIONAL (0 FAILs, 2 CONCERNs — C1 and C2 — both resolved via concrete Execute-Agent Instructions E1/E2, not left as open unaddressed gaps; no design flaw found, no re-plan needed)
Accepted by: session (VALIDATE agent, autonomous subagent pass — no interactive user available in this delegated VALIDATE task; both concerns are precision/clarity gaps in an otherwise mechanically sound, additive-only, well-decided plan, each closed with a specific, actionable Execute-Agent Instruction rather than a plan-body rewrite, per the task constraint "write only the validate-contract section"). If a human reviewer disagrees with this self-acceptance, re-run VALIDATE after amending the plan's Phase 2 checklist/test text directly instead of relying on E1/E2.

## Autonomous Goal Block

```
SESSION GOAL: Ship OTP delivery observability (persist Cast send attempts, sweep-classify carrier rejection, alert with a stable Sentry fingerprint, prune after 48h, fix silent SMS_PROVIDER fallback)
Charter + umbrella plan: N/A — single plan (process/general-plans/active/otp-delivery-observability_20-07-26/otp-delivery-observability_PLAN_20-07-26.md)
Autonomy: standard /goal autonomous execution rules (process/development-protocols/orchestration.md §Autonomy Mode) — CONDITIONAL findings apply-and-proceed, BLOCKED items go to backlog, irreversible/outward-facing actions without explicit contract instruction hard-stop
Hard stop conditions / safety constraints:
- Never let the OTP send path (sendOtp) throw or block on a logging/persistence failure — insert failures are fail-open LOGGING, never fail-open AUTH (Goal 6 / AC6)
- The insert in logDeliveryAttempt MUST be awaited inside its own try/catch — an un-awaited thenable rejection becomes an unhandled promise rejection on the guest-login path (Execute-Agent Instruction E1)
- Never interpolate providerMessageId or phoneMasked into an Error message/title — extra-only, constant message string (Carried-forward flag 1 / fingerprint stability)
- Never store raw E.164 phone numbers — maskPhone() output only, everywhere including Sentry extra
- The 48h prune DELETE must run unconditionally every sweep, never gated on Cast API call success (Carried-forward flag 4)
- No unique constraint on customer_otp_delivery_log — append-only by design (Q2); do not "fix" this
- Do not touch apps/customer/src/lib/server/validateEnv.ts (Q5 scope containment — standing decision, SMS vars deliberately unvalidated there)
Next phase: EXECUTE — process/general-plans/active/otp-delivery-observability_20-07-26/otp-delivery-observability_PLAN_20-07-26.md, Phase 1 (migration) first, no dependencies
Validate contract: inline in plan (## Validate Contract section, same file) — Gate: CONDITIONAL, accepted by session, 2 concerns closed via Execute-Agent Instructions E1/E2
Execute start: Fully-Automated — `cd apps/customer && bunx vitest run src/lib/server/otp.spec.ts` and `cd apps/customer && bunx vitest run src/routes/api/otp/sweep-delivery/+server.spec.ts` | Hybrid — `bun run db:push` (precondition: `bun run db:start`) | high-risk pack: no (guest-auth-adjacent but additive-only, no auth/billing/schema-of-existing-table/public-API change — see Blast Radius "Risk class: HIGH" note, mitigated by E1/E2/AC6/AC8)
```
