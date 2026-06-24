/** Pretty-print an E.164 PH mobile ("+639176544521") as "+63 917 654 4521"; returns the
 * raw string unchanged if it doesn't match. Customers register by phone only, so this is the
 * canonical guest identity shared by the Users table and the Finance buyer column. */
export function fmtPhone(p: string): string {
	const m = p.match(/^\+63(\d{3})(\d{3})(\d{4})$/);
	return m ? `+63 ${m[1]} ${m[2]} ${m[3]}` : p;
}
