# Maya → Veent DO → Local webhook relay

**Status:** spec, to implement.
**Owner:** —
**Related code:** `apps/customer/src/routes/api/webhooks/payment/+server.ts`,
`apps/customer/scripts/maya-webhooks.ts`,
`packages/core/src/integrations/payments/maya.ts`,
`apps/customer/src/routes/top-up/+page.server.ts`,
`apps/customer/src/routes/api/payments/reconcile/+server.ts`.

---

## 1. Overview & problem

Today the Maya integration assumes Maya can reach the **local portal directly** at its public
`ORIGIN` (ngrok in dev, Caddy/nginx TLS in prod). The webhook lands on
`POST /api/webhooks/payment`, and the registration CLI (`maya-webhooks.ts`) points Maya at whatever
origin you pass it.

That assumption fails in production: the local server sits at the hotspot site **behind NAT with no
stable public inbound**. Maya can only deliver server-to-server webhooks to a **Veent-owned public
box (the "DO")**. The DO must relay the outcome down to the local server. Closing that gap is the
purpose of this change.

### Decisions locked in

1. **Tunnel:** DO → local uses **ngrok** — the local server keeps a persistent outbound ngrok
   tunnel that gives the DO a public HTTPS URL to POST to.
2. **Credentials:** the **local server keeps the Maya merchant credentials.** It still creates
   checkouts and polls Maya's status directly (outbound HTTPS already works). The DO holds **no**
   Maya keys.
3. **DO role:** **dumb forwarder.** No payload modification, no added auth — it re-POSTs Maya's
   request verbatim (raw body + headers) to the local webhook endpoint via the ngrok URL.
4. **Path:** the same path the local app already exposes — `/api/webhooks/payment`.
5. **Outcomes relayed:** the same set Maya sends and the app registers today —
   `PAYMENT_SUCCESS`, `PAYMENT_FAILED`, `PAYMENT_EXPIRED`.

---

## 2. Key insight — why the money path barely changes

`verifyWebhook` (`packages/core/src/integrations/payments/maya.ts`) **does not trust the webhook
body.** On every event it re-fetches `GET /payments/v1/payments/{id}` from Maya with the secret key
and trusts THAT status. A relayed — or even spoofed — body therefore can't fabricate a paid
payment; the re-fetch is the real gate.

Because the DO forwards verbatim and the local server keeps the Maya credentials, the existing
`POST /api/webhooks/payment` handler, `verifyWebhook`, and the crediting path
(`recordPaymentTransaction` + `creditCheckoutIfUnsettled`) all work **untouched**.

What actually changes is **who Maya calls and how it's registered**, plus two operational sharp
edges created by all traffic now arriving through one relay hop (see §5).

---

## 3. Architecture

```
Maya  ──webhook──▶  Veent DO (public HTTPS, stable URL registered with Maya)
                        │  forward verbatim: POST, raw body byte-for-byte, headers preserved.
                        │  no auth added, no transform. append/preserve X-Forwarded-For.
                        ▼
                  local ngrok tunnel  ──▶  local  POST /api/webhooks/payment
                        │
                        ▼  verifyWebhook re-fetches the payment from Maya with the SECRET key
                  recordPaymentTransaction + creditCheckoutIfUnsettled   (all unchanged)
```

Checkout creation, Maya status polling, the on-return reconcile on `/top-up/processing`, and the
cron reconcile safety net (`/api/payments/reconcile`) all stay as-is — they run **outbound** from
the local server and never needed inbound reachability.

---

## 4. Registration change

Register the **DO's** public URL with Maya instead of the local ngrok URL.

`maya-webhooks.ts` already appends `/api/webhooks/payment` to a bare origin and rejects non-`https`,
so the value you pass simply becomes the DO endpoint:

```
bun run maya:webhooks register https://<veent-do-host>
```

Document, alongside this, the DO's inbound path and the **local ngrok URL it forwards to**.

---

## 5. Local-side changes required (small)

The handler logic is unchanged; these are the operational adjustments the relay hop forces.

- **Rate-limit keying.** `+server.ts` caps 120/min **per client IP**
  (`rateLimit('payment_webhook_ip', clientIp(event), 120, 60_000)`). Behind DO+ngrok every webhook
  shares one egress IP, turning a per-source cap into a **per-site global cap** that a busy site
  could hit and drop legit events. Fix: key the limiter on the **true** source (`X-Forwarded-For`,
  resolved by `clientIp`) once forwarding preserves it, and/or raise the ceiling. Pick one and
  document it.
- **Client-IP resolution.** `clientIp(event)` and the fraud `ipFp` fingerprint must resolve the real
  origin **through the forwarded headers**, not the ngrok/DO hop. Verify the SvelteKit adapter is
  configured to trust `X-Forwarded-For` (adapter `xff` / trust-proxy setting). Without this the
  UNATTRIBUTED-event and `paid` log lines record the tunnel IP, which is useless for fraud review.
- **Do not refactor the money path.** `verifyWebhook`, attribution, `recordPaymentTransaction`, and
  `creditCheckoutIfUnsettled` stay exactly as they are. Called out explicitly so nobody "tidies"
  the credit logic while wiring the relay.

---

## 6. Redirect / return path (browser)

The browser `successUrl` / `cancelUrl` are built from `event.url.origin` in
`apps/customer/src/routes/top-up/+page.server.ts`. After paying, the buyer's **browser** must still
land on the **local** `/top-up/processing`.

This path is **independent of the DO** — the DO only relays the server-to-server webhook, not
browser redirects. Document how `ORIGIN` is set so the return URL is reachable by the buyer's
device (it is on the hotspot LAN and/or reaches the local server via its own ngrok URL). Maya
requires an `https` public redirect URL, so a bare LAN IP won't do.

---

## 7. Threat model & security controls

| Threat | Control |
| --- | --- |
| Spoofed webhook / forged payment id | Maya re-fetch with the secret key (`verifyWebhook`) — a forged body can't produce a real paid payment under our account. **Existing, unchanged.** |
| Open-relay abuse through the tunnel | The DO adds no auth, so anything that reaches the tunnel can POST the endpoint. Safety rests on (a) the re-fetch gate above and (b) the rate limiter (§5). **Optional hardening:** a shared secret header between DO and local, rejected early before the Maya round-trip. User said "nothing" for now — flagged as a decision, not a requirement. |
| Rate-limit collapse to one IP | Fixed by XFF-based keying / raised ceiling (§5). |
| PII in logs | Unchanged — buyer email, user id, and IP are HMAC-fingerprinted via `fingerprint()` before logging. |
| ngrok tunnel down | Not a correctness risk: the on-return reconcile (`/top-up/processing`) and the cron reconcile (`/api/payments/reconcile`) already self-heal missed webhooks by polling Maya directly. The relay affects **latency**, not correctness. Document this as the fallback. |

---

## 8. Open questions to resolve before/while implementing

- **Multi-site routing.** "Forward only, no payload modification" implies **one DO endpoint per
  site** (or a DO configured with each site's ngrok URL). If one Veent Maya account serves many
  sites, Maya registers only ONE webhook URL — so how does the DO know which site's tunnel to
  forward to without reading the body? Needs a routing rule: a per-site DO path, or the DO reading
  `referenceId` to route. Decide the model before coding the DO.
- **ngrok URL stability.** Free-tier ngrok URLs rotate. Who/what updates the DO's forward target
  when the local tunnel URL changes? (Reserved ngrok domain, ngrok API lookup, or config reload.)
- **Optional DO↔local shared secret** — see §7. Add now or defer?

---

## 9. Verification (end-to-end)

1. **Baseline (direct):** `bun run maya:webhooks register <local-ngrok-url>`, run a sandbox top-up,
   confirm credit lands via the webhook (`[webhook] paid` log). Proves the handler still works.
2. **Through the DO:** point Maya at the DO URL; DO forwards to the local ngrok URL. Run a sandbox
   top-up; confirm the same credit path fires and `[webhook] paid` logs on the local server.
3. **Client-IP check:** confirm the rate-limit key and `ipFp` reflect the real source, not the
   ngrok/DO hop (inspect the `paid` / UNATTRIBUTED log lines and the limiter bucket).
4. **Tunnel-down fallback:** kill the ngrok tunnel, pay, confirm the on-return reconcile on
   `/top-up/processing` and the cron `/api/payments/reconcile` still credit by polling Maya.
5. **Failure / expiry:** trigger `PAYMENT_FAILED`; confirm it is recorded (not credited) and the
   processing page stops waiting instead of timing out.
