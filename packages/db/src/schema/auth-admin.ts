import { boolean } from 'drizzle-orm/pg-core';
import { authTables } from './_auth-factory';
import { adminTwoFactor } from './admin-two-factor';

// Auth tables for staff/admin users (the management dashboard). Prefixed `admin_*`.
// The admin instance enforces TOTP (better-auth two-factor plugin), so its user
// table carries `two_factor_enabled` — the customer instance must NOT get it.
const t = authTables('admin', {
	twoFactorEnabled: boolean('two_factor_enabled').default(false)
});

export const adminUser = t.user;
export const adminSession = t.session;
export const adminAccount = t.account;
export const adminVerification = t.verification;

/** Pass to better-auth's drizzleAdapter `schema` option in apps/admin. */
export const adminAuthSchema = {
	user: adminUser,
	session: adminSession,
	account: adminAccount,
	verification: adminVerification,
	twoFactor: adminTwoFactor
};
