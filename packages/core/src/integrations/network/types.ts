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

/**
 * How much of a MAC's bypass to remove on `revoke`. Required (a compile-time forcing function) so a
 * caller can never accidentally cross tags: guest-lifecycle callers pass `{ tag: 'veent-portal' }`,
 * admin sign-out `{ tag: 'veent-admin' }`, and the destructive levers (block / kick / delete) pass
 * `{ all: true }` to cut the device fully regardless of tag.
 */
export type RevokeScope = { tag: string } | { all: true };

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

/** Input for applying (or clearing) an aggregate per-AP bandwidth cap on the router. */
export interface InterfaceLimitInput {
	/** Stable AP identity (`network_health.name`) — names/comments the queue so it can be
	 * found, updated, and removed idempotently, and is traceable back to the row. */
	apName: string;
	/** Router interface the AP maps to (`network_health.interfaceName ?? name`). The
	 * controller resolves this interface's client subnet as the queue target. */
	interfaceName: string;
	/** Aggregate download cap toward clients, in Kbps. Null = no download cap. */
	downKbps: number | null;
	/** Aggregate upload cap from clients, in Kbps. Null = no upload cap. */
	upKbps: number | null;
}

/** Input for proactively transitioning a granted device into an *active* hotspot session. */
export interface ActivateSessionInput {
	macAddress: string;
	/** Current LAN IP of the device, when known — the RouterOS hotspot login needs MAC + IP. When
	 * omitted, the controller resolves it from the router's own host/lease/ARP tables. */
	ipAddress?: string;
}

/** Input for opening pre-auth host access for ONE device (the reCAPTCHA-during-checkout case). */
export interface DeviceHostAccessInput {
	/** Device MAC — the controller resolves its current LAN IP to scope the walled-garden entry
	 * (the hotspot NATs client traffic, so the app can't observe the device IP directly). */
	macAddress: string;
	/** Hostnames to allow for THIS device only (src-address scoped), pre-auth. */
	hosts: string[];
}

export interface NetworkController {
	readonly name: string;
	/** Drop the firewall for a device (allow internet). Idempotent. */
	grant(input: GrantInput): Promise<void>;
	/**
	 * Proactively place an already-granted device into an *active* hotspot session so the OS
	 * captive probe clears immediately (Issue 2 — "post-auth captive-state delay"). `grant`
	 * only adds an `ip-binding type=bypassed`, which lets traffic through but does NOT put the
	 * device in `/ip/hotspot/active`, so the OS can linger on "Sign in to network". The MikroTik
	 * controller drives `/ip/hotspot/active/login` over the **binary API** (RouterOS v6 has no
	 * REST). Activation is a UX layer ON TOP of the durable `grant` binding, so a failure here
	 * must never revoke access. Idempotent. Optional: stub/dev and controllers without a hotspot
	 * login path omit it, and callers treat it as best-effort.
	 */
	activateSession?(input: ActivateSessionInput): Promise<void>;
	/**
	 * Re-block a device by removing its bypass binding(s). Idempotent. `scope` bounds which bindings
	 * are removed so guest and admin lifecycles can't clobber each other — see {@link RevokeScope}.
	 */
	revoke(macAddress: string, scope: RevokeScope): Promise<void>;
	/**
	 * Apply an aggregate up/down bandwidth cap to one AP by installing a `/queue/simple`
	 * on the hotspot's client subnet (falling back to the interface). Idempotent: updates
	 * the existing queue if present, adds it if not, and removes it when both caps are null.
	 * Enforcement is independent of the `bypassed` ip-bindings `grant` uses, so it limits
	 * all guest traffic on the AP. Best-effort — a failure must not break the admin save.
	 * Optional: stub/dev and controllers without queue support omit it.
	 */
	applyInterfaceLimit?(input: InterfaceLimitInput): Promise<void>;
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
	 * Open `hosts` in the hotspot walled garden for ONE device only, scoped to its current
	 * LAN IP (`src-address`). Used to render Maya's checkout reCAPTCHA (served from
	 * google.com/gstatic.com) WITHOUT a *global* allow — a global allow of those hosts lets
	 * Android's connectivity probe (`.../generate_204`) succeed pre-auth, so every connecting
	 * guest briefly shows "connected" then flips back to "Sign in to network". Scoping the
	 * allow to the paying device keeps the sign-in screen clean for everyone else. Entries are
	 * comment-stamped with a creation time so `sweepHostAccess` can expire them. Resolves the
	 * device IP from the MAC via the hotspot host table (currently-connected clients only, so a
	 * stale MAC can't scope access to a reused IP); returns the IP it scoped to, or null when the
	 * device isn't a current hotspot client (nothing added). Best-effort; optional (stub omits).
	 */
	openHostAccessForDevice?(input: DeviceHostAccessInput): Promise<{ ipAddress: string | null }>;
	/**
	 * Remove per-device host-access entries (added by `openHostAccessForDevice`) older than
	 * `maxAgeMs`. Self-describing on the router — the creation time is encoded in each entry's
	 * comment, so this needs no external state and survives an app restart. Returns the count
	 * removed. Optional (stub omits).
	 */
	sweepHostAccess?(input?: { maxAgeMs?: number }): Promise<number>;
	/**
	 * Remove admin-device bypass bindings (`veent-admin:<epoch>`) older than `maxAgeMs` — the 4h cap.
	 * Self-describing on the router (the creation time is in each comment), so no external state.
	 * Only timestamped bindings are eligible; bare/legacy `veent-admin` is grandfathered. Returns the
	 * MACs it reaped so the caller can restore a guest binding for any that still hold a live window
	 * (mutual exclusion across the expiry). Optional (stub returns none).
	 */
	sweepAdminBindings?(input?: { maxAgeMs?: number }): Promise<string[]>;
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
