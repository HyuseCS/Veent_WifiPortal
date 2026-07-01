import type { EmailProvider } from './types';
import { createResendProvider, type ResendConfig } from './resend';
import { createStubEmailProvider } from './stub';
import { traceMethods } from '../../observability';

export * from './types';
export { createResendProvider, type ResendConfig } from './resend';
export { createStubEmailProvider } from './stub';

export type EmailConfig = ({ provider: 'resend' } & ResendConfig) | { provider: 'stub' };

/**
 * Selects and builds the configured email provider. The app reads its own env
 * and passes config in (this package never touches env). Add new providers here.
 */
export function createEmailProvider(config: EmailConfig): EmailProvider {
	switch (config.provider) {
		case 'resend':
			// traceMethods: `email.resend.send` span captures transactional-email send latency.
			return traceMethods(createResendProvider(config), 'email.resend', 'email');
		case 'stub':
			return createStubEmailProvider();
		default:
			throw new Error(`Unknown email provider: ${(config as { provider: string }).provider}`);
	}
}
