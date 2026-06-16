import { authTables } from './_auth-factory';

// Auth tables for staff/admin users (the management dashboard). Prefixed `admin_*`.
const t = authTables('admin');

export const adminUser = t.user;
export const adminSession = t.session;
export const adminAccount = t.account;
export const adminVerification = t.verification;

/** Pass to better-auth's drizzleAdapter `schema` option in apps/admin. */
export const adminAuthSchema = {
	user: adminUser,
	session: adminSession,
	account: adminAccount,
	verification: adminVerification
};
