import { Resend } from 'resend';
import type { EmailProvider, EmailMessage } from './types';

export interface ResendConfig {
	apiKey: string;
	/** Verified sender, e.g. "Veent <noreply@yourdomain>". */
	from: string;
}

/** Hard cap on a single send so a hung request can't stall the invite action. */
const SEND_TIMEOUT_MS = 10_000;

/**
 * Resend transactional-email provider. Wraps the official SDK behind the
 * provider-agnostic `EmailProvider` interface so call sites never know about Resend.
 *
 * The SDK returns `{ data, error }` and does NOT throw on API errors — we check
 * `error` and throw so failures propagate to callers (required for invite rollback).
 * The send is also raced against a timeout so a hung request can't stall the caller.
 * Never logs the message body, recipient, or any token.
 */
export function createResendProvider(config: ResendConfig): EmailProvider {
	if (!config.apiKey) throw new Error('resend: apiKey not configured');
	const resend = new Resend(config.apiKey);

	return {
		name: 'resend',
		async send(msg: EmailMessage): Promise<{ id: string }> {
			const sent = resend.emails.send({
				from: config.from,
				to: msg.to,
				subject: msg.subject,
				html: msg.html,
				text: msg.text ?? '',
				replyTo: msg.replyTo
			});

			let timer: ReturnType<typeof setTimeout> | undefined;
			const timeout = new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error('resend: send timed out')),
					SEND_TIMEOUT_MS
				);
			});

			let result: Awaited<typeof sent>;
			try {
				result = await Promise.race([sent, timeout]);
			} finally {
				clearTimeout(timer);
			}

			const { data, error } = result;
			if (error) throw new Error(`resend: send failed (${error.name})`);
			if (!data) throw new Error('resend: send returned no data');
			return { id: data.id };
		}
	};
}
