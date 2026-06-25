import { and, eq, ne, sql } from 'drizzle-orm';
import { type DB, adminUser, adminProfile } from '@veent/db';

/** Transaction advisory-lock key serializing all owner-count mutations (arbitrary constant). */
const OWNER_CHANGE_LOCK = 0x6f776e72; // "ownr"
import { STAFF_ROLE, STAFF_STATUS, type StaffRole, type StaffStatus } from '../config';

/** An owner's contact row, for approval emails and the owner-count invariant. */
export interface Owner {
	id: string;
	name: string;
	email: string;
}

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

/** All current owners (id/name/email), for approval routing + the owner-count guard. */
export async function listOwners(db: DB): Promise<Owner[]> {
	return db
		.select({ id: adminUser.id, name: adminUser.name, email: adminUser.email })
		.from(adminUser)
		.innerJoin(adminProfile, eq(adminProfile.userId, adminUser.id))
		.where(eq(adminProfile.role, STAFF_ROLE.owner));
}

/**
 * Execute a unanimously-approved owner change. The ONLY path that demotes or removes
 * an owner. Runs in a transaction and re-asserts the invariants atomically, so it's
 * safe against races (two requests both reaching unanimity) and stale approvals:
 *   - the target must still be an owner (else the change is moot — return false);
 *   - there must be at least one OTHER owner left afterwards (never zero owners).
 * `demote` flips the role owner→admin (keeping the account); `remove` deletes the
 * `admin_user` (cascades to profile/sessions/account). Returns true iff it executed.
 */
export async function executeOwnerChange(
	db: DB,
	target: { targetUserId: string; action: 'demote' | 'remove' }
): Promise<boolean> {
	return db.transaction(async (tx) => {
		// Serialize the owner-count check: a transaction-scoped advisory lock makes
		// concurrent owner changes run one-at-a-time, so two can't both read "2 owners",
		// both pass the last-owner guard, and drop the org to zero (READ COMMITTED, the
		// default, would otherwise allow that race). Released automatically at commit.
		await tx.execute(sql`select pg_advisory_xact_lock(${OWNER_CHANGE_LOCK})`);

		const owners = await tx
			.select({ userId: adminProfile.userId })
			.from(adminProfile)
			.where(eq(adminProfile.role, STAFF_ROLE.owner));

		const isOwner = owners.some((o) => o.userId === target.targetUserId);
		// Last-owner guard: refuse if target isn't an owner, or is the only owner left.
		if (!isOwner || owners.length <= 1) return false;

		if (target.action === 'demote') {
			const updated = await tx
				.update(adminProfile)
				.set({ role: STAFF_ROLE.admin })
				.where(
					and(
						eq(adminProfile.userId, target.targetUserId),
						eq(adminProfile.role, STAFF_ROLE.owner)
					)
				)
				.returning({ userId: adminProfile.userId });
			return updated.length > 0;
		}

		const removed = await tx
			.delete(adminUser)
			.where(eq(adminUser.id, target.targetUserId))
			.returning({ id: adminUser.id });
		return removed.length > 0;
	});
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
