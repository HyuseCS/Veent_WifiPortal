import { env } from '$env/dynamic/private';
import { createNetworkController, type NetworkConfig } from '@veent/core';

// Builds the configured network controller from this app's env.
// NETWORK_CONTROLLER=stub (default) | mikrotik
function buildConfig(): NetworkConfig {
	if (env.NETWORK_CONTROLLER === 'mikrotik') {
		return {
			controller: 'mikrotik',
			host: env.MIKROTIK_HOST || '',
			user: env.MIKROTIK_USER || '',
			password: env.MIKROTIK_PASSWORD || '',
			port: env.MIKROTIK_PORT ? Number(env.MIKROTIK_PORT) : undefined,
			tls: env.MIKROTIK_TLS === 'true',
			insecureTls: env.MIKROTIK_TLS_INSECURE === 'true'
		};
	}
	return { controller: 'stub' };
}

export const network = createNetworkController(buildConfig());
