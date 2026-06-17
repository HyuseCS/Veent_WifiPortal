import { env } from '$env/dynamic/private';
import { createNetworkController, type NetworkConfig } from '@veent/core';

// Admin's network controller — same abstraction the customer app uses, for
// block/kick. Set NETWORK_CONTROLLER once a real strategy is chosen.
const config: NetworkConfig = { controller: (env.NETWORK_CONTROLLER as 'stub') || 'stub' };

export const network = createNetworkController(config);
