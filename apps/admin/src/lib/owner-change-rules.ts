/**
 * Pure decision logic for owner-change approval — the load-bearing security rule,
 * kept side-effect-free (no DB/env) so it's unit-testable in isolation. The server
 * module (`$lib/server/owner-change`) and the orchestration call into this.
 */

export type OwnerChangeAction = 'demote' | 'remove';

/** A pending owner-change as the staff panel renders it. */
export interface OpenOwnerChange {
	id: string;
	targetId: string;
	targetName: string;
	action: OwnerChangeAction;
	initiatedById: string;
	initiatedByName: string;
	/** Current owners whose approval is required (all owners except the target). */
	requiredOwnerIds: string[];
	/** Of the required owners, those who have approved. */
	approvedOwnerIds: string[];
	expiresAt: number;
	expired: boolean;
}

/** The minimal request row the assembler needs (DB Date → ms via getTime()). */
export interface OpenRequestRow {
	id: string;
	targetId: string;
	targetName: string;
	action: OwnerChangeAction;
	initiatedById: string;
	expiresAt: number;
}

/** Owners whose approval is required for a change: everyone except the target. */
export function requiredApprovers(ownerIds: string[], targetId: string): string[] {
	return ownerIds.filter((id) => id !== targetId);
}

/**
 * Pure assembly of the open-requests panel view from already-fetched data — pulled out
 * of the DB layer so the per-request progress computation (required vs approved owners)
 * is unit-testable and the query layer can batch approvals in ONE round-trip instead of
 * one-per-request. `approvalsByRequest` maps a request id to the owner ids that approved;
 * only approvals from CURRENT owners count (same rule as `isUnanimous`).
 */
export function assembleOpenRequests(
	rows: OpenRequestRow[],
	ownerIds: string[],
	nameById: Map<string, string>,
	approvalsByRequest: Map<string, string[]>,
	now: number
): OpenOwnerChange[] {
	const current = new Set(ownerIds);
	return rows.map((r) => ({
		id: r.id,
		targetId: r.targetId,
		targetName: r.targetName,
		action: r.action,
		initiatedById: r.initiatedById,
		initiatedByName: nameById.get(r.initiatedById) ?? '—',
		requiredOwnerIds: requiredApprovers(ownerIds, r.targetId),
		approvedOwnerIds: (approvalsByRequest.get(r.id) ?? []).filter((id) => current.has(id)),
		expiresAt: r.expiresAt,
		expired: r.expiresAt < now
	}));
}

/**
 * Is the change unanimously approved? Required = current owners minus the target;
 * only approvals from CURRENT owners count (a departed owner's vote is ignored, a
 * newly-promoted owner becomes newly required). A sole owner (no others) can never
 * reach unanimity — protecting the last owner.
 */
export function isUnanimous(
	ownerIds: string[],
	targetId: string,
	approvedOwnerIds: string[]
): boolean {
	const required = requiredApprovers(ownerIds, targetId);
	if (required.length === 0) return false;
	const current = new Set(ownerIds);
	const approved = new Set(approvedOwnerIds.filter((id) => current.has(id)));
	return required.every((id) => approved.has(id));
}
