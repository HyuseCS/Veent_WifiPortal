import type { PaymentProvider } from './types';
import { createMayaProvider, type MayaConfig } from './maya';

export * from './types';
export { createMayaProvider, type MayaConfig } from './maya';

export type PaymentConfig = { provider: 'maya' } & MayaConfig;

/**
 * Selects and builds the configured payment provider. The app reads its own env
 * and passes config in (this package never touches env). Add new providers here.
 */
export function createPaymentProvider(config: PaymentConfig): PaymentProvider {
	switch (config.provider) {
		case 'maya':
			return createMayaProvider(config);
		default:
			throw new Error(`Unknown payment provider: ${(config as { provider: string }).provider}`);
	}
}
