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
import {
	provisionWalledGarden,
	provisionGcashResolveScheduler,
	reconcileWalledGarden,
	restrictApiService,
	type MikrotikConfig
} from '@veent/core';
import { PAYMENT_HOSTS, PROBE_DENIES } from './walled-garden-config';

const argv = new Set(process.argv.slice(2));
const DRY_RUN = argv.has('--dry-run');
const RESTRICT_API = argv.has('--restrict-api');
const DISABLE_PLAIN_API = argv.has('--disable-plain-api');
const RECONCILE = argv.has('--reconcile');

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

// PAYMENT_HOSTS + PROBE_DENIES live in ./walled-garden-config (side-effect-free) so the
// collision-guard spec can import them without running this script's top-level provisioning.
//
// The walled garden is provisioned as THREE tagged groups (walled-garden-canonical, 30-07-26) so
// every code-owned row is traceable to its group and --reconcile can manage each independently:
//   veent-admin:probe    — the OS captive-probe DENY rows (PROBE_DENIES)
//   veent-admin:payment  — the payment-gateway allow hosts (PAYMENT_HOSTS)
//   veent-admin:portal   — the admin/portal origin (ORIGIN + ADMIN_WG_HOSTS/ADMIN_WG_IPS)
// PAYMENT_HOSTS is its OWN group now — it is NOT merged into the portal host set.

const adminHosts = new Set(splitList(ADMIN_WG_HOSTS));
const adminIps = new Set(splitList(ADMIN_WG_IPS));

// Derive the admin host from ORIGIN and slot it into the right portal layer.
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
(isIp(originHost) ? adminIps : adminHosts).add(originHost);

if (adminHosts.size === 0 && adminIps.size === 0) {
	console.error('Nothing to whitelist — no ORIGIN host, ADMIN_WG_HOSTS, or ADMIN_WG_IPS resolved.');
	process.exit(1);
}

// The desired per-group sets — computed ONCE and reused by both the additive provision calls and
// the opt-in --reconcile prune, so reconcile can never drift from what was just provisioned.
const paymentHostList = [...PAYMENT_HOSTS];
const portalHostList = [...adminHosts];
const portalIpList = [...adminIps];

// E5 guard: an operator-set ADMIN_WG_HOSTS value that duplicates a PAYMENT_HOSTS entry would create
// the same host under two different tags (functionally harmless — provisioning is idempotent
// per-tag — but confusing for the doc/AC12 tag audit). Warn rather than silently resolve.
const portalPaymentOverlap = portalHostList.filter((h) => PAYMENT_HOSTS.includes(h));
if (portalPaymentOverlap.length)
	console.warn(
		`  WARNING: ADMIN_WG_HOSTS overlaps PAYMENT_HOSTS (${portalPaymentOverlap.join(', ')}) — ` +
			'the same host will be tagged under both veent-admin:portal and veent-admin:payment.'
	);

console.log(`Provisioning walled garden on ${config.host}:${config.port ?? (config.tls ? 8729 : 8728)}`);
console.log('  3 tagged groups (load-bearing order: probe → payment → portal):');
if (PROBE_DENIES.length)
	console.log(
		`  [veent-admin:probe]   denies: ${PROBE_DENIES.map((d) => d.host + (d.path ?? '')).join(', ')}`
	);
if (paymentHostList.length) console.log(`  [veent-admin:payment] hosts:  ${paymentHostList.join(', ')}`);
if (portalHostList.length) console.log(`  [veent-admin:portal]  hosts:  ${portalHostList.join(', ')}`);
if (portalIpList.length) console.log(`  [veent-admin:portal]  ips:    ${portalIpList.join(', ')}`);

try {
	// Provision the 3 groups sequentially in a LOAD-BEARING order: probe FIRST, then payment, then
	// portal. On a wiped/fresh garden this guarantees the deny rows land at the very top (ahead of
	// every allow), matching the doc's stated ordering. provisionWalledGarden re-derives its
	// deny-placement `beforeId` fresh per call, so the denies would still sit above the allows even
	// if reordered — but do NOT reorder these calls without re-verifying that beforeId derivation.
	const probeResult = await provisionWalledGarden(config, {
		denies: PROBE_DENIES,
		tag: 'veent-admin:probe'
	});
	const paymentResult = await provisionWalledGarden(config, {
		hosts: paymentHostList,
		tag: 'veent-admin:payment'
	});
	const portalResult = await provisionWalledGarden(config, {
		hosts: portalHostList,
		ips: portalIpList,
		tag: 'veent-admin:portal'
	});
	for (const d of probeResult.denies)
		console.log(`  [probe]   deny ${d.value}: ${d.created ? 'added' : 'already present'}`);
	for (const h of paymentResult.hosts)
		console.log(`  [payment] host ${h.value}: ${h.created ? 'added' : 'already present'}`);
	for (const h of portalResult.hosts)
		console.log(`  [portal]  host ${h.value}: ${h.created ? 'added' : 'already present'}`);
	for (const i of portalResult.ips)
		console.log(`  [portal]  ip   ${i.value}: ${i.created ? 'added' : 'already present'}`);
	console.log('\nDone. Guest devices can now reach the admin dashboard before authenticating.');
} catch (err) {
	console.error('\nFailed to provision walled garden:', err instanceof Error ? err.message : err);
	process.exit(1);
}

// GCash CNAME resolve-script: `payments.gcash.com` CNAMEs to a rotating Akamai edge IP that v6
// dst-host rules can't follow, so a `/system scheduler` re-resolves it every 5 min and upserts a
// walled-garden ip row. Additive + idempotent (matched by name=gcash-resolve), same as above.
try {
	const sched = await provisionGcashResolveScheduler(config);
	console.log(
		`  scheduler ${sched.scheduler.value}: ${sched.scheduler.created ? 'added' : 'already present'}`
	);
} catch (err) {
	console.error(
		'\nFailed to provision the gcash-resolve scheduler:',
		err instanceof Error ? err.message : err
	);
	process.exit(1);
}

// Opt-in prune: --reconcile removes ONLY code-owned (veent-admin-tagged, action=allow) walled-garden
// rows no longer in the desired set — never un-tagged operator rows, the gcash-auto row, or the
// PROBE_DENIES deny rows. Default (no flag) run never prunes; --dry-run prints without removing.
if (RECONCILE) {
	console.log(
		`\nReconciling walled garden — removing drifted code-owned rows${DRY_RUN ? ' [dry-run]' : ''}:`
	);
	try {
		// One reconcile call per group, each scoped to its OWN sub-tag + desired set — mirroring the 3
		// provision calls. A sub-tag-scoped call only manages its own group's rows (the family-prefix
		// match never leaks across siblings, since no row is tagged `veent-admin:payment:<...>`), so
		// the 3 groups stay isolated. The probe group has only deny rows, which reconcile never
		// removes, so its desired set is empty.
		const recProbe = await reconcileWalledGarden(config, {
			hosts: [],
			ips: [],
			tag: 'veent-admin:probe',
			dryRun: DRY_RUN
		});
		const recPayment = await reconcileWalledGarden(config, {
			hosts: paymentHostList,
			ips: [],
			tag: 'veent-admin:payment',
			dryRun: DRY_RUN
		});
		const recPortal = await reconcileWalledGarden(config, {
			hosts: portalHostList,
			ips: portalIpList,
			tag: 'veent-admin:portal',
			dryRun: DRY_RUN
		});
		const removed = [...recProbe.removed, ...recPayment.removed, ...recPortal.removed];
		if (removed.length === 0) {
			console.log('  nothing to remove — no drifted code-owned rows.');
		} else {
			for (const r of removed)
				console.log(`  ${r.layer} ${r.value}: ${r.dryRun ? 'would remove' : 'removed'}`);
		}
	} catch (err) {
		console.error('\nFailed to reconcile walled garden:', err instanceof Error ? err.message : err);
		process.exit(1);
	}
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
