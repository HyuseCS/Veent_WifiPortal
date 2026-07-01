import { env } from '$env/dynamic/private';
import { createNetworkController, type NetworkConfig } from '@veent/core';

// Admin's network controller — same abstraction the customer app uses, for
// block/kick. NETWORK_CONTROLLER=stub (default) | mikrotik
function buildConfig(): NetworkConfig {
	if (env.NETWORK_CONTROLLER === 'mikrotik') {
		return {
			controller: 'mikrotik',
			host: env.MIKROTIK_HOST || '',
			user: env.MIKROTIK_USER || '',
			password: env.MIKROTIK_PASSWORD || '',
			port: env.MIKROTIK_PORT ? Number(env.MIKROTIK_PORT) : undefined,
			tls: env.MIKROTIK_TLS === 'true',
			insecureTls: env.MIKROTIK_TLS_INSECURE === 'true',
			// MIKROTIK_HOTSPOT_USER opts in to hotspot activation over the binary API — used by the
			// admin comp/extend path, which also funnels through the shared bind→activate hook
			// (Issue 2). Optional.
			hotspotLoginUser: env.MIKROTIK_HOTSPOT_USER || undefined,
			hotspotLoginPassword: env.MIKROTIK_HOTSPOT_PASSWORD || undefined,
			// Comma-separated router interfaces to hide from the Networks view / map
			// (e.g. a wired `ether2` that isn't a guest AP).
			excludeInterfaces: (env.HEALTH_EXCLUDE_INTERFACES ?? '')
				.split(',')
				.map((s) => s.trim())
				.filter(Boolean)
		};
	}
	return { controller: 'stub' };
}

export const network = createNetworkController(buildConfig());
