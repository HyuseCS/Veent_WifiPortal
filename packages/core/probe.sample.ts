const { MIKROTIK_HOST, MIKROTIK_USER, MIKROTIK_PASSWORD, MIKROTIK_PORT, MIKROTIK_TLS } = process.env;
const tls = MIKROTIK_TLS === 'true';
const port = MIKROTIK_PORT ? Number(MIKROTIK_PORT) : (tls ? 8729 : 8728);
const mod = await import('node-routeros');
const conn = new mod.RouterOSAPI({
	host: MIKROTIK_HOST,
	user: MIKROTIK_USER,
	password: MIKROTIK_PASSWORD || '',
	port: port,
	tls: tls ? { rejectUnauthorized: false } : undefined,
	timeout: 8,
});
async function step(label, fn, fatal) {
	try {
		const r = await fn();
		console.log('OK   ' + label + ' -> ' + (Array.isArray(r) ? (r.length + ' rows') : 'ok'));
		return r;
	} catch (e) {
		console.error('FAIL ' + label + ' THREW: ' + (e && e.message ? e.message : e));
		if (fatal) { console.error(e); throw e; }
		console.log('     (swallowed by the app - non-fatal)');
		return null;
	}
}
await step('connect/login', function () { return conn.connect(); }, true);
const hotspots = await step('/ip/hotspot/print', function () { return conn.write('/ip/hotspot/print'); }, true);
const ifaceSet = new Set((hotspots || []).map(function (h) { return h.interface; }).filter(Boolean));
console.log('     hotspot interfaces: ' + JSON.stringify(Array.from(ifaceSet)));
await step('/ip/hotspot/ip-binding/print type=bypassed', function () { return conn.write('/ip/hotspot/ip-binding/print',
	['?type=bypassed']); }, true);
await step('/ping', function () { return conn.write('/ping', ['=address=1.1.1.1', '=count=3']); }, false);
const ifaces = await step('/interface/print', function () { return conn.write('/interface/print'); }, true);
const list = ifaces || [];
for (let idx = 0; idx < list.length; idx++) {
	const i = list[idx];
	if (!i.name || !ifaceSet.has(i.name)) continue;
	await step('/interface/monitor-traffic ' + i.name, function () { return conn.write('/interface/monitor-traffic',
		['=interface=' + i.name, '=once=']); }, false);
}
conn.close();
console.log('');
console.log('sample sequence complete - all uncaught calls succeeded');