import type { RequestHandler } from './$types';

/**
 * GET /docs — live API reference (Scalar) served from the customer app. Mirrors
 * the admin /docs route but lists the customer origin first, so "Test Request"
 * defaults to :5173 and works same-origin (with cookies) for the customer
 * endpoints (grant, revoke, webhook, auth).
 *
 * CORS note: testing the admin endpoint (:5174 /api/connected) from here is
 * cross-origin and will be blocked — use the admin app's /docs for that.
 *
 * `proxyUrl: ''` disables Scalar's cloud proxy so requests hit your local server.
 * Public by design (just docs).
 */
const spec = {
	openapi: '3.1.0',
	info: {
		title: 'Veent WiFi Portal API',
		version: '0.1.0',
		description:
			'REST endpoints for the captive portal (customer, :5173) and admin dashboard (:5174). Auth via better-auth session cookies. Non-REST surfaces (customer dashboard/top-up form actions, admin block/kick actions, page loaders) are described in docs/API.md.'
	},
	servers: [
		{ url: 'http://localhost:5173', description: 'Customer portal (try-it works here)' },
		{ url: 'http://localhost:5174', description: 'Admin dashboard (try-it cross-origin → CORS)' }
	],
	tags: [
		{ name: 'Customer · Network' },
		{ name: 'Customer · Payments' },
		{ name: 'Auth' },
		{ name: 'Admin' }
	],
	paths: {
		'/api/network/grant': {
			post: {
				tags: ['Customer · Network'],
				summary: 'Start an access session (free or paid tier)',
				description:
					'Authenticated. No packageId → Free Time (429 if in 12h cooldown). With packageId → spends the tier creditCost then grants (402 if short). 403 if blocked. Server: :5173.',
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								required: ['macAddress'],
								properties: {
									macAddress: { type: 'string', example: 'AA:BB:CC:DD:EE:FF' },
									packageId: { type: 'integer', example: 5 }
								}
							}
						}
					}
				},
				responses: {
					'200': {
						description: 'Granted',
						content: { 'application/json': { schema: { $ref: '#/components/schemas/GrantResult' } } }
					},
					'400': { description: 'macAddress missing' },
					'401': { description: 'Not authenticated' },
					'402': { description: 'Insufficient credit balance' },
					'403': { description: 'Account blocked' },
					'404': { description: 'Package not found' },
					'429': { description: 'Free time in cooldown' }
				}
			}
		},
		'/api/network/revoke': {
			post: {
				tags: ['Customer · Network'],
				summary: 'Expire due sessions (cron)',
				description:
					'Revokes every active session past its expiry and re-blocks the MAC. Auth via the `x-cron-secret` header. Server: :5173.',
				parameters: [
					{ name: 'x-cron-secret', in: 'header', required: true, schema: { type: 'string' } }
				],
				responses: {
					'200': {
						description: 'Done',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: { ok: { type: 'boolean' }, revoked: { type: 'integer' } }
								}
							}
						}
					},
					'401': { description: 'Bad or missing cron secret' }
				}
			}
		},
		'/api/webhooks/payment': {
			post: {
				tags: ['Customer · Payments'],
				summary: 'Payment gateway webhook (source of truth for credits)',
				description:
					'Raw body verified via the provider (Maya). On a paid event, credits the buyer EXACTLY ONCE (idempotent on the gateway txn id). referenceId = `${userId}:${packageId}`. Server: :5173. NOTE: Maya verifyWebhook is wired (HMAC-verified); an invalid/missing signature is rejected (400). Only outbound createCheckout is still a stub.',
				requestBody: {
					required: true,
					content: {
						'application/json': { schema: { type: 'object', description: 'Raw provider payload' } }
					}
				},
				responses: {
					'200': {
						description: 'Processed / ignored',
						content: {
							'application/json': {
								schema: {
									type: 'object',
									properties: {
										ok: { type: 'boolean' },
										credited: { type: 'boolean' },
										balance: { type: 'number' },
										ignored: { type: 'boolean' }
									}
								}
							}
						}
					},
					'400': { description: 'Verification failed / malformed referenceId' },
					'404': { description: 'Package not found' }
				}
			}
		},
		'/api/connected': {
			get: {
				tags: ['Admin'],
				summary: 'Connected-users live stream (SSE)',
				description:
					'Server-Sent Events stream of ActiveSession[] — snapshot on connect, then every 5s (business rule #5). Authenticated staff only. Server: :5174 (test from the admin /docs).',
				responses: {
					'200': {
						description: 'text/event-stream of `data: ActiveSession[]`',
						content: { 'text/event-stream': { schema: { type: 'string' } } }
					},
					'401': { description: 'Not authenticated' }
				}
			}
		}
	},
	components: {
		schemas: {
			GrantResult: {
				type: 'object',
				properties: {
					ok: { type: 'boolean' },
					mode: { type: 'string', enum: ['free', 'tier'] },
					balance: { type: 'number' },
					session: {
						type: 'object',
						properties: {
							id: { type: 'integer' },
							macAddress: { type: 'string' },
							status: { type: 'string' },
							expiresAt: { type: 'string', format: 'date-time' }
						}
					}
				}
			},
			ActiveSession: {
				type: 'object',
				properties: {
					mac: { type: 'string' },
					package: { type: 'string' },
					timeLeft: { type: 'string', example: '14:52' },
					tone: { type: 'string', enum: ['online', 'warning', 'blocked'] },
					status: { type: 'string' }
				}
			}
		}
	}
};

const html = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>Veent WiFi Portal — API Reference</title>
	</head>
	<body>
		<script id="api-reference" type="application/json" data-configuration='{"proxyUrl":""}'>${JSON.stringify(
			spec
		)}</script>
		<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
	</body>
</html>`;

export const GET: RequestHandler = () => {
	return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
};
