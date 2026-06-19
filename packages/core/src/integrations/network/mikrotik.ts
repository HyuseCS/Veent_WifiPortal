import type { NetworkController, GrantInput, NetworkApSample } from './types';

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
}

/**
 * MikroTik RouterOS network controller (RouterOS v6 binary API via node-routeros).
 *
 * grant(mac)  → upsert an /ip/hotspot/ip-binding with type=bypassed for the MAC
 *               (device skips the hotspot login → full access)
 * revoke(mac) → remove that binding (device falls back under the hotspot again)
 *
 * Time is enforced by our revoke cron (expireDueSessions), matching the
 * startSession lifecycle. Connection is opened per call and closed after —
 * grant/revoke are infrequent, so a pooled socket isn't worth the complexity.
 *
 * node-routeros is imported dynamically so it's only loaded when this controller
 * is actually selected (the stub path never touches it).
 */
export function createMikrotikController(config: MikrotikConfig): NetworkController {
	const port = config.port ?? (config.tls ? 8729 : 8728);
	const tag = config.tag ?? 'veent-portal';

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
			tls: config.tls ? { rejectUnauthorized: !config.insecureTls } : undefined
		});
		await conn.connect();
		try {
			return await fn(conn);
		} finally {
			conn.close();
		}
	}

	async function findBindingIds(conn: RosConn, mac: string): Promise<string[]> {
		const rows = await conn.write('/ip/hotspot/ip-binding/print', [`?mac-address=${mac}`]);
		return rows.map((r) => r['.id']).filter((id): id is string => Boolean(id));
	}

	return {
		name: 'mikrotik',

		async grant(input: GrantInput): Promise<void> {
			const mac = input.macAddress.toUpperCase();
			// Callers may override the comment (e.g. admin bypasses tagged so the
			// time-based revoke cron, which only touches session MACs, leaves them be).
			const comment = input.tag ?? tag;
			await withConn(async (conn) => {
				const ids = await findBindingIds(conn, mac);
				if (ids.length > 0) {
					// Idempotent: ensure the existing binding is a bypass.
					await conn.write('/ip/hotspot/ip-binding/set', [
						`=.id=${ids[0]}`,
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
			});
		},

		async revoke(mac: string): Promise<void> {
			const m = mac.toUpperCase();
			await withConn(async (conn) => {
				for (const id of await findBindingIds(conn, m)) {
					await conn.write('/ip/hotspot/ip-binding/remove', [`=.id=${id}`]);
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
				// Which interface carries the hotspot, and how many devices we've put
				// online. Our model grants via bypassed ip-bindings (not hotspot logins),
				// so that's the honest "connected users" count — attributed to the
				// hotspot interface.
				const hotspots = await conn.write('/ip/hotspot/print');
				const hotspotIface = hotspots[0]?.interface;
				const bypassed = await conn.write('/ip/hotspot/ip-binding/print', ['?type=bypassed']);
				const connectedUsers = bypassed.length;

				const ifaces = await conn.write('/interface/print');
				const samples: NetworkApSample[] = [];
				for (const i of ifaces) {
					if (i.disabled === 'true' || i.type === 'loopback' || !i.name) continue;
					const running = i.running === 'true';
					// Only surface live links + the hotspot interface (even if down, so an
					// outage is visible). Skips idle/unplugged ports (e.g. spare ethers).
					if (!running && i.name !== hotspotIface) continue;
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
						users: i.name === hotspotIface ? connectedUsers : 0,
						throughputMbps
					});
				}
				return samples;
			});
		}
	};
}

/** Minimal shape of the node-routeros connection we use. */
interface RosConn {
	connect(): Promise<unknown>;
	close(): void;
	write(menu: string, params?: string[]): Promise<Array<Record<string, string>>>;
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
		tls: config.tls ? { rejectUnauthorized: !config.insecureTls } : undefined
	});
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
