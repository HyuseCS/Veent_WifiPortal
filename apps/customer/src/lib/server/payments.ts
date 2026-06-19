import { env } from '$env/dynamic/private';
import { createPaymentProvider, type PaymentConfig } from '@veent/core';

// Builds the configured payment provider from this app's env. Fill MAYA_* in
// .env (public + secret keys, sandbox toggle) to point at your Maya account.
const config: PaymentConfig = {
	provider: 'maya',
	publicKey: env.MAYA_PUBLIC_KEY || '',
	secretKey: env.MAYA_SECRET_KEY || '',
	webhookSecret: env.MAYA_WEBHOOK_SECRET || '',
	sandbox: env.MAYA_SANDBOX !== 'false'
};

export const payments = createPaymentProvider(config);
