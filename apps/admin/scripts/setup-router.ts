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
 */
import { provisionWalledGarden, type MikrotikConfig } from '@veent/core';

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

const hosts = new Set(splitList(ADMIN_WG_HOSTS));
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
