import { text, boolean } from 'drizzle-orm/pg-core';
import { authTables } from './_auth-factory';

// Auth tables for wifi end-users (the captive portal). Prefixed `customer_*`.
// The customer instance authenticates by phone + OTP (better-auth phoneNumber
// plugin), so its user table carries `phone_number` / `phone_number_verified`.
const t = authTables('customer', {
	phoneNumber: text('phone_number').unique(),
	phoneNumberVerified: boolean('phone_number_verified').default(false)
});

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
