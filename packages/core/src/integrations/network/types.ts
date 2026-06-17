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
}

export interface NetworkController {
	readonly name: string;
	/** Drop the firewall for a device (allow internet). Idempotent. */
	grant(input: GrantInput): Promise<void>;
	/** Re-block a device. Idempotent — revoking an already-blocked MAC is a no-op. */
	revoke(macAddress: string): Promise<void>;
}
