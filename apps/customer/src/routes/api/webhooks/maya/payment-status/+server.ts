import { handlePaymentWebhook } from '$lib/server/paymentWebhook';
import type { RequestHandler } from './$types';

/**
 * POST /api/webhooks/maya/payment-status — the production webhook path.
 *
 * Maya notifies the central Veent DO (the single webhook URL registered on the shared Maya
 * account); the DO reads `metadata.originUrl` off the event and forwards it verbatim here, to
 * `${originUrl}/api/webhooks/maya/payment-status` — routing the event back to THIS NAT'd site.
 * The path is the DO's fixed forward target (see the DO `receive.js`); it must match exactly.
 *
 * Identical to /api/webhooks/payment: both delegate to the shared handler, which re-verifies
 * the event against Maya with the secret key regardless of who delivered it (the DO adds no
 * auth). See $lib/server/paymentWebhook.ts.
 */
export const POST: RequestHandler = (event) => handlePaymentWebhook(event);
