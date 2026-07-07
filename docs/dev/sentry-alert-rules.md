# Sentry alert-rules spec (Phase 4.3 / B2.2.2)

The code emits a fixed taxonomy of telemetry; this is the spec for the Sentry-side **alert rules** the
dashboard operator configures on top of it. Thresholds are starting points — tune against real volume
after the first staging soak (4.2).

> **When to apply — this is a deploy-time task, not a dev task.** The rules act on live telemetry, so
> there's nothing to do (or tune) in local dev: `PUBLIC_SENTRY_DSN` is empty there → no events, and the
> cron monitors only materialize at prod cadence. Do it on **staging first** to tune, then replicate to
> prod. Set at least **A1** (money) and **A4** (cron missed) — both threshold-independent — as part of
> the **go-live checklist** so the risky initial prod window isn't unmonitored; **A2/A3** go in with the
> defaults below and get retuned after the soak.

Two discriminators the rules lean on:
- **`handled:true`** — every `captureHandled(...)` event carries this tag (graceful degradation the app
  recovered from). Uncaught crashes do **not**, so `!handled` isolates real crashes.
- **`area` / `scope` / `level`** — `captureHandled` stamps `tags.area` + `tags.scope`; default level is
  `warning`, money-path errors pass `level: 'error'`.

## Capture taxonomy (what the code emits)

| area · scope | level | meaning | source |
|---|---|---|---|
| `payment` · `attribution` | error | **unattributed PAID event** — buyer charged, not credited (needs manual refund/credit) | `lib/server/paymentWebhook.ts` |
| `payment` · `webhook` | error | webhook verify failed — spoofed/garbled event OR gateway lookup outage | `lib/server/paymentWebhook.ts` |
| `payment` · `createCheckout` | error | checkout creation failed — a purchase was blocked | `top-up/+page.server.ts` |
| `payment` · `attribution-miss` | warning | AP unresolved — payment unattributed by location (funnel-data gap, not money loss) | `network-location.ts` |
| `payment` · `buyer-persist` | warning | best-effort buyer-details write failed (Maya Kount) | `top-up/+page.server.ts` |
| `payment` · `pending-write` | warning | best-effort pending-checkout write failed | `top-up/+page.server.ts` |
| `reconcile` · `cron` | error | reconcile cron pass errored (the safety net is failing) | `reconcilePayments.ts` |
| `reconcile` · `on-return` | error | reconcile-on-return errored | `reconcilePayments.ts` |
| `network` · `unbind` | warning | stranded unbind — self-heals via reconcile next pass (B3.1) | `sessions.ts` |
| `network` · `ip-mac-lookup` | warning | IP→MAC lookup failed (router blip) | `network-location.ts` |
| `network` · `mac-persist` | warning | MAC persist failed | `network-location.ts` |
| `network` · `checkout-access` | warning | opening the checkout walled-garden failed | `top-up/+page.server.ts` |
| _(no area)_ · `<scope>` | warning | any error routed through the app `logger.error` | `logger.ts` (admin + customer) |

**Cron monitors** (auto-created by `Sentry.withMonitor`, all `* * * * *`, `checkinMargin: 5`):

| monitor | criticality if it stops |
|---|---|
| `customer-network-revoke` | **critical** — access never expires → free internet + revenue leak |
| `customer-payments-reconcile` | **critical** — payments not reconciled → uncredited money |
| `admin-network-health-refresh` | low — health display goes stale (B3.5 surfaces a "Stale" chip, so degraded-not-broken) |

---

## Alert rules

### A1 — PAGE immediately: unattributed paid event (count = 1)
- **Type:** Issue alert. **Query:** `handled:true area:payment scope:attribution level:error`
- **Condition:** *any* matching event → notify. **Not** volume-based — a single event means one real buyer
  was charged and not credited.
- **Action / urgency:** page on-call (PagerDuty/Opsgenie/phone). This is the money-loss alarm; the webhook
  200-ack is deliberate, so a human doing a manual refund/credit is the remediation.

### A2 — PAGE on spike: money-path errors
- **Type:** Issue alert (or metric). **Query:** `handled:true level:error area:[payment, reconcile] !scope:attribution`
- **Condition:** ≥ **5 events in 5 min** → page (gateway down / systemic). A single transient (one garbled
  request, one gateway hiccup) is expected noise.
- **Also:** ≥ **1 in 60 min** → Slack notify (so a slow trickle is still seen, without paging).
- Covers `payment/webhook`, `payment/createCheckout`, `reconcile/cron`, `reconcile/on-return`.

### A3 — NOTIFY on volume: handled warnings
- **Type:** Metric alert. **Query:** `handled:true level:warning`
- **Condition:** ≥ **25 events in 10 min** → Slack. **No paging** — these are self-healing or non-money
  (router blips, best-effort writes, attribution-miss).
- **Carve-out (recommended):** a dedicated Slack rule for `handled:true area:network scope:unbind` at
  ≥ **10 in 10 min** — a spike here means router revokes are failing, i.e. devices keeping access they
  shouldn't (a revenue/security leak, even though each one self-heals).

### A4 — Cron missed / failed check-in
Configure on each monitor (Alerts tab of the Cron Monitor). Fires when a check-in is **missed** (scheduler
dead — invisible to error tracking) or **errors**.
- `customer-network-revoke` → **PAGE** on missed OR failed.
- `customer-payments-reconcile` → **PAGE** on missed OR failed.
- `admin-network-health-refresh` → **Slack notify** on missed (low urgency).

### A5 — Uncaught crashes
- **Type:** Issue alert. **Query:** `!handled` (everything NOT a graceful capture — real unhandled errors).
- **Condition:** a **new issue** is created → Slack notify; an issue seen ≥ **10 times in 1 min** → page.

---

## Implementation checklist (dashboard operator)
- [ ] A1 issue alert → on-call. (Highest priority — money.)
- [ ] A2 issue alert (5-in-5 page + 1-in-60 notify).
- [ ] A3 metric alert (25-in-10 notify) + the `network/unbind` carve-out.
- [ ] A4 on all three cron monitors (page the two customer ones, notify the admin one).
- [ ] A5 uncaught-crash alert.
- [ ] After the 4.2 staging soak, revisit every threshold against observed baseline volume.

## Notes
- All handled captures run through `scrubEvent` on send (MAC/phone/email masking, incl. spans) — alert
  bodies are safe to route to Slack/email.
- Constant failures collapse into ONE Sentry Issue with a rising count (grouping, no throttle), so
  "issue seen N times in M minutes" is the right lever for handled areas.
- Thresholds assume a single-tenant PH deployment; scale A2/A3 counts up if volume grows.

---

## Implementation steps (Sentry UI)

> UI labels drift between Sentry versions; the flow is stable. Metric alerts (count-over-window) fit
> A1–A3; an Issue alert fits A5; Crons has its own per-monitor alert config for A4.

### 0. Prerequisites
1. **Project layout.** Each app reads its own `PUBLIC_SENTRY_DSN`. If all point at ONE project, every
   rule lives there. If separate projects, place each rule where its events originate:
   - **customer** project: A1, A2, A3 (+ carve-out), the two `customer-*` cron monitors (A4), A5.
   - **admin** project: `admin-network-health-refresh` monitor (A4), A5 (admin crashes).
   - locator: A5 only (it emits no audit captures).
2. **Notification integrations** (Settings → Integrations): connect **Slack** (authorize the target
   channel) and your pager (**PagerDuty**/**Opsgenie**, or use an SMS/phone action). Note the channel
   name(s) — you'll pick them as alert actions.
3. **Confirm the cron monitors exist.** They auto-create on first check-in, so make sure the crons have
   run at least once (Crons page lists `customer-network-revoke`, `customer-payments-reconcile`,
   `admin-network-health-refresh`).

### A1 — page on any unattributed-paid event
1. **Alerts → Create Alert → Metric** ("Number of Errors") → pick the **customer** project.
2. **Filter (query):** `handled:true area:payment scope:attribution level:error`
3. **Metric** `count()`, **threshold type** "is above", **window** 1 minute.
4. **Critical** trigger: value **≥ 1** → **Action:** notify on-call (PagerDuty/Opsgenie action, or SMS).
5. Name it `PAGE — unattributed paid event`. Save.

### A2 — money-path error spike (two rules: page + notify)
Query for both: `handled:true level:error !scope:attribution` (this is exactly webhook + createCheckout
+ reconcile/cron + reconcile/on-return).
- **A2-page:** Metric alert, window **5 min**, Critical **≥ 5** → page. Name `PAGE — money-path error spike`.
- **A2-notify:** Metric alert, window **60 min**, Warning **≥ 1** → Slack. Name `NOTIFY — money-path error trickle`.

### A3 — warning volume (notify) + unbind carve-out
- **A3-main:** Metric alert, query `handled:true level:warning`, window **10 min**, ≥ **25** → Slack.
- **A3-unbind:** Metric alert, query `handled:true area:network scope:unbind`, window **10 min**,
  ≥ **10** → Slack. Name `NOTIFY — router revokes failing`.

### A4 — cron missed/failed check-ins
For each monitor: **Crons → click the monitor → Alerts/settings → notify on _failed_ AND _missed_**.
- `customer-network-revoke` → on-call (page).
- `customer-payments-reconcile` → on-call (page).
- `admin-network-health-refresh` → Slack (low urgency).
(`checkinMargin` is already 5 min in code — a check-in >5 min late counts as missed.)

### A5 — uncaught crashes (two rules)
1. **Alerts → Create Alert → Issues** → project.
2. **Filter:** "The event's tags match" → `handled` **is not equal to** `true` (isolates non-handled crashes).
3. **A5-new:** condition "A new issue is created" → Slack. Name `NOTIFY — new crash`.
4. **A5-storm:** condition "An issue is seen more than **10** times in **1 minute**" → page. Name
   `PAGE — crash storm`.
(Repeat per project if you run separate admin/customer/locator projects.)

### Verify
Fire one test event per tier in staging and confirm delivery + routing — e.g. replay/force an
`area:payment scope:attribution` capture and confirm A1 pages; stop the revoke cron for >5 min and
confirm A4 fires "missed". Then run the **4.2 soak** and retune every threshold against real volume.
