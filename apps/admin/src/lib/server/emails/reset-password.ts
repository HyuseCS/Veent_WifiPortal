// Password-reset email — admin-specific *content* (core only transports it).
// Inline styles only: email clients ignore <style>/external CSS and don't support
// CSS custom properties, so the brand colors are literal hex here.
//
// Distinct from activation.ts: this goes to an EXISTING active staff member who
// asked to reset a forgotten password, not to a fresh invitee. The link only sets
// a new password — mandatory TOTP still applies at sign-in, so a reset alone can
// never grant access.

/** Minimal HTML entity escape — prevents HTML/email injection from user input. */
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export interface ResetPasswordEmailInput {
	/** Reset URL (trusted ORIGIN + /reset-password?token=…). */
	url: string;
	/** Staff member's display name (untrusted — escaped before embedding). */
	name: string;
}

export function resetPasswordEmail({ url, name }: ResetPasswordEmailInput): {
	subject: string;
	html: string;
	text: string;
} {
	const safeName = escapeHtml(name.trim() || 'there');
	const safeUrl = escapeHtml(url);
	const brand = '#c41f2c'; // red accent (≈ oklch(0.52 0.21 25)); white button text clears AA

	const subject = 'Reset your RADIUS Admin password';

	const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f5f5;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f5;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;">
            <tr>
              <td style="font-size:18px;font-weight:600;color:#0f172a;padding-bottom:8px;">
                RADIUS <span style="color:#64748b;font-weight:500;">Admin</span>
              </td>
            </tr>
            <tr>
              <td style="font-size:14px;line-height:22px;color:#334155;padding:8px 0 24px;">
                Hi ${safeName}, we received a request to reset your RADIUS Admin password.
                Click below to choose a new one.
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:24px;">
                <a href="${safeUrl}" style="display:inline-block;background:${brand};color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;padding:12px 24px;border-radius:8px;">
                  Reset password
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
                This link expires in 24 hours. You'll still need your authenticator app to sign in.
                If you didn't request this, you can safely ignore this email — your password won't change.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

	const text = `Hi ${name.trim() || 'there'},

We received a request to reset your RADIUS Admin password. Choose a new one here:

${url}

This link expires in 24 hours. You'll still need your authenticator app to sign in.
If you didn't request this, you can safely ignore this email — your password won't change.`;

	return { subject, html, text };
}
