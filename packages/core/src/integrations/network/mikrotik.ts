import type {
	NetworkController,
	GrantInput,
	NetworkApSample,
	RouterLogEntry,
	ActivateSessionInput,
	InterfaceLimitInput,
	DeviceHostAccessInput
} from './types';

export interface MikrotikConfig {
	host: string;
	user: string;
	password: string;
	/** 8728 for plain `api`, 8729 for `api-ssl`. Defaults by `tls`. */
	port?: number;
	/** Use api-ssl (TLS). */
	tls?: boolean;
	/** Accept a self-signed api-ssl cert (sets rejectUnauthorized=false). */
	insecureTls?: boolean;
	/** Comment written on bindings we create, so ours are identifiable. */
	tag?: string;
	/** Router interfaces to omit from health sampling even if a hotspot binds them
	 * (e.g. a wired/management `ether2` that isn't a guest AP). Matched by exact name. */
	excludeInterfaces?: string[];
	/**
	 * Hotspot login identity used by `activateSession` (over the binary API — RouterOS v6 has no
	 * REST). Setting `hotspotLoginUser` OPTS IN to activation: after a grant the controller logs
	 * the device into the hotspot via `/ip/hotspot/active/login` so it appears in
	 * `/ip/hotspot/active` immediately and the OS captive "Sign in to network" banner clears at
	 * once. Must name a real hotspot user on the guest profile (e.g. a shared `veent-guest`) — the
	 * deployment profile is `login-by=http-chap`, so the device-MAC-as-user shortcut does NOT
	 * apply. When unset, `activateSession` is not exposed (grant/revoke still work; the banner just
	 * clears a little slower).
	 */
	hotspotLoginUser?: string;
	hotspotLoginPassword?: string;
}

/**
 * MikroTik RouterOS network controller (RouterOS v6 binary API via node-routeros).
 *
 * grant(mac)  → upsert an /ip/hotspot/ip-binding with type=bypassed for the MAC
 *               (device skips the hotspot login → full access)
 * revoke(mac) → remove that binding (device falls back under the hotspot again)
 *
 * Time is enforced by our revoke cron (expireDueAccounts), matching the
 * account-access lifecycle. Connection is opened per call and closed after —
 * grant/revoke are infrequent, so a pooled socket isn't worth the complexity.
 *
 * node-routeros is imported dynamically so it's only loaded when this controller
 * is actually selected (the stub path never touches it).
 */
/** Public host the router pings to gauge internet round-trip latency. */
const LATENCY_PROBE_HOST = '1.1.1.1';
/** Hard ceiling for the latency ping so a hung ping stream can't stall a health refresh. */
const PING_TIMEOUT_MS = 5000;
/** Comment/name prefix on the per-AP bandwidth queues we create, so ours are identifiable
 * and a re-apply updates rather than duplicates: `veent-hotspot-limit:<apName>`. */
const LIMIT_TAG = 'veent-hotspot-limit';

/** Comment prefix on the per-device, src-scoped walled-garden entries `openHostAccessForDevice`
 * creates. The creation time is appended (`veent-checkout:<epochMs>`) so `sweepHostAccess` can
 * expire them with no external state — the router row is self-describing. */
const CHECKOUT_TAG = 'veent-checkout';

/**
 * Render a Kbps cap as a RouterOS queue rate token. RouterOS `k` is decimal (×1000), so
 * `<kbps>k` is exactly the kilobit rate. Null → `0`, which RouterOS reads as *unlimited* —
 * used for the side of an asymmetric cap (only up or only down set). Exported for tests.
 */
export function formatQueueRate(kbps: number | null): string {
	return kbps == null ? '0' : `${Math.round(kbps)}k`;
}

/**
 * Network address for an IPv4 `address/prefix` (e.g. `10.210.0.1/18` → `10.210.0.0/18`),
 * so a simple queue can target the AP's whole client subnet. Returns null on a malformed or
 * non-IPv4 input (caller falls back to interface-target). Exported for tests.
 */
export function ipv4NetworkOf(cidr: string): string | null {
	const [ip, prefixStr] = cidr.split('/');
	const prefix = Number(prefixStr);
	if (!ip || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
	const octets = ip.split('.').map(Number);
	if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
		return null;
	}
	const ipInt = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
	const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
	const netInt = (ipInt & mask) >>> 0;
	const net = [(netInt >>> 24) & 255, (netInt >>> 16) & 255, (netInt >>> 8) & 255, netInt & 255];
	return `${net.join('.')}/${prefix}`;
}

/** Reject if `p` doesn't settle within `ms` — bounds a single router call's wall time. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
		p.then(
			(v) => {
				clearTimeout(t);
				resolve(v);
			},
			(e) => {
				clearTimeout(t);
				reject(e);
			}
		);
	});
}

/** Parse a RouterOS ping `time` value ("12ms", "834us", "1s200ms") into milliseconds. */
function rttToMs(raw: unknown): number | null {
	if (typeof raw !== 'string') return null;
	let total = 0;
	let ok = false;
	const us = /(\d+(?:\.\d+)?)us/.exec(raw);
	const ms = /(\d+(?:\.\d+)?)ms/.exec(raw);
	// A standalone `s` not part of `ms`/`us` and not followed by another letter.
	const s = /(?:^|[^a-z])(\d+(?:\.\d+)?)s(?![a-z])/i.exec(raw);
	if (s) {
		total += parseFloat(s[1]) * 1000;
		ok = true;
	}
	if (ms) {
		total += parseFloat(ms[1]);
		ok = true;
	}
	if (us) {
		total += parseFloat(us[1]) / 1000;
		ok = true;
	}
	return ok ? total : null;
}

export function createMikrotikController(config: MikrotikConfig): NetworkController {
	const port = config.port ?? (config.tls ? 8729 : 8728);
	const tag = config.tag ?? 'veent-portal';
	// Interfaces to keep off the Networks view / map even if a hotspot binds them.
	const excludeIfaces = new Set(config.excludeInterfaces ?? []);

	async function withConn<T>(fn: (conn: RosConn) => Promise<T>): Promise<T> {
		if (!config.host || !config.user) throw new Error('mikrotik: host/user not configured');
		const mod = (await import('node-routeros')) as unknown as {
			RouterOSAPI: new (opts: Record<string, unknown>) => RosConn;
		};
		const conn = new mod.RouterOSAPI({
			host: config.host,
			user: config.user,
			password: config.password,
			port,
			timeout: 15,
			tls: config.tls ? { rejectUnauthorized: !config.insecureTls } : undefined
		});
		// node-routeros surfaces socket failures (e.g. SOCKTMOUT — common on a slow or
		// api-ssl link) by throwing from inside the socket 'error'/'timeout' event. With
		// no listener that escapes the awaited call and becomes an UNCAUGHT exception that
		// crashes the whole server. Swallow it here — connect()/write() already reject on
		// failure, which callers catch and turn into an empty result / 500.
		conn.on?.('error', () => {});
		await conn.connect();
		try {
			return await fn(conn);
		} finally {
			// close() can itself throw on an already-errored socket — never let teardown
			// mask the real result or crash on a half-dead connection.
			try {
				conn.close();
			} catch {
				/* already closed */
			}
		}
	}

	async function findBindingIds(conn: RosConn, mac: string): Promise<string[]> {
		const rows = await conn.write('/ip/hotspot/ip-binding/print', [`?mac-address=${mac}`]);
		return rows.map((r) => r['.id']).filter((id): id is string => Boolean(id));
	}

	/**
	 * Drop the device's lingering hotspot host entry so a freshly-added bypass takes
	 * effect immediately. Without this, RouterOS keeps applying the hotspot's DNS
	 * hijack + HTTP redirect to the host's EXISTING tracked connections until they age
	 * out — the device has access but is painfully slow for minutes, and the OS captive
	 * check only flips to "connected" once it happens to re-probe. Removing the host
	 * forces a clean re-evaluation, and since the bypass binding is already in place the
	 * device re-appears bypassed. Best-effort: a grant must never fail over this cleanup.
	 */
	async function flushHotspotHost(conn: RosConn, mac: string): Promise<void> {
		try {
			const hosts = await conn.write('/ip/hotspot/host/print', [`?mac-address=${mac}`]);
			for (const h of hosts) {
				const id = h['.id'];
				if (!id) continue;
				try {
					await conn.write('/ip/hotspot/host/remove', [`=.id=${id}`]);
				} catch {
					// Host entry already gone / dynamic refresh — ignore.
				}
			}
		} catch {
			// Host table unavailable — the bypass alone still works, just slower to settle.
		}
	}

	/** Every current IP the router associates with `mac` — hotspot host table, DHCP lease,
	 * then ARP (each may be absent / stale; we union whatever's there). Used to find the
	 * conntrack rows to cut on revoke. */
	async function ipsForMac(conn: RosConn, mac: string): Promise<string[]> {
		const out = new Set<string>();
		const sources: [string, string][] = [
			['/ip/hotspot/host/print', `?mac-address=${mac}`],
			['/ip/dhcp-server/lease/print', `?mac-address=${mac}`],
			['/ip/arp/print', `?mac-address=${mac}`]
		];
		for (const [path, query] of sources) {
			try {
				const rows = await conn.write(path, [query]);
				for (const r of rows) if (r.address) out.add(r.address);
			} catch {
				// This table is unavailable / not installed — skip it, try the next source.
			}
		}
		return [...out];
	}

	/**
	 * The device's IP as a CURRENTLY-CONNECTED hotspot client — read from the hotspot host table
	 * ONLY, deliberately not the DHCP-lease/ARP union `ipsForMac` returns. For opening pre-auth
	 * access scoped to a device (`openHostAccessForDevice`) we must be certain the IP still belongs
	 * to THIS device right now: a stale lease/ARP row for a MAC whose device has left could name an
	 * IP DHCP has since handed to another guest, and opening a captive-probe host (google.com) for
	 * that IP would reintroduce the connectivity-flash for the wrong guest. The hotspot host table
	 * only lists clients the router currently sees, so a miss (device gone) correctly yields null →
	 * no entry is opened. A real buyer sitting on the captive portal is always a current host.
	 */
	async function currentHotspotIpForMac(conn: RosConn, mac: string): Promise<string | null> {
		try {
			const hosts = await conn.write('/ip/hotspot/host/print', [`?mac-address=${mac}`]);
			return hosts.find((h) => h.address)?.address ?? null;
		} catch {
			// Hotspot host table unavailable — treat as "device not currently seen".
			return null;
		}
	}

	/**
	 * Drop the device's live connection-tracking entries so a revoke takes effect
	 * IMMEDIATELY. Removing the ip-binding only stops NEW flows from being bypassed — the
	 * firewall's established/related accept rule keeps forwarding the device's ALREADY-OPEN
	 * connections until they age out of conntrack, so a revoked / blocked / kicked / evicted
	 * device can keep browsing on existing sockets for minutes. Flushing the device's
	 * conntrack rows forces every flow to be re-evaluated; with the bypass now gone they hit
	 * the hotspot intercept and are cut. Best-effort: a revoke must still succeed (binding
	 * already removed) even if this cleanup can't run.
	 */
	async function cutConnectionsForMac(conn: RosConn, mac: string): Promise<void> {
		try {
			const ips = await ipsForMac(conn, mac);
			if (ips.length === 0) return;
			const rows = await conn.write('/ip/firewall/connection/print', []);
			for (const r of rows) {
				const id = r['.id'];
				if (!id) continue;
				// conntrack addresses carry a `:port` suffix — compare on the IP only, and on
				// either end so we catch the flow whichever side the device sits on.
				const src = (r['src-address'] ?? '').split(':')[0];
				const dst = (r['dst-address'] ?? '').split(':')[0];
				if (!ips.includes(src) && !ips.includes(dst)) continue;
				try {
					await conn.write('/ip/firewall/connection/remove', [`=.id=${id}`]);
				} catch {
					// Entry already closed / aged out between print and remove — ignore.
				}
			}
		} catch {
			// Connection table unavailable — binding removal alone still cuts new flows.
		}
	}

	/**
	 * Resolve the queue target for an AP interface: prefer the interface's own IP network
	 * (the client subnet), so a simple queue's upload/download read as from-client/to-client.
	 * Falls back to the interface name itself when no address is found (up/down then read
	 * relative to the interface).
	 */
	async function resolveQueueTarget(conn: RosConn, ifaceName: string): Promise<string> {
		try {
			const addrs = await conn.write('/ip/address/print', [`?interface=${ifaceName}`]);
			for (const a of addrs) {
				const net = typeof a.address === 'string' ? ipv4NetworkOf(a.address) : null;
				if (net) return net;
			}
		} catch {
			// /ip/address unavailable or query error — fall back to interface-target.
		}
		return ifaceName;
	}

	const controller: NetworkController = {
		name: 'mikrotik',

		async grant(input: GrantInput): Promise<void> {
			const mac = input.macAddress.toUpperCase();
			// Callers may override the comment (e.g. admin bypasses tagged so the
			// time-based revoke cron, which only touches session MACs, leaves them be).
			const comment = input.tag ?? tag;
			await withConn(async (conn) => {
				const rows = await conn.write('/ip/hotspot/ip-binding/print', [`?mac-address=${mac}`]);
				const existing = rows[0];
				if (existing) {
					// Already a bypass with our tag → nothing to do. Re-issuing /set here is
					// what made the router log "ip binding rule changed" on every add-time,
					// and the host-flush below would needlessly poke a live device. Access
					// time lives in the DB window (customer_profile.access_expires_at), not in
					// this binding, so a re-grant on an already-bypassed MAC is a true no-op.
					if (existing.type === 'bypassed' && existing.comment === comment) return;
					await conn.write('/ip/hotspot/ip-binding/set', [
						`=.id=${existing['.id']}`,
						'=type=bypassed',
						`=comment=${comment}`
					]);
				} else {
					await conn.write('/ip/hotspot/ip-binding/add', [
						`=mac-address=${mac}`,
						'=type=bypassed',
						`=comment=${comment}`
					]);
				}
				// Clear the stale captured host so the bypass applies right away, not after
				// the device's old intercepted connections time out (the "slow for 5 min" bug).
				// Only reached on a real add/change — an unchanged re-grant returned above.
				await flushHotspotHost(conn, mac);
			});
		},

		async revoke(mac: string): Promise<void> {
			const m = mac.toUpperCase();
			await withConn(async (conn) => {
				for (const id of await findBindingIds(conn, m)) {
					await conn.write('/ip/hotspot/ip-binding/remove', [`=.id=${id}`]);
				}
				// Removing the binding stops NEW bypassed flows; cut live conntrack + the stale
				// hotspot host entry so EXISTING connections drop immediately instead of riding
				// until they age out (a revoked device must lose internet now, not in minutes).
				await cutConnectionsForMac(conn, m);
				await flushHotspotHost(conn, m);
			});
		},

		async applyInterfaceLimit(input: InterfaceLimitInput): Promise<void> {
			const comment = `${LIMIT_TAG}:${input.apName}`;
			await withConn(async (conn) => {
				// Our queue is found by comment, so a re-apply updates the same row (idempotent),
				// mirroring provisionWalledGarden's find-by-comment.
				const existing = await conn.write('/queue/simple/print', [`?comment=${comment}`]);
				const id = existing[0]?.['.id'];

				// Both caps cleared → tear our queue down (if any). Uncapped = no queue at all.
				if (input.downKbps == null && input.upKbps == null) {
					if (id) await conn.write('/queue/simple/remove', [`=.id=${id}`]);
					return;
				}

				const target = await resolveQueueTarget(conn, input.interfaceName);
				// RouterOS max-limit is <upload>/<download> relative to the target. With the client
				// subnet as target: upload = from clients, download = to clients.
				const maxLimit = `${formatQueueRate(input.upKbps)}/${formatQueueRate(input.downKbps)}`;
				if (id) {
					await conn.write('/queue/simple/set', [
						`=.id=${id}`,
						`=target=${target}`,
						`=max-limit=${maxLimit}`,
						'=disabled=no'
					]);
				} else {
					await conn.write('/queue/simple/add', [
						`=name=${comment}`,
						`=target=${target}`,
						`=max-limit=${maxLimit}`,
						`=comment=${comment}`
					]);
				}
			});
		},

		async resolveMacByIp(ipAddress: string): Promise<string | null> {
			const ip = ipAddress.trim();
			if (!ip) return null;
			return withConn(async (conn) => {
				// Prefer the hotspot host table (knows currently-seen clients), then
				// fall back to the ARP table for statically-bound or non-hotspot LAN IPs.
				const hosts = await conn.write('/ip/hotspot/host/print', [`?address=${ip}`]);
				const fromHost = hosts.find((r) => r['mac-address'])?.['mac-address'];
				if (fromHost) return fromHost.toUpperCase();

				// DHCP lease is the most reliable IP→MAC for a DHCP client (survives ARP
				// aging and hotspot host-table churn).
				const lease = await conn.write('/ip/dhcp-server/lease/print', [`?address=${ip}`]);
				const fromLease = lease.find((r) => r['mac-address'])?.['mac-address'];
				if (fromLease) return fromLease.toUpperCase();

				const arp = await conn.write('/ip/arp/print', [`?address=${ip}`]);
				const fromArp = arp.find((r) => r['mac-address'])?.['mac-address'];
				return fromArp ? fromArp.toUpperCase() : null;
			});
		},

		async openHostAccessForDevice(
			input: DeviceHostAccessInput
		): Promise<{ ipAddress: string | null }> {
			const mac = input.macAddress.toUpperCase();
			return withConn(async (conn) => {
				// The walled garden matches the device's own hotspot-side src IP (before the router's
				// own NAT), so scope by the IP the router currently sees for this MAC. Use the hotspot
				// host table ONLY (not the lease/ARP union) so a stale MAC can't scope access to an IP
				// now belonging to another guest — see currentHotspotIpForMac.
				const ip = await currentHotspotIpForMac(conn, mac);
				if (!ip) return { ipAddress: null };
				const comment = `${CHECKOUT_TAG}:${Date.now()}`;
				for (const host of input.hosts) {
					// Refresh rather than stack: drop any prior scoped entry for this (host, src)
					// so a re-checkout renews the timestamp instead of accumulating duplicates.
					const existing = await conn.write('/ip/hotspot/walled-garden/print', [
						`?dst-host=${host}`
					]);
					for (const e of existing) {
						const srcIp = (e['src-address'] ?? '').split('/')[0];
						if (srcIp !== ip || !e['.id']) continue;
						try {
							await conn.write('/ip/hotspot/walled-garden/remove', [`=.id=${e['.id']}`]);
						} catch {
							// Already gone between print and remove — ignore.
						}
					}
					await conn.write('/ip/hotspot/walled-garden/add', [
						'=action=allow',
						`=dst-host=${host}`,
						`=src-address=${ip}`,
						`=comment=${comment}`
					]);
				}
				return { ipAddress: ip };
			});
		},

		async sweepHostAccess(input?: { maxAgeMs?: number }): Promise<number> {
			const maxAgeMs = input?.maxAgeMs ?? 15 * 60_000;
			const now = Date.now();
			return withConn(async (conn) => {
				const rows = await conn.write('/ip/hotspot/walled-garden/print', []);
				let removed = 0;
				for (const r of rows) {
					const comment = r.comment ?? '';
					if (!comment.startsWith(`${CHECKOUT_TAG}:`)) continue;
					const ts = Number(comment.slice(CHECKOUT_TAG.length + 1));
					if (!Number.isFinite(ts) || now - ts < maxAgeMs) continue;
					if (!r['.id']) continue;
					try {
						await conn.write('/ip/hotspot/walled-garden/remove', [`=.id=${r['.id']}`]);
						removed++;
					} catch {
						// Raced with another sweep / manual removal — ignore.
					}
				}
				return removed;
			});
		},

		async listRouterLog(opts?: { limit?: number }): Promise<RouterLogEntry[]> {
			const limit = opts?.limit ?? 60;
			return withConn(async (conn) => {
				// /log returns the whole buffer oldest→newest; we take the newest tail.
				const rows = await conn.write('/log/print', []);
				const entries = rows.map((r) => ({
					time: r.time ?? '',
					topics: r.topics ?? '',
					message: r.message ?? ''
				}));
				// Hide our own API churn — we open a fresh connection per call, so the
				// log fills with "<user> logged in/out … via api". That's noise, not
				// guest activity, and would otherwise dominate the panel.
				const guestRelevant = entries.filter((e) => !/logged (in|out).*via api/i.test(e.message));
				return guestRelevant.slice(-limit).reverse();
			});
		},

		async listGuestBindings(): Promise<{ macAddress: string }[]> {
			return withConn(async (conn) => {
				const rows = await conn.write('/ip/hotspot/ip-binding/print', ['?type=bypassed']);
				// Only our guest-tagged bindings — never admin bypasses or operator-added
				// (untagged) ones. Filter in JS so we don't rely on RouterOS query AND-ing.
				return rows
					.filter((r) => r.comment === tag)
					.map((r) => r['mac-address'])
					.filter((m): m is string => Boolean(m))
					.map((m) => ({ macAddress: m.toUpperCase() }));
			});
		},

		async resolveApForMac(macAddress: string): Promise<string | null> {
			const mac = macAddress.toUpperCase();
			return withConn(async (conn) => {
				// CAPsMAN first (multi-AP deployments report the managed AP interface),
				// then the local wireless registration table. Each may be absent
				// depending on the RouterOS package set — treat a query error as "n/a".
				try {
					const caps = await conn.write('/caps-man/registration-table/print', [
						`?mac-address=${mac}`
					]);
					const iface = caps.find((r) => r.interface)?.interface;
					if (iface) return iface;
				} catch {
					// CAPsMAN not installed/enabled — fall through.
				}
				try {
					const reg = await conn.write('/interface/wireless/registration-table/print', [
						`?mac-address=${mac}`
					]);
					const iface = reg.find((r) => r.interface)?.interface;
					if (iface) return iface;
				} catch {
					// wireless package absent (e.g. CHR/x86) — fall through.
				}
				// Wired/VLAN deployments (third-party APs, no MikroTik radio): the ARP
				// table maps the MAC to the interface/VLAN it's reachable on (e.g.
				// "vlan70 hotspot"). Prefer a completed entry. This is per-VLAN, not
				// per-physical-AP — the router can't see past a shared hotspot VLAN.
				try {
					const arp = await conn.write('/ip/arp/print', [`?mac-address=${mac}`]);
					const iface =
						arp.find((r) => r.interface && r.complete === 'true')?.interface ??
						arp.find((r) => r.interface)?.interface;
					if (iface) return iface;
				} catch {
					// ARP unavailable — give up.
				}
				return null;
			});
		},

		async sampleHealth(): Promise<NetworkApSample[]> {
			return withConn(async (conn) => {
				// Only guest-serving interfaces belong on the Networks view: the
				// interface(s) a hotspot server is bound to. Physical uplinks/ports and
				// non-hotspot VLANs (e.g. a WAN transit VLAN) are router plumbing, not
				// access networks, so we skip them entirely. Supports multiple hotspots.
				const hotspots = await conn.write('/ip/hotspot/print');
				const hotspotIfaces = new Set(
					hotspots.map((h) => h.interface).filter((n): n is string => Boolean(n))
				);
				if (hotspotIfaces.size === 0) return [];

				// We grant via bypassed ip-bindings (not hotspot logins), so that's the
				// coarse "connected" count. The live per-AP number is recomputed from
				// sessions downstream — this is just the fallback.
				const bypassed = await conn.write('/ip/hotspot/ip-binding/print', ['?type=bypassed']);
				const connectedUsers = bypassed.length;

				// Internet round-trip latency: one ping per refresh, shared across all
				// interfaces (the WAN path is the same regardless of which hotspot VLAN).
				// Best-effort — a blocked/absent ping or no internet leaves latency null.
				let latencyMs: number | null = null;
				try {
					const pings = await withTimeout(
						conn.write('/ping', [`=address=${LATENCY_PROBE_HOST}`, '=count=3']),
						PING_TIMEOUT_MS,
						'ping'
					);
					const times = pings
						.map((p) => rttToMs(p.time))
						.filter((n): n is number => n != null);
					if (times.length) {
						latencyMs = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
					}
				} catch {
					// ping unavailable / no internet — leave null
				}

				const ifaces = await conn.write('/interface/print');
				const samples: NetworkApSample[] = [];
				for (const i of ifaces) {
					// Surface a hotspot interface even when down, so an outage is visible —
					// unless it's explicitly excluded (non-guest interfaces like ether2).
					if (!i.name || !hotspotIfaces.has(i.name) || excludeIfaces.has(i.name)) continue;
					const running = i.running === 'true';
					let throughputMbps = 0;
					if (running) {
						try {
							// One-shot rate snapshot; `=once=` returns a single reply (no stream).
							const t = await conn.write('/interface/monitor-traffic', [
								`=interface=${i.name}`,
								'=once='
							]);
							const rx = Number(t[0]?.['rx-bits-per-second'] ?? 0);
							const tx = Number(t[0]?.['tx-bits-per-second'] ?? 0);
							throughputMbps = Math.round((rx + tx) / 1_000_000);
						} catch {
							// throughput unavailable for this interface — leave 0, keep going
						}
					}
					samples.push({
						name: i.name,
						online: running,
						users: connectedUsers,
						throughputMbps,
						latencyMs: running ? latencyMs : null
					});
				}
				return samples;
			});
		}
	};

	// Expose activateSession ONLY when a hotspot login user is configured, so callers'
	// optional-chaining (`network.activateSession?.(…)`) correctly no-ops on setups that don't opt
	// in. Activation runs over the SAME binary API as grant/revoke (RouterOS v6 has no REST) — it's
	// a UX layer ON TOP of the durable `grant` binding, so a failure here must never affect access;
	// the caller treats it as best-effort.
	if (config.hotspotLoginUser) {
		controller.activateSession = async (input: ActivateSessionInput): Promise<void> => {
			const mac = input.macAddress.toUpperCase();
			await withConn(async (conn) => {
				// RouterOS hotspot login wants the device IP; resolve it from the router's own tables
				// when the caller didn't pass one (the session layer only has the MAC).
				let ip = input.ipAddress?.trim() || '';
				if (!ip) {
					const ips = await ipsForMac(conn, mac);
					ip = ips[0] ?? '';
				}
				// Without an IP RouterOS can't match the host — nothing to activate. Best-effort: bail.
				if (!ip) return;

				// /ip hotspot active login — the same command proven by hand on the router console.
				// Param names mirror the console exactly (`mac-address`, not `mac`).
				await conn.write('/ip/hotspot/active/login', [
					`=ip=${ip}`,
					`=mac-address=${mac}`,
					`=user=${config.hotspotLoginUser}`,
					`=password=${config.hotspotLoginPassword ?? ''}`
				]);
			});
		};
	}

	return controller;
}

/** Minimal shape of the node-routeros connection we use. */
interface RosConn {
	connect(): Promise<unknown>;
	close(): void;
	write(menu: string, params?: string[]): Promise<Array<Record<string, string>>>;
	/** node-routeros connections are EventEmitters; attach to swallow async socket errors. */
	on?(event: string, listener: (...args: unknown[]) => void): void;
}

async function openConn(config: MikrotikConfig): Promise<RosConn> {
	if (!config.host || !config.user) throw new Error('mikrotik: host/user not configured');
	const port = config.port ?? (config.tls ? 8729 : 8728);
	const mod = (await import('node-routeros')) as unknown as {
		RouterOSAPI: new (opts: Record<string, unknown>) => RosConn;
	};
	const conn = new mod.RouterOSAPI({
		host: config.host,
		user: config.user,
		password: config.password,
		port,
		timeout: 15,
		tls: config.tls ? { rejectUnauthorized: !config.insecureTls } : undefined
	});
	// See withConn: without an 'error' listener a socket timeout becomes an uncaught
	// exception that crashes the server. The awaited connect()/write() still reject.
	conn.on?.('error', () => {});
	await conn.connect();
	return conn;
}

export interface WalledGardenInput {
	/** DNS hostnames to allow pre-auth, e.g. `admin.veent.lan` (matched as `*host`). */
	hosts?: string[];
	/** LAN IPs/CIDRs to allow pre-auth at the IP layer, e.g. `10.5.50.1`. */
	ips?: string[];
	/** Comment on the entries we create, so a re-run updates rather than duplicates. */
	tag?: string;
}

export interface WalledGardenResult {
	hosts: { value: string; created: boolean }[];
	ips: { value: string; created: boolean }[];
}

/**
 * Idempotently opens holes in a MikroTik hotspot's walled garden so a device can
 * reach the given hosts/IPs *before* authenticating — the same mechanism the
 * payment gateways use, here pointed at the LAN-served admin dashboard.
 *
 *   hosts → /ip/hotspot/walled-garden        (HTTP-layer, dst-host)
 *   ips   → /ip/hotspot/walled-garden/ip     (all protocols, dst-address)
 *
 * Re-running is safe: entries already carrying our tag are left in place.
 */
export async function provisionWalledGarden(
	config: MikrotikConfig,
	input: WalledGardenInput
): Promise<WalledGardenResult> {
	const tag = input.tag ?? 'veent-admin';
	const result: WalledGardenResult = { hosts: [], ips: [] };
	const conn = await openConn(config);
	try {
		for (const host of input.hosts ?? []) {
			const existing = await conn.write('/ip/hotspot/walled-garden/print', [`?dst-host=${host}`]);
			if (existing.length > 0) {
				result.hosts.push({ value: host, created: false });
				continue;
			}
			await conn.write('/ip/hotspot/walled-garden/add', [
				'=action=allow',
				`=dst-host=${host}`,
				`=comment=${tag}`
			]);
			result.hosts.push({ value: host, created: true });
		}

		for (const ip of input.ips ?? []) {
			const existing = await conn.write('/ip/hotspot/walled-garden/ip/print', [
				`?dst-address=${ip}`
			]);
			if (existing.length > 0) {
				result.ips.push({ value: ip, created: false });
				continue;
			}
			await conn.write('/ip/hotspot/walled-garden/ip/add', [
				'=action=accept',
				`=dst-address=${ip}`,
				`=comment=${tag}`
			]);
			result.ips.push({ value: ip, created: true });
		}
	} finally {
		conn.close();
	}
	return result;
}

export interface RestrictApiInput {
	/** Source IP (or CIDR) allowed to reach the RouterOS API — the app server's LAN IP. */
	sourceIp: string;
	/** Also disable the cleartext `api` (8728). Only pass when already connected over api-ssl. */
	disablePlainApi?: boolean;
	/** Best-effort: convert the source IP's DHCP lease to static so the IP can't change. */
	pinLease?: boolean;
}

export interface RestrictApiResult {
	apiSslAddress: string;
	plainApiDisabled: boolean;
	/** true = pinned/already static, 'no-lease' = no DHCP lease found (likely a static IP). */
	leasePinned: boolean | 'no-lease';
}

/**
 * Lock the RouterOS API to one source IP: restrict `api-ssl`'s *Available From* to
 * `sourceIp/32` (the api-ssl cert + service must already exist), optionally disable the
 * cleartext `api` service, and optionally pin the source IP's DHCP lease. Used by the
 * server-migration helper so the app server's new IP is whitelisted on the router.
 *
 * Safe by construction when `sourceIp` is the address THIS process reaches the router from —
 * restricting api-ssl to your own source IP can't drop your own connection. (Don't disable
 * cleartext `api` while you're connected over it; the caller guards on that.)
 */
export async function restrictApiService(
	config: MikrotikConfig,
	input: RestrictApiInput
): Promise<RestrictApiResult> {
	const cidr = input.sourceIp.includes('/') ? input.sourceIp : `${input.sourceIp}/32`;
	const conn = await openConn(config);
	try {
		const services = await conn.write('/ip/service/print');
		const apiSsl = services.find((s) => s.name === 'api-ssl');
		if (!apiSsl?.['.id']) {
			throw new Error(
				'api-ssl service not found — set up the self-signed cert + api-ssl on the router first.'
			);
		}
		await conn.write('/ip/service/set', [
			`=.id=${apiSsl['.id']}`,
			`=address=${cidr}`,
			'=disabled=no'
		]);

		let plainApiDisabled = false;
		if (input.disablePlainApi) {
			const api = services.find((s) => s.name === 'api');
			if (api?.['.id']) {
				await conn.write('/ip/service/set', [`=.id=${api['.id']}`, '=disabled=yes']);
				plainApiDisabled = true;
			}
		}

		let leasePinned: boolean | 'no-lease' = false;
		if (input.pinLease) {
			const ip = cidr.split('/')[0];
			const leases = await conn.write('/ip/dhcp-server/lease/print', [`?address=${ip}`]);
			const lease = leases.find((l) => l['.id']);
			if (!lease) {
				leasePinned = 'no-lease';
			} else if (lease.dynamic === 'true') {
				await conn.write('/ip/dhcp-server/lease/make-static', [`=.id=${lease['.id']}`]);
				leasePinned = true;
			} else {
				leasePinned = true; // already static
			}
		}

		return { apiSslAddress: cidr, plainApiDisabled, leasePinned };
	} finally {
		conn.close();
	}
}
