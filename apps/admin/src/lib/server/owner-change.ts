import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { adminOwnerChangeRequest, adminOwnerChangeApproval, adminUser, adminSession } from '@veent/db';
import { listOwners, executeOwnerChange, type Owner } from '@veent/core';
import { db } from '$lib/server/db';
import { logger } from '$lib/server/logger';
import { isUnanimous, assembleOpenRequests } from '$lib/owner-change-rules';
import type { OwnerChangeAction, OpenOwnerChange } from '$lib/owner-change-rules';

/**
 * Owner demotion/removal governed by UNANIMOUS approval of all OTHER owners. This
 * module owns the request/approval lifecycle over the `admin_owner_change_*` tables;
 * the actual role mutation + last-owner guard live atomically in core's
 * `executeOwnerChange`. Email notification is the caller's (the action's) job.
 *
 * Rules: initiator may target another owner or themselves. If initiator ≠ target,
 * the initiation records the initiator's approval. The target never votes. A request
 * executes the instant every CURRENT owner except the target has approved.
 */

// Type definitions + the pure panel-assembly live in $lib/owner-change-rules (no DB),
// re-exported here so existing importers (staff page) are unaffected.
export type { OwnerChangeAction, OpenOwnerChange } from '$lib/owner-change-rules';

/** 7 days — generous for a multi-person sign-off, short enough to not linger forever. */
const REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type CreateResult =
	| {
			ok: true;
			requestId: string;
			executed: boolean;
			action: OwnerChangeAction;
			target: Owner;
			/** Owners owed a "please approve" email (all owners except target + initiator). */
			approvers: Owner[];
			/** Full owner set at creation — recipients for the executed email. */
			owners: Owner[];
	  }
	| { ok: false; error: string };

/**
 * Open a request to demote/remove an owner. Validates the target is an owner, that
 * there are other owners, and that no request is already open for them. Records the
 * initiator's approval when initiator ≠ target, then evaluates (a 2-owner peer case
 * reaches unanimity immediately). `approvers` is who still needs to be emailed.
 */
export async function createRequest(input: {
	targetUserId: string;
	action: OwnerChangeAction;
	initiatedBy: string;
	reason?: string | null;
}): Promise<CreateResult> {
	const { targetUserId, action, initiatedBy, reason } = input;
	if (action !== 'demote' && action !== 'remove') return { ok: false, error: 'Invalid action.' };

	const owners = await listOwners(db);
	const target = owners.find((o) => o.id === targetUserId);
	if (!target) return { ok: false, error: 'That staff member is not an owner.' };
	if (owners.length <= 1) {
		return { ok: false, error: 'You are the only owner — there is no one to approve this.' };
	}

	const [existing] = await db
		.select({ id: adminOwnerChangeRequest.id, expiresAt: adminOwnerChangeRequest.expiresAt })
		.from(adminOwnerChangeRequest)
		.where(
			and(
				eq(adminOwnerChangeRequest.targetUserId, targetUserId),
				eq(adminOwnerChangeRequest.status, 'pending')
			)
		)
		.limit(1);
	if (existing) {
		// A still-live request blocks a duplicate. An EXPIRED one (past its TTL but never
		// flipped) would otherwise wedge the target forever via the partial-unique index —
		// retire it so a fresh request can be opened.
		if (existing.expiresAt.getTime() > Date.now()) {
			return { ok: false, error: 'A request is already open for this owner.' };
		}
		await markStatus(existing.id, 'cancelled');
	}

	const id = randomUUID();
	const expiresAt = new Date(Date.now() + REQUEST_TTL_MS);
	try {
		await db.insert(adminOwnerChangeRequest).values({
			id,
			targetUserId,
			action,
			initiatedBy,
			reason: reason ?? null,
			expiresAt
		});
	} catch {
		// Unique partial index lost a race — another request opened first.
		return { ok: false, error: 'A request is already open for this owner.' };
	}

	// Initiator's own approval (unless they're the target, who never votes).
	if (initiatedBy !== targetUserId) {
		await db
			.insert(adminOwnerChangeApproval)
			.values({ requestId: id, ownerId: initiatedBy })
			.onConflictDoNothing();
	}

	const executed = await evaluate(id);
	// Required approvers still owed an email = owners minus target minus initiator.
	const approvers = owners.filter((o) => o.id !== targetUserId && o.id !== initiatedBy);
	return { ok: true, requestId: id, executed, action, target, approvers, owners };
}

type ApprovalResult =
	| {
			ok: true;
			executed: boolean;
			action: OwnerChangeAction;
			target: Owner | null;
			/** Owner set before execution — recipients for the executed email. */
			owners: Owner[];
	  }
	| { ok: false; error: string };

/**
 * Record one owner's approval of a pending request, then evaluate. The acting owner
 * must be a CURRENT owner and not the target. Returns whether the request executed
 * plus the owner list (for the outcome email — captured here, pre-mutation).
 */
export async function recordApproval(requestId: string, ownerId: string): Promise<ApprovalResult> {
	const [req] = await db
		.select()
		.from(adminOwnerChangeRequest)
		.where(eq(adminOwnerChangeRequest.id, requestId))
		.limit(1);
	if (!req || req.status !== 'pending') return { ok: false, error: 'This request is no longer open.' };
	if (req.expiresAt.getTime() < Date.now()) return { ok: false, error: 'This request has expired.' };

	const owners = await listOwners(db);
	const target = owners.find((o) => o.id === req.targetUserId) ?? null;
	const isOwner = owners.some((o) => o.id === ownerId);
	if (!isOwner || ownerId === req.targetUserId) {
		return { ok: false, error: 'You are not eligible to approve this request.' };
	}

	await db
		.insert(adminOwnerChangeApproval)
		.values({ requestId, ownerId })
		.onConflictDoNothing();

	const executed = await evaluate(requestId);
	return { ok: true, executed, action: req.action as OwnerChangeAction, target, owners };
}

/**
 * Re-check a pending request against the LIVE owner set and act:
 *  - target no longer an owner → cancel (moot);
 *  - expired → leave pending (surfaced as expired in the UI), never execute;
 *  - unanimous → executeOwnerChange (atomic, last-owner-guarded) then mark executed.
 * Returns true iff it executed this call.
 */
export async function evaluate(requestId: string): Promise<boolean> {
	const [req] = await db
		.select()
		.from(adminOwnerChangeRequest)
		.where(eq(adminOwnerChangeRequest.id, requestId))
		.limit(1);
	if (!req || req.status !== 'pending') return false;

	const owners = await listOwners(db);
	const ownerIds = owners.map((o) => o.id);

	// Target already demoted/removed elsewhere → the request is moot.
	if (!ownerIds.includes(req.targetUserId)) {
		await markStatus(requestId, 'cancelled');
		return false;
	}
	if (req.expiresAt.getTime() < Date.now()) return false;

	const approvals = await db
		.select({ ownerId: adminOwnerChangeApproval.ownerId })
		.from(adminOwnerChangeApproval)
		.where(eq(adminOwnerChangeApproval.requestId, requestId));
	const approvedIds = approvals.map((a) => a.ownerId);

	if (!isUnanimous(ownerIds, req.targetUserId, approvedIds)) return false;

	const did = await executeOwnerChange(db, {
		targetUserId: req.targetUserId,
		action: req.action as OwnerChangeAction
	});
	if (did) {
		await markStatus(requestId, 'executed');
		// #10 defense-in-depth: kill the (ex-)owner's admin sessions so a demote forces a
		// fresh sign-in, not just the per-request role re-check in hooks.server.ts. (A
		// `remove` already cascades sessions away with the user; this is a harmless no-op
		// there.) Best-effort — never fail the executed change over a session cleanup.
		try {
			await db.delete(adminSession).where(eq(adminSession.userId, req.targetUserId));
		} catch (err) {
			logger('owner-change').warn('session revoke after demote failed:', (err as Error)?.message);
		}
	}
	return did;
}

/**
 * Cancel a pending request. ONLY the initiator may cancel — the `initiatedBy` predicate
 * stops a target owner from forging a POST to cancel the request against themselves.
 */
export async function cancelRequest(requestId: string, actorId: string): Promise<boolean> {
	const updated = await db
		.update(adminOwnerChangeRequest)
		.set({ status: 'cancelled', updatedAt: new Date() })
		.where(
			and(
				eq(adminOwnerChangeRequest.id, requestId),
				eq(adminOwnerChangeRequest.status, 'pending'),
				eq(adminOwnerChangeRequest.initiatedBy, actorId)
			)
		)
		.returning({ id: adminOwnerChangeRequest.id });
	return updated.length > 0;
}

async function markStatus(requestId: string, status: 'executed' | 'cancelled'): Promise<void> {
	await db
		.update(adminOwnerChangeRequest)
		.set({ status, updatedAt: new Date() })
		.where(eq(adminOwnerChangeRequest.id, requestId));
}

/** All pending requests with target/initiator names + approval progress, for the panel. */
export async function listOpenRequests(): Promise<OpenOwnerChange[]> {
	const rows = await db
		.select({
			id: adminOwnerChangeRequest.id,
			targetId: adminOwnerChangeRequest.targetUserId,
			targetName: adminUser.name,
			action: adminOwnerChangeRequest.action,
			initiatedById: adminOwnerChangeRequest.initiatedBy,
			expiresAt: adminOwnerChangeRequest.expiresAt
		})
		.from(adminOwnerChangeRequest)
		.innerJoin(adminUser, eq(adminUser.id, adminOwnerChangeRequest.targetUserId))
		.where(eq(adminOwnerChangeRequest.status, 'pending'))
		.orderBy(desc(adminOwnerChangeRequest.createdAt));
	if (rows.length === 0) return [];

	const owners = await listOwners(db);
	const ownerIds = owners.map((o) => o.id);
	const nameById = new Map(owners.map((o) => [o.id, o.name] as const));

	// One round-trip for ALL approvals (was one query per request — the #6 N+1), grouped
	// by request id. Then the panel view is assembled by the pure rules helper.
	const approvals = await db
		.select({
			requestId: adminOwnerChangeApproval.requestId,
			ownerId: adminOwnerChangeApproval.ownerId
		})
		.from(adminOwnerChangeApproval)
		.where(
			inArray(
				adminOwnerChangeApproval.requestId,
				rows.map((r) => r.id)
			)
		);
	const approvalsByRequest = new Map<string, string[]>();
	for (const a of approvals) {
		const list = approvalsByRequest.get(a.requestId);
		if (list) list.push(a.ownerId);
		else approvalsByRequest.set(a.requestId, [a.ownerId]);
	}

	return assembleOpenRequests(
		rows.map((r) => ({
			id: r.id,
			targetId: r.targetId,
			targetName: r.targetName,
			action: r.action as OwnerChangeAction,
			initiatedById: r.initiatedById,
			expiresAt: r.expiresAt.getTime()
		})),
		ownerIds,
		nameById,
		approvalsByRequest,
		Date.now()
	);
}
