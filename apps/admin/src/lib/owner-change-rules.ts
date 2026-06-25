/**
 * Pure decision logic for owner-change approval — the load-bearing security rule,
 * kept side-effect-free (no DB/env) so it's unit-testable in isolation. The server
 * module (`$lib/server/owner-change`) and the orchestration call into this.
 */

/** Owners whose approval is required for a change: everyone except the target. */
export function requiredApprovers(ownerIds: string[], targetId: string): string[] {
	return ownerIds.filter((id) => id !== targetId);
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
