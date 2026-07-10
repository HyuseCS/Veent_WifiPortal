// Incident-assignment notification email — admin-specific content (core only transports).
// Inline styles only (email clients ignore <style>/CSS vars), brand colors literal. This is a
// NOTIFICATION: the CTA just deep-links to the incident; nothing is actioned by email.

/** Minimal HTML entity escape — prevents HTML/email injection from embedded input. */
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/** Collapse CRLF/whitespace — the title goes into the Subject header, which must be single-line
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

export interface IssueAssignedInput {
	/** Recipient's display name (untrusted — escaped). */
	recipientName: string;
	/** Who assigned it (untrusted — escaped). */
	actorName: string;
	/** Incident title (untrusted — escaped). */
	issueTitle: string;
	/** Deep link to the incident (trusted ORIGIN). */
	url: string;
}

/** Sent to a staff member when they're newly assigned to an incident. */
export function issueAssignedEmail({
	recipientName,
	actorName,
	issueTitle,
	url
}: IssueAssignedInput): { subject: string; html: string; text: string } {
	const safeName = escapeHtml(recipientName.trim() || 'there');
	const safeActor = escapeHtml(actorName.trim() || 'A manager');
	const safeTitle = escapeHtml(issueTitle.trim() || 'an incident');
	const brand = '#0f766e';

	const subject = `You've been assigned: ${headerSafe(issueTitle) || 'an incident'}`;

	const html = shell(
		`<tr><td style="font-size:14px;line-height:22px;color:#334155;padding:8px 0 24px;">Hi ${safeName}, <strong>${safeActor}</strong> assigned you to the incident <strong>${safeTitle}</strong>. Open it to see the details and start working.</td></tr>
     <tr><td align="center" style="padding-bottom:24px;"><a href="${escapeHtml(url)}" style="display:inline-block;background:${brand};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:8px;padding:12px 24px;">View the incident</a></td></tr>
     <tr><td style="font-size:12px;line-height:20px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:16px;">You're receiving this because you were assigned to an incident in the RADIUS admin dashboard.</td></tr>`
	);

	const text = `Hi ${recipientName.trim() || 'there'},

${actorName.trim() || 'A manager'} assigned you to the incident "${issueTitle.trim() || 'an incident'}". Open it to see the details and start working:
${url}

You're receiving this because you were assigned to an incident in the RADIUS admin dashboard.`;

	return { subject, html, text };
}
