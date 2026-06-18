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

export interface NetworkController {
	readonly name: string;
	/** Drop the firewall for a device (allow internet). Idempotent. */
	grant(input: GrantInput): Promise<void>;
	/** Re-block a device. Idempotent — revoking an already-blocked MAC is a no-op. */
	revoke(macAddress: string): Promise<void>;
	/**
	 * Best-effort reverse lookup of a device MAC from its current LAN IP, for paths
	 * where the captive-portal redirect (which carries `?mac=`) was bypassed — e.g.
	 * an admin reaching a walled-garden-whitelisted dashboard directly. Returns null
	 * when unknown or unsupported (stub/dev). Optional: not every controller can.
	 */
	resolveMacByIp?(ipAddress: string): Promise<string | null>;
}
