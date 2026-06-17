/**
 * Business-rule constants (see CLAUDE.md "Core Business Rules"). Centralized so
 * services and routes never hardcode these numbers.
 */
export const FREE_TIME_MINUTES = 15;
export const FREE_TIME_COOLDOWN_HOURS = 12;

export const GRACE_PERIOD_MINUTES = 3;
/** Max grace-period grants per rolling hour, per device. */
export const GRACE_RATE_LIMIT_PER_HOUR = 3;

/** Network-session lifecycle states (stored in network_sessions.status). */
export const SESSION_STATUS = {
	active: 'active',
	expired: 'expired',
	revoked: 'revoked'
} as const;
export type SessionStatus = (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS];

/** credit_ledger.type values. Positive amounts add, negative amounts spend. */
export const LEDGER_TYPE = {
	topup: 'topup', // credits bought via a verified payment webhook
	spend: 'spend', // credits consumed buying an access tier
	promo: 'promo', // manually granted credits
	refund: 'refund'
} as const;
export type LedgerType = (typeof LEDGER_TYPE)[keyof typeof LEDGER_TYPE];
