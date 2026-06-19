import { env } from '$env/dynamic/private';
import { createEmailProvider, type EmailConfig } from '@veent/core';

// Admin's transactional mailer. The app reads env and passes config in; core never
// touches env (mirrors network.ts). With no RESEND_API_KEY set we fall back to the
// console stub, so local dev exercises the full invite flow without a real send and
// a live send is never *required* locally.
const config: EmailConfig = env.RESEND_API_KEY
	? {
			provider: 'resend',
			apiKey: env.RESEND_API_KEY,
			from: env.EMAIL_FROM ?? 'RADIUS <onboarding@resend.dev>'
		}
	: { provider: 'stub' };

export const mailer = createEmailProvider(config);
