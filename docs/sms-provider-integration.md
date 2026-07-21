# SMS/OTP Provider Integration — Implementation Guide

**Scope:** how the customer captive portal (`apps/customer`) sends login OTP codes over SMS, and
how to reimplement the same pattern (single seam + pluggable adapters + fail-safe-by-environment +
out-of-band delivery observability) in another system.

**Companion doc:** `docs/cast-sms-integration-analysis.md` is the original decision/analysis
document that argued for adding Cast as a provider (before it was built, before it became the
default, before the delivery-observability gap was found). This doc is the current, durable
how-it-works reference — read the analysis doc only for the historical argument; read this one for
the implementation.

**Source of truth:** `apps/customer/src/lib/server/otp.ts`. Everything below is read from that
file (and its neighbors) as of 2026-07-20, not inferred.

---

## TL;DR

- One function, `sendOtp(phone, code)`, is the entire SMS delivery seam. better-auth's
  `phoneNumber` plugin calls it from its `sendOTP` hook; nothing else in the auth flow knows which
  gateway is behind it.
- Provider choice is one env var (`SMS_PROVIDER`: `cast` default, `itexmo`, `unisms`, `smsgate`).
  Swapping providers is an env change, not a code change.
- Every adapter is fail-safe **by environment**: missing config in dev logs the code to the
  console (login still works locally); missing config in production throws (an OTP is never
  silently swallowed).
- A gateway `success: true` means **queued**, not **delivered**. A `customer_otp_delivery_log`
  table plus a 5-minute cron sweep close part of that gap — but only for Cast, and only for one
  proven rejection shape. This is documented in full in §5 — do not oversell it.
- As of 2026-07-20, Cast (the default provider) is **not actually delivering OTPs** — PH carriers
  (or Cast's own OTP-channel policy) reject the trial sender ID. This is an account-side blocker,
  not a code bug. See §9.

---

## 1. Architecture — the seam pattern

```
better-auth phoneNumber plugin
        │  owns: code generation, 5-minute expiry, attempt limiting, verification
        │  calls sendOTP({ phoneNumber, code }) when a guest requests a code
        ▼
apps/customer/src/lib/server/auth.ts
        │  sendOTP hook: enforces the per-phone/per-MAC send-rate cap, then calls sendOtp(phone, code)
        ▼
apps/customer/src/lib/server/otp.ts — sendOtp(phone, code)   <-- THE single delivery seam
        │  reads SMS_PROVIDER, dispatches to exactly one adapter
        ├─ sendViaCast     (default)
        ├─ sendViaITexMo
        ├─ sendViaUniSMS
        └─ sendViaSMSGate
```

`otp.ts`'s own header comment states the division of ownership plainly:

> better-auth's phoneNumber plugin owns the code itself (generation, expiry, attempt limiting,
> verification). This module only handles the two things the plugin doesn't: `sendOtp` — THE
> single SMS delivery seam — and a signed pending-verification cookie.

`sendOtp` is wired in at `apps/customer/src/lib/server/auth.ts`:

```ts
sendOTP: async ({ phoneNumber: phone, code }) => {
	const ev = getRequestEvent();
	if (!ev.locals.otpLimitEnforced) {
		await enforceOtpSendLimit(phone, getPortalContext(ev)?.mac, clientIp(ev));
	}
	await sendOtp(phone, code);
}
```

### Why a single seam matters

Because `auth.ts` calls one function and knows nothing about gateways, the entire provider surface
lives inside `otp.ts`. Swapping Cast for iTexMo, adding a fifth provider, or rolling back a bad
provider change is a change to `otp.ts` (or just an env var) — the better-auth wiring, the login
form actions, the rate limiter, and the pending-verification cookie are all untouched. This is the
property worth reproducing in any reimplementation: pick the ONE call site your auth library
invokes to send a code, and make that the only place that knows about SMS gateways.

### The dispatch table

```ts
export async function sendOtp(phone: string, code: string): Promise<void> {
	const provider = (env.SMS_PROVIDER ?? 'cast').trim().toLowerCase();
	if (provider === '' || provider === 'cast') return sendViaCast(phone, code);
	if (provider === 'smsgate') return sendViaSMSGate(phone, code);
	if (provider === 'unisms') return sendViaUniSMS(phone, code);
	if (provider === 'itexmo') return sendViaITexMo(phone, code);
	throw new Error(`Unrecognized SMS_PROVIDER: "${provider}"`);
}
```

Notes on this dispatch, taken directly from the code comments:

- Unset or blank `SMS_PROVIDER` **defaults to Cast**. This is a standing team decision, not an
  oversight — see §9 for why that decision is currently costly.
- An **unrecognized non-empty** value throws. Earlier code fell through silently to Cast on a typo
  (e.g. `SMS_PROVIDER=cats`); that was fixed 2026-07-26 specifically because a misconfigured box
  would otherwise look healthy while routing to the wrong (or an unfunded) gateway.

### Per-provider adapter contract

Every `sendViaX(phone, code)` follows the same shape, and a new provider should too:

1. Read its own env config. Missing config → fail-safe-by-environment (§2).
2. Adapt `phone` (which always arrives E.164, e.g. `+639171234567`) to whatever format the gateway
   wants.
3. `fetch` the gateway with an explicit timeout (`AbortSignal.timeout(10_000)` — `fetch` has no
   default timeout, and an unreachable gateway would otherwise hang the whole login request).
4. Treat **both** a transport-level failure (network error, non-2xx) **and** an API-level
   rejection (accepted count 0, `status: failed`, no message id) as a thrown `Error`. A provider
   adapter must never return successfully unless the gateway actually queued the message.
5. On confirmed accept, fire-and-forget a row into the delivery log (§5) via
   `void logDeliveryAttempt(...)`.

`otpMessage(code)` builds the one message body shared by all four providers (`"Your Parafiber code
is ${code}. It expires in 5 minutes."` — under the 160-char SMS limit).

---

## 2. The fail-safe-by-environment rule

Every adapter opens with the same shape:

```ts
if (!apiKey) {
	if (dev) {
		console.info(`[otp] Cast not configured — code for ${phone}: ${code}`);
		return;
	}
	throw new Error('Cast not configured: set CAST_API_KEY');
}
```

**In dev**, missing provider config prints the OTP code straight to the server console and
returns successfully — so a developer with no SMS credentials configured can still complete a
login locally.

**In production**, the exact same missing config throws instead. This is a deliberate security
property, not a convenience gap. If a misconfigured production box silently "succeeded" at sending
an OTP it never actually sent, the login flow would still report `code sent` to the guest — and
depending on how the caller handled that success, could in the worst case let someone through
without ever proving they hold the phone. An OTP delivery step that can silently no-op is
equivalent to no OTP step at all. Failing loudly in production is what forces a misconfigured
deploy to be caught at first use rather than discovered as a security hole later.

`dev` here is SvelteKit's `$app/environment` `dev` flag, not a hand-rolled `NODE_ENV` check —
every adapter imports the same boolean so the behavior is consistent across all four.

---

## 3. Cast specifics (the default provider)

```ts
async function sendViaCast(phone: string, code: string): Promise<void> {
	const apiKey = env.CAST_API_KEY;
	if (!apiKey) { /* fail-safe-by-environment, see §2 */ }

	const payload: Record<string, unknown> = { to: phone, message: otpMessage(code) };
	const senderId = env.CAST_SENDER_ID;
	if (senderId) payload.sender_id = senderId;

	const res = await fetch('https://api.cast.ph/api/v1/otp/send', {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
		body: JSON.stringify(payload),
		signal: AbortSignal.timeout(10_000)
	});

	const body = await res.json().catch(() => null);
	if (!res.ok || !body?.success) {
		throw new Error(`Cast SMS rejected (${res.status})${body?.error_code ? ` [${body.error_code}]` : ''}: ${body?.error ?? 'no success flag'}`);
	}

	void logDeliveryAttempt('cast', body.message_id ?? null, phone);

	if (dev) {
		console.info(`[otp] Cast accepted: ${JSON.stringify(body)}`);
		console.info(`[otp] Cast message to ${phone}: ${otpMessage(code)}`);
	}
}
```

| Aspect | Detail |
|---|---|
| Endpoint | `POST https://api.cast.ph/api/v1/otp/send` — the dedicated, higher-priority OTP pool, deliberately **not** `/sms/send` |
| Auth | `x-api-key` header. Live keys start `cast_`; sandbox keys start `cast_test_` |
| Phone format | E.164 as-is (`+639171234567`) — no reformatting; Cast accepts it directly |
| Sender ID | `CAST_SENDER_ID` optional — only send it if the account has more than one approved sender id |
| Success check | HTTP 2xx **and** `body.success === true` |
| Failure | Non-2xx, or `success: false`. The stable machine-readable `error_code` is surfaced in the thrown message when present, alongside the human `error` string |
| Timeout | `AbortSignal.timeout(10_000)` — 10 seconds |
| Response fields used | `message_id` (persisted to the delivery log), `success`, `error`, `error_code` |

**The dev-only proof-of-send log.** After a successful accept, in dev only, the code logs both
Cast's raw JSON response and the literal OTP message text sent. This is guarded by `if (dev)`
specifically because **the message text contains the live OTP code** — logging it in production
would put a working login credential into server logs, which is exactly the kind of secret
`scrubEvent` (§6) exists to keep out of Sentry. The same reasoning is why this line must never be
un-guarded "to help debug a production issue" — use the delivery log and DLR sweep instead.

---

## 4. Per-provider quirks table

All four adapters share the contract in §1; the differences are entirely gateway-specific
formatting/auth quirks. Get these wrong and the adapter will silently mis-target every message.

| Provider | Endpoint | Auth | Phone format | Notable quirk |
|---|---|---|---|---|
| **Cast** (default) | `POST https://api.cast.ph/api/v1/otp/send` | `x-api-key` header | E.164 as-is | Dedicated OTP pool, not the general SMS endpoint. Has the only DLR status endpoint of the four — see §5 |
| **iTexMo** | `POST https://api.itexmo.com/api/broadcast-otp` | Credentials in the JSON body (`ApiCode`/`Email`/`Password`) | **Local `09xxxxxxxxx`**, converted from E.164 via `phone.replace(/^\+?63/, '0')` | `ITEXMO_SENDER_ID` optional, but **a TRIAL account must set it to exactly `"ITM.TEST3"`** — any other value on a trial account is rejected. Response shape is `{ Error, Accepted, Failed, ReferenceId, Message }`; a 200 with `Accepted: 0` still means nothing went out |
| **UniSMS** | `POST https://unismsapi.com/api/sms` | HTTP Basic — **the secret key (`sk_…`) as the username, empty password** (`Buffer.from(\`${secretKey}:\`).toString('base64')`) | E.164 as-is | `UNISMS_SENDER_ID` is **required on every message** — unlike Cast where it's optional, UniSMS has no usable default. 201 Created on success; a `message.status === 'failed'` body still counts as a rejection despite the 2xx |
| **SMS Gate** | `POST {SMSGATE_BASE_URL}/3rdparty/v1/messages` (default base `https://api.sms-gate.app`) | HTTP Basic (`username:password` from the app's Cloud Server registration) | E.164 as-is | Not a traditional SMS gateway — it's an **Android phone running the SMS Gate app in Cloud mode**. Both the phone and this server dial OUTBOUND to `api.sms-gate.app`, so it keeps working even when the site's AP isolates Wi-Fi clients or the operator doesn't control the router (a captive-portal-specific constraint). Explicitly a TEMPORARY stopgap — comment says "delete once iTexMo is live." 202 Accepted on success; a `state: 'Failed'` body counts as rejection |

All four cap the call at `AbortSignal.timeout(10_000)` and treat a non-2xx response as a hard
failure — a slow/unreachable gateway degrades to a normal thrown error rather than hanging the
guest's login request.

---

## 5. Delivery observability

### The core lesson

**A gateway `success: true` means QUEUED, not DELIVERED.** Live testing against Cast on
2026-07-20 proved this the hard way: a real portal login produced `[otp] Cast accepted:
{"success":true,"message_id":"CAST...","parts":1}` — every synchronous signal said "sent" — and
the message was rejected by the carrier moments later, with zero of three test messages ever
reaching a handset. The rejection is only knowable by querying the gateway's delivery-receipt
(DLR) endpoint asynchronously, minutes after the send call returns.

Before 2026-07-26, none of the four adapters checked past the synchronous accept response, so a
100% carrier-rejection outage was **completely invisible** from inside the app: every log line,
every dashboard, and every health check stayed green while no guest could log in.

### What was built (2026-07-26)

**`customer_otp_delivery_log` table** (`packages/db/src/schema/customer.ts`):

```ts
export const customerOtpDeliveryLog = pgTable('customer_otp_delivery_log', {
	id: serial('id').primaryKey(),
	provider: text('provider').notNull(),
	providerMessageId: text('provider_message_id'),
	phoneMasked: text('phone_masked').notNull(),
	status: text('status').notNull().default('pending'), // pending | rejected | unknown
	createdAt: timestamp('created_at').notNull().defaultNow()
}, (t) => [
	index('customer_otp_delivery_log_provider_status_created_idx').on(t.provider, t.status, t.createdAt)
]);
```

Every adapter writes a row on successful gateway accept, via `logDeliveryAttempt` inside `otp.ts`
— fire-and-forget (`void logDeliveryAttempt(...)`) so a slow insert never adds latency to the
guest's login request. All four providers write rows (satisfying the `provider` discriminator),
but only Cast ever supplies a real `providerMessageId` — the other three pass `null`.

**The sweep endpoint** — `POST /api/otp/sweep-delivery`
(`apps/customer/src/routes/api/otp/sweep-delivery/+server.ts`), cron-callable, modeled directly on
the existing `POST /api/payments/reconcile` pattern:

```ts
export const POST: RequestHandler = async (event) => {
	requireCron(event);
	return Sentry.withMonitor('customer-otp-sweep', async () => {
		// select Cast rows still `pending`, created within the last 30 minutes
		// for each: GET https://api.cast.ph/api/v1/sms/status/{providerMessageId}
		// classify (see below), then always run the unconditional 48h prune
	}, { schedule: { type: 'crontab', value: '*/5 * * * *' }, checkinMargin: 5, maxRuntime: 5, timezone: 'UTC' });
};
```

**Classification is deliberately conservative — alert only on the one proven-bad shape:**

| Cast DLR response | Classification | Alert? |
|---|---|---|
| `dlr_status: "REJECTD"` or `status: "undelivered"` | `rejected` | **Yes** — the only alerting branch |
| Any other value (`DELIVRD`, `PENDING`, an unrecognized string), a missing field, or a `null` body | left `pending` | No — treated as transient, re-checked next sweep |
| Non-2xx HTTP response from the status endpoint, or a network error | left `pending` | No — the status endpoint being unhappy is not the carrier rejecting the message |
| Still `pending` 30 minutes after send (`GIVE_UP_MS`) | `unknown` | No — terminal give-up, the code stops guessing |

The 30-minute give-up and the alert are both independent of the OTP's own 5-minute expiry — this
sweep is about detecting a systemic outage, not about the individual code's validity window.

**Retention:** every row older than 48 hours (`RETENTION_MS`) is deleted, **unconditionally, as
the very last statement in the handler** — never gated on the Cast DLR calls succeeding. If it
were gated, masked-phone rows would pile up precisely when the sweep itself is broken.

**Sentry fingerprint stability.** The alert is fired via `captureHandled` with a byte-constant
`Error` message:

```ts
captureHandled(new Error('OTP delivery rejected by carrier'), {
	level: 'warning',
	tags: { area: 'otp-delivery' },
	extra: { providerMessageId: row.providerMessageId, phoneMasked: row.phoneMasked }
});
```

The message text never includes the message id or phone — those live only in `extra`. During a
total carrier outage this fires once per rejected message; if the variable data were interpolated
into the message, Sentry would group each one into a separate issue instead of one issue with a
rising count, burying the alert exactly when it matters most.

### What this does NOT prove — be explicit about the limits

- **Cast-only.** iTexMo, UniSMS, and SMS Gate rows are written to the log but are **never swept** —
  Cast is the only one of the four with a DLR status endpoint. Those three providers remain fully
  unobservable by design, not by oversight.
- **One shape only.** The classifier only recognizes `dlr_status: "REJECTD"` and `status:
  "undelivered"` as rejection — an unseen Cast failure mode with a different shape would silently
  stay `pending` until the 30-minute give-up, with no alert either way.
- **Never run against live delivered traffic.** All test coverage mocks `fetch`; the stability of
  Cast's real DLR response shape beyond the one shape observed live is unproven.
- **Still silent to the guest.** Nothing here changes what the guest sees. A confirmed-rejected
  send still just leaves the guest waiting on a code that will never arrive — no resend, no
  alternate channel, no "delivery uncertain" messaging. That is explicitly out of scope for this
  work (see `process/general-plans/backlog/otp-delivery-unobservable_NOTE_20-07-26.md`, item 4).

---

## 6. Security and privacy properties

- **Only the masked phone is ever persisted.** `maskPhone()` turns `+639171234567` into `+63 •••
  ••• 4567`; `logDeliveryAttempt` stores that output, never the raw E.164 number. A dedicated test
  (`otp.spec.ts`) asserts the masked value does not contain the raw digit sequence.
- **`scrubEvent` (`packages/core/src/observability.ts`)** is the shared strict PII redactor wired
  into every app's Sentry `beforeSend`/`beforeSendTransaction`. It drops values for keys matching
  a secret-shaped regex (`pass(word)?|secret|token|otp|^code$|authorization|cookie|api[-_]?key|
  session[-_]?id|totp`) and masks emails/MACs/phones wherever they survive elsewhere in the event
  (message, breadcrumbs, exception, extra, contexts, request). It runs on every branch, including
  the OTP-delivery-rejection alert in §5.
- **The delivery-log insert can never fail a send.** `logDeliveryAttempt` is `await`-ed **inside**
  a `try { … } catch (err) { captureHandled(err, { level: 'warning', tags: { area: 'otp-send-log'
  } }); }` block — a DB error degrades to a Sentry warning, never to a failed login. This matters
  because the OTP send path is the guest authentication path: it must never fail because logging
  failed.
- **The drizzle-thenable trap.** A Drizzle query builder (`db.insert(...).values(...)`) is a
  *thenable* — it doesn't actually run until awaited or otherwise consumed. If the `await` inside
  `logDeliveryAttempt`'s `try` block were removed "to make it truly fire-and-forget," the insert's
  eventual rejection would escape the `try/catch` entirely and surface as an **unhandled promise
  rejection** instead of a caught, logged warning — silently defeating the whole point of wrapping
  it in a try/catch. The fire-and-forget behavior at the *call site* is achieved correctly instead,
  by calling `void logDeliveryAttempt(...)` (not awaiting the wrapper itself) — the `await` stays
  inside the function so its own promise settles before the function returns, and `void` only
  detaches the caller from waiting on that already-safe promise. This exact regression was
  empirically verified during EXECUTE: removing the inner `await` made the delivery-log-insert-
  failure test fail (`expected 1 times, got 0 times`); restoring it passed again.

---

## 7. Environment variables

All read from `$env/dynamic/private` in `apps/customer/src/lib/server/otp.ts`. Names and purpose
only — **never a real key value**. Where a prefix is meaningful for identifying live vs. sandbox,
that prefix is documented (never a full key).

| Var | Required? | Purpose |
|---|---|---|
| `SMS_PROVIDER` | No — defaults to `"cast"` | Selects the adapter: `cast` \| `itexmo` \| `unisms` \| `smsgate`. Unset/blank → Cast. Any other **unrecognized non-empty** value throws at send time |
| `CAST_API_KEY` | Required for Cast | `x-api-key` header value. Live keys start with the prefix `cast_`; sandbox keys start with `cast_test_` |
| `CAST_SENDER_ID` | Optional | Only needed if the Cast account has more than one approved sender id |
| `ITEXMO_API_CODE` / `ITEXMO_EMAIL` / `ITEXMO_PASSWORD` | Required (all three) for iTexMo | iTexMo account credentials, sent in the request body |
| `ITEXMO_SENDER_ID` | Optional | Approved sender id. **On a trial account this must be exactly `"ITM.TEST3"`** |
| `UNISMS_SECRET_KEY` | Required for UniSMS | The API secret key (`sk_…`); used as the Basic-auth username with an empty password |
| `UNISMS_SENDER_ID` | Required for UniSMS | UniSMS requires a sender id on every message — there is no usable default |
| `SMSGATE_BASE_URL` | Optional | Defaults to `https://api.sms-gate.app`; override only for a self-hosted private SMS Gate server |
| `SMSGATE_USERNAME` / `SMSGATE_PASSWORD` | Required (both) for SMS Gate | Basic-auth credentials from the app's Cloud Server registration |

**These vars are deliberately excluded from `apps/customer/src/lib/server/validateEnv.ts`'s
boot-time required list.** `validateEnv.ts`'s own header comment states the reasoning directly:

> Hard-required (prod): the DB, auth secret, cron secret, and Maya keys — a real portal needs all
> of them. … SMS (ITEXMO_*) is the OTP teammate's config and validated in their path.

In other words: SMS config validation is intentionally pushed down into each `sendViaX` adapter
(the fail-safe-by-environment check in §2) rather than centralized at boot. This was a deliberate
scope decision, not an oversight — but see §9 for the operational cost it currently carries (an
environment can boot cleanly and still be completely unable to deliver OTPs).

---

## 8. How to implement this pattern in another system

The portable design, independent of SvelteKit/better-auth/Drizzle:

1. **Find (or create) the one call site your auth library invokes to send a code.** Most OTP-
   capable auth libraries expose a single `sendOTP`/`onSendCode`-shaped hook. Make that hook call
   exactly one function you own — never let more than one place in the codebase know how to reach
   an SMS gateway.
2. **Put provider selection behind one env var, read once inside that function.** A `switch`/`if`
   chain keyed on something like `SMS_PROVIDER` is enough; no factory/DI framework is needed for
   four providers. Pick one explicit "unrecognized value" branch that throws — don't let a typo
   silently fall through to whatever the default happens to be.
3. **Give every adapter a uniform contract:**
   - Read its own config up front.
   - Adapt the phone number to whatever format that specific gateway wants (some want E.164, some
     want a local format — don't assume they're all the same).
   - Call the gateway with an explicit timeout — an SMS gateway is a third-party HTTP call with no
     SLA on your side, and an unbounded `fetch`/`http.request` can hang your entire login request.
   - Treat both a transport failure (network error, non-2xx) and an API-level rejection (a 200
     response that still means "not sent") as a thrown error. Never return successfully unless the
     gateway actually queued the message.
4. **Make every adapter fail-safe by environment, not just fail-safe.** In a local/dev
   environment, missing credentials should degrade to something that keeps the rest of the system
   testable (e.g. log the code to the console) — but that same missing-config condition must throw
   in production. A silent no-op OTP send is a security hole, not a convenience, once real users
   are involved.
5. **Do not trust the gateway's synchronous response as proof of delivery.** If the gateway offers
   any kind of delivery-receipt (DLR) endpoint, plan for an out-of-band reconciliation step rather
   than polling synchronously inside the send path (which would add latency and complexity to
   every login). The pattern that worked here:
   - Persist one row per accepted send (provider, provider-assigned message id if any, a **masked**
     recipient identifier, a status defaulting to `pending`).
   - Run a scheduled sweep (a cron endpoint, a queue consumer, whatever your infra supports) that
     re-checks the DLR endpoint for still-`pending` rows within some bounded recency window, and
     give up (mark `unknown`, no alert) past that window.
   - Prune the log on a retention window, unconditionally, regardless of whether the sweep's
     external calls are currently succeeding.
6. **Classify conservatively.** Only alert on a response shape you have actually observed to mean
   "confirmed failed." Treat unknown/unfamiliar response shapes, non-2xx from the status endpoint,
   and network errors as transient — never let a shaky status-check integration itself become a
   false-alarm generator. A trigger-happy classifier gets ignored; a silent one defeats the whole
   point.
7. **Keep alert fingerprints stable.** If you report failures to an error tracker, keep the
   error's grouping key (message/type) constant across occurrences, and put per-occurrence detail
   (message id, masked recipient, etc.) in structured extra/context fields instead. Otherwise a
   real outage explodes into thousands of distinct alerts instead of one alert with a rising count.
8. **Mask before you persist or report.** Never store or transmit the raw recipient address/number
   in a log row, error message, or third-party telemetry payload — only a masked/redacted form.
9. **Never let a logging/observability side effect fail the primary action.** Wrap the delivery-log
   write in its own error boundary that degrades to a warning-level report, and if your queue
   library uses lazy/thenable execution (Drizzle-style query builders, for example), make sure you
   actually `await` inside that boundary — a fire-and-forget call that never gets awaited anywhere
   will have its rejection escape as an unhandled promise rejection instead of being caught.

**Framework-specific parts you'd swap out:** the `better-auth` `phoneNumber` plugin hook shape,
SvelteKit's `$env/dynamic/private` + `$app/environment` `dev` flag, Drizzle's `pgTable`/query
builder syntax, and the `Sentry.withMonitor` cron check-in wrapper. Everything else in this
section is transferable to any stack.

---

## 9. Operational runbook / gotchas

- **Cast is currently NOT delivering OTPs (open blocker as of 2026-07-20).** PH carrier rejection
  (or possibly Cast's own OTP-channel gateway policy — see below) on the account's trial sender ID.
  A live DLR check on a real send returned `dlr_status: "REJECTD"`, `status: "undelivered"` on
  every one of three test messages, despite the send call itself returning `success: true`. This
  is an **account-side** problem — Cast must activate a real, registered sender ID. No code change
  in this repo reaches it.
- **Cast staff have stated the trial sender ID cannot be used on the OTP channel at all** — a
  dedicated activated sender ID is required. This means the rejection may originate from Cast's
  own gateway policy rather than (only) PH carrier-level filtering. It doesn't change the fix
  (still needs a real registered sender ID from Cast), but it changes where the block is coming
  from.
- **`SMS_PROVIDER` defaults to Cast, so this blocker is silent by default.** Any environment with
  `CAST_API_KEY` set and `SMS_PROVIDER` unset routes every guest OTP through a provider that
  currently cannot deliver — with no boot-time signal, because SMS vars are deliberately excluded
  from `validateEnv.ts` (§7). Verify Cast is actually delivering (via the DLR endpoint, not the
  send response) before relying on it in any new environment.
- **Verify delivery with the DLR endpoint, never the send response.** `GET
  https://api.cast.ph/api/v1/sms/status/{message_id}` (`dlr_status`, `status`). Polling immediately
  after send returns something like `status: "sent"` and proves nothing — DLRs land seconds to
  minutes later.
- **Shell-vs-`.env` trap.** A stale exported `CAST_API_KEY` in a shell session can shadow the value
  in `.env` for tools like `curl` while the app (which reads via SvelteKit's env loading) uses the
  real `.env` value — so a manual curl test can appear to hit sandbox (`cast_test_…` prefix) while
  the running app uses the live key, or vice versa. Always compare key **prefixes** between what
  you're testing with and what the app is configured with; never assume they match.
- **Env is read at boot.** Restart the dev server after editing `.env` — `$env/dynamic/private`
  values are captured at process start, not re-read per request.
- **Run specs with `bunx vitest run <file>`, never `bun test <file>`.** Bun's native test runner
  silently no-ops `vi.setSystemTime` and other vitest fake-timer/mock APIs — a spec that passes
  under `bun test` can be exercising nothing.
- **The sweep's real-world cadence is looser than its spec.** The sweep is designed for a 5-minute
  external cron cadence (`*/5 * * * * curl … /api/otp/sweep-delivery`), but `scripts/dev-cron.ts`
  (the dev-only poller) has a single shared 1-minute interval for all cron targets, so in dev it
  fires the OTP sweep roughly 5x more often than production is designed for. This is explicitly
  called out as harmless in the dev-cron comment — the sweep is idempotent and its windows (30-
  minute give-up, 48-hour retention) are wall-clock based, not per-invocation — but don't use dev
  cadence as a signal for what production behavior should look like.
- **The sweep endpoint is not yet listed in `docs/DEPLOYMENT.md` §8 ("Cron jobs").** That section
  currently documents `network/revoke`, `payments/reconcile`, and `network/health/refresh` only.
  `POST /api/otp/sweep-delivery` needs its own `*/5 * * * *` cron line added there before a
  production deploy relies on it — it will not run in prod just because the code exists.
- **A gateway `success: true` means QUEUED, not DELIVERED — this is the single most important fact
  in this document.** Every symptom above traces back to trusting (or not trusting) that
  distinction.

---

## 10. Testing

### How the specs mock the environment

`otp.spec.ts` and `sweep-delivery.spec.ts` both need to control SvelteKit's virtual modules and env
before the module under test is imported, which vitest's normal mocking can't do for values read
at module scope. The pattern:

```ts
const state = vi.hoisted(() => ({ dev: false, env: {} as Record<string, string | undefined> }));

vi.mock('$app/environment', () => ({
	get dev() { return state.dev; },
	browser: false,
	building: false
}));
vi.mock('$env/dynamic/private', () => ({
	get env() { return state.env; }
}));

import { sendOtp } from './otp'; // imported AFTER the mocks are registered
```

- `vi.hoisted(...)` creates the mutable `state` object before vitest hoists the `vi.mock(...)`
  calls above the imports, so both the mock factories and the test bodies can read/write the same
  object.
- Exposing `dev` and `env` as **getters** (not plain values) means later `state.dev = true` /
  `state.env.CAST_API_KEY = '...'` assignments inside a test are reflected by the live import,
  without needing to re-import the module under test.
- `otp.spec.ts` also mocks `$lib/server/db` (chain-mocking `db.insert().values()`),
  `@veent/db/schema`, and `@veent/core`'s `captureHandled` — anything `otp.ts` imports at module
  scope needs a mock or the import itself throws.
- `vi.stubGlobal('fetch', someMockFn)` replaces the global `fetch` per test; `vi.unstubAllGlobals()`
  in `beforeEach` prevents leakage between tests.
- **The flush-before-assert pattern.** Because `logDeliveryAttempt` is called `void`-ed
  (fire-and-forget) from the adapters, `sendOtp` can resolve before that insert's promise settles.
  Tests that assert on the delivery-log side effect first `await` a microtask flush:
  ```ts
  const flush = () => new Promise((r) => setImmediate(r));
  await sendOtp(PHONE, CODE);
  await flush();
  expect(insertValues).toHaveBeenCalledTimes(1);
  ```
  Asserting without the flush would pass even if the fire-and-forget promise's rejection escaped
  the `try/catch` entirely — silently defeating the exact regression the test exists to catch (see
  §6, the drizzle-thenable trap).

### Commands

```bash
cd apps/customer
bunx vitest run src/lib/server/otp.spec.ts
bunx vitest run src/routes/api/otp/sweep-delivery/sweep-delivery.spec.ts

# full customer regression suite
bunx vitest run

# typecheck
bun run check
```

Never substitute `bun test <file>` for `bunx vitest run <file>` — see §9.

---

## Sources

Everything in this document is read directly from:

- `apps/customer/src/lib/server/otp.ts`
- `apps/customer/src/lib/server/otp.spec.ts`
- `apps/customer/src/lib/server/auth.ts`
- `apps/customer/src/lib/server/cron.ts`
- `apps/customer/src/lib/server/validateEnv.ts`
- `apps/customer/src/routes/api/otp/sweep-delivery/+server.ts` and its spec
- `apps/customer/src/routes/api/payments/reconcile/+server.ts` (the cron pattern this endpoint is
  modeled on)
- `packages/db/src/schema/customer.ts` (`customerOtpDeliveryLog`)
- `packages/core/src/observability.ts` (`captureHandled`, `scrubEvent`)
- `apps/customer/.env.example`
- `scripts/dev-cron.ts`
- `docs/DEPLOYMENT.md` §8
- `docs/cast-sms-integration-analysis.md`
- `process/general-plans/completed/otp-delivery-observability_20-07-26/` (plan + execute report)
- `process/general-plans/backlog/otp-delivery-unobservable_NOTE_20-07-26.md`
- `process/general-plans/backlog/otp-cast-default-while-undeliverable_NOTE_20-07-26.md`

No claim in this document is inferred beyond what these sources state.
