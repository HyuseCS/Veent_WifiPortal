import type { NetworkController } from './types';
import { createStubNetworkController } from './stub';

export * from './types';
export { createStubNetworkController } from './stub';

export type NetworkConfig = { controller: 'stub' };

/**
 * Selects and builds the configured network controller. Only the stub exists
 * today; real controllers (UniFi/Omada/RADIUS/grant_url) get added here once the
 * integration strategy is decided.
 */
export function createNetworkController(config: NetworkConfig): NetworkController {
	switch (config.controller) {
		case 'stub':
			return createStubNetworkController();
		default:
			throw new Error(`Unknown network controller: ${(config as { controller: string }).controller}`);
	}
}
