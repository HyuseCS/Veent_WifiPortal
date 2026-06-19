// Wipe-confirmation code email — admin-specific *content* (core only transports it).
// Inline styles only: email clients ignore <style>/external CSS and don't support
// CSS custom properties, so the brand colors are literal hex here.

/** Minimal HTML entity escape — prevents HTML/email injection from embedded input. */
function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export interface WipeCodeEmailInput {
	/** The 6-digit verification code (trusted, generated server-side). */
	code: string;
	/** Owner's display name (untrusted — escaped before embedding). */
	name: string;
}

export function wipeCodeEmail({ code, name }: WipeCodeEmailInput): {
	subject: string;
	html: string;
	text: string;
} {
	const safeName = escapeHtml(name.trim() || 'there');
	const safeCode = escapeHtml(code);
	const danger = '#c41f2c'; // red accent — matches the destructive action

	const subject = 'Your RADIUS Admin wipe-confirmation code';

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
                Hi ${safeName}, use this code to confirm <strong>wiping the entire customer database</strong>.
                This permanently deletes every customer and all their data.
              </td>
            </tr>
            <tr>
              <td align="center" style="padding-bottom:24px;">
                <div style="display:inline-block;font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:${danger};background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px 24px;">
                  ${safeCode}
                </div>
              </td>
            </tr>
            <tr>
              <td style="font-size:12px;line-height:20px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:16px;">
                This code expires in 10 minutes. If you didn't request a database wipe, ignore this email and your data is safe.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

	const text = `Hi ${name.trim() || 'there'},

Use this code to confirm wiping the entire customer database. This permanently deletes every customer and all their data:

${code}

This code expires in 10 minutes. If you didn't request a database wipe, ignore this email and your data is safe.`;

	return { subject, html, text };
}
