/**
 * One-off: push the Apple/Windows/Firefox captive-probe DENY rules to the live router without
 * re-running the full walled-garden provisioning. provisionWalledGarden is purely additive and
 * idempotent (existing equivalent denies are skipped), so this only adds what's missing.
 *
 *   bun --env-file=apps/admin/.env apps/admin/scripts/apply-probe-denies.ts
 *
 * Safe to delete after running.
 */
import { provisionWalledGarden, type MikrotikConfig } from '@veent/core';

const { MIKROTIK_HOST, MIKROTIK_USER, MIKROTIK_PASSWORD, MIKROTIK_PORT, MIKROTIK_TLS, MIKROTIK_TLS_INSECURE } =
	process.env;

if (!MIKROTIK_HOST || !MIKROTIK_USER) {
	console.error('Missing MIKROTIK_HOST / MIKROTIK_USER (set in apps/admin/.env)');
	process.exit(1);
}

const config: MikrotikConfig = {
	host: MIKROTIK_HOST,
	user: MIKROTIK_USER,
	password: MIKROTIK_PASSWORD ?? '',
	port: MIKROTIK_PORT ? Number(MIKROTIK_PORT) : undefined,
	tls: MIKROTIK_TLS === 'true',
	insecureTls: MIKROTIK_TLS_INSECURE === 'true'
};

// Only the newly-added platform probes — the Android/Google set is already on the router.
const denies = [
	{ host: 'captive.apple.com' },
	{ host: 'www.msftconnecttest.com' },
	{ host: 'www.msftncsi.com' },
	{ host: 'detectportal.firefox.com' }
];

console.log(`Adding ${denies.length} captive-probe denies to ${config.host}…`);
const result = await provisionWalledGarden(config, { hosts: [], ips: [], denies });
for (const d of result.denies) {
	console.log(`  ${d.created ? '＋ added ' : '✓ already'} deny  ${d.value}`);
}
console.log('done.');
