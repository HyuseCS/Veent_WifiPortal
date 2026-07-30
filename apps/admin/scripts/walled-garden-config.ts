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
	// Maya / PayMaya — checkout + redirect + API (wildcards cover sandbox + prod).
	'maya.ph',
	'*.maya.ph',
	'paymaya.com',
	'*.paymaya.com',
	// GCash + Alipay cashier + Mynt/G-Xchange infra — Maya's hosted checkout redirects the buyer to
	// GCash to authorize the payment (payments.gcash.com); GCash checkout runs through the
	// Alipay-powered cashier (live hits: `*alipay*`=23). Enumerated `*.domain` forms replace the
	// over-broad `*alipay*` / `*gcash*` / `*g-xchange*` substrings. Bare `alipay.com` is required in
	// addition to the wildcard: a `*.` wildcard does NOT match its own bare parent host, so
	// `*.alipay.com` alone leaves `alipay.com` blocked — the retired 41-hit `*alipay*` substring used
	// to catch it. (AC5.)
	'gcash.com',
	'*.gcash.com',
	'alipay.com',
	'*.alipay.com',
	'*.alipayobjects.com',
	'*.alicdn.com',
	'*.antgroup.com',
	'*.mynt.xyz',
	'*.g-xchange.com',
	// Google APIs (reCAPTCHA/assets — NOT Google Pay). Google Pay hosts (pay.google.com,
	// payments.google.com, accounts.google.com, accounts.google.com.ph) were deliberately dropped —
	// Google Pay is abandoned: Android WebView blocks it (`OR_BIBED_15`), so it can never work in the
	// captive CNA regardless of whitelisting.
	// KEEP `*.googleapis.com` — proven needed by live traffic (98 hits). Abuse residual: it is a broad
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
/**
 * Portal origin LAN IPs that must ALWAYS be reachable pre-auth, independent of which box runs
 * setup:router. The captive guest is redirected to the customer portal, so its IP must sit in the
 * walled garden even when the running box's own ORIGIN/ADMIN_WG_IPS point at a different machine.
 * Both the dev box and the deploy VM are listed so switching the router between them never drops
 * the allow. Edit this list when a box's LAN IP changes.
 */
export const PORTAL_LAN_IPS = [
	'10.210.59.11', // dev box
	'10.210.54.133' // staging/deploy VM
];

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
