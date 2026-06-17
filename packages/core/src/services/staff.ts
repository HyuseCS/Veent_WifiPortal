import { and, eq, ne } from 'drizzle-orm';
import { type DB, adminUser, adminProfile } from '@veent/db';
import { STAFF_ROLE, STAFF_STATUS, type StaffRole, type StaffStatus } from '../config';

/**
 * Staff-domain operations over `admin_profile`. Pure DB writes — account creation
 * and activation are better-auth's job and live in the admin app, not here.
 *
 * The `owner` row is protected: it can never be disabled or removed through these
 * helpers (guards below), so the singular owner account can't be locked out.
 */

/** The signed-in staff member's role, or null if they have no profile row. */
export async function getAdminRole(db: DB, userId: string): Promise<StaffRole | null> {
	const [row] = await db
		.select({ role: adminProfile.role })
		.from(adminProfile)
		.where(eq(adminProfile.userId, userId))
		.limit(1);
	return (row?.role as StaffRole) ?? null;
}

/** Lifecycle status for a staff member, or null if they have no profile row.
 * Used by the sign-in guard (only `active` may log in). */
export async function getStaffStatus(db: DB, userId: string): Promise<StaffStatus | null> {
	const [row] = await db
		.select({ status: adminProfile.status })
		.from(adminProfile)
		.where(eq(adminProfile.userId, userId))
		.limit(1);
	return (row?.status as StaffStatus) ?? null;
}

/**
 * Enable/disable a staff member. Never touches the owner (the `ne(role, owner)`
 * guard makes a disable attempt on the owner a no-op). Returns true if a row changed.
 */
export async function setStaffStatus(
	db: DB,
	userId: string,
	status: Extract<StaffStatus, 'active' | 'disabled'>
): Promise<boolean> {
	const updated = await db
		.update(adminProfile)
		.set({ status })
		.where(and(eq(adminProfile.userId, userId), ne(adminProfile.role, STAFF_ROLE.owner)))
		.returning({ userId: adminProfile.userId });
	return updated.length > 0;
}

/**
 * Fully remove a staff member: deletes the better-auth `admin_user` row, which
 * cascades to their profile, sessions, and account (freeing the email for re-use).
 * The owner is protected (never removed). Returns true if a row was removed.
 */
export async function removeStaff(db: DB, userId: string): Promise<boolean> {
	const [profile] = await db
		.select({ role: adminProfile.role })
		.from(adminProfile)
		.where(eq(adminProfile.userId, userId))
		.limit(1);
	if (!profile || profile.role === STAFF_ROLE.owner) return false;

	const removed = await db
		.delete(adminUser)
		.where(eq(adminUser.id, userId))
		.returning({ id: adminUser.id });
	return removed.length > 0;
}

/**
 * Promotes an existing **active admin** to `owner`. Scoped tightly on purpose:
 * the target must currently be an `admin` (never re-promote an owner) and `active`
 * (no promoting a pending invitee or a disabled member). Returns true if a row was
 * promoted, false if it didn't match (wrong role/status, or no such member).
 *
 * Note: the "all owners must confirm" gate is deferred — admin_role.requiresApproval
 * flags `owner` for when that flow lands. For now an owner promotes directly.
 */
export async function promoteToOwner(db: DB, userId: string): Promise<boolean> {
	const updated = await db
		.update(adminProfile)
		.set({ role: STAFF_ROLE.owner })
		.where(
			and(
				eq(adminProfile.userId, userId),
				eq(adminProfile.role, STAFF_ROLE.admin),
				eq(adminProfile.status, STAFF_STATUS.active)
			)
		)
		.returning({ userId: adminProfile.userId });
	return updated.length > 0;
}

/**
 * Promotes a freshly-activated invitee `pending → active`. Scoped to `pending` on
 * purpose: this runs from the password-reset hook, so a *disabled* member can never
 * re-activate themselves by triggering a reset. No-op for active/disabled rows.
 */
export async function activateStaff(db: DB, userId: string): Promise<void> {
	await db
		.update(adminProfile)
		.set({ status: STAFF_STATUS.active })
		.where(and(eq(adminProfile.userId, userId), eq(adminProfile.status, STAFF_STATUS.pending)));
}
