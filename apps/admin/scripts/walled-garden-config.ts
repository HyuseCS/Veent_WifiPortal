/**
 * Side-effect-free walled-garden config.
 *
 * `setup-router.ts` runs provisioning at import time, so its constants can't be
 * imported by a unit test without connecting to the router. This module holds the
 * pure host/deny arrays instead: both `setup-router.ts` and the collision-guard
 * spec import from here, so the arrays can be asserted on without side effects.
 *
 * Do NOT add imports with side effects here — it must stay safe to import from a test.
 */

/**
 * Payment-gateway domains that MUST be reachable before a device authenticates
 * (Core Business Rule #2). Without these, the Maya checkout redirect
 * (payments-web*.maya.ph) is blocked by the hotspot and the browser shows a
 * closed connection. Wildcards cover sandbox + prod, checkout page + API host.
 *
 * NOTE: card 3-D Secure step-up redirects to the issuing bank's ACS domain,
 * which can't be predicted here — e-wallet/Maya-wallet checkout is fully covered;
 * card payments may still need the bank's domain added per deployment.
 *
 * The Maya checkout page also renders a Google reCAPTCHA served from google.com/gstatic.com.
 * Those are DELIBERATELY NOT global here. A global `*.google.com` / `*.gstatic.com`
 * allow lets Android's captive-portal probe (`.../generate_204`) return a real 204 pre-auth,
 * so every connecting guest briefly flashes "connected" then reverts to "Sign in to network"
 * (MikroTik can't path-filter HTTPS, so the probe can't be blocked while google.com is open).
 * Instead they're opened PER-DEVICE, scoped to the paying device's IP, at checkout time — see
 * `openCheckoutAccess` (packages/core services/checkoutAccess.ts), swept on a TTL by the
 * customer app's revoke cron. Keep them OUT of this global list.
 *
 * This list mirrors what is live on the router's global walled garden — re-running
 * is a no-op (idempotency matches on `dst-host`, so a mismatched host here would add
 * a redundant entry). These are payment-gateway hosts only; none is a captive-portal probe
 * host, so opening them globally doesn't trigger the flash.
 *
 * Codified from live router hit-data (RouterOS 6.49.18) — the over-broad manual `*keyword*`
 * substring wildcards (`*alipay*`, `*gcash*`, `*g-xchange*`) are replaced by enumerated
 * `*.domain` forms below. The operator deletes the old substrings by hand (setup:router is
 * additive and will not prune) — see docs/mikrotik/walled-garden.md §Operator cleanup.
 */
export const PAYMENT_HOSTS = [
	'maya.ph',
	'*.maya.ph',
	'paymaya.com',
	'*.paymaya.com',
	// GCash e-wallet checkout — Maya/PayMongo redirect the buyer to GCash to authorize the payment
	// (payments.gcash.com). Wildcard covers the auth/redirect subdomains.
	'gcash.com',
	'*.gcash.com',
	// Other gateways named in Rule #2; harmless if unused.
	'*.paymongo.com',
	'*.xendit.co',
	// Alipay/Ant cashier hosts — GCash checkout runs through the Alipay-powered cashier
	// (live hits: `*alipay*`=23). Enumerated forms replace the over-broad `*alipay*` substring.
	'*.alipay.com',
	'*.alipayobjects.com',
	'*.alicdn.com',
	'*.antgroup.com',
	// GCash/Mynt/G-Xchange infra (live hits: `*.mynt.xyz`=2; research flagged mdap.paas.mynt.xyz).
	// Replaces the over-broad `*g-xchange*` substring.
	'*.mynt.xyz',
	'*.g-xchange.com',
	// Google Pay checkout hosts (live hits: pay.google.com=17, payments.google.com=13). Distinct,
	// specific hosts — NOT broad `*.google.com` (that re-opens the captive-probe flap; see note above).
	'pay.google.com',
	'payments.google.com',
	// Google login/SetSID hosts for the Google Pay flow (added from live 29-07-26 findings). The bare
	// `accounts.google.com` is required because a `*.` wildcard does NOT match its own bare parent host;
	// `accounts.google.com.ph` is the localized PH ccTLD the SetSID cross-domain-cookie step bounces to.
	// Both resolve DIRECTLY to Google IPs (no CNAME-to-CDN), so plain host rules suffice — no resolve
	// script. Distinct literal hosts, NOT broad `*.google.com`. Neither collides with PROBE_DENIES.
	'accounts.google.com',
	'accounts.google.com.ph',
	// KEEP — proven needed by live traffic (98 hits). Abuse residual: `*.googleapis.com` is a broad
	// surface, but dropping a 98-hit rule risks breaking checkout. Tightening to exact subpaths needs a
	// live capture of which paths checkout uses (out of scope — backlog candidate). Do NOT silently drop.
	'*.googleapis.com'
];

/**
 * OS connectivity-check probe hosts to explicitly DENY pre-auth. The broad reCAPTCHA allows
 * (`*.google.com` / `*.gstatic.com`) would otherwise let Android's captive probe through to a real
 * HTTP 204, so the phone flashes "Connected" and then reverts to "Sign in to network" while still
 * un-granted (docs/problems/captive-connected-flap-on-free-time.md). These denies sit ABOVE the
 * allows (walled-garden is first-match top-to-bottom) so the probe is intercepted again — while
 * reCAPTCHA, which lives on different hosts/paths (`www.gstatic.com/recaptcha`,
 * `www.google.com/recaptcha`), keeps loading. Each host below is NOT a reCAPTCHA resource:
 *   - connectivitycheck.gstatic.com — Android probe host; reCAPTCHA never uses this subdomain.
 *   - clients1..4.google.com        — Android/Chrome connectivity + client hosts; not reCAPTCHA
 *                                     resources. Matches the set already present on the live router.
 *   - connectivitycheck.android.com — Android's fallback probe (already not in the allowlist; the
 *                                     explicit deny documents intent and covers a manual allow).
 *   - www.google.com PATH /generate_204 — www.google.com IS needed by reCAPTCHA, so deny only the
 *                                     probe PATH (HTTP-only match; reCAPTCHA uses /recaptcha, not this).
 *
 * Apple / Windows / Firefox probe hosts are added below too. Unlike the Google set, these aren't
 * covered by any allow, so they're already intercepted by default — but the explicit deny keeps
 * the OS "Sign in to network" popup firing even if someone later adds a broad allow (e.g.
 * `*.apple.com`), documents intent, and gives every platform the same treatment. None are reCAPTCHA
 * or payment resources, so denying them is pure upside:
 *   - captive.apple.com          — iOS/iPadOS/macOS CNA probe (http://captive.apple.com/hotspot-detect.html).
 *   - www.msftconnecttest.com    — Windows 10/11 NCSI probe (/connecttest.txt).
 *   - www.msftncsi.com           — legacy Windows NCSI probe.
 *   - detectportal.firefox.com   — Firefox's own captive-portal detector.
 */
export const PROBE_DENIES = [
	// Android / Google
	{ host: 'connectivitycheck.gstatic.com' },
	{ host: 'clients1.google.com' },
	{ host: 'clients2.google.com' },
	{ host: 'clients3.google.com' },
	{ host: 'clients4.google.com' },
	{ host: 'connectivitycheck.android.com' },
	{ host: 'www.google.com', path: '/generate_204' },
	// Apple (iOS/macOS), Windows, Firefox
	{ host: 'captive.apple.com' },
	{ host: 'www.msftconnecttest.com' },
	{ host: 'www.msftncsi.com' },
	{ host: 'detectportal.firefox.com' }
];
