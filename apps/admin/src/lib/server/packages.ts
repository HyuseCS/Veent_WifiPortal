/**
 * Package Control (CMS) — admin CRUD over the purchasable `packages` table.
 *
 * Package categories: `free` is the Free-Time grant; `bundle` is credits bought with
 * pesos (the customer top-up storefront, keyed on `fiatCost` + `creditsProvided`);
 * `tier` is an access window bought with credits (the dashboard buy-tier flow, keyed
 * on `creditCost` + `durationMinutes`). The customer apps already read these by
 * `type` + `isActive`, so flipping `isActive` here adds/removes a customer offer.
 */
import { asc, eq } from 'drizzle-orm';
import { type DB, packages } from '@veent/db';

export const PACKAGE_TYPES = ['free', 'bundle', 'tier'] as const;
export type PackageType = (typeof PACKAGE_TYPES)[number];

/** A package row in the admin Package Control table. */
export interface AdminPackageRow {
	id: number;
	name: string;
	type: string;
	fiatCost: number | null;
	creditsProvided: number | null;
	creditCost: number | null;
	durationMinutes: number | null;
	isActive: boolean;
}

/** Validated, normalized fields for an upsert. */
export interface PackageInput {
	name: string;
	type: PackageType;
	fiatCost: number | null;
	creditsProvided: number | null;
	creditCost: number | null;
	durationMinutes: number | null;
	isActive: boolean;
}

/** All packages, grouped sensibly (by type, then id) for the management table. */
export async function listPackages(db: DB): Promise<AdminPackageRow[]> {
	const rows = await db.select().from(packages).orderBy(asc(packages.type), asc(packages.id));
	return rows.map((r) => ({
		id: r.id,
		name: r.name,
		type: r.type,
		fiatCost: r.fiatCost,
		creditsProvided: r.creditsProvided,
		creditCost: r.creditCost,
		durationMinutes: r.durationMinutes,
		isActive: r.isActive
	}));
}

export async function createPackage(db: DB, input: PackageInput): Promise<number> {
	const [row] = await db.insert(packages).values(input).returning({ id: packages.id });
	return row.id;
}

export async function updatePackage(db: DB, id: number, input: PackageInput): Promise<void> {
	await db.update(packages).set(input).where(eq(packages.id, id));
}

export async function setPackageActive(db: DB, id: number, isActive: boolean): Promise<void> {
	await db.update(packages).set({ isActive }).where(eq(packages.id, id));
}

/** Hard delete. Safe at the DB level — credit_ledger / network_sessions / payment_transactions
 * reference packages with ON DELETE SET NULL, so history rows just lose the link (no constraint
 * violation). Deactivating (isActive=false) is the softer option that preserves attribution. */
export async function deletePackage(db: DB, id: number): Promise<void> {
	await db.delete(packages).where(eq(packages.id, id));
}
