/**
 * Diagnostic: attempt a grant for a test MAC and report RouterOS's response, then
 * list current ip-bindings + active hotspot hosts. Read-only-ish (it will create a
 * binding only if the MAC is valid; we clean it up). Throwaway.
 *
 *   bun --env-file=apps/admin/.env packages/core/scripts/diag-grant.ts [host] [mac]
 */
import { createMikrotikController } from '@veent/core';

const { MIKROTIK_HOST, MIKROTIK_USER, MIKROTIK_PASSWORD, MIKROTIK_PORT, MIKROTIK_TLS } = process.env;
const host = process.argv[2] || MIKROTIK_HOST || '';
const testMac = process.argv[3] || 'DEV:00:00:00:00:01';

const controller = createMikrotikController({
	host,
	user: MIKROTIK_USER || '',
	password: MIKROTIK_PASSWORD || '',
	port: MIKROTIK_PORT ? Number(MIKROTIK_PORT) : undefined,
	tls: MIKROTIK_TLS === 'true'
});

console.log(`Attempting grant for "${testMac}" on ${host}…`);
try {
	await controller.grant({ macAddress: testMac, durationMinutes: 15 });
	console.log(`✓ grant SUCCEEDED for ${testMac} (valid MAC). Cleaning up…`);
	await controller.revoke(testMac);
	console.log('  revoked test binding.');
} catch (err) {
	console.log(`✗ grant FAILED: ${err instanceof Error ? err.message : err}`);
	console.log('  → this is exactly what bubbles up as the 500 on "Start 15 min trial".');
}
