# Threat Model — Issue 2b: CNA ↔ Browser Session Continuity

**Status:** design / pre-implementation review. No 2b code is written yet. This document exists
to be reviewed _before_ any session-minting code lands (per the project rule that auth/session/
network changes get a threat model up front).

## 1. What 2b does and why

The phone's **Captive Network Assistant** (CNA — the mini-webview that pops up on join) has an
OS-sandboxed cookie jar isolated from Safari/Chrome. A `better-auth` session minted in the CNA
(phone + OTP) **does not exist** when the guest later reopens the portal in their real browser to
buy more credits — forcing a second OTP login. 2b re-establishes the session in the real browser
**without a fresh OTP**, two layered ways:

- **(A) Silent network-identity re-auth [primary]** — on a session-less browser request, resolve
  the caller's MAC (`resolveMacForUser` → portal cookie / router IP→MAC / `lastKnownMac`), look up
  the **active `network_sessions`** row → `userId`, and mint a browser session for that user with
  no user action.
- **(B) One-time-token handoff [fallback]** — the CNA success screen offers an "Open in your
  browser" link carrying a single-use, short-TTL signed token; opening it in the system browser
  consumes the token and mints the session there.

The core security tension: **(A) mints a credentialed session from network identity alone, and the
network is open/unencrypted WiFi where both the cookie and the MAC are attacker-controllable.**

## 2. Assets

| Asset                                           | Why it matters                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------- |
| Customer portal session cookie (`veent-portal`) | Grants the buyer's identity — balance view, **spending credits**, starting paid tiers |
| Credit balance / paid-time                      | Real money. Theft = spending another guest's credits                                  |
| Phone number (PII)                              | Masked in UI, but a hijacked session exposes account context                          |
| `network_sessions` rows (MAC ↔ userId)          | The trust anchor 2b(A) keys on — if forgeable, identity is forgeable                  |
| One-time handoff token                          | Bearer credential during the CNA→browser hop                                          |

## 3. Trust boundaries & assumptions

- **The L2 network is hostile.** Captive-portal WiFi is **open** (no WPA), so any associated
  device can sniff all unencrypted traffic and **spoof any MAC** it observes. This is the
  governing assumption — every (A) control flows from it.
- **The portal redirect is plain HTTP today** (`docs/mikrotik/login.html`), so the session cookie
  is currently sniffable off the air (sidejacking) **regardless of 2b**. 2b makes this worse by
  minting more sessions silently, so TLS is a hard prerequisite, not an add-on.
- **The router NATs guest traffic to its own IP** in at least some deployments (documented in
  `network-location.ts`), so server-side `getClientAddress()` is frequently the router IP, not the
  device — IP alone cannot identify a device.
- better-auth owns cookie signing/CSRF; sessions are **24h fixed, no refresh** (`auth.ts`).
- `BETTER_AUTH_SECRET` is the signing root for both cookies and any token we mint.

## 4. Threat actors

- **A1 — Co-located freeloader.** Another guest on the same open AP. Can sniff traffic and spoof
  MACs. Goal: spend someone else's credits for free. _Primary actor._
- **A2 — Opportunistic interceptor.** Grabs a URL/token shoulder-surfed, from a shared screen, or
  from a referrer/log. Goal: replay the handoff link.
- **A3 — Remote attacker.** Off the LAN. Cannot sniff/spoof L2; limited to CSRF/forged requests.

## 5. Attack scenarios → controls

| #      | Scenario                                                                                                                             | Actor | Without controls                  | Control(s)                                                                                                                                                                                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------ | ----- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **T1** | **Cookie sidejacking** — sniff the session cookie off open WiFi and replay it                                                        | A1    | Full takeover                     | **C1 TLS end-to-end pre-auth** + `Secure`+`HttpOnly`+`SameSite=Lax`. Decisive — nothing else in 2b is safe without it                                                                                             |
| **T2** | **MAC spoof → silent re-auth** — A1 sniffs a victim's MAC, spoofs it, hits the portal with no cookie; (A) mints the victim's session | A1    | Takeover with **zero** credential | **C2** gate silent (A) to **low-risk views only** (balance, buy-_more_); **C3** require **fresh OTP step-up** for any spend/account change; **C4** only trust an **active, non-expired, non-revoked** session row |
| **T3** | **Handoff-token replay** — intercept the one-time link and open it first                                                             | A2    | Takeover                          | **C5** token = single-use, **≤60s TTL**, bound to `userId`+MAC/IP, invalidated on first use; **C6** strip token from URL via redirect after consumption (no referrer/history/log leak)                            |
| **T4** | **Cross-device cookie replay** — a cookie captured on one device replayed from another MAC                                           | A1    | Takeover                          | **C7** bind the silently-minted session to the MAC/IP it was minted for; **re-validate per request**; reject a cookie presented from a different MAC                                                              |
| **T5** | **NAT shared-IP confusion** — many devices behind the router IP; (A) attributes the wrong user                                       | A1    | Wrong-account session             | **C8** never key (A) on IP alone — require a MAC-keyed active session row; IP is corroboration only; **C3** step-up still gates spend                                                                             |
| **T6** | **Stale/revoked trust** — reuse a MAC from an expired/kicked session to mint a fresh one                                             | A1    | Revoked user regains access       | **C4** active-only check, evaluated against live status (`SESSION_STATUS`), not just row existence                                                                                                                |
| **T7** | **CSRF on the mint endpoint** — remote page forces a victim's browser to trigger (A)/token consume                                   | A3    | Forced mint / token burn          | **C9** `SameSite=Lax` cookies + better-auth CSRF; token consume is POST/redirect, not a bare GET side effect                                                                                                      |
| **T8** | **Token leakage via URL** — token sits in address bar, history, server logs, referrer header                                         | A2    | Delayed replay                    | **C6** redirect-strip + `Cache-Control: no-store` + never log the raw token                                                                                                                                       |

## 6. Controls summary

| Control                                                                                                        | Mitigates                                    | Notes / prerequisite                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **C1** TLS pre-auth + Secure/HttpOnly/SameSite=Lax cookies, `ORIGIN=https://…`, walled-garden the HTTPS origin | T1 (and the _pre-existing_ sidejacking risk) | **Hard prerequisite for a PUBLIC portal.** Needs a cert reachable pre-auth on the portal host — a deploy decision (see §8). **LAN-appliance exception:** a portal served only on a private-LAN host (RFC1918 IP / `.lan`) may run http; `validateEnv` allows it but **warns**, accepting the §7 sidejacking residual on the trusted LAN. |
| **C2** Silent (A) gated to low-risk views only                                                                 | T2                                           | "Recognized," not "trusted"                                                                                                                                                                                                                                                                                                              |
| **C3** OTP step-up for spend/account actions                                                                   | T2, T5                                       | Reuses the existing phone-OTP flow; the _credential_ check 2b otherwise skips                                                                                                                                                                                                                                                            |
| **C4** Trust only active/non-expired/non-revoked session rows                                                  | T2, T6                                       | Evaluate against live status each time                                                                                                                                                                                                                                                                                                   |
| **C5** One-time token: single-use, ≤60s TTL, bound to userId+MAC/IP                                            | T3                                           | Use better-auth **native** one-time-token / magic-link plugin, not hand-rolled (matches "prefer native")                                                                                                                                                                                                                                 |
| **C6** Strip token from URL after consume; no-store; never log                                                 | T3, T8                                       | 302 to a clean URL on success                                                                                                                                                                                                                                                                                                            |
| **C7** Bind silent session to MAC/IP; re-validate per request                                                  | T4                                           | Shrinks the spoof window to "same MAC, same time"                                                                                                                                                                                                                                                                                        |
| **C8** Never attribute (A) on IP alone                                                                         | T5                                           | Router NAT makes IP unreliable anyway                                                                                                                                                                                                                                                                                                    |
| **C9** SameSite=Lax + better-auth CSRF; consume via POST/redirect                                              | T7                                           | Mostly inherited                                                                                                                                                                                                                                                                                                                         |

## 7. Residual risk (accepted even with all controls)

- **Same-MAC, same-time spoofing of low-risk views.** With C1–C9, A1 who spoofs the victim's MAC
  _while the victim has an active session_ can still get a **balance-view** session — but **cannot
  spend** (C3 forces OTP they don't have) and **cannot persist** (C7 re-validates; the real device
  reasserts the MAC). Impact is bounded to **read-only** account context. This is the irreducible
  cost of trusting network identity on open WiFi; the alternative is to drop (A) entirely and ship
  **token-only** continuity (see §8 decision).
- **Pre-existing sidejacking until C1 ships.** Until TLS pre-auth lands, the portal cookie is
  sniffable today — independent of 2b. C1 should arguably land _first_, on its own.

## 8. Open decisions needed before coding

> **Resolved 2026-06-26:** §8.1 TLS pre-auth = **YES — real domain + public cert** (also fixes
> the pre-existing sidejacking risk). §8.2 mechanism = deferred pending §8.1, now unblocked →
> recommended path is C1 first, then (B), then (A) gated on accepting the §7 read-only residual
> (not yet explicitly accepted). §8.3/§8.4 still to confirm at implementation time.
>
> **Implemented 2026-06-26 (C1 + B):**
>
> - **C1** — `auth.ts` `useSecureCookies` pinned to the ORIGIN protocol + explicit
>   `defaultCookieAttributes` (HttpOnly/SameSite=Lax/Secure); `validateEnv` hard-fails in prod if
>   ORIGIN is missing or a non-https **public** host, but **allows http on a private-LAN host**
>   (RFC1918 IP / `.lan` / localhost) with a warning — the LAN-appliance deploy added 2026-06-30
>   (`node build` served on the LAN, no public TLS). `docs/mikrotik/login.html` carries the
>   public-HTTPS-vs-LAN-http note.
> - **B** — better-auth `oneTimeToken` plugin (`storeToken:'hashed'`, `expiresIn:2`min,
>   `disableClientRequest`); `GET /auth/handoff` verifies+consumes the token, mints the session,
>   strips the token from the URL (C6), is per-IP rate-limited, and never logs the raw token; the
>   dashboard mints a per-session token and renders the "Open in your browser" link; an
>   expired/used link bounces to `/login?handoff=expired` with a friendly banner.
> - **(A) NOT implemented** — silent network-identity re-auth is held pending explicit acceptance
>   of the §7 read-only residual risk. T2/T4/T5 therefore do not apply to the shipped surface.

1. **Is TLS pre-auth deployable?** (C1) — can the LAN portal host serve a valid HTTPS cert that a
   pre-auth device trusts (real domain + public cert, or a deployment-managed CA)? **If no, 2b(A)
   should not ship** — silent mint over sniffable HTTP is a downgrade.
2. **Silent re-auth (A) at all, or token-only (B)?** Given the §7 residual, do we accept
   read-only MAC-recognition for convenience, or require the explicit one-time-token hop (B) for
   _all_ CNA→browser continuity? (B) removes T2/T4/T5 entirely at the cost of one user tap.
3. **Step-up scope (C3)** — confirm the exact action set behind OTP: spend credits, start tier,
   change account. (Balance + top-up _initiation_ stay friction-free; the _charge_ is already
   webhook-gated.)
4. **Token TTL/transport (C5/C6)** — confirm ≤60s and the native better-auth plugin choice.

## 9. Recommendation

Land in this order, each independently shippable:

1. **C1 (TLS pre-auth + cookie flags) first, standalone** — it fixes a real _current_ risk and is
   the gate for everything else.
2. **(B) one-time-token handoff** — strong continuity with no network-trust assumption; safe even
   on NAT.
3. **(A) silent re-auth only if decision §8.1 is "TLS yes" and §8.2 is "accept read-only
   recognition"** — strictly low-risk views, with C3 step-up enforced on every sensitive action.

If §8.1 is "no TLS," ship only (B) and defer (A).
