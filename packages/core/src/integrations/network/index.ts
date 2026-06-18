import type { NetworkController } from './types';
import { createStubNetworkController } from './stub';
import { createMikrotikController, type MikrotikConfig } from './mikrotik';

export * from './types';
export { createStubNetworkController } from './stub';
export { createMikrotikController, type MikrotikConfig } from './mikrotik';

export type NetworkConfig =
	| { controller: 'stub' }
	| ({ controller: 'mikrotik' } & MikrotikConfig);

/**
 * Selects and builds the configured network controller. The app reads its own
 * env and passes config in (this package never touches env).
 */
export function createNetworkController(config: NetworkConfig): NetworkController {
	switch (config.controller) {
		case 'stub':
			return createStubNetworkController();
		case 'mikrotik':
			return createMikrotikController(config);
		default:
			throw new Error(`Unknown network controller: ${(config as { controller: string }).controller}`);
	}
}
