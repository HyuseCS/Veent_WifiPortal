/**
 * Provider-agnostic network-access abstraction — the seam between the web app and
 * the physical router/controller (the "missing link" the docs call out). The app
 * codes against `NetworkController` only; the concrete strategy (UniFi/Omada
 * controller API, RADIUS CoA, or a router grant_url) is chosen by the impl.
 */

export interface GrantInput {
	macAddress: string;
	/** How long access should last; the controller may enforce its own timeout. */
	durationMinutes: number;
	/** Optional speed cap (Mbps) for grace/free tiers. */
	bandwidthMbps?: number;
	/**
	 * Overrides the comment/tag the controller writes on the binding it creates.
	 * Lets callers distinguish kinds of grants (e.g. an admin-device bypass the
	 * time-based revoke cron must never sweep) from ordinary guest sessions.
	 */
	tag?: string;
}

/** A light, live health sample for one router interface (the unit the controller
 * can actually report on without per-AP probing). */
export interface NetworkApSample {
	/** Interface name as the router knows it (e.g. `vlan70`, `ether1`). */
	name: string;
	/** Link is up (`running`). */
	online: boolean;
	/** Connected hotspot users attributed to this interface (0 for non-hotspot). */
	users: number;
	/** Current rx+tx throughput in Mbps (from a one-shot monitor-traffic sample). */
	throughputMbps: number;
	/** Internet round-trip latency in ms (router ping to a public host). Null when
	 * the controller can't measure it (stub/dev, no internet, ping unavailable). */
	latencyMs?: number | null;
}

export interface NetworkController {
	readonly name: string;
	/** Drop the firewall for a device (allow internet). Idempotent. */
	grant(input: GrantInput): Promise<void>;
	/** Re-block a device. Idempotent — revoking an already-blocked MAC is a no-op. */
	revoke(macAddress: string): Promise<void>;
	/** Live per-interface health (link/users/throughput) for the Networks page.
	 * Optional: only controllers with telemetry implement it (the stub doesn't). */
	sampleHealth?(): Promise<NetworkApSample[]>;
	/**
	 * Best-effort reverse lookup of a device MAC from its current LAN IP, for paths
	 * where the captive-portal redirect (which carries `?mac=`) was bypassed — e.g.
	 * an admin reaching a walled-garden-whitelisted dashboard directly. Returns null
	 * when unknown or unsupported (stub/dev). Optional: not every controller can.
	 */
	resolveMacByIp?(ipAddress: string): Promise<string | null>;
	/**
	 * Best-effort: which AP/interface the device (by MAC) is currently associated
	 * with, for per-AP user attribution. Returns the interface/AP name as the router
	 * knows it (match against `network_health.name`), or null when unknown. Optional:
	 * controllers that can't tell (stub/dev) omit it.
	 */
	resolveApForMac?(macAddress: string): Promise<string | null>;
	/**
	 * Lists the *guest* bypass bindings this controller created (by our tag), so a
	 * reconcile pass can drop ones that no longer map to an active session. Excludes
	 * admin bypasses and any manually-added bindings. Optional: stub/dev omit it.
	 */
	listGuestBindings?(): Promise<{ macAddress: string }[]>;
	/**
	 * Recent entries from the router's own system log (newest first), for a live
	 * admin view. Optional: stub/dev omit it.
	 */
	listRouterLog?(opts?: { limit?: number }): Promise<RouterLogEntry[]>;
}

/** One line of the router's system log (`/log` in MikroTik). */
export interface RouterLogEntry {
	/** Router-formatted time, e.g. `12:59:48` or `jun/19 12:59:48`. */
	time: string;
	/** Comma-joined topics, e.g. `hotspot,info,account`. */
	topics: string;
	message: string;
}
