# SMS OTP delivery (Semaphore)

The customer captive portal authenticates guests with a phone OTP. better-auth's
`phoneNumber` plugin owns the code itself (generation, expiry, attempt limiting,
verification); the app only has to **deliver** the code over SMS. That delivery is
implemented with [Semaphore](https://semaphore.co), the PH SMS gateway.

## Where it lives

`sendOtp(phone, code)` in `apps/customer/src/lib/server/otp.ts` is **the single SMS
integration point** — it's wired into the plugin's `sendOTP`. The phone number is
already E.164 (e.g. `+639171234567`), which is exactly what Semaphore expects.

It POSTs the code to Semaphore's send endpoint:

```
POST https://api.semaphore.co/api/v4/messages   (application/x-www-form-urlencoded)
  apikey      = SEMAPHORE_API_KEY
  number      = +639171234567
  message     = Your Veent code is 123456. It expires in 5 minutes.
  sendername  = (optional) SEMAPHORE_SENDER_NAME
```

We send **our own** code via `/messages` — not Semaphore's auto-generating `/otp`
endpoint — because better-auth already generates and verifies the code.

## Configuration

Set these in `apps/customer/.env` (documented in `.env.example`):

| Var | Required | Notes |
|-----|----------|-------|
| `SEMAPHORE_API_KEY` | yes (to send) | From the Semaphore dashboard. |
| `SEMAPHORE_SENDER_NAME` | no | An **approved** sender name. Leave blank to use the account default (`SEMAPHORE`) until you register one. |

## Behavior when not configured

`sendOtp` is deliberately fail-safe-by-environment:

- **Dev** (no key): prints `[otp] Semaphore not configured — code for <phone>: <code>`
  to the server console, so you can keep logging in locally without a gateway.
- **Production** (no key): **throws**. An OTP that can't be delivered must never be
  treated as "sent" — silently swallowing it would let anyone past the login with no
  code. Failing loudly forces the deployment to be configured before it serves users.

A non-OK Semaphore response also throws, surfacing the gateway's error body.

## Going live

1. Create a Semaphore account and top up credits.
2. Put the API key in `SEMAPHORE_API_KEY`.
3. (Optional) Register a sender name in the Semaphore dashboard and set
   `SEMAPHORE_SENDER_NAME`; until then leave it blank.
4. Restart the customer server. No code change is required.

## Switching providers later

Only the body of `sendOtp` changes — the plugin wiring, the cookie/verify flow, and
the call sites stay the same. Keep the same fail-safe shape (dev → console, prod →
throw when unconfigured) so a misconfigured deploy can't silently accept logins.
