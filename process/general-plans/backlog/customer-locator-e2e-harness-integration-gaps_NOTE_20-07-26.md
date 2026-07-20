---
name: note:customer-locator-e2e-harness-integration-gaps
description: "Admin/Maya reachability closed as verified-safe; the real (latent) exposure was customer/locator Playwright webServer envs loading live Maya/SMS credentials. SMS is now genuinely fail-closed via tripwire; Maya is only fail-rejected (401), not contained — requests still leave the machine. DATABASE_URL and Sentry remain unprotected."
date: 20-07-26
metadata:
  node_type: memory
  type: note
  feature: general-plans
---

# Customer/locator e2e harness — integration coverage gaps

## History

Originally filed as `test-env-integration-coverage-gap_NOTE_20-07-26.md` under
`process/features/incident-management/backlog/`, flagging that `apps/admin/e2e/config.ts`'s
`TEST_ENV` allowlist didn't cover Maya payments and that admin e2e reachability to Maya was
unverified. **Investigated 20-07-26 (this session) and the original headline concern is
CLOSED as a non-issue** — see below. A different, real exposure was found in its place, in a
different app, and this note has moved out of incident-management's surface accordingly (per
the original note's own "may belong in general-plans" caveat).

## What was verified

**1. Admin has no Maya code path — the original concern does not apply.** Exhaustive grep of
`apps/admin/src` and `apps/admin/e2e` for `maya` (case-insensitive) returns exactly three inert
hits: a comment in `hooks.client.ts:5`, the string literal `'maya-wallet'` used only as a
fund-source display key in `lib/types.ts:211` and `lib/server/queries.ts:558`. No Maya client
import, no call into `@veent/core`'s payments provider. Admin reads payment rows out of the DB;
it never talks to Maya. `TEST_ENV` correctly omits Maya — there was never a gap to close on the
admin side.

**2. The real exposure was in `apps/customer` and `apps/locator`'s Playwright configs.** Before
this session, `apps/customer/playwright.config.ts` had no `webServer.env` override at all — it
runs `npm run build && npm run preview`, which loads the app's real `.env`, including live
`MAYA_SECRET_KEY` and `CAST_API_KEY`. Same shape for `apps/locator/playwright.config.ts` (though
locator's env schema only has `DATABASE_URL`/`ORIGIN` — no payment/SMS keys to leak).

This was **latent, not active**: `find` confirms there are currently **zero `*.e2e.ts` specs**
in either app. But the first customer e2e spec exercising checkout or OTP login would have hit
live Maya and live Cast SMS — strictly worse than the admin/Sentry gap that prompted the
original note, since these are money-moving and SMS-sending calls, not read-only API reads.

**3. Proper e2e isolation for `apps/customer` is a project, not a config tweak.** Three
confirmed blockers, beyond just blanking env vars:
- **Payments has no stub.** `packages/core/src/integrations/payments/index.ts`:
  `PaymentConfig = { provider: 'maya' }`; `createPaymentProvider`'s switch has only a `maya`
  case and throws `Unknown payment provider` on anything else. There is no second provider to
  select in tests.
- **SMS has no stub for a preview build.** `apps/customer/src/lib/server/otp.ts`'s
  `sendViaCast`/`sendViaITexMo` fail-open only when `dev` (from `$app/environment`) is true.
  Playwright's `webServer` runs `npm run preview` — a production build — so `dev` is `false`
  there; a blank `CAST_API_KEY`/`ITEXMO_*` throws instead of no-op'ing.
- **No throwaway-DB harness.** `apps/customer` has nothing equivalent to admin's
  `radius_admin_test` + `scripts/seed-test-data.ts` + `global-setup.ts` pattern.

**4. What shipped this session (concurrent work, verified on disk) — and what the tripwire
actually does, precisely.** `apps/customer/playwright.config.ts` sets a credential tripwire in
`webServer.env`. Its effect is **not uniform across integrations** — do not describe it as
"fail-closed" without qualification:
- **SMS — genuinely fail-closed.** `webServer` runs a `preview` (production) build, so
  `$app/environment`'s `dev` is `false`. `sendOtp`'s missing-key branches
  (`sendViaCast`/`sendViaITexMo`, `apps/customer/src/lib/server/otp.ts`) throw BEFORE any
  network call when `CAST_API_KEY`/`ITEXMO_*` are blank. All four SMS providers
  (`CAST_*`/`ITEXMO_*`/`UNISMS_*`/`SMSGATE_*`) are blanked, not just the active one, so
  flipping `SMS_PROVIDER` cannot route around it. Nothing leaves the machine.
- **Maya — NOT fail-closed. Fail-*rejected*, and the request still goes out.**
  `basicAuth('')` (`packages/core/src/integrations/payments/maya.ts:27`) builds
  `Basic ${Buffer.from(':').toString('base64')}` — a syntactically valid Basic-auth header with
  empty credentials, not an error. The checkout HTTP request is still sent and comes back `401`
  from Maya's API. **The payload leaves the machine; it is rejected by Maya, not prevented by
  the tripwire.** Genuinely containing Maya traffic requires a payments stub, which does not
  exist (see "What's still open" below). The one thing the tripwire DOES guarantee for Maya:
  `MAYA_SANDBOX` is pinned to `'true'` rather than blanked, because
  `apps/customer/src/lib/server/payments.ts:10-13` hard-throws unless the value is exactly
  `'true'` or `'false'` — an omitted/blank value would have let the real `.env` value pass
  through unchanged, and if that value were `'false'`, the preview server would have aimed
  **production** Maya at a 401 instead of sandbox. Pinning `'true'` was the sharpest hole in an
  earlier draft of the tripwire and is why anything that does escape now hits sandbox, never
  production — but "hits sandbox" is a different (and weaker) guarantee than "never leaves the
  machine," and this note must not blur that distinction.
- **MikroTik — genuinely stubbed.** `NETWORK_CONTROLLER: 'stub'` with blanked `MIKROTIK_*` vars
  is a real stub, not a credential blank — no HTTP call is even attempted.

This does **not** make customer e2e work — by design it makes SMS/MikroTik calls impossible and
makes any escaping Maya call land safely in sandbox, forcing whoever writes the first customer
e2e spec to build real stubs deliberately rather than discovering the gap by accident.
`apps/locator/playwright.config.ts` was deliberately left unchanged — its env schema
(`DATABASE_URL`/`ORIGIN` only) has no external credentials to blank, so no tripwire applies
there; the harness gap for locator is only "no specs, no DB isolation," not a credential leak.

## What's still open

1. **Build a payments provider stub** (mirrors the `@veent/core` factory+stub pattern already
   used for network/email) — the only way to make Maya traffic genuinely fail-closed instead of
   fail-rejected. Until this exists, any customer e2e spec that reaches checkout sends a real
   HTTP request to Maya sandbox on every run.
2. **Build an SMS provider stub** reachable in a `preview` (non-`dev`) build, or extend
   `sendOtp`'s fail-safe to also trigger on an explicit test-mode flag, not just
   `$app/environment`'s `dev` — SMS is already fail-closed via the throw, but a real spec still
   needs something to assert against instead of an exception.
3. **`DATABASE_URL` is untouched — the largest remaining gap.** `apps/customer` has no
   throwaway-DB harness equivalent to admin's (`radius_admin_test` +
   `scripts/seed-test-data.ts` + `global-setup.ts`). A future customer e2e spec runs against the
   real dev DB and can write to it. Nothing in the tripwire protects this.
4. **Sentry is not blanked.** `apps/customer/playwright.config.ts`'s `webServer.env` does not
   override `PUBLIC_SENTRY_DSN` (or any other Sentry var), so a real DSN in `.env` means any
   customer e2e run ships events to the real Sentry project — the same class of gap the admin
   `TEST_ENV` fix (M4d, 20-07-26) closed for admin, unaddressed here.
5. **Structural gap — still stands, unchanged from the original note.** `TEST_ENV` (admin) and
   the customer tripwire are both hand-maintained allowlists with no enforcement that they stay
   in sync with the integrations the code actually calls. The Sentry incident
   (`process/context/tests/all-tests.md` §Known Gaps) proves this class of gap recurs silently.
   A structural cross-reference check (lint/test rule diffing "integration modules that read env"
   against "vars blanked in the harness env override") remains unimplemented. This was fix
   option 2 in the original note and is still open.

## Priority reassessment

**Was: High.** Justified by suspected active Maya leakage reachable from the admin e2e suite —
a payments surface, so treated as high-risk-until-proven-safe.

**Now: Medium.** The suspected active leak does not exist (admin never touches Maya). Of the
real exposure found in `apps/customer`: SMS is now genuinely fail-closed (throws before any
network call); Maya is only fail-*rejected* — the tripwire pins sandbox so an escaping request
can't hit production, but the request still leaves the machine and gets a 401, it is not
prevented. `DATABASE_URL` and Sentry remain completely unprotected. What keeps this at Medium
rather than High is that the blast radius is currently zero — `find` confirms no customer
`*.e2e.ts` specs exist yet to trigger any of this. But this is not "closed" the way the admin
side is: the moment someone writes a customer checkout or DB-mutating e2e spec, real requests
reach Maya sandbox and the real dev DB with no isolation. Bump back to High the moment that work
begins, and treat items 1 and 3 in "What's still open" as prerequisites, not nice-to-haves.

## Pointers

- `apps/admin/src` / `apps/admin/e2e` — verified no Maya code path (grep, 20-07-26)
- `apps/customer/playwright.config.ts` — tripwire (this session, concurrent edit; corrected to
  document the SMS-vs-Maya distinction and pin `MAYA_SANDBOX: 'true'`)
- `apps/locator/playwright.config.ts` — unchanged, no credentials to leak
- `packages/core/src/integrations/payments/maya.ts:27` — `basicAuth('')`, why a blank Maya key
  still produces a valid (rejected) request instead of throwing
- `packages/core/src/integrations/payments/index.ts` — `createPaymentProvider`, no stub branch
- `apps/customer/src/lib/server/payments.ts:10-13` — `MAYA_SANDBOX` hard-throw unless exactly
  `'true'`/`'false'`, why it had to be pinned rather than blanked
- `apps/customer/src/lib/server/otp.ts` — `sendViaCast`, `sendViaITexMo`, dev-only fail-open (the
  genuinely-fail-closed SMS path)
- `apps/admin/e2e/config.ts` — `TEST_ENV`, the admin-side pattern to mirror for a future customer harness
- `process/context/tests/all-tests.md` — §Known Gaps, updated 20-07-26 alongside this note
- Original note (superseded, this content replaces it):
  `process/features/incident-management/backlog/test-env-integration-coverage-gap_NOTE_20-07-26.md`
  (deleted; see pointer stub left at that path's parent folder if still present, or this file)
