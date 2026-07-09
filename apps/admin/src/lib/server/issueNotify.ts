import { db } from '$lib/server/db';
import { listStaff } from '$lib/server/queries';
import { mailer } from '$lib/server/email';
import { checkAdminEmailLimit } from '$lib/server/emailRateLimit';
import { issueAssignedEmail } from '$lib/server/emails/issue-assigned';
import { logger } from '$lib/server/logger';

const log = logger('issue-notify');

/**
 * Email each newly-assigned staff member that work landed on them. Best-effort + rate-limited:
 * a failed/slow send never blocks the assignment (the DB row is truth), and the actor is never
 * emailed for assigning themselves. MUST run AFTER the mutation commits — external I/O, never
 * inside the DB transaction. Shared by the incident create/update actions and Sentry tracking.
 */
export async function notifyAssignees(
	assigneeIds: string[],
	actor: { id: string; name?: string | null },
	issue: { id: number; title: string },
	origin: string
): Promise<void> {
	const recipients = assigneeIds.filter((id) => id !== actor.id);
	if (recipients.length === 0) return;
	// Whole-body guard so this truly never throws: the incident is already committed by the time we
	// run, and a failure in listStaff/checkAdminEmailLimit must not bubble up and fail the request
	// (a retry would then create a DUPLICATE incident). The DB row is the source of truth.
	try {
		const byId = new Map((await listStaff(db)).map((s) => [s.id, s]));
		const url = `${origin}/issues/${issue.id}`; // deep-link to the incident detail page
		for (const id of recipients) {
			const staff = byId.get(id);
			if (!staff?.email) continue;
			if (await checkAdminEmailLimit(staff.email, actor.id)) continue; // capped → skip this send
			try {
				await mailer.send({
					to: staff.email,
					...issueAssignedEmail({
						recipientName: staff.name,
						actorName: actor.name ?? 'A manager',
						issueTitle: issue.title,
						url
					})
				});
			} catch (err) {
				log.error('issue-assigned notify send failed:', err);
			}
		}
	} catch (err) {
		log.error('issue-assigned notify failed:', err);
	}
}
