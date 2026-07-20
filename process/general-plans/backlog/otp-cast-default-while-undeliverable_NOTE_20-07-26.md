---
name: note:otp-cast-default-while-undeliverable
description: "PARTIALLY RESOLVED 20-07-26 — the silent-fallthrough sub-issue (unrecognized SMS_PROVIDER routing silently to Cast) is fixed: sendOtp now throws on any unrecognized non-empty value. Options 1 (change coded default) and 2 (validateEnv boot check) were deliberately declined as standing decisions, not oversights."
date: 20-07-26
metadata:
  node_type: memory
  type: note
  feature: general-plans
---

# Cast is the coded default while it cannot deliver

## Resolution status (20-07-26)

The **silent-fallthrough half** of this note is fixed — see
`process/general-plans/completed/otp-delivery-observability_20-07-26/otp-delivery-observability_PLAN_20-07-26.md`
Phase 4. `sendOtp`'s dispatch (`apps/customer/src/lib/server/otp.ts`) now throws synchronously on
any unrecognized non-empty `SMS_PROVIDER` value instead of silently falling through to Cast.
Unset/blank still defaults to `cast` — unchanged, by design.

**Fix options 1 and 2 were deliberately NOT done, on purpose, not by oversight:**
- **Option 1** (revert/change the coded default away from Cast) — not done. `SMS_PROVIDER ?? 'cast'`
  defaulting to Cast is a standing team decision (iTexMo unresponsive; see
  `~/.claude/projects/-home-hyuse-Desktop-veent-wifiportal/memory/project_cast-sms.md`). This note
  does not argue to move off Cast and this session did not revisit that call.
- **Option 2** (validate `SMS_PROVIDER` at boot in `validateEnv.ts`) — not done. `validateEnv.ts`
  deliberately leaves SMS vars unvalidated by prior design (its own comment documents this); this
  plan's Non-Goals explicitly excluded touching that file, per Q5 scope containment.

**Option 3** (leave as-is, rely on deploy checklists) is effectively superseded by the throw fix —
an unrecognized value now fails loud instead of needing a checklist to catch it.

The underlying observability gap this note is "Related" to
(`otp-delivery-unobservable_NOTE_20-07-26.md`) is now substantially addressed for Cast — see that
note's own resolution status.

---

## Why this exists

`apps/customer/src/lib/server/otp.ts:121` —
`const provider = (env.SMS_PROVIDER ?? 'cast').trim().toLowerCase();` — falls back to Cast when
`SMS_PROVIDER` is unset. Any environment with `CAST_API_KEY` configured and no explicit
`SMS_PROVIDER` therefore routes every guest OTP to Cast implicitly.

Live testing today (2026-07-20) established that Cast is currently rejecting 100% of OTP sends at
the carrier level (see `otp-delivery-unobservable_NOTE_20-07-26.md` for the delivery-observability
half of this — this note is specifically about the default/fallback wiring). The rejected sends did
not pass an explicit `sender_id`; they used the Cast account's own default, configured via
`CAST_SENDER_ID="CAST TRIAL"` — an identity approved on the Cast account itself but a trial identity
PH carriers drop. The fix for the rejection is account-side (Cast registering a real sender ID) and
is being pursued separately; not a code task, not part of this note.

### Prior recommendation this reverses

`docs/cast-sms-integration-analysis.md` §4 "Why this is non-deprecating by construction" explicitly
argued against making Cast the default:

> If you later want Cast to be the *default* (so an unset `SMS_PROVIDER` picks Cast), that's a
> one-word change to the fallback in `sendOtp` — but I'd **not** do that yet: keeping `itexmo` as
> the coded default means the switch to Cast is an explicit, auditable env change, and forgetting to
> set the key in one environment fails loud rather than silently routing to a possibly-unfunded Cast
> account.

That recommendation was overridden by an explicit team decision to make Cast the default. Today's
outcome — an environment silently routing to a provider that cannot currently deliver — is the exact
scenario §4 warned about. Recording this as fact, not as second-guessing the decision to switch.

**This note is not arguing to move off Cast.** The team is deliberately staying with Cast because
iTexMo has been unresponsive; that decision stands independent of this note. The question here is
narrower: whether the *fallback-when-unset* behavior should remain an implicit default, or become an
explicit required setting — a config-hygiene question, not a provider choice.

## What to do (fix options — not a decision)

1. Revert the coded default in `sendOtp` back to an existing provider, or otherwise make the
   fallback explicit rather than silent-Cast — trades "one less env var to set" for "no environment
   can drift into Cast without someone choosing it."
2. Make `SMS_PROVIDER` a required env var, validated at boot in
   `apps/customer/src/lib/server/validateEnv.ts`, so no environment can rely on the implicit
   default at all. Note: SMS vars are currently **not** validated there by design — the file's
   own comment (`validateEnv.ts:13`) says "SMS (ITEXMO_*) is the OTP teammate's config and
   validated in their path," and `docs/cast-sms-integration-analysis.md` §3 confirms this was a
   deliberate choice, not an oversight. Changing this is a real design reversal, not a bug fix.
3. Leave as-is and rely on deploy checklists / `.env.example` documentation to ensure
   `SMS_PROVIDER` is always set explicitly in every environment.

Priority: **Medium**. Not urgent on its own — the account-side sender-ID fix, once shipped,
resolves the immediate symptom regardless of which provider is the default. But the underlying gap
(an implicit default can silently select an undeliverable provider with no boot-time signal) is a
real config-hygiene issue that will recur with any future provider swap, not just this one.

## Related

- `otp-delivery-unobservable_NOTE_20-07-26.md` — the OTP-delivery-observability gap this default
  wiring makes worse (an implicit, unvalidated provider selection compounds with zero delivery
  confirmation).

## Pointers

- `apps/customer/src/lib/server/otp.ts:121` — the `SMS_PROVIDER ?? 'cast'` fallback.
- `apps/customer/src/lib/server/validateEnv.ts:13` — comment documenting that SMS vars are
  deliberately unvalidated at boot.
- `docs/cast-sms-integration-analysis.md` §3 "Env wiring" and §4 "Why this is non-deprecating by
  construction" — the original design intent (itexmo as coded default, explicit opt-in to Cast),
  since overridden by team decision.
