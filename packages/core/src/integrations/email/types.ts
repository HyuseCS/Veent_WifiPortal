/**
 * Provider-agnostic transactional-email abstraction — the seam between the app
 * and whatever sends mail (Resend today). The app codes against `EmailProvider`
 * only; the concrete transport is chosen by the factory in `index.ts`.
 *
 * Email *content* (subject/HTML/text) is built by the app, not here — core only
 * transports a generic message.
 */

export interface EmailMessage {
	to: string;
	subject: string;
	html: string;
	/** Plaintext fallback — improves deliverability and serves no-JS/text clients. */
	text?: string;
	replyTo?: string;
}

export interface EmailProvider {
	readonly name: string;
	/**
	 * Send one email. MUST throw on provider/transport failure — callers treat a
	 * thrown error as "the email did not go out" (e.g. to roll back an invite).
	 */
	send(msg: EmailMessage): Promise<{ id: string }>;
}
