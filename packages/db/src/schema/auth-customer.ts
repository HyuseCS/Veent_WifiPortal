import { authTables } from './_auth-factory';

// Auth tables for wifi end-users (the captive portal). Prefixed `customer_*`.
const t = authTables('customer');

export const customerUser = t.user;
export const customerSession = t.session;
export const customerAccount = t.account;
export const customerVerification = t.verification;

/** Pass to better-auth's drizzleAdapter `schema` option in apps/customer. */
export const customerAuthSchema = {
	user: customerUser,
	session: customerSession,
	account: customerAccount,
	verification: customerVerification
};
