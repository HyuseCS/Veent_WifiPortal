#!/usr/bin/env bun
/**
 * One-shot production setup for the Veent/Radius WiFi portal.
 *
 *   bun scripts/setup-prod.ts            # run it
 *   bun scripts/setup-prod.ts --dry-run  # print every action, change nothing
 *
 * Cross-platform (Linux / Windows / macOS). It automates the parts that are the
 * SAME everywhere — env files + generated secrets, local Postgres DB, migrations,
 * seed, owner bootstrap, build — then GENERATES the OS-specific service config
 * (systemd unit on Linux, NSSM script on Windows) under ./deploy and prints the
 * privileged commands for YOU to run. It never sudo/admins your machine itself.
 *
 * Idempotent: safe to re-run (also your update path). Existing secrets are kept,
 * not rotated; an existing DB/role is reused.
 *
 * What it does NOT do (deployment-specific, left to you):
 *   - install bun / node / Postgres system packages
 *   - fill external secrets (Maya, Semaphore, Resend, MikroTik creds, OWNER_*)
 *   - configure the router (upload login.html, run setup:router)
 *   - TLS / reverse proxy
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');
const PLATFORM = process.platform; // 'linux' | 'win32' | 'darwin'

// ── Tunables ────────────────────────────────────────────────────────────────
const DB_NAME = 'radius';
const DB_ROLE = 'radius';
const DB_HOST = 'localhost';
const DB_PORT = 5432;
// Admin connection used ONLY to create the role/db. Override via PG_ADMIN_URL.
const PG_ADMIN_URL = process.env.PG_ADMIN_URL ?? 'postgres://postgres@localhost:5432/postgres';
const APPS = [
	{ name: 'customer', pkg: 'veent-customer', port: 3001 },
	{ name: 'admin', pkg: 'radius-admin', port: 3002 }
] as const;

// ── Tiny logging / exec helpers ─────────────────────────────────────────────
const log = (m: string) => console.log(`  ${m}`);
const step = (m: string) => console.log(`\n▶ ${m}`);
const warn = (m: string) => console.warn(`  ⚠ ${m}`);
function run(cmd: string, args: string[], opts: { cwd?: string; input?: string } = {}) {
	if (DRY) {
		log(`[dry-run] ${cmd} ${args.join(' ')}`);
		return '';
	}
	return execFileSync(cmd, args, {
		cwd: opts.cwd ?? ROOT,
		input: opts.input,
		stdio: opts.input ? ['pipe', 'pipe', 'inherit'] : 'inherit',
		encoding: 'utf8'
	}) as unknown as string;
}
function capture(cmd: string, args: string[]): string {
	try {
		return execFileSync(cmd, args, { encoding: 'utf8' }).trim();
	} catch {
		return '';
	}
}
const gen = (bytes = 32) => randomBytes(bytes).toString('base64url');

// ── .env editing (set a key only if missing/blank — never clobber real values) ─
function ensureEnvVar(file: string, key: string, value: string): 'set' | 'kept' {
	let text = existsSync(file) ? readFileSync(file, 'utf8') : '';
	const re = new RegExp(`^${key}=.*$`, 'm');
	const current = re.exec(text)?.[0]?.split('=').slice(1).join('=').replace(/^"|"$/g, '') ?? null;
	if (current && current.trim() !== '') return 'kept';
	const line = `${key}="${value}"`;
	if (DRY) return 'set';
	text = re.test(text) ? text.replace(re, line) : `${text}${text.endsWith('\n') || !text ? '' : '\n'}${line}\n`;
	writeFileSync(file, text);
	return 'set';
}
function envValue(file: string, key: string): string | null {
	if (!existsSync(file)) return null;
	const m = new RegExp(`^${key}=(.*)$`, 'm').exec(readFileSync(file, 'utf8'));
	return m ? m[1].replace(/^"|"$/g, '').trim() || null : null;
}

// ── 0. Preflight ─────────────────────────────────────────────────────────────
console.log(`\n=== Radius prod setup ${DRY ? '(DRY RUN — no changes)' : ''} ===`);
console.log(`repo: ${ROOT}\nos:   ${PLATFORM}`);

step('Checking prerequisites');
const bunV = capture('bun', ['--version']);
const nodeV = capture('node', ['--version']);
const psqlV = capture('psql', ['--version']);
log(`bun:  ${bunV || 'MISSING'}`);
log(`node: ${nodeV || 'MISSING'}`);
log(`psql: ${psqlV || 'MISSING'}`);
if (!bunV) fail('bun is required — install from https://bun.sh');
if (!nodeV) warn('node not found — install Node to run the built servers (or use `bun ./build`).');
if (!psqlV) warn('psql not found — DB provisioning will be skipped; create the DB manually.');

// ── 1. Provision the local Postgres DB + role ────────────────────────────────
step('Provisioning local Postgres database');
let dbPassword = '';
const existingUrl = envValue(join(ROOT, 'apps/customer/.env'), 'DATABASE_URL');
if (existingUrl && existingUrl.includes(`/${DB_NAME}`)) {
	log(`DATABASE_URL already set to the ${DB_NAME} DB — leaving DB as-is.`);
} else if (psqlV) {
	dbPassword = gen(18);
	const sqlRole = `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='${DB_ROLE}') THEN CREATE ROLE ${DB_ROLE} LOGIN PASSWORD '${dbPassword}'; END IF; END $$;`;
	const dbExists = !DRY && capture('psql', [PG_ADMIN_URL, '-tAc', `SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'`]) === '1';
	try {
		run('psql', [PG_ADMIN_URL, '-v', 'ON_ERROR_STOP=1', '-c', sqlRole]);
		if (!dbExists) run('psql', [PG_ADMIN_URL, '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE ${DB_NAME} OWNER ${DB_ROLE}`]);
		else log(`database "${DB_NAME}" already exists — reused.`);
		log(`role "${DB_ROLE}" and database "${DB_NAME}" ready.`);
	} catch {
		warn(`Could not provision the DB as ${PG_ADMIN_URL}.`);
		warn('Run this yourself as a Postgres superuser, then re-run:');
		console.log(`    CREATE ROLE ${DB_ROLE} LOGIN PASSWORD '<pick-one>';`);
		console.log(`    CREATE DATABASE ${DB_NAME} OWNER ${DB_ROLE};`);
		dbPassword = '';
	}
} else {
	warn('Skipping DB provisioning (no psql). Create the DB/role, then set DATABASE_URL.');
}
const DATABASE_URL =
	existingUrl ??
	(dbPassword ? `postgres://${DB_ROLE}:${dbPassword}@${DB_HOST}:${DB_PORT}/${DB_NAME}` : '');

// ── 2. Env files (+ generated secrets) ───────────────────────────────────────
step('Writing env files and generating secrets');
const cronSecret = firstExistingEnv('CRON_SECRET') ?? gen(24);
for (const app of APPS) {
	const dir = join(ROOT, 'apps', app.name);
	const env = join(dir, '.env');
	const example = join(dir, '.env.example');
	if (!existsSync(env)) {
		if (existsSync(example)) {
			if (!DRY) copyFileSync(example, env);
			log(`apps/${app.name}/.env created from .env.example`);
		} else if (!DRY) writeFileSync(env, '');
	}
	if (DATABASE_URL) ensureEnvVar(env, 'DATABASE_URL', DATABASE_URL);
	// Distinct per-app auth secret; shared cron secret.
	ensureEnvVar(env, 'BETTER_AUTH_SECRET', gen(32));
	ensureEnvVar(env, 'CRON_SECRET', cronSecret);
	log(`apps/${app.name}/.env ready (secrets generated where blank).`);
}

// ── 3. Install, migrate, seed, build ─────────────────────────────────────────
step('Installing dependencies');
run('bun', ['install']);

step('Applying database migrations');
run('bun', ['run', 'db:migrate']);

step('Seeding starter packages (idempotent)');
run('bun', ['run', 'db:seed']);

step('Bootstrapping the owner account');
const ownerEmail = envValue(join(ROOT, 'apps/admin/.env'), 'OWNER_EMAIL');
if (ownerEmail) run('bun', ['run', '--filter', 'radius-admin', 'bootstrap:owner']);
else warn('OWNER_EMAIL not set in apps/admin/.env — skipping. Set OWNER_* and run `bun run --filter radius-admin bootstrap:owner`.');

step('Building both apps');
run('bun', ['run', 'build']);

// ── 4. Emit OS-specific service + cron config under ./deploy ──────────────────
step('Generating service config');
const deploy = join(ROOT, 'deploy');
if (!DRY) mkdirSync(deploy, { recursive: true });
const nodeBin = PLATFORM === 'win32' ? capture('where', ['node']).split(/\r?\n/)[0] || 'node' : capture('which', ['node']) || '/usr/bin/node';

if (PLATFORM === 'win32') emitWindows();
else emitSystemd();

function emitSystemd() {
	for (const app of APPS) {
		const unit = `[Unit]
Description=Radius ${app.name} server
After=network.target postgresql.service

[Service]
WorkingDirectory=${ROOT}
EnvironmentFile=${ROOT}/apps/${app.name}/.env
Environment=PORT=${app.port}
ExecStart=${nodeBin} ${ROOT}/apps/${app.name}/build
Restart=always

[Install]
WantedBy=multi-user.target
`;
		writeOut(join(deploy, `radius-${app.name}.service`), unit);
	}
	const cron = `# Radius cron jobs — install with: crontab deploy/crontab
* * * * * curl -fsS -X POST -H "x-cron-secret: ${cronSecret}" http://127.0.0.1:${APPS[0].port}/api/network/revoke
* * * * * curl -fsS -X POST -H "x-cron-secret: ${cronSecret}" http://127.0.0.1:${APPS[0].port}/api/payments/reconcile
* * * * * curl -fsS -X POST -H "x-cron-secret: ${cronSecret}" http://127.0.0.1:${APPS[1].port}/api/network/health/refresh
`;
	writeOut(join(deploy, 'crontab'), cron);
	console.log('\n  Next (Linux, run as root):');
	console.log(`    sudo cp ${deploy}/radius-*.service /etc/systemd/system/`);
	console.log('    sudo systemctl daemon-reload && sudo systemctl enable --now radius-customer radius-admin');
	console.log(`    crontab ${deploy}/crontab`);
}

function emitWindows() {
	// NSSM (https://nssm.cc) registers each app as a Windows Service.
	const ps = `# Radius Windows services via NSSM (https://nssm.cc). Run in an elevated PowerShell.
${APPS.map(
		(a) => `nssm install Radius-${a.name} "${nodeBin}" "${ROOT}\\apps\\${a.name}\\build"
nssm set Radius-${a.name} AppDirectory "${ROOT}"
nssm set Radius-${a.name} AppEnvironmentExtra PORT=${a.port}
# NSSM does not read .env — load it, or set each var with: nssm set Radius-${a.name} AppEnvironmentExtra KEY=VALUE
nssm start Radius-${a.name}`
	).join('\n\n')}
`;
	writeOut(join(deploy, 'install-services.ps1'), ps);
	const tasks = `# Radius cron equivalents — Scheduled Tasks (run elevated). Fires every minute.
$h = @{ 'x-cron-secret' = '${cronSecret}' }
schtasks /Create /SC MINUTE /TN "Radius-Revoke" /TR "powershell -c \\"Invoke-WebRequest -Method POST -Headers @{'x-cron-secret'='${cronSecret}'} http://127.0.0.1:${APPS[0].port}/api/network/revoke\\"" /F
schtasks /Create /SC MINUTE /TN "Radius-Reconcile" /TR "powershell -c \\"Invoke-WebRequest -Method POST -Headers @{'x-cron-secret'='${cronSecret}'} http://127.0.0.1:${APPS[0].port}/api/payments/reconcile\\"" /F
schtasks /Create /SC MINUTE /TN "Radius-Health" /TR "powershell -c \\"Invoke-WebRequest -Method POST -Headers @{'x-cron-secret'='${cronSecret}'} http://127.0.0.1:${APPS[1].port}/api/network/health/refresh\\"" /F
`;
	writeOut(join(deploy, 'scheduled-tasks.ps1'), tasks);
	console.log('\n  Next (Windows, elevated PowerShell — install NSSM first):');
	console.log(`    ${deploy}\\install-services.ps1`);
	console.log(`    ${deploy}\\scheduled-tasks.ps1`);
	warn('NSSM does not read .env files — see the comment in install-services.ps1 to inject env vars.');
}

// ── 5. Final checklist ───────────────────────────────────────────────────────
step('Remaining manual steps (deployment-specific)');
console.log(`  1. Fill real secrets in apps/*/.env:
       customer: MAYA_PUBLIC_KEY / MAYA_SECRET_KEY (+ MAYA_SANDBOX=false), SEMAPHORE_API_KEY, ORIGIN
       admin:    MIKROTIK_HOST/USER/PASSWORD, RESEND_API_KEY/EMAIL_FROM, OWNER_*, ORIGIN, set NETWORK_CONTROLLER=mikrotik
  2. Remove the temporary /register admin hole before serving users.
  3. Router: edit docs/mikrotik/login.html to the prod portal URL & upload it; run:
       bun run --filter radius-admin setup:router
  4. Install + start the services and crons printed above.
  5. (Optional) Put Caddy/nginx in front for HTTPS — see docs/DEPLOYMENT.md.`);
console.log(`\n✔ setup ${DRY ? '(dry run) ' : ''}complete.\n`);

// ── helpers ──────────────────────────────────────────────────────────────────
function writeOut(path: string, content: string) {
	if (DRY) {
		log(`[dry-run] would write ${path}`);
		return;
	}
	writeFileSync(path, content);
	log(`wrote ${path}`);
}
function firstExistingEnv(key: string): string | null {
	for (const app of APPS) {
		const v = envValue(join(ROOT, 'apps', app.name, '.env'), key);
		if (v) return v;
	}
	return null;
}
function fail(msg: string): never {
	console.error(`\n✖ ${msg}\n`);
	process.exit(1);
}
