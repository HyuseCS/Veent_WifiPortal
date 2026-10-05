# Plan history

This file summarizes the old plan archive of this repo. It groups the work by product area.
`process/general-plans/` and `process/features/` are frozen, read-only history. Do not edit them.
New work goes to `specs/<feature>/` (Spec Kit). Use the "Spec seeds" below as starting points.

Last source date: 2026-10-05. Hashes were checked with `git log`. Later sources win when sources disagree.

Areas:

1. Captive portal and guest login
2. Payments (Maya, GCash, wallets)
3. Walled garden and MikroTik router
4. Network health and AP visibility
5. Admin finance
6. Incident management
7. Staff governance and auth
8. OTP, SMS and test mode
9. Testing infra and repo hygiene
10. Deploy
11. Contradictions between plans

---

## 1. Captive portal and guest login

### Shipped

- Stale MAC no longer binds on grant. `resolveMacForUser` returns `{ mac, live }`. A fallback MAC (device cookie, `last_known_mac`) is not a verified binding. Commits `cab32e0`, `ca00f62`. Plan: `process/general-plans/completed/mac-trust-grant-fix_23-07-26/`.
- Dashboard shows an "unverified, reconnect" banner when only a fallback MAC matches. Same plan.
- Fallback MAC no longer overwrites `customer_profile.last_known_mac` (seed only when null). Same plan.
- Sessions bind to the physical AP, not the shared bridge row. Commit `e2361c1`. Plan: `process/general-plans/completed/ap-session-binding-circuitid-first_23-07-26/`. User verified live on 2-SSID hardware.

### Key decisions

- The `?mac=` query value is client-influenceable. Never call it server-authoritative. M-1 and L-1 are mitigated, not removed.
- Reason for the MAC fix: a wrong MAC kept matching the DB, so the UI showed "connected" while the guest was offline. A refresh could not break the loop.
- Rejected on purpose: gating explicit buy/grant actions on MAC provenance. These are user actions and keep old behavior.
- No schema change for the MAC fix (YAGNI).
- Never re-add a raw interface-name-first fallback in `resolveNetworkIdForMac`. Circuit-id must resolve first.

### Known gaps and open items

- The fallback to unverified banner to reconnect path was not live-reproduced. Proven by code and unit tests only (`mac-trust-grant-fix` plan).
- SSE stream (`api/account/stream`) and root `+page` verification still trust a connect-time MAC. Accepted known-gap in the SPEC.
- Router lease/ARP repopulation and real client MAC rotation are not fixable in the app. Accepted.
- Live 2-SSID `resolveApForMac` bridge-name shape is not reproducible in tests. User confirmed live.

### Spec seeds

- As a guest, I want the portal to tell me when it cannot verify my device, so that I do not think I am online when I am not.
  - Given a fallback-only MAC match, the dashboard shows "device not verified, reconnect".
  - Given a live MAC hit, the dashboard shows the normal connected state.
  - A fallback MAC never writes `last_known_mac`.

---

## 2. Payments (Maya, GCash, wallets)

### Shipped

- Maya hosted checkout, hand-rolled HTTP client, webhook plus reconcile cron (in the repo; not a plan topic).
- Maya browser return URL reverted to `${origin}` (`event.url.origin`). Plan: `process/general-plans/completed/maya-return-url-revert_23-07-26/`. Commit base `cab32e0`. User live-confirmed the full 1-peso GCash loop on 23-07-26.
- Maya checkout resolves the physical AP first (circuit-id first). Commit `2eeba08`. Closeout `45d3017`. Source: `process/general-plans/backlog/maya-checkout-ap-attribution-interface-not-physical_NOTE_22-07-26.md`.
- Live payment surface: GCash and Maya only. Google Pay, PayMongo and Xendit hosts removed from `PAYMENT_HOSTS`. Commit `8ae7fc7`. Plan: `process/general-plans/completed/walled-garden-wallet-onboarding-prep_30-07-26/`.
- GCash web checkout works through the `gcash-resolve` scheduler (see area 3). User confirmed live 29-07-26.
- Wallet apps verified on a captive phone: GoTyme, SeaBank, GCash native app (see area 3).

### Key decisions

- `successUrl` and `cancelUrl` must use `event.url.origin`. In production, `ORIGIN` is the walled-gardened LAN portal address. Reason: the device is still captive at redirect time and can reach walled-garden hosts only.
- `TUNNEL_ORIGIN` is for the server-to-server webhook `originUrl` only.
- Rejected: browser return via `TUNNEL_ORIGIN` (`maya-live-return-url_23-07-26`). It was a misdiagnosis. The tunnel domain is not walled-gardened, so the return fails with `ERR_CONNECTION_CLOSED`. Fully reverted.
- Rejected: Google Pay. Google blocks the captive Android WebView with error `OR_BIBED_15`. No router rule can fix it. Reachability and completion are two separate problems.
- Rejected (invalidated on live hardware 27-07-26 to 30-07-26): "conditional full internet access during checkout" (`process/general-plans/completed/conditional-checkout-access_27-07-26/`). A `0.0.0.0/0` allow makes the OS connectivity probe pass. The captive mini-browser closes where the payment runs. No code shipped. Redesign direction (not scoped): pay outside the captive session through the CNA-to-browser handoff (`/auth/handoff`).
- Card 3-D Secure is not diagnosed. Bank ACS hosts are per-deployment, capture-when-it-breaks. SPEC marks it out of scope.

### Known gaps and open items

- GH #97 "Maya checkout attributes to wrong AP on staged VM" is still OPEN. The note says RESOLVED 22-07-26 in code. Old rows keep the old attribution (no backfill). See area 11.
- Maya native app: FAILED pre-auth, even with all traffic open for the device. It works after portal login. Source: `docs/mikrotik/walled-garden.md` candidate table, commit `3425be9`. Wallet list is frozen for now.
- 7 candidates still UNVERIFIED: GrabPay, ShopeePay, Coins.ph, BDO, BPI, Landbank, Security Bank. The four banks carry a cert-pin caveat. GH #96.
- Credit/debit 3-D Secure on a captive device: not diagnosed.

### Spec seeds

- As a guest, I want to pay with a card or bank redirect, so that I can buy time without a wallet.
  - A captive guest can finish 3-D Secure, or sees a clear fallback to pay outside the captive session.
  - The device does not leave the captive state before payment success.
- As an operator, I want one verified list of supported wallets and banks, so that I know what a guest can pay with.
  - Each candidate has a recon result (VERIFIED, FAILED, UNVERIFIED) in `docs/mikrotik/walled-garden.md`.
  - A wallet is added to `PAYMENT_HOSTS` only after a live captive pass (GH #96).
- As a guest, I want to pay in a normal browser through `/auth/handoff`, so that payment methods that block the captive WebView still work.
  - Payment starts from the handoff page, not the CNA mini-browser.
  - Access is granted only after the webhook confirms payment.

---

## 3. Walled garden and MikroTik router

### Shipped

- `PAYMENT_HOSTS` as enumerated `*.domain` forms plus a collision guard. Commit `ec24ed4`. Plan: `process/general-plans/completed/payment-walled-garden-v6_29-07-26/`.
- `gcash-resolve` `/system scheduler` (5 min, `:resolve payments.gcash.com`, `gcash-auto` ip row) and Google login hosts, plus opt-in `setup:router --reconcile [--dry-run]`. Commit `bde53d2`.
- Canonical model: 3 tagged groups `veent-admin:probe`, `veent-admin:payment`, `veent-admin:portal`. Family-prefix match in `reconcileWalledGarden`. Bare `alipay.com` added. Dead `apply-probe-denies.ts` deleted. Commit `252d748`. Plan: `process/general-plans/completed/walled-garden-canonical_30-07-26/`. Staging rebuilt and user confirmed.
- `PAYMENT_HOSTS` trimmed to GCash and Maya, wallet recon protocol and candidate table written. Commit `8ae7fc7`.
- Scripted `setup:router --wipe` / `--wipe-only [--dry-run]` through `wipeWalledGarden()`. Commit `53a223b`. Fix `0913243`. Plan: `process/general-plans/completed/walled-garden-wipe_30-07-26/`. Dry-run on real RouterOS confirmed a true no-op 30-07-26.
- Both dev and deploy portal IPs always whitelisted (`PORTAL_LAN_IPS`). Commit `d392535`.
- GoTyme VERIFIED 02-10-26: `*.gotyme.com.ph` in `PAYMENT_HOSTS` plus `gotyme-resolve` scheduler (`aws-gate.licelus.com`, `gotyme-auto` row). Commits `ba8839c`, `1f14fd8`. Plan: `process/general-plans/completed/gotyme-walled-garden-recon_22-09-26/`.
- SeaBank VERIFIED (`seabank-resolve`, commit `83c73b6`). GCash native app VERIFIED (`gcash-app-resolve`, commits `cbf9650`, `9278ae6`, `dc860a2`). Source: `docs/mikrotik/walled-garden.md`, git log.
- Resolve schedulers keep the last 4 IPs per host. Commit `0ae14fc` (GH #108, closed).
- Router drops DNS on the WAN, warns about disabled code-owned rows. Commits `45d6267`, `7ca4f4a`, `26b20e0` (GH #110, #111, closed).
- Canonical reference: `docs/mikrotik/walled-garden.md`. Read it first for any walled-garden work.

### Key decisions

- Root cause of GCash failure: `payments.gcash.com` CNAMEs to Akamai. RouterOS v6 `dst-host` cannot follow a CNAME chain, so hostname rules show `hits=0`. The fix is a `:resolve` scheduler, not DNS blocking.
- Rule: a host that CNAMEs to a CDN needs a `:resolve` scheduler. A host that resolves directly needs only a `dst-host` entry.
- Rejected: whole-network DoH/DoT block (`provisionDnsEnforcement()`). Live diagnosis proved it unnecessary. Never built.
- Rejected: temporary manual IP allow as the long-term fix. Replaced by the scheduler.
- Rejected: dropping `*.googleapis.com`. It has 98 hits and is a live checkout dependency. The Android captive-icon worry was a red herring.
- `*.domain` does not match its bare parent. Add both forms when needed.
- Never add broad CDN allowlists.
- Hard reset (wipe both menus, rebuild from code) is the chosen reset method. Every surviving row must be tagged and code-owned.
- `--reconcile` is action-scoped (`action=allow` only) and tag-scoped. It never touches deny rows, `gcash-auto`, or un-tagged manual rows. Default `setup:router` stays additive.
- Old manual `*keyword*` rules can shadow new `*.domain` rules because matching is first-match top to bottom. Replace with a coverage check, not a blind delete.
- Host layer uses `action=allow`. `action=accept` is valid only on the `walled-garden ip` layer.
- RouterOS v6 quirks: no `/system scheduler run`. `find where dst-address=X` returns empty. Operate rows by print-then-index.
- Production router is out of scope for all walled-garden work so far. Staging only.
- Router services are address-restricted. Open DNS resolver on the WAN is blocked (GH #110).

### Known gaps and open items

- GH #96 (priority-1): recon of the remaining wallets and banks. Table in `docs/mikrotik/walled-garden.md`.
- `process/general-plans/backlog/gotyme-followups_NOTE_02-10-26.md` (no GH issue):
  - Stale `veent-admin:payment` CLI block in the doc. Priority 3.
  - Hard-reset note lists only `gcash-auto`, not `gotyme-auto`. Priority 3.
  - `bun run --filter radius-admin check` does not typecheck `apps/admin/scripts/`. Priority 2.
  - Licel ELB returns 3 A records but `:resolve` returns 1. Priority 2, revisitable. Commit `0ae14fc` (keep last 4 IPs) probably covers this. The note was not updated.
- `process/general-plans/backlog/gcash-walled-garden-ip-productionize_NOTE_23-07-26.md`: superseded by `gcash-resolve`. GH #92 is closed. See area 11.
- Per-AC live evidence for `walled-garden-canonical` was not logged one by one (accepted; the user confirmed "it works").
- `mdap.paas.mynt.xyz` (Akamai CNAME) was a possible follow-up. The GCash native app row now covers `mdap`.
- Credit/debit 3-D Secure not diagnosed (see area 2).
- Card 3DS and Google Pay are structurally blocked in the captive WebView.

### Spec seeds

- As an operator, I want to add a new wallet or bank by a fixed recon procedure, so that I can enable it without guessing.
  - The procedure is flush DNS cache, drive the flow on a captive phone, print the cache, classify, add, retest.
  - Each result is recorded as VERIFIED, FAILED or UNVERIFIED in the candidate table.
  - A direct host gets a `dst-host` rule. A CDN-fronted host gets a resolve scheduler.
- As an operator, I want `setup:router` code to be type-checked, so that a wrong call is caught before it reaches the router.
  - `apps/admin/scripts/` is covered by a check script or tsconfig.
  - A wrong-arity call in `setup-router.ts` fails the check.
- As an operator, I want the walled-garden doc to match the code, so that I can trust the runbook.
  - The `veent-admin:payment` CLI block is generated from `walled-garden-config.ts`.
  - The hard-reset section names every scheduler-maintained ip row.
- As an operator, I want GoTyme login to work every time, so that guests do not see Code 3103000.
  - All A records of `aws-gate.licelus.com` stay open across resolve runs.
  - If login fails, compare `walled-garden ip` rows with the DNS cache (commands in the note).

---

## 4. Network health and AP visibility

### Shipped

- Per-AP visibility Phase A. Commit `4d67e76` (plus `ba14cac`, `e5a3047`). Plan: `process/general-plans/completed/per-ap-visibility_16-07-26/`.
  - AP recognized by MAC OUI `E4:67:1E` or hostname `OAP3000G-*`. Attribution through DHCP Option 82 `agent-circuit-id`.
  - Migration `0047`: new `network_health` columns, new `network_client_attribution` table.
  - `/networks` collapses shared-ONU APs into one group card.
- AP upsert retries once on a name-key collision. Commit `0141531`. Plan: `process/general-plans/completed/ap-name-collision-retry_20-07-26/`.
- Tripwire test fails if `refreshNetworkHealth` is wrapped in `db.transaction(`. Runbook `docs/mikrotik/ap-liveness-bypass.md`. Commit `55ef235`. Plan: `process/general-plans/completed/ap-false-down-outage-guard_21-07-26/`.
- Router timeout becomes a Sentry warning, not an error (`RouterUnreachableError`). Commit `432be58`. Plan: `process/general-plans/completed/router-timeout-sentry-classify_17-07-26/`.
- Sessions bind to the physical AP (see area 1, `e2361c1`). This also fixed the outage auto-pause keying.
- Durable editable AP name, AP detail modal. Commit `dddd50f`.

### Key decisions

- Live finding (17-07-26): the hotspot `hs-unauth-to` rule rejects router ICMP to any un-bypassed AP. Every AP reads DOWN. Mitigation: add every AP MAC as `type=bypassed` in `/ip/hotspot/ip-binding`. This is the primary fix.
- Rejected: a code guard `online_since IS NOT NULL`. Those columns are current-state stamps, not history. Candidates left on record: a set-once `ever_served` column, or a bypass-state router read.
- Per-AP guest throughput is not measurable by design. Paid guests are granted with `ip-binding type=bypassed`. RouterOS skips hotspot byte accounting for them. The honest `—` column is correct and permanent.
- AP identity keys on MAC, never IP. Circuit-id identifies the ONU, not the radio. APs behind one ONU form an honest "AP group".
- Ping concurrency (4 per chunk) is safe on one node-routeros connection. Live proof 17-07-26.
- `RouterUnreachableError` is downgraded to `warning`, never dropped. No local `try/catch` around the sweeps, so the cron `withMonitor` check-in stays red on failure.
- Later plan wins: the "byte-for-byte fallback" promise in `per-ap-visibility` was deliberately revised by `ap-session-binding-circuitid-first` for the shared-bridge case.
- Multi-router: the SPEC rejected it as the current direction. Single router, many APs.

### Known gaps and open items

- G16: live down-AP negative case is an accepted prod-observation known-gap. Mitigation is the runbook.
- OLT-1 leases carry no circuit-id (Option 82 not enabled there). External network change, not app work.
- Same-circuit APs cannot be split further (accepted).
- Phase B (Suncomm "Fatap" AP API, per-client RSSI, throughput) is blocked on web-interface credentials. GH #100 and #102.
- `process/general-plans/backlog/per-ap-throughput-alt-source_NOTE_21-07-26.md` (GH #102, revisitable, parked): per-guest simple queues, OLT per-ONU stats, or Fatap API. None probed.
- `multi-router-support_13-07-26` (GH #100, revisitable): archived unexecuted in `process/general-plans/completed/multi-router-support_13-07-26/`. COMPLEX, 5 phases: DB registry of routers with encrypted creds, `getController(siteId)`, `site_id` on sessions, multi-controller cron. Blocked on Fatap credentials. Commit `72ef7e3`.
- `withTimeout()` is duplicated in `mikrotik.ts` and `adminAccess.ts`. Left as is on purpose.
- Router lease `comment` (for example `AP-Pabayo`) is not shown in the UI. Idea only.

### Spec seeds

- As an operator, I want an AP to read DOWN only when it is really down, so that the outage guard does not pause paying guests by mistake.
  - A never-served or bypass-missing AP is flagged as "unverified", not DOWN.
  - A real outage still triggers auto-pause.
  - Candidate designs: `ever_served` column, or read bypass state from the router.
- As an operator, I want per-AP guest throughput, so that I can see load per site.
  - Source is chosen by a cheap live probe (queues, OLT stats, or Fatap API).
  - The UI keeps the honest `—` when no source exists.
- As an operator, I want to manage many routers from one portal, so that I get one pane for many sites. (GH #100, only if the business needs it.)
  - A router registry stores encrypted credentials.
  - A grant goes to the router of the guest's site.
  - Admin shows the site per session and per AP.

---

## 5. Admin finance

### Shipped

- Durable per-purchase and per-grant AP attribution (circuit-id string) with admin display. Commit `0d13023`. Plan: `process/general-plans/completed/purchase-ap-attribution_21-07-26/`.
- Unified transaction history: one merged, deduped, chronological list at `/finance/transactions` (Maya payments, credit top-up, credit spend, points earn/spend, free-time grant). Commits `2242219`, `f1f5672`. CSV gets `?scope=unified|maya` (default unchanged). Plan: `process/general-plans/completed/unified-transaction-history_21-07-26/`. `listUnifiedTransactions` replaced `listRecentGrantAttribution`.
- AP name frozen at transaction time (`ap_name_snapshot`, migration `0051`). Commit `6a167cf`. Plan: `process/general-plans/completed/tx-ap-name-snapshot_22-07-26/`.
- 13 finance/session columns changed from `timestamp` to `timestamptz` (migration `0052_pink_maginty.sql`, hand-edited `USING` casts). `period.ts` now uses real Manila-day to UTC math. Commit `1aece33`. Plan: `process/general-plans/completed/finance-timestamptz-migration_23-07-26/`. Prod applied and user confirmed 30-07-26.
- Dashboard AP display name and period timezone boundary. Commit `92acc97`.

### Key decisions

- KPI and revenue functions (`financeKpis`, `revenueByAp`, `revenueByPeriod`, `paymentMethodBreakdown`) stay Maya-only and untouched by the unified list.
- Old rows are never backfilled. They show the live AP name or "Unattributed".
- AP attribution is advisory only. Never used for access, pricing or fraud.
- Root cause for the timezone bug: two storage conventions in bare `timestamp` columns. Credit, points, payment_transactions and `payment_checkouts.created_at` hold Manila wall time. The rest hold UTC wall time. Fix: explicit per-column `USING` casts.
- Writers (`sessions.ts`, `reconcilePayments.ts`) needed no change. They write a JS `Date`, which postgres.js binds correctly.
- `drizzle-kit` emits no `USING` clause. Always hand-edit.
- `bun run test` is the right fan-out. Bare `bun test` uses bun's native runner and gives false failures.
- Added `@electric-sql/pglite` as an admin test-only devDependency (user approved) for a real-SQL anti-join test.

### Known gaps and open items

- The dev live-feed browser smoke (dashboard notify after top-up) was deferred to human check.
- The prod apply has no per-step evidence record (honest gap in the report).
- The dev DB is push-managed. `db:migrate` fails on journal drift. Apply DDL directly with `psql`, but still generate the migration file.
- No open backlog items.

### Spec seeds

None. Finance has no open work.

---

## 6. Incident management

### Shipped

- Full IMS build, PR #74, commit `ccb2e02`. Two-tab filters, quick-preview modal, self-report tile, assignment-aware status, open pool, Sentry dedupe partial unique index.
- Audit remediation of 13 findings (2H/5M/6L). Commits `5a78dbe`, `dec95bc`, `9fa956a`, `73cef82`. Migration `0046_oval_lorna_dane.sql` (`note_edited` event). Plan: `process/features/incident-management/completed/ims-audit-remediation_10-07-26/`.
- Due-date, note-edit race, notification resilience fixes. Commit `8d67f7a`. Plan: `process/general-plans/completed/review-findings-remediation_10-07-26/` (19 findings; 5 judged invalid and left alone).
- Sentry permalink host pinned to `sentry.io` and regional subdomains. Commit `5c81cff`. Plan: `process/features/incident-management/completed/sentry-permalink-host-pinning_20-07-26/`.
- `?/track` verifies `sentryIssueId` with the Sentry API, fail-closed. Commit `35c3266`. Plan: `process/features/incident-management/completed/sentry-issueid-provenance_20-07-26/`.
- Manager board loads each issue timeline on row expand. Commit `be896d2`. Plan: `process/features/incident-management/completed/manager-board-lazy-events_22-07-26/`. User verified 22-07-26. `listIssueEventsByIssue` removed.
- All 12 admin e2e specs (23 tests) green. Commit `7b2dc2a`, `097383e`. Plan: `process/features/incident-management/completed/ims-e2e-spec-modernization_20-07-26/`.
- Ignored-issues tab with restore (`e8449f8`).

### Key decisions

- Provenance check reuses `fetchLatestEventRaw`. It proves "issue has at least one retrievable event", not pure existence. A false-reject is an accepted narrow gap.
- Permalink allowlist is hardcoded (`SENTRY_HOST = 'sentry.io'`) to keep `map.ts` pure. A self-hosted Sentry on another domain is rejected.
- M2 secret rotation: no action. `owner.json` and `owner-totp.txt` re-create on every e2e run against a throwaway DB. `git rm --cached` was enough. No history scrub (it would force-push shared branches for zero benefit).
- The `loginNonManager` "timeout" theory was wrong. It was a `storageState` leak.
- The `:113` "2 unread" failure was a cross-test leak, not a count bug.
- Finding: the e2e webserver inherited live Sentry credentials from `apps/admin/.env`. Fixed by blanking `SENTRY_*` in `TEST_ENV` (`c8d1049`).
- The `test-env-integration-coverage-gap` concern was closed. Admin has no Maya code path.

### Known gaps and open items

- `process/features/incident-management/backlog/manager-board-pagination_NOTE_10-07-26.md` (GH #99, priority-3, low): row pagination of `listIssues()`. No urgency at current volume.
- `process/features/incident-management/backlog/issuestable-component-test_NOTE_22-07-26.md` (low, no GH issue): `IssuesTable.svelte.test.ts` for no-refetch on re-expand (AC3) and graceful fetch-failure (AC4). Blocked on the repo having a first `.svelte.test.ts`.
- Self-hosted Sentry would need a configurable host allowlist.
- 25 pre-existing eslint errors remain (see area 9).

### Spec seeds

- As a manager, I want the incident board to page its rows, so that the board stays fast when incidents grow. (GH #99)
  - The board loads one page at a time (cursor or offset).
  - Filters and the open pool still work across pages.
- As a developer, I want a component test for the lazy timeline, so that a regression is caught without a manual pass.
  - Expand, collapse and re-expand a row issues exactly one fetch for that id.
  - A failed fetch shows "Couldn't load the history." and does not crash the row.

---

## 7. Staff governance and auth

### Shipped

- Feature folder `process/features/admin-staff-governance/` has no plans. Only `_GUIDE.md` (status "stable").
- Surface in the repo: staff accounts and roles, TOTP 2FA and step-up, invite, promote, owner-change, wipe-verification, password reset. E2E specs `invite`, `owner-change`, `promote`, `wipe`, `content-mfa`.
- Related incident-management work that touched auth paths: see area 6 (CSRF-aware e2e tamper test, notification access).

### Key decisions

- The folder was created early because this class (identity, trust boundary) needs a risk-evidence pack for any future work.
- Two `betterAuth()` instances (admin `radius-admin`, customer `veent-portal`) must never be cross-wired.

### Known gaps and open items

None recorded in the archive.

### Spec seeds

None.

---

## 8. OTP, SMS and test mode

### Shipped

- Cast (`api.cast.ph`) is the default SMS provider. Commit `cb36c9b`. Dev logging of the Cast result `97dcd62`.
- OTP delivery observability. Commit `b130e72`. Plan: `process/general-plans/completed/otp-delivery-observability_20-07-26/`.
  - Table `customer_otp_delivery_log` (migration `0048_lying_firedrake.sql`), append-only.
  - Cron `apps/customer/src/routes/api/otp/sweep-delivery/` checks Cast DLR every 5 minutes. Alerts only on `REJECTD` or `undelivered` in a 30-minute window. Rows pruned after 48 hours.
  - Unknown non-empty `SMS_PROVIDER` throws. Blank still routes to Cast.
- "Resend code" on `/auth/verify`: 45-second cooldown, shares the send budget (`enforceOtpSendLimit`).
- `TEST_MODE`: skips the SMS gateway, shows the code in a labeled banner. Commit `be527f1`. Plan: `process/general-plans/completed/otp-test-mode-toast_27-07-26/`.
- Prod boot gate: `TEST_MODE` in prod hard-fails unless `ALLOW_TEST_MODE_IN_PROD` is also set. Commits `8531041`, `9dc2ed1`. Plan: `process/general-plans/completed/test-mode-prod-optin_27-07-26/`.

### Key decisions

- Every provider writes a delivery row, but only Cast has a DLR endpoint. `itexmo`, `unisms`, `smsgate` are unobservable by design.
- The `await` on the delivery-log insert is a real fix. Without it, a rejected insert is an unhandled promise rejection on the guest login path. A test proves it (removing the `await` fails the test).
- Old judgement ("skip DLR polling") was overturned by live evidence: 3 of 3 live Cast sends were `REJECTD`, with no alert and no log.
- The 45-second cooldown was kept on purpose (decision 22-07-26).
- `TEST_MODE` guarantees "never in production", not "harmless". Any future consumer must be safe in dev.
- Later plan wins: `otp-test-mode-toast` first said unconditional prod hard-fail. The shipped design is a two-flag opt-in for staging.
- Spec file name `sweep-delivery.spec.ts` (no `+` prefix, SvelteKit reserves `+`).

### Known gaps and open items

- Root cause of Cast rejection: Cast has not activated a real sender ID. Not in our control. Parked.
- `process/general-plans/backlog/otp-delivery-unobservable_NOTE_20-07-26.md` (GH #101, revisitable, parked): alternate-channel resend, and "delivery uncertain" guest message tied to the DLR rejection signal. Note body says priority High; header says PARKED. Resend route has no route-level test.
- Cast DLR shape beyond one observed `REJECTD` shape is unproven.
- The sweep reject-alert has no atomic claim. Two overlapping runs could double-alert one row. Relies on a single external scheduler.
- `dev-cron.ts` fires the sweep every minute. Prod must run it every 5 minutes on the external scheduler.
- Real staging boot with both flags set was proven by unit test only at report time (user later confirmed on 30-07-26 per `all-context.md`).

### Spec seeds

- As a guest, I want to be told when my SMS code probably will not arrive, so that I do not wait on a code that never comes. (GH #101)
  - When the DLR shows rejection, the verify page says delivery may have failed.
  - The guest can request another channel or provider.
  - The resend budget is not bypassed.
- As an operator, I want a fallback provider when the default is known-bad, so that guests can still log in.
  - The fallback is chosen from config.
  - The switch is logged and alerted.
- As a developer, I want a route-level test for `?/resend` and `?/verify`, so that the cooldown and budget are asserted.
  - Over budget returns 429 with a retry message.

---

## 9. Testing infra and repo hygiene

### Shipped

- Prettier sweep of 308 files. `.prettierignore` fixed (`drizzle/`, generated skills catalog). Commit `41f5762`, plan commit `daa8865`. GH #98 closed. Plan: `process/features/incident-management/active/repo-wide-lint-prettier-drift_03-09-26/`.
- `.prettierrc` `tailwindStylesheet` path fixed (20-07-26).
- Customer e2e config carries a credential tripwire (`239a228`): SMS fail-closed, Maya fail-rejected (a request leaves the machine and gets 401), `MAYA_SANDBOX` pinned `'true'`.
- Admin e2e `TEST_ENV` blanks Sentry keys (`c8d1049`).
- Static tripwire spec for `db.transaction(` around `refreshNetworkHealth` (area 4).

### Key decisions

- Option 1 (one-time `prettier --write .`) chosen. Per-app fan-out rejected.
- Known ceiling: `tailwindStylesheet` points at admin `layout.css`, so customer and locator class sort order follows admin theme. Cosmetic only.
- Use `bunx vitest run <file>` from the app directory. Never `bun test <file>`. Never run specs from the repo root (`$lib` alias fails).
- `bun run check` does not cover `apps/admin/scripts/`. Use a manual `tsc --noEmit` today.

### Known gaps and open items

- 25 eslint errors remain, all pre-existing: 19 `svelte/no-navigation-without-resolve`, 3 `svelte/no-unused-props` (`customer/src/lib/DeviceList.svelte`), 2 `no-unused-vars`, 1 `svelte/no-at-html-tags` (`admin/(app)/profile/+page.svelte:262`). Source: `process/features/incident-management/active/repo-wide-lint-prettier-drift_03-09-26/*_REPORT_03-09-26.md`.
- `process/context/tests/all-tests.md` §Known Gaps: customer and locator have no e2e specs. `packages/db` has no tests. No `.svelte.test.ts` exists. No coverage tooling. No CI gate.
- No rule forces new integrations into `TEST_ENV` or the customer tripwire. Each was added after a miss.
- `apps/admin/scripts/` is not typechecked (see area 3).

### Spec seeds

- As a developer, I want a green root `bun run lint`, so that lint is a real gate.
  - The 25 eslint errors are fixed or rules are scoped with a recorded reason.
  - `eslint .` runs after `prettier --check .` and exits 0.
- As a developer, I want e2e specs for the customer portal, so that guest login and checkout are covered.
  - Payments and SMS are stubbed in the harness.
  - A customer test DB harness exists.
- As a developer, I want a check that new integrations appear in the harness env overrides, so that live credentials never leak into tests.
  - A lint or test rule compares integration modules with `TEST_ENV` and the customer tripwire.

---

## 10. Deploy

### Shipped

- `TEST_MODE` staging opt-in pair documented in `apps/customer/.env.example`, `.env.prod.example`, `compose.prod.yaml` (plan `test-mode-prod-optin_27-07-26`).
- Deploy guide consolidated into `docs/deploy/README.md` (commit `00c095c`), including `ORIGIN` must be the walled-gardened portal address and the staging env notes (`bab287a`).

### Key decisions

- `ORIGIN` for `apps/customer` must be guest-reachable and walled-gardened. Never `localhost`, never the tunnel.

### Known gaps and open items

- No CI workflow in the plan archive era. The git log shows later containerization and CI commits (`abb868a`, `2da4ab3`). This file does not cover them.

### Spec seeds

None.

---

## 11. Contradictions between plans

Later source wins in each case.

- GH #97 is OPEN, but the note and code say RESOLVED 22-07-26 (`2eeba08`, `45d3017`). Action: close the issue or re-scope it.
- `process/general-plans/backlog/gcash-walled-garden-ip-productionize_NOTE_23-07-26.md` still lists IP-allow options. The `gcash-resolve` scheduler superseded it. GH #92 is closed. The note is stale.
- `maya-live-return-url_23-07-26` (browser return via `TUNNEL_ORIGIN`) is superseded by `maya-return-url-revert_23-07-26`.
- `conditional-checkout-access_27-07-26` PLAN and SPEC still carry EXECUTE steps. Both are marked INVALIDATED / NOT-PLANNED. Do not follow them.
- `payment-walled-garden-v6` PLAN designed a DoH/DoT block. Its own REPORT proved it unnecessary.
- `per-ap-visibility` promised a "byte-for-byte fallback" in `resolveNetworkIdForMac`. `ap-session-binding-circuitid-first` deliberately revised it for shared bridges.
- `per-ap-visibility` SPEC rejected multi-router as the direction. `multi-router-support` was archived as "deferred, revisitable" (GH #100), not rejected.
- Several backlog notes point to notes that no longer exist: `otp-cast-default-while-undeliverable_NOTE_20-07-26.md`, `customer-locator-e2e-harness-integration-gaps_NOTE_20-07-26.md`, `ap-outage-false-down-code-safeguard_NOTE_21-07-26.md`, `per-ap-traffic-counter-reprobe_NOTE_16-07-26.md`. They were deleted in git (`9ef41f1`, `638f685`, `f1f5672`, `9bb2cb9`). Their findings live in the reports and `process/context/`.
- `process/context/tests/all-tests.md` still says root lint fails on 297 prettier files. The sweep (`41f5762`) fixed that. Only eslint errors remain.
- `repo-wide-lint-prettier-drift_NOTE_10-07-26.md` says GH #98 residual is open (25 eslint errors). GH #98 is closed.
- `gotyme-followups_NOTE_02-10-26.md` item 4 (1 of 3 IPs) was probably fixed by `0ae14fc` (GH #108). The note was not updated.
- `otp-test-mode-toast` PLAN first stated "Ready for VALIDATE" and an unconditional prod hard-fail. Shipped design is the two-flag opt-in.
- `finance-timestamptz-migration` REPORT header says prod pending. Its closeout section says prod applied 30-07-26.
- `manager-board-lazy-events` REPORT header says G8 deferred. Its TL;DR says user verified 22-07-26.
- `ims-audit-remediation` first said the leaked secret "should be rotated". The M2 note resolved it as no action.

---

## Backlog index

| Item                                                         | Area                | Source note path                                                                                                                       | GH issue                 | Priority             |
| ------------------------------------------------------------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------- |
| E-wallet/QRPH captive whitelist recon (remaining candidates) | Walled garden       | `docs/mikrotik/walled-garden.md` (candidate table; no note)                                                                            | #96 open                 | priority-1           |
| Maya checkout AP attribution (code resolved)                 | Payments            | `process/general-plans/backlog/maya-checkout-ap-attribution-interface-not-physical_NOTE_22-07-26.md`                                   | #97 open                 | priority-2           |
| IMS manager-board row pagination                             | Incident management | `process/features/incident-management/backlog/manager-board-pagination_NOTE_10-07-26.md`                                               | #99 open                 | priority-3           |
| Multi-router support (Fatap Phase B)                         | Network health      | `process/general-plans/completed/multi-router-support_13-07-26/multi-router-support_PLAN_13-07-26.md`                                  | #100 open                | revisitable          |
| OTP alternate-channel resend, delivery-uncertain UX          | OTP/SMS             | `process/general-plans/backlog/otp-delivery-unobservable_NOTE_20-07-26.md`                                                             | #101 open                | revisitable (parked) |
| Per-AP guest throughput, alternative source                  | Network health      | `process/general-plans/backlog/per-ap-throughput-alt-source_NOTE_21-07-26.md`                                                          | #102 open                | revisitable (parked) |
| Repo-wide lint and prettier drift (25 eslint errors left)    | Testing infra       | `process/features/incident-management/backlog/repo-wide-lint-prettier-drift_NOTE_10-07-26.md`                                          | #98 closed               | priority-3           |
| GCash/Maya hostname rules do not match HTTPS (superseded)    | Walled garden       | `process/general-plans/backlog/gcash-walled-garden-ip-productionize_NOTE_23-07-26.md`                                                  | #92 closed               | none                 |
| GoTyme: stale doc CLI block                                  | Walled garden       | `process/general-plans/backlog/gotyme-followups_NOTE_02-10-26.md` item 1                                                               | none                     | 3                    |
| GoTyme: hard-reset note misses `gotyme-auto`                 | Walled garden       | same note, item 2                                                                                                                      | none                     | 3                    |
| Typecheck `apps/admin/scripts/`                              | Testing infra       | same note, item 3                                                                                                                      | none                     | 2                    |
| GoTyme: Licel ELB 1 of 3 IPs                                 | Walled garden       | same note, item 4                                                                                                                      | #108 closed (likely fix) | 2, revisitable       |
| IssuesTable component test (AC3, AC4)                        | Incident management | `process/features/incident-management/backlog/issuestable-component-test_NOTE_22-07-26.md`                                             | none                     | low                  |
| Resolve schedulers kept 1 IP per host                        | Walled garden       | none (git `0ae14fc`)                                                                                                                   | #108 closed              | priority-2           |
| Block open DNS resolver on WAN                               | Walled garden       | none (git `45d6267`)                                                                                                                   | #110 closed              | priority-1           |
| Warn about disabled code-owned router rows                   | Walled garden       | none (git `7ca4f4a`)                                                                                                                   | #111 closed              | priority-2           |
| Pay outside the captive session (`/auth/handoff` redesign)   | Payments            | `process/general-plans/completed/conditional-checkout-access_27-07-26/conditional-checkout-access_PLAN_27-07-26.md` (direction only)   | none                     | not scoped           |
| AP false-DOWN code safeguard                                 | Network health      | design in `process/general-plans/completed/ap-false-down-outage-guard_21-07-26/ap-false-down-outage-guard_REPORT_21-07-26.md`          | none                     | deferred             |
| Customer/locator e2e specs, harness stubs                    | Testing infra       | `process/context/tests/all-tests.md` §Known Gaps                                                                                       | none                     | none                 |
| Integration-to-`TEST_ENV` enforcement rule                   | Testing infra       | `process/context/tests/all-tests.md` §Known Gaps                                                                                       | none                     | none                 |
| Self-hosted Sentry host allowlist                            | Incident management | `process/features/incident-management/completed/sentry-permalink-host-pinning_20-07-26/sentry-permalink-host-pinning_NOTE_10-07-26.md` | none                     | none                 |
