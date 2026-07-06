import { env } from '$env/dynamic/private';
import { createPaymentProvider, type PaymentConfig } from '@veent/core';

// Builds the configured payment provider from this app's env. Fill MAYA_* in
// .env (public + secret keys, sandbox toggle) to point at your Maya account.

// MAYA_SANDBOX must be set explicitly to 'true' or 'false'. The old `!== 'false'` default meant a
// deploy that simply forgot the var silently ran against sandbox (prod) — or, if flipped, real Maya
// (dev). Requiring it makes picking the wrong environment a loud startup error, not a silent one.
const sandboxRaw = env.MAYA_SANDBOX;
if (sandboxRaw !== 'true' && sandboxRaw !== 'false') {
	throw new Error("MAYA_SANDBOX must be set to 'true' (sandbox) or 'false' (production).");
}

const config: PaymentConfig = {
	provider: 'maya',
	publicKey: env.MAYA_PUBLIC_KEY || '',
	secretKey: env.MAYA_SECRET_KEY || '',
	webhookSecret: env.MAYA_WEBHOOK_SECRET || '',
	sandbox: sandboxRaw === 'true'
};

export const payments = createPaymentProvider(config);
