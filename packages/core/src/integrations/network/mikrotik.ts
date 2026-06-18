import type { NetworkController, GrantInput } from './types';

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
			await withConn(async (conn) => {
				const ids = await findBindingIds(conn, mac);
				if (ids.length > 0) {
					// Idempotent: ensure the existing binding is a bypass.
					await conn.write('/ip/hotspot/ip-binding/set', [
						`=.id=${ids[0]}`,
						'=type=bypassed',
						`=comment=${tag}`
					]);
				} else {
					await conn.write('/ip/hotspot/ip-binding/add', [
						`=mac-address=${mac}`,
						'=type=bypassed',
						`=comment=${tag}`
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
		}
	};
}

/** Minimal shape of the node-routeros connection we use. */
interface RosConn {
	connect(): Promise<unknown>;
	close(): void;
	write(menu: string, params?: string[]): Promise<Array<Record<string, string>>>;
}
