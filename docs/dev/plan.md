# Mitigation Plan — Branch Audit Findings (2026-07-02)

**Source:** `docs/dev/AUDIT_dev-system-sentry_2026-07-02.md`, plus a triaged external review pass (2026-07-02): 6 of its 12 comments were valid and new (the three sample-rate comments merged into A3; the others → A4, A5, B3.6), 4 overlapped this plan or the audit (MAC/phone regex + the +63 regression test → folded into A2; vite-config duplication → stays on the deferred cleanup list; device-cookie trust → assessed by-design in the audit), and 2 were verified not-actionable (Maya buyer guard — the only caller already validates; expire-revoke race — the in-tx recheck handles it, the remaining window is ms-scale and self-heals via auto-bind).
**Status:** ▶ **PHASE 3 (router-free subset) SHIPPED + MERGED** (2026-07-03). Phases 0–2 COMPLETE; `dev/system-sentry` is now MERGED into `dev/audit-fixes` (`2d2b31b`) — which un-gated **B3.6** and the **B3.1/B2.2 `captureHandled`** seams, all now shipped. Only **B3.2** remains (bench-router + design gate). Phases 0–2 detail:
- **Phase 0 + 1** — `dev/system-sentry` commit `6018e33` (squashed; 118 → 125 tests green, 0 typecheck errors). Checkpoint 1 passed with the human Sentry-dashboard verification.
- **Phase 2** — `dev/audit-fixes` (cut from `origin/main`) commit `a262f02`: B1, B2.1, B2.3 + an unplanned e2e-seed fix (main's seed collided with the R18 reference_no unique index and broke the governance suite at setup). Checkpoint 2 passed: 96 unit tests (10 new), 8/8 e2e, 0 typecheck errors, plus live verification — the finance-export gate by hand, and B2.1 by a REAL Maya sandbox webhook (via the registered ngrok tunnel) crediting a blind-expired checkout exactly once and refusing the replay.
- **Cherry-picks on `dev/audit-fixes`**: `ac7efcd` (OTP single native input) + `ad42394` (Maya Kount buyer details) — needed to test payments on main-era code; both dedup automatically at the post-merge rebase. `ad42394` carries migrations 0031+0032 and intentionally omits its `captureHandled` call (no Sentry seam on main).
- **B2.2 is DONE (2026-07-03, post-merge)** — with `captureHandled` now on-branch, the webhook's unattributed-paid path pages at `payment/attribution` (level error) alongside the existing warn; 200-ack unchanged. A live unattributed-paid event (teammate's webhook on the shared sandbox key, 2026-07-02 16:44, tx `e5234262…`) confirmed the scenario is real, not theoretical.
- **Merge done:** `dev/system-sentry` → `dev/audit-fixes` (`2d2b31b`, 124 files, 7 conflicts resolved, 141 tests green + browser-verified). Remaining Phase 3 work is **B3.2 only** — needs bench-router time + the B3.2 design mini-checkpoint.

---

## 1. Regression-safety contract

These invariants must hold after **every** phase. Any task that cannot satisfy them stops and gets re-designed instead of shipped.

| # | Invariant | How it's enforced |
|---|-----------|-------------------|
| S1 | **Money is never double-credited.** The atomic checkout claim + `external_transaction_id` idempotency stay the double-credit guards; no fix bypasses them. | B2.1 widens the claim's *status filter* only — the claim itself stays atomic and inside one transaction. Unit tests assert single-credit under races before/after. |
| S2 | **Webhook ack semantics don't change** except where a task explicitly says so. Maya retry behavior (200 = stop, 4xx/5xx = retry) is load-bearing. | B2.2 keeps the 200-ack and adds alerting only. B2.3 *removes* an accidental 500 path, restoring the documented collapse behavior. |
| S3 | **Sentry scrubbing only ever gets stricter.** No fix may cause previously-masked PII to ship; capture volume/levels stay as-is except named additions. | A1/A2 change masking only; every change lands with a test asserting the old masked cases still mask. |
| S4 | **Guest network lifecycle keeps working end-to-end** (free time + paid tier: grant → browse → expire/revoke → sweep). Admin standing bypasses must survive guest lifecycle events — and vice versa. | Phase 3 tasks each list their blast radius; B3.2 gets a design checkpoint + real-router verification before merge. |
| S5 | **No DB schema changes.** Every fix here is code-level; nothing touches `packages/db` (avoids the known migration-journal drift problem). | Reviewed per task below — none require schema. |
| S6 | **All existing tests pass unmodified**, except tests that themselves encode a bug (the 23505 fake shape in B2.3) — those change in the *same commit* as the fix, with the old case kept alongside. | Phase 0 records the green baseline; every checkpoint re-runs it. |
| S7 | **One task = one commit**, independently revertible. No task mixes a fix with a refactor. | Roadmap ordering below. |

**Deliberately NOT touched** (so nothing gets messed up by scope creep):
- The ~20 duplication/cleanup findings (cron auth, rate limiting, Sentry init, loggers, `escapeHtml`) — separate effort, zero coupling to correctness.
- The webhook's unattributed-ack *design* (deliberate, documented anti-500 behavior) — we alert on it, we don't redesign it.
- `sampleHealth`'s hotspot-interface scoping (deliberate: uplinks/transit VLANs are not access networks) — B3.5 fixes the *staleness* consequence on the read side instead.
- Sentry capture call sites added by this branch — they're additive and correct; only the scrubber changes.

---

## 2. Branch & sequencing strategy

- **Phase 1 (A1, A2) lands on `dev/system-sentry`.** These are defects *in* this branch's new code; the branch shouldn't merge without them.
- **Phases 2–3 (B1, B2, B3) land on a new branch cut from `origin/main`** (e.g. `dev/audit-fixes`). They're pre-existing bugs that exist on main today; coupling them to the Sentry feature branch would block the feature on unrelated fixes and make reverts messy. If `dev/system-sentry` merges first, rebase `dev/audit-fixes` on top so the new `captureHandled` seams are available for the alerting tasks (B2.2, B3.1 want them).
- Ordering within phases is by severity × risk: cheap high-value guards first (B1), money-paths next (B2), router-lifecycle last (B3 — highest blast radius, needs hardware verification).
- **Prerequisite:** `git fetch && git branch -f main origin/main` — local `main` is 296 commits stale, which already skewed one review pass this week.

---

## 3. Roadmap / task list

### Phase 0 — Baseline (no code changes)
- [x] 0.1 Update local `main` to `origin/main`.
- [x] 0.2 Record the green baseline: `bun test` in `packages/core`, `apps/admin`, `apps/customer`; `bun run check` (svelte-check/typecheck) per app; note any pre-existing failures so later phases aren't blamed for them.
- [x] 0.3 Snapshot current Sentry dev-project behavior: trigger one error + one traced navigation from the customer app in dev, save the raw event JSON (this is the before/after evidence for A1).

**Checkpoint 0:** baseline documented. → pause for go-ahead.

---

### Phase 1 — Branch-introduced defects (on `dev/system-sentry`)

#### A1 — Scrub transaction spans + encoded PII (`packages/core/src/observability.ts`)
The Medium security finding: `scrubEvent` (lines 81–108) never visits `event.spans`, and the percent-encoded MAC (`AA%3ABB%3A…`) that the customer app puts in query strings doesn't match `MAC_RE` (line 31) anywhere.

- [x] A1.1 In `scrubEvent`, after the existing `scrub(...)` calls, add `scrub((event as TransactionEvent).spans, new WeakSet())` (guarded `'spans' in event`), and `if (typeof event.transaction === 'string') event.transaction = maskString(event.transaction)`.
- [x] A1.2 Add an encoded-form pattern to `maskString`: MAC with `%3A`/`%2D` separators (e.g. `/\b[0-9A-Fa-f]{2}(?:%3[Aa][0-9A-Fa-f]{2}){5}\b/g`) and the `%40` email form. Masking runs on the *encoded* text — no decode/re-encode round-trip (lossy, and position-mapping back is error-prone).
- [x] A1.3 Tests in `observability.test.ts`: (a) a MAC inside `event.spans[].data['http.url']` is masked; (b) an encoded MAC in a scrubbed string is masked; (c) **all existing masking tests unchanged and green** (S3); (d) a transaction event with parameterized route name passes through byte-identical (protects Sentry issue-grouping).

*Why this can't mess anything up:* the change makes the scrubber visit **more** fields with the **same** recursive logic already proven on `breadcrumbs`/`exception`/`contexts` (depth- and cycle-guarded). Spans are plain data at this point in the pipeline. The only theoretical risk is over-masking span URLs used for grouping — Sentry groups transactions by `transaction` name (parameterized route ids, no PII patterns → `maskString` is a no-op on them), which test (d) pins.
*Rollback:* revert one commit; events simply ship unscrubbed spans again (status quo ante).

#### A2 — Fix the masking regex pair: `PHONE_RE` over-matching AND `MAC_RE` phone-swallowing (`packages/core/src/observability.ts:31-44`)
Two sides of the same defect (the second flagged by the external review): `PHONE_RE`'s generic `≥9-digit run` mangles timestamps/amounts/ids, and `MAC_RE`'s bare-12-hex branch matches all-digit runs — `+639171234567` is MAC-masked (`+63 9171•••` shape, exposing the carrier prefix) before `PHONE_RE` ever sees it.

- [x] A2.1 Replace the generic phone catch-all with PH shapes: `(?:\+?63|0)9\d{2}[\s()-]?\d{3}[\s()-]?\d{4}\b`, keeping a generic `+<country>` international form. Comment the ceiling: non-PH domestic formats won't mask (acceptable — PH-only product: Maya + itexmo).
- [x] A2.2 Design the two regexes **together** — there's a tension: requiring a hex letter in `MAC_RE`'s bare-12 branch (the external review's suggestion) hands all-digit runs to `PHONE_RE`, but a genuinely all-digit MAC (`001122334455` — OUI 00:11:22 exists) then matches neither once A2.1 narrows `PHONE_RE`. Resolution: hex-letter requirement on the bare-12 branch **plus** a final catch-all masking any leftover 11–13-digit bare run — every token previously masked stays masked (S3), just with the right shape.
- [x] A2.3 Tests: epoch-ms timestamp, centavo amount, and a 10-digit external id survive unmasked; `+639171234567`, `09171234567`, and spaced/hyphenated variants mask **as phones** (regression test from the external review); separator MACs and `001122334455` still mask. Existing tests stay green.

*Why this can't mess anything up:* strictly reshapes what gets rewritten in **outbound telemetry text only** — no app behavior reads these strings. The catch-all in A2.2 guarantees nothing previously masked ships unmasked (S3); the risk direction is a weird foreign phone in a log line, smaller than today's corruption of every long number.
*Rollback:* revert the regex commit.

#### A3 — Validate Sentry sample rates in one place (`packages/core/src/observability.ts` — `sentryOptions`)
External review flagged 3 of 6 hook files; verified all six: the client hooks (`apps/{admin,customer,locator}/src/hooks.client.ts:22`) check `Number.isFinite` only, so a finite out-of-range value (`5`, `-1`) reaches `tracesSampleRate`; the server hooks (`apps/admin/src/hooks.server.ts:28`, `apps/customer/src/hooks.server.ts:26`, `apps/locator/src/hooks.server.ts:20`) have **no** guard at all, so `NaN` gets through.

- [x] A3.1 Fix once at the shared seam instead of six copies: `sentryOptions()` clamps its `tracesSampleRate` input — finite and within `[0,1]` → use it; anything else → `0.2`. The hooks' `dev ? 1.0 : …` overrides pass `1.0`, which the clamp passes through untouched.
- [x] A3.2 Test in `observability.test.ts`: `NaN`, `-1`, `5`, `'garbage'`-parsed input → `0.2`; `0`, `0.2`, `1` pass through.

*Why this can't mess anything up:* every currently-valid configuration produces the identical rate after clamping; only currently-broken configurations (NaN silently disabling tracing, out-of-range values Sentry rejects at runtime) change — to the documented 0.2 default. Env vars are operator-controlled, so this is robustness, not security.
*Rollback:* revert; hooks keep their per-file partial guards.

#### A4 — Accessible names for the top-up buyer fields (`apps/customer/src/routes/top-up/+page.svelte:128-156`)
Verified: `firstName`, `lastName`, `email` inputs are placeholder-only — no `<label>`/`aria-label` — while the adjacent `saveDetails` checkbox is properly labelled. Placeholders vanish on input and aren't reliably announced.

- [x] A4.1 Add an accessible name per field following the form's existing labelling pattern (visible label or `aria-label`, whichever matches the design) — markup-only, no logic changes.

*Why this can't mess anything up:* additive markup on three inputs; form names, values, and the action contract are untouched.
*Rollback:* revert the markup.

#### A5 — Strengthen the grant-atomicity spec (`apps/customer/src/lib/server/grant-atomic.spec.ts:118-131`)
External-review nitpick, verified worthwhile: the test asserts `network.grant` is called but not that it runs **inside** `db.transaction`, so the regression it exists for could silently return.

- [x] A5.1 In the fake db, set an `inTransaction` flag around the transaction callback; assert it inside the `grant` mock. Test-only change.

*Why this can't mess anything up:* test-only; production code untouched.
*Rollback:* n/a.

**Checkpoint 1:** `bun test packages/core` green; repeat the 0.3 dev-capture and diff the event JSON — MAC absent from spans, timestamp intact in message. **Human verification handoff:** browse the customer dev portal (`/login?mac=` → dashboard → top-up), then confirm in the Sentry dev project that no event contains a raw or encoded MAC. → pause.

---

### Phase 2 — Payments & PII exposure (new branch `dev/audit-fixes` off `origin/main`)

#### B1 — Gate the finance CSV export (`apps/admin/src/routes/(app)/finance/export/+server.ts:14-18`)
- [x] B1.1 Add the exact guard pair from the sibling `api/router-log/+server.ts:16-20`: `if (!event.locals.user) error(401, 'Not authenticated');` then `if (!event.locals.user.twoFactorEnabled) error(403, 'Two-factor enrollment required');`. Replace `event.locals.user!.id` with `event.locals.user.id` (kills the unauth 500). Fix the false comment claiming the layout guards this route.
- [x] B1.2 Governance-suite E2E: pre-enrollment session gets 403 from `/finance/export?period=all`; enrolled admin still gets the CSV. (Harness notes: throwaway `radius_admin_test` DB, `TEST_ENV` must blank `RESEND`.) *Also pins anonymous → 401. Required fixing main's seed (per-customer reference_no vs the R18 unique index) — the suite was broken at global-setup on main itself.*

*Why this can't mess anything up:* two added early-returns, identical to the pattern three sibling endpoints already use in production. Enrolled admins hit code that is byte-identical after the guards. Blast radius: one endpoint.
*Rollback:* revert; endpoint returns to current (vulnerable) behavior — nothing else depends on it.

#### B2.1 — Let verified-paid events credit blind-expired checkouts (`packages/core/src/services/reconcilePayments.ts`)
The cron flips aged `pending` checkouts to `expired` without asking the gateway (lines 288–291); a late paid webhook then finds status ≠ `pending`, no-ops, and acks 200. Buyer charged, credits never granted.

- [x] B2.1.1 Widen `creditCheckoutIfUnsettled`'s atomic claim from `status = 'pending'` to `status IN ('pending','expired')` (claim → `settled` stays atomic, in-transaction). `expired` is an *administrative* state (stop polling), not a *money* state — a gateway-verified paid event must always credit. The blind-expire sweep itself **stays** (it's what bounds cron work); it just stops being a credit-lockout.
- [x] B2.1.2 Unit tests (fake-db style used by the existing suite): paid webhook against an `expired` checkout credits exactly once; a second replay no-ops (`already_settled`); the amount-mismatch and unknown-package guards still refuse; two concurrent claims on an expired checkout produce one credit (S1). *(`credit-claim.spec.ts`, 7 tests, incl. a SQL-params pin on the status filter. Verified live 2026-07-02: real webhook credited an expired checkout once; replay refused.)*

*Why this can't mess anything up:* the only behavior change is `expired → settled` becoming a legal claim transition, and it is reachable **only** with a gateway-verified paid event in hand — the same proof `pending → settled` requires. Double-credit safety is untouched (same atomic claim, same txn-id idempotency). Checkouts that expire *unpaid* are never claimed because no paid event ever arrives for them.
*Rollback:* revert to the narrower status filter; lockout behavior returns.

#### B2.2 — Alert on unattributed paid events (`apps/customer/src/routes/api/webhooks/payment/+server.ts:128-146`)
- [x] B2.2.1 Alongside the existing `console.warn`, added `captureHandled(new Error('unattributed paid event'), { level: 'error', tags: { area: 'payment', scope: 'attribution' }, extra: { txId, amountMinor, hadCheckoutRow, userExists, pkgExists } })` — the non-PII fields already assembled for the warn. The 200-ack **stays** (S2 — deliberate anti-500 design; the money remediation is manual refund/credit, which now gets a loud signal instead of a buried log line). *(Shipped post-merge 2026-07-03.)*
- [x] B2.2.2 Specified in **[`docs/dev/sentry-alert-rules.md`](sentry-alert-rules.md)** (rule A1): any `payment/attribution` event pages immediately — count 1, not volume-based. Full alert taxonomy for all capture areas is there too (Phase 4.3). Dashboard config is the operator's to apply.

*Why this can't mess anything up:* purely additive capture on an existing code path, matching the pattern commit `f9e8bef` used on six other paths; `scrubEvent` runs on send. No control flow changes.
*Rollback:* delete the capture call.

#### B2.3 — Fix the dead 23505 collapse (`packages/core/src/services/reconcilePayments.ts:98`)
drizzle-orm 0.45.x wraps driver errors in `DrizzleQueryError`; the SQLSTATE lives on `.cause.code`, so the collapse branch never fires and the webhook path 500s into a gateway retry loop.

- [x] B2.3.1 Extract the code by walking the cause chain: `const pgCode = (e as any)?.code ?? (e as any)?.cause?.code ?? (e as any)?.cause?.cause?.code` (bounded, no loop) and compare that to `'23505'`. Keep accepting the bare `.code` shape (driver-direct callers, and the stub used in tests).
- [x] B2.3.2 Fix the masking test: the fake db now rejects with the production shape (`new DrizzleQueryError`-alike carrying `cause.code = '23505'`) **and** keep one bare-`{code}` case so both shapes are pinned.
- [x] B2.3.3 Regression test at the caller level: same payment arriving under two gateway ids results in one row updated, no throw.

*Why this can't mess anything up:* the fix makes an existing, documented, already-tested branch actually reachable; the non-23505 path still rethrows unchanged. Worst case if the shape ever changes again: we're back to today's behavior (rethrow → 500 → retry), never a silent swallow of a *different* error class, because only `23505` matches.
*Rollback:* revert; the collapse goes dead again (current behavior).

**Checkpoint 2: ✔ PASSED (2026-07-02).** 96 unit / 8-of-8 e2e / 0 typecheck errors. Live: finance-export gate verified by hand (401 anonymous, CSV for enrolled owner); paid-after-expiry credited exactly once by a REAL Maya webhook through the registered ngrok tunnel, replay refused (`already_settled`). The duplicate-id collapse isn't stageable by hand locally — pinned by 4 unit tests incl. the wrapped production shape; watch for webhook 500-retry loops in the Phase 4 staging soak.

---

## ⏸ STOP → ▶ PARTIAL RESUME (owner decision, 2026-07-03)

**2026-07-02:** paused before Phase 3. **2026-07-03:** shipped the router-free subset (**B3.3, B3.4, B3.5** + B3.1's DB-first reorder), THEN merged `dev/system-sentry` in (`2d2b31b`) and finished the newly-unblocked items — **B3.6** (checkout tag-guard) and the `captureHandled` seams for **B3.1** (unbind) and **B2.2** (unattributed-paid alert). Then closed the last open unit test (B3.1.2 sweeper-drops-orphan) + ran the B3.4.3 data audit (clean) + reconciled every stale checkbox against the actual tree. Unit suite green: customer 46 / admin 76 / core 14 = **136**, 0 fail (+ the 8-test governance e2e from Checkpoint 2); merge browser-verified.

**Every code + unit-test item in Phases 1–3 is now DONE, including B3.2** (implemented 2026-07-03, pt.5 — the section below is rewritten to match). What remains is gated on things outside the code:

| Remaining | Blocked on | Kind |
|-----------|-----------|------|
| **B3.2 bench verification** + **B3.1 / B3.6 real-router legs**, **Checkpoint 3** | bench MikroTik + human sign-off | hardware verification (ship gate before prod) |
| **B2.2.2 + Phase 4.3** (Sentry alert rules) | ✅ spec'd in `docs/dev/sentry-alert-rules.md`; operator applies + tunes in the dashboard | ops config, not code |
| **Phase 4.2 / 4.4** (staging soak, prod post-deploy MAC check) | a staging/prod deploy | rollout |
| **Phase 4.5** (mark findings mitigated, rename `*_COMPLETE`) | everything above landing | doc bookkeeping |

**B3.2 design decision (resolved 2026-07-03):** owner chose **mutual exclusion** (≤1 binding per MAC; grant precedence + tag-scoped revoke) over option (a) coexistence — which removes the RouterOS "multiple ip-bindings per MAC" assumption entirely, so it was buildable + fully unit-testable WITHOUT the bench router. The bench MikroTik is now the *final verification* (Checkpoint 3), not a build blocker. Scope grew: the admin bypass was found **standing / never-expiring** (staff device kept internet forever after one sign-in; `revokeAdminAccess` was never wired), so a net-new **4h sliding cap** (teammate-approved) was added alongside the clobber fix. Unit suite now **151** (customer 48 / admin 89 / core 14), 0 fail; both apps `check` 0 errors. Nothing else here is finishable at a keyboard without hardware, a deploy, or a Sentry dashboard.

---

### Phase 3 — Network/session lifecycle (continues on `dev/audit-fixes`)

Highest-blast-radius phase: these paths talk to the physical router. Every task here gets verified against a real MikroTik (via `apps/admin/scripts/setup-router.ts` + `docs/mikrotik/` runbooks) before merge, plus a human verification handoff.

> **RE-ANCHORED 2026-07-03** against the current `dev/audit-fixes` tree (line refs below were written against newer `dev/system-sentry` code and had drifted). Verdicts: **B3.1, B3.3, B3.4, B3.5 confirmed present** and implementable now (no hardware/rebase). **B3.2 is partially fixed** — `GrantInput.tag` plumbing already exists; only the grant find-or-create + tag-filtered revoke remain. **B3.6's target code does not exist on this branch** — it lives only on `dev/system-sentry`, so it defers to the Phase 4.1 rebase.

#### B3.1 — Stop `pauseAccountAccess` stranding live bypasses (`packages/core/src/services/sessions.ts:855-877`, call site `:548`)
*(re-anchored: function is `unbindAllDevices` (post-merge `~929`), per-device loop; `afterBind` pattern at `:192-198`. Shipped in two parts — DB-first reorder pre-merge; `captureHandled(err, …scope:'unbind')` wired post-merge 2026-07-03 once the observability seam landed.)*
- [x] B3.1.1 Make `unbindAllDevices` DB-first and resilient, matching the architecture's "DB is truth, sweeper reconciles router drift" pattern used by `afterBind` (sessions.ts:192-197): mark each row `revoked` first, then attempt `network.revoke(mac)` in a per-device `try/catch` with `captureHandled(err, { level: 'warning', tags: { area: 'network', scope: 'unbind' } })` — continue on failure instead of throwing out of the loop.
- [x] B3.1.2 Pinned with a unit test (`unbind-devices.spec.ts`): `reconcileGuestBindings` revokes a router binding whose MAC has no `active` session row (the stranded case) and leaves an active one alone — case-insensitive match — so the "reconcileGuestBindings sweeps any miss" comment is now true-by-test.
- [x] B3.1.3 Unit test (`unbind-devices.spec.ts`): stub controller whose `revoke` throws for BOTH devices — pause still completes, returns count 2, every row ends `revoked`, revoke attempted per device, no unhandled rejection. *(The `captureHandled` call is a fire-and-forget no-op when Sentry is uninitialised — not asserted; the load-bearing swallow+continue+all-revoked behaviour is.)* Callers reviewed: return value is a count — semantics unchanged.

*Why this can't mess anything up:* the failure ordering flips from "router-first, DB stranded on throw" (free internet forever) to "DB-first, router swept later" (worst case: a device keeps access until the next sweeper cron — bounded minutes, and the state self-describes). The happy path is byte-equivalent: rows revoked, router revoked, same count returned.
*Rollback:* revert; pause returns to strand-on-throw.

#### B3.2 — Admin-bypass 4h expiry + guest/admin mutual exclusion — ✅ IMPLEMENTED (2026-07-03, pt.5); bench-gated
**Shipped as MUTUAL EXCLUSION, not coexistence.** The audit also surfaced that the admin bypass was *standing* (never expired; `grantAdminAccess` used `durationMinutes:0` and `revokeAdminAccess` had **zero callers** — admin `/logout` never touched the router), so a staff device kept free internet forever after one sign-in. A net-new **sliding 4h cap** (teammate-approved) was added alongside the clobber fix. The approach keeps ≤1 bypass binding per MAC, so it needs no RouterOS "multiple bindings per MAC" assumption.

- [x] B3.2.1 **Design decision (owner):** mutual exclusion over coexistence. One binding per MAC; grant precedence (`planGrant`) — an admin grant slides its own window (no re-flush), else NO-OPs on a device already bypassed by a guest (paid time never clobbered); a guest grant NO-OPs when an admin binding exists (never demotes it). Expiry: **fixed 4h, slid on dashboard activity**. Migration: **grandfather** bare legacy `veent-admin` — only timestamped `veent-admin:<epoch>` is ever reaped.
- [x] B3.2.2 **Implemented.** Pure planner `planGrant` + predicates (`isAdminBypassComment` / `commentMatchesTag` / `adminBypassExpired` / `adminBypassComment`) in `mikrotik.ts`; `grant` routes through the planner (flush only on a real non-bypassed→bypassed transition). `revoke(mac, scope: {tag}|{all:true})` — a **required** arg, so a missed call site is a compile error, never a silent cross-tag clobber. New `sweepAdminBindings` (TOCTOU re-check before remove; present-only conntrack cut) + service `sweepAdminAccess(db, network)` that restores a guest binding for any reaped MAC that still holds a live window (`hasLiveAccessForMac`) — mutual exclusion across the expiry. Wired: customer revoke cron runs the sweep; admin `(app)` layout slides the window (throttled ~2h, in-memory, best-effort); admin `/logout` now revokes. All 8 revoke callers scoped: guest-lifecycle (`afterBind` evict, `expireDueAccounts`, `reconcileGuestBindings`, `unbindDevice`, `unbindAllDevices`) → `{tag: veent-portal}`; security levers (`revokeUserSessions` block/kick, `revokeActiveMacs` delete) → `{all:true}` full cut (defeats a MAC-spoofer riding an admin binding); `revokeAdminAccess` → `{tag: veent-admin}`.
- [ ] B3.2.3 **Real-router verification matrix** — bench MikroTik, in the Checkpoint 3 handoff. Unit tests cover all DECISION logic + the restore orchestration (151 tests, 0 fail); the thin router-command execution (TOCTOU re-read, ip-binding-table scoping, present-only cut) is what the bench pass verifies.

*Unit-tested:* precedence over multi-row drift, admin-refresh no-flush, guest idempotent no-flush (no connectivity-flash regression), admin-no-op-keeps-paid-guest, grandfather bare/malformed/non-positive stamps, cross-tag revoke isolation via `commentMatchesTag`, `sweepAdminAccess` restore for a live-window MAC (and skip without), guest-lifecycle revoke stays `veent-portal`-scoped.
*Why this can't mess anything up:* mutual exclusion keeps ≤1 binding per MAC (no coexistence to get wrong); tag-scoped revoke can't cross tags (unit-pinned) and the required scope arg makes a miss a compile error; grant never clobbers paid time; the sweep reaps ONLY timestamped `veent-admin:<epoch>` rows on the `/ip/hotspot/ip-binding` table — never guest, never bare/operator bindings, never the identically-named `veent-admin` *walled-garden* rules (a different RouterOS table); no admin lockout (dashboard is walled-garden-reachable without a bypass); no DB schema change (expiry lives in the router comment).
*Rollback:* independent commits — revert the revoke-scope commit for tag-blind revoke; the sweep/cron commit for the standing bypass; the sliding-renewal/logout commit to leave grant at sign-in only.

#### B3.3 — Age-bound the stale IP→MAC fallback (`packages/core/src/services/adminAccess.ts:88-91`)
*(re-anchored: lines unchanged; function is `resolveDeviceMac` at `:69`. Happy-path TTL check is `:76`; the unbounded fallback is the `catch` at `:88-91` returning `cached?.mac ?? null`. Callers: customer `resolveMac` `apps/customer/.../network-location.ts:28`, admin `postLogin.ts:41`.)*
- [x] B3.3.1 On the error path, only return `cached.mac` if the entry is younger than a stale ceiling (`MAC_CACHE_STALE_MAX_MS = 5 * 60_000`); otherwise return `null`. Comment the ceiling: 5 min tolerates a router blip without surviving a DHCP lease reassignment. *(`adminAccess.ts:52,95`.)*
- [x] B3.3.2 Unit test (`adminAccess.spec.ts`): fresh-cache outage within 5 min → served (and the 60s happy-path TTL is bypassed, proving the catch branch ran); >5 min stale + outage → `null`.

*Why this can't mess anything up:* `null` is the already-handled "can't detect device" outcome every caller (customer portal `resolveMac`, admin flows) renders today; the change only shrinks the window where a *wrong* MAC could be served, which is strictly safer than the status quo. Happy path (fresh cache / live router) unchanged.
*Rollback:* revert the constant/branch.

#### B3.4 — Reject zero-minute packages (`apps/admin/.../content/packages/+page.server.ts:45-66` + `packages/core/src/services/sessions.ts`)
- [x] B3.4.1 Form validation: `durationMinutes < 1` is invalid for both `tier` and `free` types (the current `num()` accepts `>= 0`). *(`content/packages/+page.server.ts:68-71`.)*
- [x] B3.4.2 Defense-in-depth at the money seam: `startPaidAccessAndBindDevice` refuses `durationMinutes <= 0` **before** deducting credits (throws, surfaced like other purchase errors — never a silent no-op after spending). *(`sessions.ts:339`.)*
- [x] B3.4.3 Data audit (read-only, live DB `localhost:5432`) — **clean**: the only NULL/sub-1 duration rows are `bundle` type (credit top-ups ₱20/₱50/₱100), which legitimately have no duration; **zero** `tier`/`free` packages with `duration_minutes < 1`. No data mutation needed.
- [x] B3.4.4 Unit test on the seam guard (`grant-atomic.spec.ts:120` — a 0-minute package throws `/non-positive durationMinutes/` **before** any spend). Form action itself remains untested (no action-level harness) — the seam guard is the money-safety backstop.

*Why this can't mess anything up:* both changes are pure input rejection ahead of any state change; no legitimate flow sells a 0-minute package. Existing packages are reported, not touched (S5-adjacent caution).
*Rollback:* revert; 0 becomes purchasable again.

#### B3.5 — Un-freeze network health via read-side staleness (`packages/core/src/services/networkHealth.ts:16-52` + consumers)
*(re-anchored: write-path lines unchanged, prune-guard `names.length > 0` at `:46`. Consumers with NO staleness derivation today: admin `listNetworkHealth` `apps/admin/src/lib/server/queries.ts:313`, locator `listPublicLocations` `apps/locator/src/lib/server/locations.ts:22`. Shared `lastSampleAt` column at `packages/db/src/schema/admin.ts:106`. No fixed refresh-interval constant exists — admin refreshes on-view `networks/+page.server.ts:39`.)*
`sampleHealth` legitimately returns `[]` (no hotspot-bound interfaces), and `refreshNetworkHealth` then neither upserts nor prunes — so the Networks page and public locator show last-known state forever.

- [x] B3.5.1 Fixed on the **read side**: a shared `@veent/db` helper `isNetworkHealthStale(lastSampleAt, now)` / `NETWORK_HEALTH_STALE_MS = 3*60_000` (`packages/db/src/network-health.ts`); both `apps/admin/.../queries.ts` and `apps/locator/.../locations.ts` derive stale/offline from it. Write path (incl. the `names.length > 0` prune guard) untouched.
- [x] B3.5.2 Both consumers wired to the **one** shared helper so they can't disagree; boundary unit-tested (`networkHealthStale.spec.ts`: fresh at exactly the ceiling, stale 1ms past, never-sampled `null`/`undefined` → stale).

*Why this can't mess anything up:* zero writes change, so no data can be lost or wrongly pruned; a freeze caused by *any* reason (empty samples, router unreachable, cron dead) now degrades to visibly-stale/offline instead of confidently-wrong "Healthy". Worst case of a mis-tuned N: an AP briefly shows stale during slow sample cycles — cosmetic, tunable.
*Rollback:* revert the read-side derivation; display returns to frozen last-known.

#### B3.6 — Tag-guard the checkout walled-garden refresh (`packages/core/src/integrations/network/mikrotik.ts` — `openHostAccessForDevice`)
**✅ DONE (2026-07-03, post-merge).** The checkout-access code landed via the `dev/system-sentry` merge (`2d2b31b`). Applied the one-line `CHECKOUT_TAG` guard in `openHostAccessForDevice`'s refresh loop (`mikrotik.ts:~428`), mirroring the guard `sweepHostAccess` already has — a re-checkout now only drops its own `veent-checkout:*` rows, never an operator-added walled-garden rule for the same (host, device-IP). Bench-router leg (B3.6.2) still pending.

The finding: `openHostAccessForDevice`'s refresh loop removed walled-garden rows matching `(dst-host, src-address)` **without** checking the `CHECKOUT_TAG` comment — an operator-added rule for the same payment host scoped to that device's IP would be silently deleted on re-checkout. `sweepHostAccess` already had the guard.

- [x] B3.6.1 One line before the remove: `if (!(e.comment ?? '').startsWith(`${CHECKOUT_TAG}:`)) continue;` — mirrors the sweep's existing check.
- [ ] B3.6.2 Covered by the Phase 3 router verification pass: re-checkout still refreshes its own row (no duplicate accumulation).

*Why this can't mess anything up:* strictly narrows what gets deleted to rows this mechanism created; the add path and sweep are untouched. Worst case of the guard being too strict: a stale checkout row lingers 15 min until `sweepHostAccess` reaps it by the same tag.
*Rollback:* revert the line.

**Checkpoint 3:** full test suite + typecheck green; router verification matrix signed off on real hardware — **runbook: [`docs/mikrotik/bench-verify.md`](../mikrotik/bench-verify.md)** (B3.2 expiry/mutual-exclusion, B3.1 reconcile safety net, B3.6 walled-garden tag-guard); **human verification handoff** for the customer-facing flows (pause/resume during a simulated router outage, purchase on a DHCP-reused IP, Networks page with hotspot disabled). → pause.

---

### Phase 4 — Integration verification & rollout
- [ ] 4.1 Merge order: `dev/system-sentry` (with Phase 1) first, then rebase + merge `dev/audit-fixes`; re-run the full suite after each merge.
- [ ] 4.2 Staging soak: deploy staging, run the loadtest grant-spike (`apps/customer/loadtest/`) and a Maya sandbox payment loop; watch the new Sentry areas (`payment/attribution`, `network/unbind`, `reconcile/*`) for unexpected volume.
- [x] 4.3 Sentry alert rules **specified** in [`docs/dev/sentry-alert-rules.md`](sentry-alert-rules.md): A1 pages on the first `payment/attribution` event, A2 spike-pages money-path errors, A3 notifies on warning volume (+ `network/unbind` carve-out), A4 covers the three cron monitors' missed/failed check-ins, A5 the uncaught-crash catch-all. → **operator applies the rules in the Sentry dashboard**, then tunes thresholds after the 4.2 soak.
- [ ] 4.4 Post-deploy checks in production Sentry: confirm transaction events carry **no** MAC (raw or encoded) in spans — the A1 acceptance test against real traffic.
- [ ] 4.5 Update `docs/SECURITY_RISKS.md` / `docs/BUG_AUDIT.md` to mark findings mitigated; rename this file `*_COMPLETE` per convention.

---

## 4. How this plan ensures nothing gets messed up — summary

1. **Contract-first:** the seven invariants in §1 are acceptance criteria, not aspirations; every checkpoint re-verifies them (full test suite + the phase's targeted evidence).
2. **Checkpoint gates:** four pause points (plus the B3.2 design mini-checkpoint) — no phase starts on top of an unreviewed one, and every commit is a clean single-task revert.
3. **Minimal-diff bias:** every fix is the smallest change that removes the failure mode — guards copied from proven siblings (B1), a status-filter widening inside an already-atomic claim (B2.1), additive telemetry (B2.2), an error-unwrap (B2.3), an ordering flip to an already-established pattern (B3.1), input rejection (B3.4), read-side derivation with zero write changes (B3.5). The one genuinely behavioral redesign (B3.2) is explicitly gated on design review + hardware verification.
4. **Tests move with the code:** each task ships its regression test in the same commit, and the two tests that currently *hide* bugs (23505 fake shape; absent span-scrub coverage) are corrected alongside their fixes so they can never re-mask them.
5. **Separation of concerns:** feature-branch defects stay on the feature branch; pre-existing bugs get their own branch off a fresh `origin/main` — either can ship or revert without dragging the other.
6. **Humans verify what tests can't:** real-router matrix for the MikroTik lifecycle, browser + Sentry-dashboard passes for the PII egress — both with explicit handoff checklists at Checkpoints 1 and 3.
