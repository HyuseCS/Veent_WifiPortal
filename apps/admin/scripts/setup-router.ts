/**
 * Opens the MikroTik hotspot walled garden so guest devices can reach the
 * LAN-served admin dashboard *before* authenticating — the same mechanism the
 * payment gateways use (Core Business Rule #2), pointed at the admin host.
 *
 *   bun run setup:router
 *
 * Reads MIKROTIK_* + ORIGIN from apps/admin/.env (bun auto-loads it). The host to
 * whitelist is derived from ORIGIN; an IP origin is added at the IP layer, a
 * hostname at the HTTP layer. Add extras with:
 *
 *   ADMIN_WG_HOSTS="admin.veent.lan,portal.veent.lan"   # comma-separated DNS names
 *   ADMIN_WG_IPS="10.5.50.1,10.5.50.0/24"               # comma-separated IPs/CIDRs
 *
 * Idempotent: entries we already created (matched by dst-host/dst-address) are
 * left in place, so re-running after an ORIGIN change just adds the new hole.
 *
 * Requires NETWORK_CONTROLLER=mikrotik and reachable RouterOS API credentials.
 *
 * SERVER MIGRATION — lock the router API to THIS server's IP (run once the new server
 * can reach the router; it detects its own source IP and restricts api-ssl to it):
 *
 *   bun run --filter radius-admin setup:router --restrict-api               # lock api-ssl to this IP + pin lease
 *   bun run --filter radius-admin setup:router --restrict-api --disable-plain-api  # also turn off cleartext api (needs MIKROTIK_TLS=true)
 *   bun run --filter radius-admin setup:router --restrict-api --dry-run     # show what it would do
 *
 * The api-ssl cert + service must already exist on the router (see docs/DEPLOYMENT.md §7a).
 */
import { Socket } from 'node:net';
import { provisionWalledGarden, restrictApiService, type MikrotikConfig } from '@veent/core';

const argv = new Set(process.argv.slice(2));
const DRY_RUN = argv.has('--dry-run');
const RESTRICT_API = argv.has('--restrict-api');
const DISABLE_PLAIN_API = argv.has('--disable-plain-api');

const {
	NETWORK_CONTROLLER,
	ORIGIN,
	MIKROTIK_HOST,
	MIKROTIK_USER,
	MIKROTIK_PASSWORD,
	MIKROTIK_PORT,
	MIKROTIK_TLS,
	MIKROTIK_TLS_INSECURE,
	ADMIN_WG_HOSTS,
	ADMIN_WG_IPS
} = process.env;

function required(name: string, value: string | undefined): string {
	if (!value) {
		console.error(`Missing ${name}. Set it in apps/admin/.env or the command line.`);
		process.exit(1);
	}
	return value;
}

if (NETWORK_CONTROLLER !== 'mikrotik') {
	console.error(
		`NETWORK_CONTROLLER is "${NETWORK_CONTROLLER ?? 'unset'}", expected "mikrotik".\n` +
			'The walled garden lives on the router — there is nothing to provision for the stub controller.'
	);
	process.exit(1);
}

const config: MikrotikConfig = {
	host: required('MIKROTIK_HOST', MIKROTIK_HOST),
	user: required('MIKROTIK_USER', MIKROTIK_USER),
	password: MIKROTIK_PASSWORD ?? '',
	port: MIKROTIK_PORT ? Number(MIKROTIK_PORT) : undefined,
	tls: MIKROTIK_TLS === 'true',
	insecureTls: MIKROTIK_TLS_INSECURE === 'true'
};

const splitList = (raw: string | undefined): string[] =>
	(raw ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);

const isIp = (h: string): boolean => /^[0-9.]+(\/\d{1,2})?$/.test(h) || h.includes(':');

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
 * Those are DELIBERATELY NOT global here anymore. A global `*.google.com` / `*.gstatic.com`
 * allow lets Android's captive-portal probe (`.../generate_204`) return a real 204 pre-auth,
 * so every connecting guest briefly flashes "connected" then reverts to "Sign in to network"
 * (MikroTik can't path-filter HTTPS, so the probe can't be blocked while google.com is open).
 * Instead they're opened PER-DEVICE, scoped to the paying device's IP, at checkout time — see
 * `openCheckoutAccess` (packages/core services/checkoutAccess.ts), swept on a TTL by the
 * customer app's revoke cron. Keep them OUT of this global list.
 *
 * This list mirrors EXACTLY what is live on the router's global walled garden — re-running
 * is a no-op (idempotency matches on `dst-host`, so a mismatched host here would add
 * a redundant entry). These are payment-gateway hosts only; none is a captive-portal probe
 * host, so opening them globally doesn't trigger the flash.
 */
const PAYMENT_HOSTS = [
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
	'*.xendit.co'
];

/**
 * OS connectivity-check probe hosts to explicitly DENY pre-auth. The broad reCAPTCHA allows above
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
const PROBE_DENIES = [
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

const hosts = new Set([...splitList(ADMIN_WG_HOSTS), ...PAYMENT_HOSTS]);
const ips = new Set(splitList(ADMIN_WG_IPS));

// Derive the admin host from ORIGIN and slot it into the right layer.
const origin = required('ORIGIN', ORIGIN);
let originHost: string;
try {
	originHost = new URL(origin).hostname;
} catch {
	console.error(`ORIGIN is not a valid URL: "${origin}"`);
	process.exit(1);
}
if (originHost === 'localhost' || originHost === '127.0.0.1') {
	console.error(
		`ORIGIN host is "${originHost}" — that's loopback, not a LAN address guests can reach.\n` +
			'Set ORIGIN to the admin box\'s LAN URL (e.g. http://10.5.50.1:5174 or http://admin.veent.lan)\n' +
			'before provisioning the walled garden.'
	);
	process.exit(1);
}
(isIp(originHost) ? ips : hosts).add(originHost);

if (hosts.size === 0 && ips.size === 0) {
	console.error('Nothing to whitelist — no ORIGIN host, ADMIN_WG_HOSTS, or ADMIN_WG_IPS resolved.');
	process.exit(1);
}

console.log(`Provisioning walled garden on ${config.host}:${config.port ?? (config.tls ? 8729 : 8728)}`);
if (hosts.size) console.log(`  hosts: ${[...hosts].join(', ')}`);
if (ips.size) console.log(`  ips:   ${[...ips].join(', ')}`);
if (PROBE_DENIES.length)
	console.log(`  denies: ${PROBE_DENIES.map((d) => d.host + (d.path ?? '')).join(', ')}`);

try {
	const result = await provisionWalledGarden(config, {
		hosts: [...hosts],
		ips: [...ips],
		denies: PROBE_DENIES
	});
	for (const d of result.denies)
		console.log(`  deny ${d.value}: ${d.created ? 'added' : 'already present'}`);
	for (const h of result.hosts) console.log(`  host ${h.value}: ${h.created ? 'added' : 'already present'}`);
	for (const i of result.ips) console.log(`  ip   ${i.value}: ${i.created ? 'added' : 'already present'}`);
	console.log('\nDone. Guest devices can now reach the admin dashboard before authenticating.');
} catch (err) {
	console.error('\nFailed to provision walled garden:', err instanceof Error ? err.message : err);
	process.exit(1);
}

/**
 * The LAN IP this machine uses to reach the router — i.e. the source IP the router sees, the
 * exact value its api-ssl *Available From* must allow. A TCP connect to the API port resolves
 * it without sending data; we never complete a RouterOS session here.
 */
function detectSourceIp(host: string, port: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const sock = new Socket();
		const finish = (fn: () => void) => {
			sock.removeAllListeners();
			sock.destroy();
			fn();
		};
		sock.setTimeout(4000);
		sock.once('timeout', () => finish(() => reject(new Error('timed out connecting to the router'))));
		sock.once('error', (e) => finish(() => reject(e)));
		sock.connect(port, host, () => {
			const ip = sock.localAddress?.replace(/^::ffff:/, '');
			finish(() => (ip ? resolve(ip) : reject(new Error('could not read local address'))));
		});
	});
}

// Optional migration step: lock the RouterOS API to THIS server's IP.
if (RESTRICT_API) {
	const apiPort = config.port ?? (config.tls ? 8729 : 8728);
	if (DISABLE_PLAIN_API && !config.tls) {
		console.error(
			'\nRefusing --disable-plain-api while connected over cleartext api — you would cut your own\n' +
				'connection. Switch this server to api-ssl first (MIKROTIK_TLS="true", MIKROTIK_PORT="8729").'
		);
		process.exit(1);
	}

	let sourceIp: string;
	try {
		sourceIp = await detectSourceIp(config.host, apiPort);
	} catch (err) {
		console.error(
			`\nCould not detect this server's IP to the router (${config.host}:${apiPort}): ` +
				(err instanceof Error ? err.message : err) +
				'\nThe router may already restrict api-ssl to a different IP. Temporarily widen its\n' +
				'Available From (or open it) so this server can connect, then re-run.'
		);
		process.exit(1);
	}

	console.log(`\nLocking RouterOS API to this server: ${sourceIp}/32 (api-ssl Available From)`);
	if (DISABLE_PLAIN_API) console.log('  + disabling cleartext api (8728)');
	if (DRY_RUN) {
		console.log('  [dry-run] no changes made.');
	} else {
		try {
			const r = await restrictApiService(config, {
				sourceIp,
				disablePlainApi: DISABLE_PLAIN_API,
				pinLease: true
			});
			console.log(`  api-ssl Available From → ${r.apiSslAddress}`);
			console.log(`  cleartext api: ${r.plainApiDisabled ? 'disabled' : 'left as-is'}`);
			console.log(
				`  DHCP lease: ${
					r.leasePinned === 'no-lease'
						? 'no lease found (static IP?) — skipped'
						: r.leasePinned
							? 'static (pinned)'
							: 'skipped'
				}`
			);
			console.log('\nRouter API is now restricted to this server.');
		} catch (err) {
			console.error('\nFailed to restrict the API:', err instanceof Error ? err.message : err);
			process.exit(1);
		}
	}
}
