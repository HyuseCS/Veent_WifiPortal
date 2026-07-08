# SMS OTP delivery (iTexMo)

The customer captive portal authenticates guests with a phone OTP. better-auth's
`phoneNumber` plugin owns the code itself (generation, expiry, attempt limiting,
verification); the app only has to **deliver** the code over SMS. That delivery is
implemented with [iTexMo](https://itexmo.com), the PH SMS gateway.

## Where it lives

`sendOtp(phone, code)` in `apps/customer/src/lib/server/otp.ts` is **the single SMS
integration point** — it's wired into the plugin's `sendOTP`. The phone number arrives
E.164 (e.g. `+639171234567`); iTexMo wants the **local** `09…` form, so the handler
converts it (`phone.replace(/^\+?63/, '0')`) before sending.

It POSTs the code to iTexMo's Broadcast-OTP endpoint:

```
POST https://api.itexmo.com/api/broadcast-otp    (application/json)
{
  "ApiCode":    ITEXMO_API_CODE,
  "Email":      ITEXMO_EMAIL,
  "Password":   ITEXMO_PASSWORD,
  "Recipients": ["09171234567"],
  "Message":    "Your Parafiber code is 123456. It expires in 5 minutes.",
  "SenderId":   ITEXMO_SENDER_ID        // optional; omitted when unset
}
```

We send **our own** code (better-auth generates and verifies it) — iTexMo only
delivers the message text.

## Configuration

Set these in `apps/customer/.env` (documented in `.env.example`):

| Var | Required | Notes |
|-----|----------|-------|
| `ITEXMO_API_CODE` | yes | API code from the iTexMo dashboard. |
| `ITEXMO_EMAIL` | yes | Your iTexMo account email. |
| `ITEXMO_PASSWORD` | yes | Your iTexMo account password. |
| `ITEXMO_SENDER_ID` | no | Approved sender id; sent only when set. On a **trial** account this MUST be `ITM.TEST3`. |

The first three are required to send.

## Choosing the provider (iTexMo vs UniSMS)

`SMS_PROVIDER` selects the gateway — `itexmo` (default) or `unisms` — so you can switch between
them with no code change (e.g. depending on which SMS account is approved first). Only the selected
provider's config is read. UniSMS config (when `SMS_PROVIDER=unisms`):

| Env var | Required | Notes |
| --- | --- | --- |
| `UNISMS_SECRET_KEY` | yes | API secret key (`sk_…`); sent as the Basic-auth username with an empty password. |
| `UNISMS_SENDER_ID` | yes | UniSMS requires a sender id on every message. |

UniSMS (`POST unismsapi.com/api/sms`) takes the recipient in **E.164** (`+63…`, which
`normalizePhone` already produces); iTexMo takes the **local** `09…` form. The fail-safe and 10s
timeout behavior below applies to whichever provider is active.

## Behavior when not configured

`sendOtp` is deliberately fail-safe-by-environment:

- **Dev** (any credential missing): prints `[otp] <provider> not configured — code for
  <phone>: <code>` to the server console, so you can keep logging in locally.
- **Production** (any credential missing): **throws**. An OTP that can't be delivered
  must never be treated as "sent" — silently swallowing it would let anyone past the
  login with no code. Failing loudly forces the deployment to be configured first.

Failures are surfaced three ways: a non-OK HTTP status throws with the response body,
an API-level rejection throws with the message, and a timeout / connection failure throws
too — the send is bounded by a 10s `AbortSignal.timeout` so a slow or unreachable gateway
can't hang the login request. (The login action catches all of these and re-renders the form
with an inline "try again" instead of a 500 — see
`apps/customer/src/routes/login/+page.server.ts`.)

The iTexMo result shape is `{ Error?, Accepted?, Failed?, ReferenceId?, Message? }`; the send
is treated as failed on `Error` **or** `Accepted < 1` (a `200` with `Accepted: 0` means nothing
went out). UniSMS returns `{ message: { status, fail_reason } }` — a missing message or
`status === 'failed'` is the failure signal.

## Going live

1. Create an iTexMo account, buy credits, and get your API code.
2. Set `ITEXMO_API_CODE` / `ITEXMO_EMAIL` / `ITEXMO_PASSWORD`.
3. Restart the customer server. No code change required.

## Switching providers later

Only the body of `sendOtp` changes — the plugin wiring, the cookie/verify flow, and
the call sites stay the same. Keep the same fail-safe shape (dev → console, prod →
throw when unconfigured) so a misconfigured deploy can't silently accept logins.
