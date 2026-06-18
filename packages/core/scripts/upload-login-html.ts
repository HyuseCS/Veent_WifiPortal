/**
 * Overwrites the router's hotspot login.html via the RouterOS API (no FTP needed).
 * The file must already exist on the router (`/file`); `/file/set contents=` then
 * replaces its text. Throwaway diagnostic; safe to delete.
 *
 *   bun --env-file=apps/admin/.env packages/core/scripts/upload-login-html.ts [host] [routerFileName]
 *   default host = MIKROTIK_HOST, default routerFileName = hotspot/login.html
 */
import { readFileSync } from 'node:fs';

const { MIKROTIK_HOST, MIKROTIK_USER, MIKROTIK_PASSWORD, MIKROTIK_PORT, MIKROTIK_TLS } = process.env;
const host = process.argv[2] || MIKROTIK_HOST;
const routerFile = process.argv[3] || 'hotspot/login.html';
const localFile = 'docs/mikrotik/login.html';

if (!host || !MIKROTIK_USER) {
	console.error('Missing MIKROTIK_HOST / MIKROTIK_USER');
	process.exit(1);
}

const html = readFileSync(localFile, 'utf8');
const tls = MIKROTIK_TLS === 'true';
const port = MIKROTIK_PORT ? Number(MIKROTIK_PORT) : tls ? 8729 : 8728;

const mod = (await import('node-routeros')) as unknown as {
	RouterOSAPI: new (opts: Record<string, unknown>) => {
		connect(): Promise<unknown>;
		close(): void;
		write(menu: string, params?: string[]): Promise<Array<Record<string, string>>>;
	};
};
const conn = new mod.RouterOSAPI({
	host,
	user: MIKROTIK_USER,
	password: MIKROTIK_PASSWORD ?? '',
	port,
	tls: tls ? { rejectUnauthorized: false } : undefined,
	timeout: 8
});

try {
	await conn.connect();
	const files = await conn.write('/file/print', [`?name=${routerFile}`]);
	const id = files[0]?.['.id'];
	if (!id) {
		console.error(`File "${routerFile}" not found on the router. Existing hotspot files:`);
		const all = await conn.write('/file/print', ['?type=.html']);
		for (const f of all) console.error('  -', f.name);
		console.error(
			'\nThe API can only overwrite files that already exist. If login.html is missing,\n' +
				'create it once via Winbox/FTP, then this script can update it thereafter.'
		);
		process.exit(1);
	}
	await conn.write('/file/set', [`=.id=${id}`, `=contents=${html}`]);

	// Read it back to confirm the new redirect target is in place.
	const after = await conn.write('/file/print', [`?name=${routerFile}`]);
	const contents = after[0]?.contents ?? '';
	const m = contents.match(/url=([^"&]+)/);
	console.log(`✓ uploaded ${html.length} bytes to ${routerFile}`);
	console.log(`  redirect target now: ${m ? m[1] : '(could not parse — check manually)'}`);
} catch (err) {
	console.error('✗ upload failed:', err instanceof Error ? err.message : err);
	process.exit(1);
} finally {
	conn.close();
}
