// Barrel for the whole shared schema. drizzle-kit reads this file, so every
// table that should exist in the database must be reachable from here.
export * from './auth-customer';
export * from './auth-admin';
export * from './customer';
export * from './admin';
