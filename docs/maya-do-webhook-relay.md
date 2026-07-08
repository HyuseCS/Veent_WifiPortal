# Maya → Veent DO → Local webhook relay

**Status:** implemented (local side). The DO forwarder (`receive.js`) is maintained separately.
**Related code:**
`apps/customer/src/lib/server/paymentWebhook.ts` (shared handler),
`apps/customer/src/routes/api/webhooks/maya/payment-status/+server.ts` (DO-relay route),
`apps/customer/src/routes/api/webhooks/payment/+server.ts` (direct/dev route),
`packages/core/src/integrations/payments/maya.ts` (`createCheckout` → `metadata.originUrl`),
`packages/core/src/integrations/payments/types.ts` (`CreateCheckoutInput.originUrl`),
`apps/customer/src/routes/top-up/+page.server.ts` (passes `originUrl: origin`),
`apps/customer/scripts/maya-webhooks.ts` (registration CLI),
`apps/customer/src/routes/api/payments/reconcile/+server.ts` (safety-net poll).

---

## 1. Problem

The Maya integration originally assumed Maya could reach the **local portal directly** at its public
`ORIGIN`. That fails in production: the local server sits at the hotspot site **behind NAT with no
stable public inbound**, and a **single shared Veent Maya account** serves many such sites — so Maya
can register only **one** webhook URL for all of them. Maya can only deliver to a Veent-owned public
box (the **DO**), which must fan the event back out to the correct NAT'd site.

## 2. Solution — route by `metadata.originUrl`

Each checkout carries **this site's origin** in Maya's `metadata`. Maya echoes metadata on the
event; the DO reads `metadata.originUrl` and forwards the event **verbatim** to
`${originUrl}/api/webhooks/maya/payment-status`. Routing info travels with each transaction, so:

- No per-site registration or static map on the DO.
- ngrok URL rotation self-heals — the next checkout carries the current origin.
- Cross-site safety is automatic: the local handler ignores any `referenceId` not in **its own** DB
  (recorded "unattributed", never credited).

### Decisions locked in

1. **Tunnel:** DO → local over the site's **ngrok** tunnel (local keeps a persistent outbound tunnel).
2. **Credentials:** the **local server keeps the Maya creds** (shared Veent account). It creates
   checkouts and polls Maya directly; the DO holds **no** Maya keys.
3. **DO role:** **dumb forwarder** — reads `metadata.originUrl`, re-POSTs the payload, no auth added.
   It IP-allowlists Maya on its **own** inbound (`WEBHOOK_ALLOWED_IP_ADDRESSES`) only.
4. **Field:** `metadata.originUrl` = **bare origin** (no path); the DO appends the webhook path.
5. **Local path:** the DO's fixed forward target is **`/api/webhooks/maya/payment-status`**.

---

## 3. Architecture

```
Maya  ──webhook──▶  Veent DO  (single registered webhook URL for the shared account)
                     │  IP-allowlists Maya on inbound; reads payload.metadata.originUrl
                     │  re-POSTs payload as JSON to ${originUrl}/api/webhooks/maya/payment-status
                     ▼
               site ngrok tunnel  ──▶  local  POST /api/webhooks/maya/payment-status
                     │
                     ▼  handlePaymentWebhook → verifyWebhook re-fetches the payment from Maya
                        with the SECRET key (unchanged) → recordPaymentTransaction +
                        creditCheckoutIfUnsettled (idempotent on the gateway txn id)
```

Checkout creation, Maya status polling, the on-return reconcile on `/top-up/processing`, and the
cron reconcile (`/api/payments/reconcile`) are unchanged — all **outbound** from the local server.

### Why the money path didn't change

`verifyWebhook` never trusts the webhook body: on every event it re-fetches
`GET /payments/v1/payments/{id}` from Maya with the secret key and trusts THAT. A relayed (or
spoofed) body can't fabricate a paid payment. So the DO delivering the event — and adding its own
harmless `__ow_*` keys to the JSON — changes nothing downstream. The two routes
(`/api/webhooks/payment` for direct/dev, `/api/webhooks/maya/payment-status` for the DO relay)
delegate to the same `handlePaymentWebhook`.

---

## 4. What changed on the local side

1. **`CreateCheckoutInput.originUrl`** (types.ts) — optional bare origin.
2. **`createCheckout`** (maya.ts) — emits `metadata: { originUrl }` when present; omitted otherwise
   (never sends `null`), so direct/non-relay deployments are unaffected.
3. **top-up action** — two separate origins:
   - **`originUrl`** (webhook routing, in metadata) = **`TUNNEL_ORIGIN`** always (the public tunnel
     the DO forwards to). Blank when unset — no LAN fallback, so a misconfigured NAT'd site fails
     loudly at Maya / the DO instead of shipping an unreachable URL.
   - **Buyer redirect URLs** (`successUrl`/`cancelUrl`) = **always** the origin the buyer
     **started on** (`event.url.origin`), so the return lands back on the same site they're
     browsing — the LAN captive portal, localhost, or a public domain. It is **never** swapped to
     `TUNNEL_ORIGIN` (that is the server-to-server relay origin only); swapping the browser return to
     the tunnel would strand the buyer on the wrong site (commit `5cf15ae`).
   `ORIGIN` stays the LAN address guests browse on.
4. **New route** `/api/webhooks/maya/payment-status` — the DO's forward target. Thin wrapper over
   the shared handler; the existing `/api/webhooks/payment` stays as a direct/dev alias.

### Registration

Register the **DO function's** URL as Maya's webhook (once, for the shared account) — this is the
single URL Maya notifies. `maya-webhooks.ts register <url>` uses a full URL verbatim (it only
appends `/api/webhooks/payment` when you pass a bare origin, which you do **not** for the DO).
For local direct testing you can still register a site's own ngrok URL to hit `/api/webhooks/payment`.

---

## 5. Client-IP / rate-limit note (why spec's XFF plan was dropped)

The DO issues a fresh `fetch` to the local endpoint with only `Content-Type` — it does **not**
preserve Maya's source IP, and behind ngrok the local server sees the tunnel peer (localhost). So
there is no true source IP to key the rate limiter on or to log for fraud review — an inherent
limit of this DO design, not something the local side can recover. Consequences:

- The 120/min cap on the webhook (`handlePaymentWebhook`) becomes a **single global bound** for the
  endpoint. That is fine for one site (120 events/min ≫ real payment volume) and still bounds
  re-fetch amplification if the ngrok endpoint is hit directly.
- `ipFp` in the UNATTRIBUTED/paid logs reflects the tunnel peer, not the payer. `referenceId`,
  `buyerEmailFp`, and the masked fund source remain the useful fraud-review signals.

No `ADDRESS_HEADER`/`XFF_DEPTH` trust config is set — trusting `X-Forwarded-For` from a localhost
peer would be meaningless and spoofable.

---

## 6. Threat model & controls

| Threat | Control |
| --- | --- |
| Spoofed webhook / forged payment id | Maya re-fetch with the secret key (`verifyWebhook`) — a forged body can't produce a real paid payment under our account. Unchanged. |
| Open relay via the ngrok endpoint | The DO adds no auth, so the endpoint is reachable directly. Protection: the re-fetch gate (blocks fake credits) + the global rate cap (bounds amplification). **Optional hardening (deferred):** a shared-secret header DO→local, rejected before the re-fetch. Not implemented — the DO currently forwards nothing extra. |
| Cross-site leakage (shared account) | Local credits only `referenceId`s in its own DB; foreign events are recorded unattributed, never credited. |
| Maya → DO abuse | DO IP-allowlists Maya (`WEBHOOK_ALLOWED_IP_ADDRESSES`) on its own inbound. |
| PII in logs | Buyer email / user id / IP are HMAC-fingerprinted (`fingerprint()`) before logging. |
| ngrok/DO down (even indefinitely) | Not a correctness risk: the on-return reconcile (`/top-up/processing`) and cron reconcile (`/api/payments/reconcile`) credit by polling Maya directly. The relay affects **latency**, not correctness. **Reconcile resolves the payment by OUR reference** — `getPaymentByReference` calls `GET /payments/v1/payment-rrns/{rrn}` (rrn = our `referenceId`), returning the authoritative payment (status + amount + id). This needs **neither the webhook nor the checkout's payment-id field**, so a missed webhook credits even if the tunnel never recovers. (`getCheckoutStatus` — read the checkout, hope it exposes a payment id — was unreliable: Maya's checkout resource doesn't dependably surface the payment id/paid amount, so reconcile stayed stuck `pending`. Replaced by the RRN lookup.) |

---

## 7. Verification

Automated (done): `apps/customer/src/lib/server/maya-webhook.spec.ts` +
`record-payment.spec.ts` (17 tests) pass; `svelte-check` clean. A throwaway spec confirmed
`createCheckout` emits `metadata.originUrl` (bare origin) and omits `metadata` when absent.

End-to-end (to run against sandbox + the real DO):
1. **Direct (baseline):** register a site's ngrok URL with Maya, sandbox top-up → credit lands via
   `/api/webhooks/payment` (`[webhook] paid`).
2. **Through the DO:** set `TUNNEL_ORIGIN` to the site's ngrok URL and register the DO URL with Maya;
   the checkout's `metadata.originUrl` becomes that tunnel origin. Sandbox top-up → DO forwards to
   `/api/webhooks/maya/payment-status` → same credit path, `[webhook] paid` on the local server.
3. **Tunnel-down fallback:** kill ngrok, pay, confirm the on-return + cron reconcile still credit.
4. **Failure / expiry:** trigger `PAYMENT_FAILED` → recorded (not credited), processing page stops.

---

## 8. Deferred / open

- **DO→local shared secret** (§6) — add if open-relay exposure becomes a concern.
- **Maya metadata echo** — this relies on Maya echoing checkout `metadata` on the event so the DO
  sees `originUrl`. Confirmed by the DO design; re-verify against sandbox if routing ever 400s
  ("Missing originUrl") in the DO logs.
