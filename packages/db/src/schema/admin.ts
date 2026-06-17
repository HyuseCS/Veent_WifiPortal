/**
 * Domain tables owned by the admin (management dashboard) module.
 *
 * The ERD (docs/use-cases/wifi-portal-erd.puml) defines no admin-owned tables
 * yet — the dashboard reads/writes the shared customer-domain tables in
 * `./customer` (packages, credit_ledger, network_sessions, rate_limits).
 *
 * Add admin-only tables here when the docs call for them (e.g. an action audit
 * log, AP/location mapping for "sales per location", network-health samples).
 */

export {};
