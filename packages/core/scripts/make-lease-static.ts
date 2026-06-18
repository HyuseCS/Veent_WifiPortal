/**
 * Pins a DHCP lease so the device keeps its IP across reconnects (Winbz: Make
 * Static) — over the API, since Winbox isn't reachable on the hotspot network.
 * This is the durable fix for the recurring "IP changed → everything pinned to the
 * old IP breaks" problem. Throwaway ops script.
 *
 *   bun --env-file=apps/admin/.env packages/core/scripts/make-lease-static.ts <host> <mac>
 */
const { MIKROTIK_USER, MIKROTIK_PASSWORD, MIKROTIK_PORT, MIKROTIK_TLS } = process.env;
const host = process.argv[2];
const mac = (process.argv[3] || '').toUpperCase();

if (!host || !mac) {
	console.error('Usage: make-lease-static.ts <host> <mac>');
	process.exit(1);
}

const tls = MIKROTIK_TLS === 'true';
const port = MIKROTIK_PORT ? Number(MIKROTIK_PORT) : tls ? 8729 : 8728;

const mod = (await import('node-routeros')) as unknown as {
	RouterOSAPI: new (opts: Record<string, unknown>) => {
		connect(): Promise<unknown>;
		close(): void;
		write(menu: string, params?: string[]): Promise<Array<Record<string, string>>>;
	};
};
const conn = new mod.RouterOSAPI({
	host,
	user: MIKROTIK_USER || '',
	password: MIKROTIK_PASSWORD || '',
	port,
	tls: tls ? { rejectUnauthorized: false } : undefined,
	timeout: 8
});

try {
	await conn.connect();
	const leases = await conn.write('/ip/dhcp-server/lease/print', [`?mac-address=${mac}`]);
	if (leases.length === 0) {
		console.error(`No DHCP lease found for ${mac}. Is the device connected and using DHCP?`);
		process.exit(1);
	}
	for (const l of leases) {
		const id = l['.id'];
		const dynamic = l.dynamic === 'true';
		console.log(`lease ${id}: address=${l.address} dynamic=${l.dynamic} status=${l.status ?? '?'}`);
		if (!dynamic) {
			console.log('  already static — nothing to do.');
			continue;
		}
		await conn.write('/ip/dhcp-server/lease/make-static', [`=.id=${id}`]);
		console.log(`  ✓ made static (address ${l.address} now reserved for ${mac}).`);
	}
} catch (err) {
	console.error('✗ failed:', err instanceof Error ? err.message : err);
	process.exit(1);
} finally {
	conn.close();
}
