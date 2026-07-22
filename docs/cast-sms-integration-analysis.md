# Cast SMS — Integration Analysis

**Goal:** Add Cast (`api.cast.ph`) as an SMS provider for portal OTP delivery, and make it the
active provider — **without removing** iTexMo, UniSMS, or SMS Gate. All four stay selectable via
`SMS_PROVIDER`; flip one env var to switch, flip it back to roll back.

**Source of truth:** `apps/customer/src/lib/server/otp.ts` — the single SMS delivery seam. This
doc is analysis only. No code changed.

---

## TL;DR

- The current code already supports provider swapping: `sendOtp()` reads `SMS_PROVIDER` and
  dispatches to one `sendViaX()` per provider. Adding Cast = **one new branch + one new
  `sendViaCast()` function + 2 env vars.** Nothing existing is touched or removed.
- Cast is the *easiest* of the four to wire: static base URL, header auth (`X-API-Key`), E.164
  numbers as-is (no reformatting), a dedicated OTP endpoint, and a clean `success` boolean.
- "Non-deprecating" is free here — the dispatch is a switch, not a replacement. Leaving iTexMo /
  UniSMS / SMS Gate in place costs nothing and keeps instant rollback.
- Estimated change: **~35 lines in `otp.ts` + ~6 lines in `.env.example`.** No schema, no auth
  flow, no API contract, no new dependency (native `fetch`).

---

## 1. How provider switching works today

`sendOtp(phone, code)` is the only thing the better-auth phoneNumber plugin calls. It picks a
provider by env and delegates:

```ts
const provider = (env.SMS_PROVIDER ?? 'itexmo').trim().toLowerCase();
if (provider === 'smsgate') return sendViaSMSGate(phone, code);
if (provider === 'unisms')  return sendViaUniSMS(phone, code);
return sendViaITexMo(phone, code);   // default
```

Each `sendViaX` follows the same contract:

1. Read its own env config; if missing → **dev: log code to console and return; prod: throw**
   (fail-safe by environment — an OTP must never be silently swallowed).
2. Adapt the phone number to the provider's expected format.
3. `fetch` with `AbortSignal.timeout(10_000)` (fetch has no default timeout — an unreachable
   gateway would otherwise hang the whole login request).
4. Treat both transport failure (`!res.ok`) **and** API-level rejection (accepted count 0 /
   `status: failed`) as a thrown error.

Adding a provider means adding one more function in this shape and one more `if` line. **That's
the entire extension surface.** No other file in the auth flow knows which provider is used.

---

## 2. Cast mapped onto that contract

| Contract step | Cast specifics |
|---|---|
| Endpoint | `POST https://api.cast.ph/api/v1/otp/send` (dedicated higher-priority OTP pool — use this, not `/sms/send`) |
| Auth | Header `X-API-Key: cast_…` (64 hex). Sandbox keys are `cast_test_…` |
| Phone format | Accepts E.164 (`+639171234567`) **as-is** — `phone` already arrives E.164, no reformatting needed (unlike iTexMo which needs `09…`) |
| Body | `{ "to": phone, "message": otpMessage(code), "sender_id": <optional> }` |
| Sender ID | Optional. If the account has exactly one approved sender ID, omit it — Cast defaults automatically. Only send `sender_id` if the account has several |
| Success check | HTTP 200 **and** `body.success === true` (response also carries `message_id` starting `CAST` and `parts`) |
| Failure | Non-2xx, or `success: false` with `error_code` (stable machine constant) + `error` (human string). Use `error_code` in the thrown message |
| `scheduled_at` | Not supported on the OTP endpoint — irrelevant to us, we send immediately |

Cast is a strictly *simpler* adapter than the three we already have: no phone reformatting, no
Basic-auth base64 dance, no numeric delivery-code table. It's the closest to the JS example in
Cast's own docs.

### Reference adapter (analysis sketch — not yet in the tree)

```ts
/**
 * Cast (https://api.cast.ph) OTP API. Config (customer env):
 *   CAST_API_KEY    — REQUIRED. Header X-API-Key. Live keys start cast_, sandbox cast_test_.
 *   CAST_SENDER_ID  — optional; only needed if the account has >1 approved sender id.
 * Phone arrives E.164 (+63…) and Cast takes it as-is.
 */
async function sendViaCast(phone: string, code: string): Promise<void> {
	const apiKey = env.CAST_API_KEY;
	if (!apiKey) {
		if (dev) {
			console.info(`[otp] Cast not configured — code for ${phone}: ${code}`);
			return;
		}
		throw new Error('Cast not configured: set CAST_API_KEY');
	}

	const payload: Record<string, unknown> = { to: phone, message: otpMessage(code) };
	const senderId = env.CAST_SENDER_ID;
	if (senderId) payload.sender_id = senderId;

	let res: Response;
	try {
		res = await fetch('https://api.cast.ph/api/v1/otp/send', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(10_000)
		});
	} catch (err) {
		throw new Error(`Cast SMS send failed: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
	}

	// Transport-level failure — surface the stable error_code when the body carries one.
	const body = (await res.json().catch(() => null)) as
		| { success?: boolean; error?: string; error_code?: string; message_id?: string }
		| null;
	if (!res.ok || !body?.success) {
		throw new Error(`Cast SMS rejected (${res.status})${body?.error_code ? ` [${body.error_code}]` : ''}: ${body?.error ?? 'no success flag'}`);
	}
}
```

And the one dispatch line, added above the iTexMo default:

```ts
if (provider === 'cast') return sendViaCast(phone, code);
```

---

## 3. Env wiring (add to `apps/customer/.env.example`)

```dotenv
# --- Cast (api.cast.ph) — used when SMS_PROVIDER=cast. CAST_API_KEY required. ---
CAST_API_KEY=""
# Optional — only if the Cast account has more than one approved sender id.
CAST_SENDER_ID=""
```

Then to activate: `SMS_PROVIDER="cast"`.

Note: SMS vars are **not** enforced by `validateEnv.ts` (comment there: "SMS is the OTP path's
config, validated in that path"). So no change to `validateEnv` — the fail-safe lives in
`sendViaCast` itself, matching the other three. Nothing to add.

---

## 4. Why this is non-deprecating by construction

"Replace without deprecating" needs no special effort because the dispatch is a **selector, not a
swap**:

- iTexMo / UniSMS / SMS Gate functions and their env vars stay byte-for-byte unchanged.
- `SMS_PROVIDER` defaults to `itexmo` if unset, so any box that doesn't set the var keeps its
  current behavior. Only boxes that explicitly set `SMS_PROVIDER="cast"` use Cast.
- **Rollback = change one env var back** (`cast` → `itexmo`) and restart. No redeploy of code, no
  migration, no data change.
- Cast's SMS Gate stopgap comment ("delete once iTexMo is live") is unaffected — that's a separate
  cleanup decision; adding Cast doesn't force it.

If you later want Cast to be the *default* (so an unset `SMS_PROVIDER` picks Cast), that's a
one-word change to the fallback in `sendOtp` — but I'd **not** do that yet: keeping `itexmo` as
the coded default means the switch to Cast is an explicit, auditable env change, and forgetting to
set the key in one environment fails loud rather than silently routing to a possibly-unfunded Cast
account.

---

## 5. Nice-to-haves Cast offers that we currently don't use (skip for now)

All optional. None needed for OTP delivery. Listed so they're on record, not to build now.

- **Idempotency** (`X-Idempotency-Key` header, 24h replay cache). Would prevent a double-send if a
  login retry re-fires. *Skip:* better-auth already rate-limits OTP requests, and a rare duplicate
  OTP SMS is harmless. Add only if double-sends show up in practice — one `crypto.randomUUID()`
  header when we do.
- **Delivery status** (`GET /sms/status/{id}`, `dlr_status`). We fire-and-forget OTPs; polling DLRs
  buys nothing for a 5-minute code. *Skip.*
- **Sandbox key** (`cast_test_…`) for CI / manual test without spending credits or sending real
  SMS. *Worth grabbing* for a test environment — same adapter, just a test key; response carries
  `"sandbox": true`. No code difference.
- **Balance / usage endpoints.** Could feed an admin low-credit warning someday. Out of scope.

---

## 6. Cost & risk

- **Blast radius:** one file (`otp.ts`, additive) + one env example. No schema, no auth contract,
  no API surface, no new dependency. Sits inside the existing fail-safe pattern.
- **Test:** the existing OTP path test shape covers it; add a Cast case mirroring the others
  (mock `fetch`, assert the throw on `success:false` and the no-throw on `success:true`). Run with
  `bunx vitest run` (never `bun test` — bun's runner no-ops vitest mocks).
- **Manual verify:** with a real `CAST_API_KEY` set and `SMS_PROVIDER="cast"`, run one live login
  and confirm the OTP SMS arrives from the expected sender ID. Cast's OTP pool is separate from its
  promo pool, so this is the honest end-to-end check.

---

## Recommended next step

This is a small, bounded, additive change with no schema/auth/billing surface — it fits the
**QUICK FIX lane** (or a trivial EXECUTE), not a full RIPER-5 program. When you want it built:

> add Cast SMS provider — new `sendViaCast` + dispatch line in `otp.ts`, `CAST_API_KEY` /
> `CAST_SENDER_ID` in customer `.env.example`, one vitest case

Nothing here needs a plan artifact beyond this doc. Say the word and I'll route it.
