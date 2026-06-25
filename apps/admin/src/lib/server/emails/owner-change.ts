// Owner-change notification emails — admin-specific content (core only transports).
// Inline styles only (email clients ignore <style>/CSS vars), brand colors literal.
// These are NOTIFICATIONS: approval is cast in-app behind a TOTP step-up, never by
// clicking a link, so the URL just deep-links to the staff page.

/** Minimal HTML entity escape — prevents HTML/email injection from embedded input. */
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

const actionVerb = (a: 'demote' | 'remove') => (a === 'demote' ? 'demote to admin' : 'remove');

/** Collapse CRLF/whitespace — names go into the Subject header, which must be single-line
 *  (a raw \r\n would allow header injection). */
const headerSafe = (value: string) => value.replace(/\s+/g, ' ').trim();

function shell(body: string): string {
	return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f5f5;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f5;padding:32px 0;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;">
          <tr><td style="font-size:18px;font-weight:600;color:#0f172a;padding-bottom:8px;">RADIUS <span style="color:#64748b;font-weight:500;">Admin</span></td></tr>
          ${body}
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export interface OwnerChangeRequestedInput {
	/** Recipient's display name (untrusted — escaped). */
	recipientName: string;
	/** The owner being changed (untrusted — escaped). */
	targetName: string;
	action: 'demote' | 'remove';
	/** Whether this recipient is a required approver (vs. the target, just informed). */
	isApprover: boolean;
	/** Deep link to the staff page (trusted ORIGIN). */
	url: string;
}

/** Sent to each required approver (action needed) and the target (awareness). */
export function ownerChangeRequestedEmail({
	recipientName,
	targetName,
	action,
	isApprover,
	url
}: OwnerChangeRequestedInput): { subject: string; html: string; text: string } {
	const safeName = escapeHtml(recipientName.trim() || 'there');
	const safeTarget = escapeHtml(targetName.trim() || 'an owner');
	const verb = actionVerb(action);
	const brand = '#0f766e';

	const subject = isApprover
		? `Approval needed: ${verb} ${headerSafe(targetName) || 'an owner'}`
		: `A request to ${verb} your owner account was opened`;

	const lead = isApprover
		? `A request to <strong>${verb} ${safeTarget}</strong> needs every other owner's approval before it takes effect. Open the staff page to review and approve with your authenticator.`
		: `Heads up: another owner opened a request to <strong>${verb} your owner account</strong>. It takes effect only once all other owners approve.`;

	const cta = isApprover
		? `<tr><td align="center" style="padding-bottom:24px;"><a href="${escapeHtml(url)}" style="display:inline-block;background:${brand};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;padding:12px 24px;">Review on the staff page</a></td></tr>`
		: '';

	const html = shell(
		`<tr><td style="font-size:14px;line-height:22px;color:#334155;padding:8px 0 24px;">Hi ${safeName}, ${lead}</td></tr>
     ${cta}
     <tr><td style="font-size:12px;line-height:20px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:16px;">Approvals are confirmed in the dashboard with your authenticator code — never by replying to this email.</td></tr>`
	);

	const text = `Hi ${recipientName.trim() || 'there'},

${
	isApprover
		? `A request to ${verb} ${targetName.trim() || 'an owner'} needs every other owner's approval. Review and approve it on the staff page: ${url}`
		: `Another owner opened a request to ${verb} your owner account. It takes effect only once all other owners approve.`
}

Approvals are confirmed in the dashboard with your authenticator code — never by replying to this email.`;

	return { subject, html, text };
}

export interface OwnerChangeExecutedInput {
	/** Recipient's display name (untrusted — escaped). */
	recipientName: string;
	/** The owner who was changed (untrusted — escaped). */
	targetName: string;
	action: 'demote' | 'remove';
}

/** Sent to all owners + the target once a request reaches unanimity and executes. */
export function ownerChangeExecutedEmail({
	recipientName,
	targetName,
	action
}: OwnerChangeExecutedInput): { subject: string; html: string; text: string } {
	const safeName = escapeHtml(recipientName.trim() || 'there');
	const safeTarget = escapeHtml(targetName.trim() || 'an owner');
	const past = action === 'demote' ? 'demoted to admin' : 'removed';
	const subject = `Owner change completed: ${headerSafe(targetName) || 'an owner'} ${past}`;

	const html = shell(
		`<tr><td style="font-size:14px;line-height:22px;color:#334155;padding:8px 0 24px;">Hi ${safeName}, all owners approved and <strong>${safeTarget} has been ${past}</strong>. This is now in effect.</td></tr>
     <tr><td style="font-size:12px;line-height:20px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:16px;">If this wasn't expected, review your staff and sign-in activity right away.</td></tr>`
	);

	const text = `Hi ${recipientName.trim() || 'there'},

All owners approved and ${targetName.trim() || 'an owner'} has been ${past}. This is now in effect.

If this wasn't expected, review your staff and sign-in activity right away.`;

	return { subject, html, text };
}
