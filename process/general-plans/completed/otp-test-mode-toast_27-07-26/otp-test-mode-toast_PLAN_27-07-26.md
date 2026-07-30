---
name: plan:otp-test-mode-toast
description: "TEST_MODE escape hatch — surface the login OTP in a verify-page banner instead of SMS, with a prod-boot hard-fail security gate"
date: 27-07-26
feature: general-plans
---

# OTP Test-Mode Toast — Implementation Plan (SIMPLE)

Date: 27-07-26
Status: DONE — shipped `be527f1` (TEST_MODE OTP escape hatch), prod-boot gate in `8531041`/`9dc2ed1`; user-confirmed 30-07-26
Complexity: SIMPLE

## Closeout — DONE (30-07-26)

Shipped and confirmed. `be527f1 feat(customer): add TEST_MODE to surface OTP on-device instead of
SMS` implements this plan's deliverable — `sendOtp` short-circuits under `TEST_MODE`, stashes the
code in-memory, and the verify page surfaces it in a 15s toast instead of sending SMS. The prod-boot
security gate (`ALLOW_TEST_MODE_IN_PROD` two-flag opt-in) landed alongside/after via
`8531041`/`9dc2ed1`: with that gate in place, `validateEnv` hard-fails prod boot when `TEST_MODE` is
on **unless** the explicit two-flag staging opt-in (`TEST_MODE` + `ALLOW_TEST_MODE_IN_PROD`) is
present — it is not an unconditional prod hard-fail on `TEST_MODE`. The "Ready for VALIDATE" status
line above was stale — archiving as DONE per user confirmation 30-07-26.

## Overview / Context
Context loaded: `process/context/all-context.md` (auth + SMS/OTP sections), `process/context/auth/all-auth.md`,
`process/context/tests/all-tests.md`. This plan is a self-contained `apps/customer` change adding a
general-purpose `TEST_MODE` flag whose FIRST consumer is an OTP escape hatch — so the team can test
real-hardware login while SMS sender IDs are still being provisioned. `TEST_MODE` is deliberately
named generically so future dev/test-only behaviors can gate on the same flag. It reuses the existing
`sendOtp` delivery seam and the signed pending-verification cookie; the load-bearing safety property
is a production boot hard-fail that protects the flag itself (all present and future consumers).

**Flag-safety invariant (applies to every future consumer):** `TEST_MODE` guarantees "never runs in
production" — NOT "harmless." Any behavior gated on `TEST_MODE` must be safe to run in dev-only, since
the flag only enforces the prod boundary, not intrinsic safety.

## TL;DR
While no SMS provider can deliver (sender IDs still processing), add a general `TEST_MODE` flag (first
consumer: the OTP toast): when truthy,
`sendOtp` skips the gateway and stashes the login code in an in-memory Map keyed by phone; the
`/auth/verify` page shows that code in a clearly-labeled TEST-MODE banner (phone sourced only from
the signed pending cookie). `validateEnv` hard-fails production boot when `TEST_MODE` is truthy —
the load-bearing security gate that makes it structurally impossible to ship test mode.

## Goal
Let the team test the full real-hardware login flow without working SMS, without weakening any
production security property.

## Touchpoints
| File | Change |
|---|---|
| `apps/customer/src/lib/server/otp.ts` | Add `isTestMode()` (exported truthy helper), a module-level `pendingTestCodes` Map, `readTestOtp(phone)` (prune-on-read), and a test-mode short-circuit at the TOP of `sendOtp` (before provider dispatch). |
| `apps/customer/src/lib/server/validateEnv.ts` | Hard-fail (`throw`) in prod when `isTestMode()` is true; warn in dev. |
| `apps/customer/src/routes/auth/verify/+page.server.ts` | In `load`, when `isTestMode()`, read `readTestOtp(pending.phone)` and add `devCode` to returned data. |
| `apps/customer/src/routes/auth/verify/+page.svelte` | When `data.devCode` present, render a labeled TEST-MODE banner showing the code. |
| `apps/customer/.env.example` | Document `TEST_MODE` near the SMS block. |
| `apps/customer/src/lib/server/otp.spec.ts` | Add test-mode short-circuit tests (stash + no gateway call). |
| `apps/customer/src/lib/server/validateEnv.spec.ts` (NEW) | Prod hard-fail + dev-pass tests for the security gate. |

## Public Contracts
- New env var `TEST_MODE` (truthy = on). Truthy rule (single source of truth in `isTestMode()`):
  value set AND `['1','true','yes','on'].includes(value.trim().toLowerCase())`. Anything else = off.
- New exports from `otp.ts`: `isTestMode(): boolean`, `readTestOtp(phone: string): string | null`.
- `verify` page `load` return gains an optional `devCode?: string` field.
- No SMS provider contract, schema, migration, or better-auth flow changes.

## Blast Radius
5 source files + 2 spec files, all inside `apps/customer` (one app). Risk class: **auth surface**
(OTP delivery). The single high-risk property is "test mode must never run in production" — covered
by the validateEnv hard-fail gate and its test. In-memory Map is single-instance only (LAN appliance
ceiling; marked with a `// ponytail:` comment). No schema, no migration, no new dependency.

## Acceptance Criteria
- AC1: With `TEST_MODE` truthy, `sendOtp` stashes the code and makes NO gateway `fetch` call.
- AC2: With `TEST_MODE` off/blank, `sendOtp` behaves exactly as today (provider dispatch unchanged).
- AC3: `/auth/verify` renders a labeled TEST-MODE banner with the code when test mode is on; the phone
  is sourced only from the signed pending cookie.
- AC4: `validateEnv` throws at boot when `TEST_MODE` is truthy AND `dev === false` (production).
- AC5: `validateEnv` does NOT throw when `TEST_MODE` is truthy AND `dev === true` (dev warns only).
- AC6: No schema, migration, or new dependency introduced.

## Phase Completion Rules
- CODE DONE: steps 1-5 implemented; `bunx vitest run` green for `otp.spec.ts` + `validateEnv.spec.ts`;
  `bun run check` clean in `apps/customer`.
- VERIFIED: additionally, a human confirms the real-hardware login flow shows the banner code and
  completes login (browser/manual gate — cannot be auto-asserted).

## Implementation Checklist

### 1. `otp.ts` — helper, Map, short-circuit
1a. Add exported `isTestMode()` — a GENERAL test-mode flag helper (OTP is only its first consumer).
Home: `otp.ts` is acceptable for now since OTP is the sole consumer; if/when a second consumer lands,
relocate the one function to a neutral `$lib/server/testMode.ts` and re-import. Do NOT pre-create that
util now (YAGNI) — a single exported `isTestMode()` is enough.
```ts
/** General dev/test-mode switch. Truthy = on. NOTE: guarantees "never in prod" (see validateEnv),
 * not "harmless" — every consumer must be dev-safe on its own. */
export function isTestMode(): boolean {
  const v = (env.TEST_MODE ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}
```
1b. Add module-level Map + reader (place near PENDING constants):
```ts
// ponytail: in-memory, single portal instance only. TEST_MODE targets a single LAN appliance;
// a multi-instance deploy would not share this Map — acceptable and documented (see validateEnv gate).
const pendingTestCodes = new Map<string, { code: string; exp: number }>();

/** Read (and consume-check) the stashed test-mode code for a phone; prunes expired entries. */
export function readTestOtp(phone: string): string | null {
  const now = Date.now();
  for (const [k, v] of pendingTestCodes) if (v.exp < now) pendingTestCodes.delete(k);
  const hit = pendingTestCodes.get(phone);
  return hit && hit.exp >= now ? hit.code : null;
}
```
1c. At the TOP of `sendOtp` (before the `provider` line), short-circuit:
```ts
if (isTestMode()) {
  pendingTestCodes.set(phone, { code, exp: Date.now() + PENDING_MAX_AGE * 1000 });
  console.info(`[otp] TEST MODE — code for ${phone}: ${code} (shown on verify page, NOT sent)`);
  return; // never touches the SMS gateway
}
```
Verify: `bunx vitest run src/lib/server/otp.spec.ts` (from `apps/customer`).

### 2. `validateEnv.ts` — prod hard-fail gate
2a. Import `isTestMode` from `$lib/server/otp`.
2b. Immediately after the `if (building) return;` guard, add:
```ts
if (isTestMode()) {
  const m = 'TEST_MODE is enabled — dev/test-only behavior is active (first consumer: the login OTP '
    + 'is shown in the UI instead of sent via SMS). This MUST NOT run in production.';
  if (!dev) throw new Error(m);
  console.warn(`[env] ${m} (allowed in dev only)`);
}
```
(Place BEFORE the REQUIRED aggregation so the gate fires even if other vars are also missing.)
Verify: `bunx vitest run src/lib/server/validateEnv.spec.ts` (from `apps/customer`).

### 3. `verify/+page.server.ts` — surface devCode
3a. Import `isTestMode, readTestOtp` from `$lib/server/otp` (alongside existing otp imports).
3b. In `load`, after resolving `pending`, before return:
```ts
const devCode = isTestMode() ? (readTestOtp(pending.phone) ?? undefined) : undefined;
return { maskedPhone: maskPhone(pending.phone), devCode };
```
Phone comes only from the signed `pending` cookie — never client input. Gated on `isTestMode()`
so the field is always `undefined` in production (defense in depth on top of the boot gate).

### 4. `verify/+page.svelte` — TEST-MODE banner
4a. Read `data.devCode` (already destructured via `data`).
4b. Above the code `<input>` (inside the form column), render when present:
```svelte
{#if data.devCode}
  <div class="mb-5 rounded-xl border-[1.5px] border-brand/40 bg-brand/5 p-3 text-center" role="status">
    <p class="text-[11px] font-bold uppercase tracking-wide text-brand">Test mode — not sent via SMS</p>
    <p class="mt-1 font-mono text-2xl font-semibold tracking-[0.3em] text-ink">{data.devCode}</p>
  </div>
{/if}
```
Uses existing Tailwind tokens (`brand`, `ink`); no new UI primitive needed.

### 5. `.env.example` — document
5a. Near the SMS block (~line 66), add:
```
# TEST_MODE — general dev/test switch (LAN/dev testing only). When truthy ("1"/"true"/"yes"/"on"),
# dev/test-only behaviors turn on. FIRST consumer: the login OTP is shown on the verify page instead
# of being sent via SMS (use while no SMS sender ID is live). Production REFUSES TO BOOT when this is
# truthy (see validateEnv.ts) — the flag only guarantees "never in prod", not "harmless", so any
# future behavior gated on it must be dev-safe. Leave blank/"false" for real deploys.
TEST_MODE=""
```

## Verification Evidence
| Gate / Scenario | Strategy | Proves SPEC criterion |
|---|---|---|
| `otp.spec.ts`: test mode stashes code, `readTestOtp` returns it, NO `fetch` call | Fully-Automated | Test mode skips gateway + surfaces code |
| `otp.spec.ts`: test mode off → normal provider dispatch unchanged | Fully-Automated | No regression to existing send path |
| `validateEnv.spec.ts`: `TEST_MODE` truthy + `dev=false` → throws | Fully-Automated | Prod cannot boot with test mode (security gate) |
| `validateEnv.spec.ts`: `TEST_MODE` truthy + `dev=true` → no throw (warns) | Fully-Automated | Dev is allowed to use it |
| `bun run check` (customer) | Fully-Automated | Types (incl. new `devCode` page-data field) sound |
| Manual: real-hardware login shows banner code, completes login | Agent-Probe / Human | Full flow works end-to-end |

## Test Infra Improvement Notes
(none identified yet — validateEnv gains its first spec via this plan)

## Resume and Execution Handoff
1. Selected plan file: `process/general-plans/active/otp-test-mode-toast_27-07-26/otp-test-mode-toast_PLAN_27-07-26.md`
2. Last completed step: PLAN written; VALIDATE run (see Validate Contract below)
3. Validate-contract status: written
4. Context loaded: `otp.ts`, `otp.spec.ts`, `validateEnv.ts`, verify `+page.server.ts`/`+page.svelte`, `tests/all-tests.md`, `.env.example`
5. Next step for a fresh agent: on "ENTER EXECUTE MODE", implement steps 1-5 in order, then run the two vitest files + `bun run check` from inside `apps/customer`.

## Validate Contract

generated-by: outer-pvl
date: 2026-07-27
Gate: PASS

### Revision Note (27-07-26)
Env var + helper renamed `OTP_TEST_MODE` → `TEST_MODE` / `isOtpTestMode()` → `isTestMode()` (generalize
the flag; OTP toast is its first consumer). This is a pure rename — no touchpoint, blast-radius,
security property, or test gate changed. The prod-boot hard-fail (AC4) still applies, now to the
broader flag. Gate re-affirmed **PASS**. Added flag-safety invariant: any future consumer must be
dev-safe (the flag guarantees "never in prod", not "harmless").

### Net Gate Derivation
- Layer 1: Infra PASS · Test-coverage PASS · Breaking-changes PASS · Security PASS (concern mitigated)
- Layer 2: §1 PASS · §2 PASS · §3 PASS · §4 PASS · §5 PASS
- Totals: 0 FAIL / 0 unresolved CONCERN / 9 PASS → **PASS**

### Test Gates (run from inside `apps/customer`)
1. `bunx vitest run src/lib/server/otp.spec.ts` — proves AC1 (test mode stashes code, no gateway
   `fetch`) and AC2 (off → provider dispatch unchanged). NEVER use `bun test <file>` (no-ops fake timers).
2. `bunx vitest run src/lib/server/validateEnv.spec.ts` — proves AC4 (prod truthy → throws) and
   AC5 (dev truthy → no throw). New spec; mirror `otp.spec.ts` `vi.hoisted` state pattern
   (getter-mock `$app/environment` `dev` + `$env/dynamic/private` `env`; also mock `$lib/server/db`,
   `@veent/db/schema`, `@veent/core` since validateEnv → otp.ts pulls those).
3. `bun run check` (customer) — proves types incl. new `devCode` page-data field (AC-types).
4. Manual/human: real-hardware login shows the TEST-MODE banner code and completes login (AC3 flow;
   cannot be auto-asserted — Agent-Probe/Human gate).

TDD stub (gate 1, new behavior):
```
test("sendOtp in test mode stashes the code and calls no gateway", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: TEST_MODE short-circuit before provider dispatch")
})
```
TDD stub (gate 2, security gate):
```
test("validateEnv throws in prod when TEST_MODE is truthy", () => {
  throw new Error("NOT IMPLEMENTED — TDD stub for: prod boot hard-fail on TEST_MODE")
})
```

### Execute-Agent Instructions
- E1: Place the `sendOtp` test-mode short-circuit BEFORE the `const provider =` line (§1c) — after it
  would still hit gateway config errors. Uniqueness confirmed for the `const provider =` anchor.
- E2: Place the validateEnv gate AFTER `if (building) return;` and BEFORE the REQUIRED filter (§2b) so
  it fires even when other vars are also missing.
- E3: Keep the `// ponytail:` single-instance comment on the module Map — do not remove it.
- E4: `load`'s `devCode` MUST be gated on `isTestMode()` (defense in depth); phone from `pending`
  cookie only, never `event.url`/form.

### Known Gaps (accepted)
- In-memory Map is single-instance only (LAN appliance ceiling) — documented, not a defect.
- Real-hardware banner→login flow is a manual gate; unit tests prove the seam, not the browser render.

### Resume / Handoff
Selected plan path above. Last step: VALIDATE complete, Gate PASS. Next: on "ENTER EXECUTE MODE",
spawn vc-execute-agent (opus) with this plan path; implement steps 1-5, then run test gates 1-3.
