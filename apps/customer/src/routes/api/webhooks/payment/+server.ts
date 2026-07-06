import { handlePaymentWebhook } from '$lib/server/paymentWebhook';
import type { RequestHandler } from './$types';

/**
 * POST /api/webhooks/payment — direct Maya → us (local dev with the ngrok URL registered
 * straight with Maya). Production instead receives the same event via the Veent DO relay at
 * /api/webhooks/maya/payment-status. Both delegate to the one shared handler; see
 * $lib/server/paymentWebhook.ts for the full contract.
 */
export const POST: RequestHandler = (event) => handlePaymentWebhook(event);
