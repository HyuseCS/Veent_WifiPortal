import { env } from '$env/dynamic/private';
import { createNetworkController, type NetworkConfig } from '@veent/core';

// Builds the configured network controller from this app's env. Only the stub
// exists today; set NETWORK_CONTROLLER once a real strategy is chosen.
const config: NetworkConfig = { controller: (env.NETWORK_CONTROLLER as 'stub') || 'stub' };

export const network = createNetworkController(config);
