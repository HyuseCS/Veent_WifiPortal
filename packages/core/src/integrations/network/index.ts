import type { NetworkController } from './types';
import { createStubNetworkController } from './stub';
import { createMikrotikController, type MikrotikConfig } from './mikrotik';
import { traceMethods } from '../../observability';

export * from './types';
export { createStubNetworkController } from './stub';
export {
	createMikrotikController,
	provisionWalledGarden,
	restrictApiService,
	type MikrotikConfig,
	type WalledGardenInput,
	type WalledGardenResult,
	type RestrictApiInput,
	type RestrictApiResult
} from './mikrotik';

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
			// traceMethods: grant / revoke / activateSession / sampleHealth / router-log calls each
			// become a `network.mikrotik.*` span — router round-trip latency is the main network delay.
			return traceMethods(createMikrotikController(config), 'network.mikrotik', 'router');
		default:
			throw new Error(`Unknown network controller: ${(config as { controller: string }).controller}`);
	}
}
