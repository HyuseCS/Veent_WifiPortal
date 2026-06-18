/**
 * READ-ONLY MikroTik probe — verifies API connectivity and prints current state
 * (identity, hotspot servers, walled garden, host-table size). Modifies nothing.
 * Throwaway diagnostic; safe to delete.
 *
 *   bun run scripts/probe-router.ts
 */
const { MIKROTIK_HOST, MIKROTIK_USER, MIKROTIK_PASSWORD, MIKROTIK_PORT, MIKROTIK_TLS } = process.env;

// CLI overrides: argv[2]=host, argv[3]=port — for testing against the LAN IP.
const host = process.argv[2] || MIKROTIK_HOST;

if (!host || !MIKROTIK_USER) {
	console.error('Missing MIKROTIK_HOST / MIKROTIK_USER in apps/admin/.env');
	process.exit(1);
}

const tls = MIKROTIK_TLS === 'true';
const port = process.argv[3] ? Number(process.argv[3]) : MIKROTIK_PORT ? Number(MIKROTIK_PORT) : tls ? 8729 : 8728;

const mod = (await import('node-routeros')) as unknown as {
	RouterOSAPI: new (opts: Record<string, unknown>) => {
		connect(): Promise<unknown>;
		close(): void;
		write(menu: string, params?: string[]): Promise<Array<Record<string, string>>>;
	};
};

const conn = new mod.RouterOSAPI({
	host,
	user: MIKROTIK_USER,
	password: MIKROTIK_PASSWORD ?? '',
	port,
	tls: tls ? { rejectUnauthorized: false } : undefined,
	timeout: 8
});

const step = (m: string) => process.stderr.write(`[probe] ${m}\n`);
const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
	Promise.race([
		p,
		new Promise<T>((_, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms))
	]);

step(`connecting to ${host}:${port} (tls=${tls}) as ${MIKROTIK_USER}…`);

try {
	await withTimeout(conn.connect(), 10_000, 'connect/login');
	step('connected + authenticated ✓');
	console.log('✓ connected\n');

	const identity = await conn.write('/system/identity/print');
	console.log('identity:', identity[0]?.name ?? '(unknown)');

	const resource = await conn.write('/system/resource/print');
	console.log('routerOS:', resource[0]?.version ?? '(unknown)', '| board:', resource[0]?.['board-name'] ?? '?');

	const hotspots = await conn.write('/ip/hotspot/print');
	console.log(`\nhotspot servers: ${hotspots.length}`);
	for (const h of hotspots) console.log(`  - ${h.name} on ${h.interface} (profile ${h.profile})`);
	if (hotspots.length === 0) {
		console.log('  ⚠ no hotspot configured — walled-garden / ip-binding menus may be empty.');
	}

	const wgHost = await conn.write('/ip/hotspot/walled-garden/print');
	console.log(`\nwalled-garden (host) entries: ${wgHost.length}`);
	for (const e of wgHost) console.log(`  - action=${e.action} dst-host=${e['dst-host'] ?? '*'} comment=${e.comment ?? ''}`);

	const wgIp = await conn.write('/ip/hotspot/walled-garden/ip/print');
	console.log(`\nwalled-garden (ip) entries: ${wgIp.length}`);
	for (const e of wgIp) console.log(`  - action=${e.action} dst-address=${e['dst-address'] ?? '*'} comment=${e.comment ?? ''}`);

	const hosts = await conn.write('/ip/hotspot/host/print');
	console.log(`\nhotspot host table: ${hosts.length} device(s) currently seen`);
	for (const h of hosts.slice(0, 5)) console.log(`  - ${h['mac-address']} @ ${h.address}`);

	const bindings = await conn.write('/ip/hotspot/ip-binding/print');
	console.log(`\nip-bindings: ${bindings.length}`);
	for (const b of bindings.slice(0, 10))
		console.log(`  - ${b['mac-address'] ?? b.address ?? '?'} type=${b.type} comment=${b.comment ?? ''}`);

	console.log('\n--- raw walled-garden (host) ---');
	for (const e of wgHost) console.log(JSON.stringify(e));
	console.log('--- hotspot profile (login config / html dir) ---');
	const profiles = await conn.write('/ip/hotspot/profile/print');
	for (const p of profiles)
		console.log(`  ${p.name}: login-by=${p['login-by'] ?? '?'} html-directory=${p['html-directory'] ?? '?'}`);

	console.log('\n✓ probe complete — no changes made.');
} catch (err) {
	console.error('\n✗ probe failed:', err instanceof Error ? err.message : err);
	process.exit(1);
} finally {
	conn.close();
}
