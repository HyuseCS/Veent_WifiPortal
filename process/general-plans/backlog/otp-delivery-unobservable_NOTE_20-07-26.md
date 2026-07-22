---
name: note:otp-delivery-unobservable
description: "PARTIALLY RESOLVED — Options 1-3 (Cast DLR observability) shipped 20-07-26; Option 4 RESEND shipped in apps/customer/src/routes/auth/verify/ (45s cooldown, rate-limited). Remaining open: Option 4 alternate-channel resend + 'delivery uncertain' messaging (DLR-aware guest UX). itexmo/unisms/smsgate remain unobservable by design."
date: 20-07-26
metadata:
  node_type: memory
  type: note
  feature: general-plans
---

# OTP delivery is unobservable (silent accept-then-drop)

## Resolution status (20-07-26)

Fix options 1 (poll DLR), 2 (persist message_id for reconciliation), and 3 (alert on aggregate
failure) are **shipped for Cast** — see
`process/general-plans/completed/otp-delivery-observability_20-07-26/otp-delivery-observability_PLAN_20-07-26.md`.
A new `customer_otp_delivery_log` table records each successful gateway-accepted OTP send (all 4
providers write a row only after the gateway accepts; a send that throws before acceptance is not logged); a 5-minute
cron sweep (`apps/customer/src/routes/api/otp/sweep-delivery/`) checks Cast's DLR endpoint and
fires a stable-fingerprint Sentry alert on confirmed carrier rejection.

**Deliberately out of scope, still true today:** `itexmo`/`unisms`/`smsgate` rows are written but
never swept — only Cast has a DLR status endpoint, so those three providers remain unobservable by
design, not by oversight.

**Option 4 (guest-facing fallback) is PARTIALLY shipped.** The **resend** sub-option is DONE —
`apps/customer/src/routes/auth/verify/` has a "Resend code" control (45s client cooldown countdown,
native form POST `?/resend` action) that re-sends via the current `SMS_PROVIDER` and shares the same
`enforceOtpSendLimit` budget as the initial send (no bypass; 429 with friendly retry message when
over budget). Kept as-is by decision 22-07-26 (the 45s cooldown was deliberately not changed).

**Still open (the genuine remainder):** the *DLR-aware* sub-options — (a) **alternate-channel
resend** (fall back to a different provider when Cast is the known-bad one), and (b) **"delivery
uncertain" messaging** (wire the guest UI to the confirmed DLR-rejection signal so a guest whose OTP
is confirmed-rejected is told delivery may have failed, rather than silently offered a resend for a
code that will never arrive). Both need a decision and a plan. Resend-route test coverage is also a
gap (the `resend`/`verify` form actions have no asserting route-level spec).

---

## Why this exists

Live-tested today (2026-07-20) against Cast, the customer portal's current default SMS
provider (`SMS_PROVIDER` unset → `cast`, see `otp-cast-default-while-undeliverable_NOTE_20-07-26.md`
for that half of the story). The integration itself is correct end-to-end: real portal login →
gateway logged `[otp] Cast accepted: {"success":true,"message_id":"CAST...","parts":1}`. Auth,
request shape, response parsing, and error handling all work as designed.

But every one of three live sends was rejected by the carrier after acceptance. A DLR query
(`GET /api/v1/sms/status/{message_id}`) returned `dlr_status: "REJECTD"`, `status: "undelivered"`.
Zero of three messages arrived on the handset. The portal, meanwhile, told the guest "code sent,"
logged a success line, and consumed a credit — with no error, no alert, and nothing in the logs
indicating the code never went out.

`sendOtp` (`apps/customer/src/lib/server/otp.ts:120`) and each provider's `sendViaX` function only
check what's knowable synchronously: `if (!res.ok || !body?.success) throw ...` (e.g. `sendViaCast`
at `otp.ts:167`). Carrier-side rejection is reported asynchronously, minutes later, via a delivery
receipt (DLR) endpoint the code never queries. This is **provider-agnostic** — none of the four
providers wired into `otp.ts` (`cast`, `itexmo`, `unisms`, `smsgate`) are checked past the
synchronous gateway-accept response, so any of them could accept-then-drop invisibly. Today it
happens to be observed on Cast because that's what was live-tested, not because Cast is uniquely
at fault.

This makes OTP delivery — the entire guest login path — a failure mode with zero observability. A
complete outage would look, from inside the app, identical to a healthy day.

### Prior judgement this evidence overturns

`docs/cast-sms-integration-analysis.md` §5 explicitly considered and deferred this:

> **Delivery status** (`GET /sms/status/{id}`, `dlr_status`). We fire-and-forget OTPs; polling DLRs
> buys nothing for a 5-minute code. *Skip.*

That was a reasonable call on the information available at the time (no evidence of carrier
rejection, and a 5-minute code has a narrow window anyway). Today's live test contradicts the
premise: rejection is real and currently silent. The deferral should not be re-applied on the old
reasoning without accounting for this — flagging that explicitly so it isn't waved through again.

## What to do (fix options — not a decision)

1. Poll `GET /api/v1/sms/status/{message_id}` after send and record/alert on non-delivery. Simplest
   to reason about but adds latency/complexity to a currently fire-and-forget path.
2. Persist `message_id` against the OTP attempt (whatever row/log currently represents an OTP send)
   so delivery can be reconciled later even without live polling — lower-latency, defers the
   "did it arrive" question to an async job or manual lookup.
3. Alert or surface an aggregate DLR-failure-rate metric rather than trying to gate each individual
   message — catches an outage without adding per-request latency.
4. Decide what the guest-facing behavior should be once delivery is known to have failed. Currently
   the guest just waits on a code that will never arrive, with no fallback (resend, alternate
   channel, explicit "delivery uncertain" messaging).

Priority: **High**. This is not a peripheral integration detail — it is the entire authentication
path for every guest, and it can fail completely while every dashboard, log, and health check
stays green. The blast radius of silence (a guest-facing outage invisible to operators) outweighs
the implementation cost of any of the options above.

## Related

- `otp-cast-default-while-undeliverable_NOTE_20-07-26.md` — Cast being the coded default while
  currently 100% undeliverable is a separate, narrower issue; this note is about observability and
  applies regardless of which provider is active.

## Pointers

- `apps/customer/src/lib/server/otp.ts` — `sendOtp` (line 120), per-provider `sendViaX` functions
  (`sendViaCast` at line 134, `sendViaITexMo` at line 187, `sendViaUniSMS` at line 250,
  `sendViaSMSGate` at line 307) — all four stop checking at the synchronous accept response.
- `docs/cast-sms-integration-analysis.md` §5 "Nice-to-haves ... (skip for now)" — the deferred DLR
  polling item, written before live evidence of carrier rejection existed.
