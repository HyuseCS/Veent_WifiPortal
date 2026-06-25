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
 * The Maya checkout page renders a Google reCAPTCHA, which loads from SEPARATE
 * domains. Without them the captcha never appears on a device behind the portal,
 * the page looks broken, and the phone may flip to cellular ("no internet"), which
 * then breaks our IP→MAC device detection.
 *
 * Captcha hosts, by risk:
 *   - `www.gstatic.com`  — static asset CDN (reCAPTCHA JS/images); serves no
 *     browsable services, so opening it leaks no real internet.
 *   - `www.recaptcha.net` — Google's dedicated reCAPTCHA host; serves nothing else.
 *   - `www.google.com`   — REQUIRED: Maya's checkout embeds the google.com variant of
 *     reCAPTCHA (confirmed from the router's DNS cache — the device resolves
 *     www.google.com + gstatic, never recaptcha.net). The walled garden can only match
 *     the TLS SNI (host), not the path, so this also exposes Google search to
 *     UNAUTHENTICATED devices. That's an accepted, bounded trade-off: without it the
 *     captcha can't render and mobile Maya payments dead-end. Pre-auth devices reach
 *     google.com only — other domains stay blocked, so it isn't open internet.
 */
const PAYMENT_HOSTS = [
	'maya.ph',
	'*.maya.ph',
	'paymaya.com',
	'*.paymaya.com',
	// Google reCAPTCHA (Maya checkout). google.com is required + a deliberate leak — see note above.
	'www.google.com',
	'www.recaptcha.net',
	'www.gstatic.com',
	// Other gateways named in Rule #2; harmless if unused.
	'*.paymongo.com',
	'*.xendit.co'
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

try {
	const result = await provisionWalledGarden(config, {
		hosts: [...hosts],
		ips: [...ips]
	});
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
