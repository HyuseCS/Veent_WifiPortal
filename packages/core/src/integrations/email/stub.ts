import type { EmailProvider, EmailMessage } from './types';

/**
 * No-op email provider for local dev / when no API key is configured. Logs the
 * recipient + subject (never the body or any token/link) and returns a fake id,
 * so the full invite/activation flow is exercisable end-to-end without a real send.
 *
 * Swap for a real impl (Resend) behind the same interface via the factory.
 */
export function createStubEmailProvider(
	log: (msg: string) => void = console.log
): EmailProvider {
	return {
		name: 'stub',
		async send(msg: EmailMessage): Promise<{ id: string }> {
			log(`[email:stub] → ${msg.to}: ${msg.subject}`);
			return { id: `stub-${msg.to}` };
		}
	};
}
