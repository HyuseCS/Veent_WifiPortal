import type { RequestHandler } from './$types';

/**
 * GET /docs — live API reference (Scalar) for the whole portal, served from the
 * admin app. The spec is embedded; `proxyUrl: ''` disables Scalar's cloud proxy
 * so "Test Request" calls your local dev server directly (with cookies).
 *
 * CORS note: try-it works same-origin (admin :5174 — e.g. /api/connected). The
 * customer endpoints live on :5173, so testing those from here is cross-origin
 * and the browser will block them unless the customer app sends CORS headers.
 * For full try-it on customer routes, mirror this route in apps/customer.
 *
 * Public by design (it's just docs). Move under the (app) group to require login.
 */
const spec = {
	openapi: '3.1.0',
	info: {
		title: 'RADIUS WiFi Portal API',
		version: '0.1.0',
		description:
			'REST endpoints for the captive portal (customer, :5173) and admin dashboard (:5174). Auth via better-auth session cookies. Non-REST surfaces (customer dashboard/top-up form actions, admin block/kick actions, page loaders) are described in docs/API.md.'
	},
	servers: [
		{ url: 'http://localhost:5174', description: 'Admin dashboard (try-it works here)' },
		{ url: 'http://localhost:5173', description: 'Customer portal (try-it cross-origin → CORS)' }
	],
	tags: [
		{ name: 'Admin' },
		{ name: 'Customer · Network' },
		{ name: 'Customer · Payments' },
		{ name: 'Auth' }
	],
	paths: {
		'/api/connected': {
			get: {
				tags: ['Admin'],
				summary: 'Connected-users live stream (SSE)',
				description:
					'Server-Sent Events stream of ActiveSession[] — snapshot on connect, then every 5s (business rule #5). Authenticated staff only. Server: :5174.',
				responses: {
					'200': {
						description: 'text/event-stream of `data: ActiveSession[]`',
						content: { 'text/event-stream': { schema: { type: 'string' } } }
					},
					'401': { description: 'Not authenticated' }
				}
			}
		},
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
					'Raw body verified via the provider (Maya). On a paid event, credits the buyer EXACTLY ONCE (idempotent on the gateway txn id). referenceId = `${userId}:${packageId}`. Server: :5173. NOTE: Maya is stubbed — verifyWebhook throws (400) until wired.',
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
		'/api/auth/sign-up/email': {
			post: {
				tags: ['Auth'],
				summary: 'Register (better-auth)',
				description:
					'Creates a user and signs in (sets the session cookie). Customer :5173 → customer_* tables; admin :5174 → admin_* tables.',
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								required: ['email', 'password', 'name'],
								properties: {
									name: { type: 'string' },
									email: { type: 'string' },
									password: { type: 'string', minLength: 8 }
								}
							}
						}
					}
				},
				responses: { '200': { description: 'Signed up; Set-Cookie session token' } }
			}
		},
		'/api/auth/sign-in/email': {
			post: {
				tags: ['Auth'],
				summary: 'Log in (better-auth)',
				requestBody: {
					required: true,
					content: {
						'application/json': {
							schema: {
								type: 'object',
								required: ['email', 'password'],
								properties: { email: { type: 'string' }, password: { type: 'string' } }
							}
						}
					}
				},
				responses: {
					'200': { description: 'Signed in; Set-Cookie session token' },
					'401': { description: 'Invalid credentials' }
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
					status: { type: 'string' },
					expiresAt: { type: 'string', format: 'date-time', nullable: true, example: '2026-06-18T09:55:00.000Z' }
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
		<title>RADIUS WiFi Portal — API Reference</title>
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
