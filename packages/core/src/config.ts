/**
 * Business-rule constants (see CLAUDE.md "Core Business Rules"). Centralized so
 * services and routes never hardcode these numbers.
 */
export const FREE_TIME_MINUTES = 15;
export const FREE_TIME_COOLDOWN_HOURS = 12;

/**
 * Max simultaneously-bound device MACs per ACCOUNT. Access time belongs to the
 * account; devices bind under it. A new bind beyond this cap evicts the
 * least-recently-seen device, so Apple per-SSID MAC rotation can't lock a user out.
 */
export const MAX_DEVICES_PER_ACCOUNT = 2;

export const GRACE_PERIOD_MINUTES = 3;
/** Max grace-period grants per rolling hour, per device. */
export const GRACE_RATE_LIMIT_PER_HOUR = 3;

/** A real device MAC: six colon-separated hex octets. Used to reject junk/oversized
 * input before it reaches the DB or the router controller (which would otherwise
 * 500 or pollute the binding table). Shared by every grant entry point. */
export const MAC_ADDRESS_RE = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/;
/** True if `value` is a well-formed device MAC. */
export function isValidMac(value: unknown): value is string {
	return typeof value === 'string' && MAC_ADDRESS_RE.test(value);
}

/** Network-session lifecycle states (stored in network_sessions.status). */
export const SESSION_STATUS = {
	active: 'active',
	expired: 'expired',
	revoked: 'revoked'
} as const;
export type SessionStatus = (typeof SESSION_STATUS)[keyof typeof SESSION_STATUS];

/** Staff access levels (stored in admin_profile.role). `owner` is the singular
 * bootstrap account; everyone invited is an `admin`. */
export const STAFF_ROLE = {
	owner: 'owner',
	admin: 'admin'
} as const;
export type StaffRole = (typeof STAFF_ROLE)[keyof typeof STAFF_ROLE];

/** Staff lifecycle (stored in admin_profile.status). Only `active` may sign in. */
export const STAFF_STATUS = {
	active: 'active',
	pending: 'pending', // invited, awaiting activation
	disabled: 'disabled'
} as const;
export type StaffStatus = (typeof STAFF_STATUS)[keyof typeof STAFF_STATUS];

/** credit_ledger.type values. Positive amounts add, negative amounts spend. */
export const LEDGER_TYPE = {
	topup: 'topup', // credits bought via a verified payment webhook
	spend: 'spend', // credits consumed buying an access tier
	promo: 'promo', // manually granted credits
	refund: 'refund'
} as const;
export type LedgerType = (typeof LEDGER_TYPE)[keyof typeof LEDGER_TYPE];
