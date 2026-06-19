import { env } from '$env/dynamic/private';
import { createPaymentProvider, type PaymentConfig } from '@veent/core';

// Builds the configured payment provider from this app's env. Maya is stubbed —
// fill MAYA_* in .env and complete packages/core/.../payments/maya.ts to go live.
const config: PaymentConfig = {
	provider: 'maya',
	publicKey: env.MAYA_PUBLIC_KEY || '',
	secretKey: env.MAYA_SECRET_KEY || '',
	webhookSecret: env.MAYA_WEBHOOK_SECRET || '',
	sandbox: env.MAYA_SANDBOX !== 'false'
};

export const payments = createPaymentProvider(config);
