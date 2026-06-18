// Activation invite email — admin-specific *content* (core only transports it).
// Inline styles only: email clients ignore <style>/external CSS and don't support
// CSS custom properties, so the brand colors are literal hex here.

/** Minimal HTML entity escape — prevents HTML/email injection from invite input. */
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export interface ActivationEmailInput {
	/** Activation URL (trusted ORIGIN + /activate?token=…). */
	url: string;
	/** Invitee's display name (untrusted — escaped before embedding). */
	name: string;
}

export function activationEmail({ url, name }: ActivationEmailInput): {
	subject: string;
	html: string;
	text: string;
} {
	const safeName = escapeHtml(name.trim() || 'there');
	const safeUrl = escapeHtml(url);
	const brand = '#c41f2c'; // red accent (≈ oklch(0.52 0.21 25)); white button text clears AA

	const subject = 'Activate your Veent Admin account';

	const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f5f5;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f5;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;">
            <tr>
              <td style="font-size:18px;font-weight:600;color:#0f172a;padding-bottom:8px;">
                Veent <span style="color:#64748b;font-weight:500;">Admin</span>
              </td>
            </tr>
            <tr>
              <td style="font-size:14px;line-height:22px;color:#334155;padding:8px 0 24px;">
                Hi ${safeName}, you've been invited to the Veent Admin dashboard.
                Set your password to activate your account.
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:24px;">
                <a href="${safeUrl}" style="display:inline-block;background:${brand};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px;">
                  Activate account
                </a>
              </td>
            </tr>
            <tr>
              <td style="font-size:12px;line-height:20px;color:#64748b;border-top:1px solid #e2e8f0;padding-top:16px;">
                Or paste this link into your browser:<br />
                <span style="color:${brand};word-break:break-all;">${safeUrl}</span>
              </td>
            </tr>
            <tr>
              <td style="font-size:12px;line-height:20px;color:#94a3b8;padding-top:16px;">
                This link expires in 24 hours. If you weren't expecting this invitation, you can safely ignore this email.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

	const text = `Hi ${name.trim() || 'there'},

You've been invited to the Veent Admin dashboard. Set your password to activate your account:

${url}

This link expires in 24 hours. If you weren't expecting this invitation, you can safely ignore this email.`;

	return { subject, html, text };
}
