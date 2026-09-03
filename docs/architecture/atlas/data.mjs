// Single source of truth for the Veent WiFi Portal atlas.
// Build: node docs/architecture/atlas/build.mjs
//   → writes docs/architecture/SYSTEM.md + docs/architecture/atlas.html

export const META = {
	title: 'Veent WiFi Portal',
	artifactUrl: '',
	sourcePath: 'docs/architecture/atlas/data.mjs',
	buildCmd: 'node docs/architecture/atlas/build.mjs',
	stats: [
		{ k: 'Repo', v: 'veent_wifiportal · staging' },
		{ k: 'Apps', v: '3 + 2 packages' },
		{ k: 'Migrations', v: '53' }
	],
	intro: `_**This file is the living source of truth for the architecture.** The interactive atlas is built from the same data file._`,
	onePara: `Veent WiFi Portal sells WiFi time in a captive-portal shop. A guest joins the hotspot, a MikroTik router holds them behind a walled garden and redirects them to the customer portal. They log in with a phone code, get free time or pay through Maya (GCash or Maya wallet), and the portal tells the router to let that MAC address through. Staff run the shop from a separate admin dashboard: access points, finance, incidents. Everything writes to one Postgres database owned by @veent/db, and everything that talks to the router goes through one seam, NetworkController, so the router can be swapped for a stub in tests. There is no CI and no production deploy pipeline yet — staging is the frontier.`,
	costModel: [
		'No cloud cost model. The costs that matter here are operational, not per-token:',
		'',
		'| Cost | Where it lands | Note |',
		'|---|---|---|',
		'| Router calls | Every grant, revoke and health probe | `node-routeros` over the API port; timeouts become `RouterUnreachableError` (warning-level in Sentry, not error) |',
		'| SMS sends | Every OTP | Only the Cast provider reports delivery status; itexmo/unisms/smsgate are write-only logs |',
		'| Maya fees | Every paid top-up | GCash and Maya wallet only — every other gateway was pruned from the walled garden |',
		'| Manual gates | Every merge | No CI: `check` → `lint` → `test` → admin e2e are run by hand |'
	],
	deepDive: '',
	platformGives:
		`MikroTik RouterOS gives the hotspot, the walled garden, DHCP Option-82 circuit-ids and ` +
		'`ip-binding type=bypassed`' +
		` for granting access. SvelteKit gives routing, form actions and server-only modules. better-auth gives sessions, TOTP and phone-OTP. Drizzle gives the schema and migration chain. Sentry gives error capture and cron check-ins.`,
	weOwn: `The walled-garden model (tag groups, additive provisioning, opt-in prune, hard reset), the MAC→session→AP binding logic, credits and points ledgers, free-time rules, the outage auto-pause, OTP delivery observability, the incident board, and the whole admin dashboard.`,
	filesystem: `apps/
  admin/          staff dashboard — networks, finance, issues, staff, map
    scripts/setup-router.ts
    scripts/walled-garden-config.ts
  customer/       captive portal — login, dashboard, top-up, probe endpoints
  locator/        public read-only hotspot map
packages/
  core/
    services/     sessions credits points freeTime outage networkHealth …
    integrations/ network/{mikrotik,stub} payments/maya email/{resend,stub}
  db/
    src/schema/   customer admin admin-issue auth-* …
    drizzle/      53 migrations
scripts/dev-cron.ts
docs/mikrotik/walled-garden.md`
};

export const DECISIONS = [
	{
		axis: 'Router seam',
		decision:
			'Every router call goes through the `NetworkController` interface. Real provider is `mikrotik.ts`, tests use `stub.ts`. Nothing outside `packages/core/src/integrations/network/` speaks RouterOS.',
		adr: '—'
	},
	{
		axis: 'Walled garden ownership',
		decision:
			'The garden is code-owned. `setup:router` provisions three tagged groups — `veent-admin:probe`, `:payment`, `:portal` — in that order so denies land above allows.',
		adr: '—'
	},
	{
		axis: 'Provisioning safety',
		decision:
			'Default `setup:router` is purely additive. `--reconcile` is an opt-in prune that removes only rows carrying the code tag AND `action=allow`. `--wipe` clears both menus for a hard rebuild.',
		adr: '—'
	},
	{
		axis: 'GCash reachability',
		decision:
			'A `/system scheduler` item (`gcash-resolve`, 5 min) resolves the host and upserts an IP row. Hostname rules cannot follow the CNAME to Akamai. The originally designed DoH/DoT block was proven unnecessary and never shipped.',
		adr: '—'
	},
	{
		axis: 'Payment surface',
		decision:
			'GCash and Maya only. Google Pay is blocked by Android WebView in captive mode; PayMongo and Xendit had no integration code and were pruned.',
		adr: '—'
	},
	{
		axis: 'Browser return URL',
		decision:
			'`successUrl`/`cancelUrl` use `event.url.origin` (the walled-gardened LAN portal address). `TUNNEL_ORIGIN` is for the server-to-server webhook only — the guest is still captive at redirect time.',
		adr: '—'
	},
	{
		axis: 'Access grant',
		decision:
			'Paid guests are granted with `ip-binding type=bypassed`, which skips hotspot byte accounting. Per-AP guest throughput is therefore not measurable, by design.',
		adr: '—'
	},
	{
		axis: 'Session→AP binding',
		decision:
			'`resolveNetworkIdForMac` resolves the Option-82 circuit-id first, then falls back to interface name. A shared bridge fronting several APs must not capture the session.',
		adr: '—'
	},
	{
		axis: 'MAC trust',
		decision:
			'A fallback-resolved MAC (device cookie, `last_known_mac`) is never treated as a verified binding, and never entrenches `last_known_mac`. The `?mac=` param is client-influenceable by nature.',
		adr: '—'
	},
	{
		axis: 'Auth isolation',
		decision:
			'Two separate `betterAuth()` instances with separate secrets and cookie prefixes — `veent-portal` and `radius-admin`. Never cross-wired.',
		adr: '—'
	},
	{
		axis: 'Schema authority',
		decision:
			'`@veent/db` is the sole schema and migration source for all three apps. The dev DB is push-managed, so `db:migrate` drifts — apply DDL directly and still generate the migration file.',
		adr: '—'
	},
	{
		axis: 'Time storage',
		decision:
			'Finance and session columns are `timestamptz` (migration `0052`), with real Manila-day→UTC-instant maths in `period.ts`.',
		adr: '—'
	},
	{
		axis: 'Scheduled work',
		decision:
			'No cron app. Prod hits guarded HTTP endpoints from an external scheduler with an `x-cron-secret` header; `scripts/dev-cron.ts` polls them in dev.',
		adr: '—'
	}
];

export const GROUPS = [
	{ id: 'edge', title: 'The network edge' },
	{ id: 'portal', title: 'The guest portal' },
	{ id: 'money', title: 'Money and grants' },
	{ id: 'shared', title: 'Shared foundations' },
	{ id: 'staff', title: 'Staff operations' },
	{ id: 'off', title: 'Not yet switched on' }
];

export const NODES = [
	{
		id: 'G',
		code: 'G',
		name: 'Guest device',
		short: 'GUEST',
		group: 'edge',
		gx: 0,
		gy: 0,
		w: 2,
		d: 2,
		h: 40,
		kind: 'screen',
		one: 'A phone or laptop that just joined the WiFi and cannot reach the internet yet.',
		what: 'The customer. It associates with the hotspot, gets an address, and is held captive until someone grants it time. Its operating system quietly checks a few known URLs to decide whether to pop up the sign-in window.',
		how: 'Identified by MAC address. The MAC arrives as a <code>?mac=</code> query param, which is client-influenceable and is <mark>never treated as server-authoritative</mark>. Captive probes hit <code>generate_204</code>, <code>gen_204</code>, <code>ncsi.txt</code>, <code>connecttest.txt</code>, <code>hotspot-detect.html</code> in <code>apps/customer/src/routes/</code>.',
		steps: [
			['Associate', 'Joins the SSID, gets a DHCP lease.'],
			['Probe', 'The OS hits a known URL to test for a captive portal.'],
			['Redirect', 'Gets bounced to the portal and the sign-in window opens.'],
			['Granted', 'After a grant, the same MAC passes through freely.']
		],
		cond: [
			{
				q: 'Can the fallback MAC path (unverified banner, reconnect prompt) be reproduced live?',
				r: 'Not reproduced — it needs live IP→MAC resolution to fail on purpose. Proven by code and unit tests only (2026-07-23).'
			}
		]
	},

	{
		id: 'MT',
		code: 'MT',
		name: 'MikroTik router',
		short: 'MIKROTIK',
		group: 'edge',
		gx: 4,
		gy: 0,
		w: 3,
		d: 3,
		h: 56,
		kind: 'slab',
		one: 'The RouterOS box that owns the hotspot and decides who gets through.',
		what: 'Runs the hotspot, hands out addresses, holds unpaid guests behind the walled garden, and lets granted devices past. It is also the source of truth for which access point a device is actually on.',
		how: 'Reached over the RouterOS API with <code>node-routeros</code> from <code>packages/core/src/integrations/network/mikrotik.ts</code>. Grants are <code>/ip/hotspot/ip-binding</code> rows with <mark>type=bypassed</mark> — which skips byte accounting, so per-guest throughput is not measurable. Every physical AP MAC must also be bypassed or the router rejects its own ICMP and the dashboard reads a healthy AP as permanently DOWN.',
		steps: [
			['Hotspot', 'Holds the guest at the login page.'],
			['Walled garden', 'Allows only the whitelisted hosts.'],
			['Bind', 'Adds an ip-binding row for a granted MAC.'],
			['Report', 'Answers health probes and reports Option-82 circuit-ids.']
		],
		cond: [
			{
				q: 'Should the false-DOWN AP case have a code-level guard, not just a runbook?',
				r: 'Impossible as designed — online_since/offline_since are current-state stamps, not history. Deferred; the ip-binding runbook is the shipped mitigation (2026-07-21).'
			}
		]
	},

	{
		id: 'WG',
		code: 'WG',
		name: 'Walled garden',
		short: 'WALLED GDN',
		group: 'edge',
		gx: 4,
		gy: 4,
		w: 2.5,
		d: 2.5,
		h: 30,
		kind: 'gate',
		one: 'The short list of hosts an unpaid guest is allowed to reach.',
		what: 'Everything a guest needs before paying: the portal itself, the payment gateway, and a few deliberate denies that stop the sign-in window from flapping. Nothing else. It is rebuilt from code, not edited by hand.',
		how: 'Provisioned as three sequential tag groups by <code>provisionWalledGarden()</code>: <code>veent-admin:probe</code> (the captive-probe denies, first so they sit above the allows), <code>veent-admin:payment</code> (from <code>PAYMENT_HOSTS</code>), <code>veent-admin:portal</code> (from <code>ADMIN_WG_HOSTS</code>/<code>ADMIN_WG_IPS</code>/<code>PORTAL_LAN_IPS</code>). A separate <code>gcash-auto</code> IP row is scheduler-owned and never touched here. Canonical reference: <code>docs/mikrotik/walled-garden.md</code>.',
		steps: [
			['Probe denies', 'Deny rows first so they win on a fresh garden.'],
			['Payment allows', 'Maya, GCash/Alipay/Mynt, googleapis.'],
			['Portal allows', 'Admin and portal origins plus the LAN portal IP.'],
			['Reconcile', 'Optional prune of drifted code-owned allow rows.']
		],
		cond: [
			{
				q: 'Which extra wallets and banks should be onboarded?',
				r: 'Nine candidates listed UNVERIFIED in docs/mikrotik/walled-garden.md (GoTyme, SeaBank, GrabPay, ShopeePay, Coins.ph, BDO, BPI, Landbank, Security Bank). None whitelisted — each needs the ₱0 recon protocol first (2026-07-30).'
			}
		]
	},

	{
		id: 'GS',
		code: 'GS',
		name: 'gcash-resolve scheduler',
		short: 'GCASH SCHED',
		group: 'edge',
		gx: 1,
		gy: 5,
		w: 2,
		d: 2,
		h: 34,
		kind: 'job',
		one: 'A five-minute job on the router that keeps GCash reachable by IP.',
		what: 'GCash hides behind a CDN, and the router can only match plain hostnames. So instead of naming the host, the router looks up its current address every few minutes and allows that address directly.',
		how: 'An idempotent <code>/system scheduler</code> item named <code>gcash-resolve</code>, created by <code>provisionGcashResolveScheduler()</code>. It <code>:resolve</code>s the hostname and upserts the <code>gcash-auto</code> walled-garden-ip row. Root cause: <code>payments.gcash.com</code> CNAMEs to an Akamai edge and <mark>v6 dst-host matching cannot follow a CNAME chain</mark> — hostname rules always showed zero hits. The originally designed DoH/DoT firewall block was proven unnecessary and never built.',
		steps: [
			['Tick', 'Fires every 5 minutes.'],
			['Resolve', 'Looks up the current edge address.'],
			['Upsert', 'Writes the gcash-auto IP row.'],
			['Survive wipe', 'Re-adds the row within 5 min of a hard reset.']
		],
		cond: [
			'Rule of thumb to keep applying: a host that CNAMEs to a CDN needs a resolve scheduler; a host that resolves to the provider’s own IP needs only a PAYMENT_HOSTS entry.'
		]
	},

	{
		id: 'CU',
		code: 'CU',
		name: 'Customer portal',
		short: 'PORTAL',
		group: 'portal',
		gx: 8.5,
		gy: 0,
		w: 3,
		d: 3,
		h: 50,
		kind: 'screen',
		one: 'The page the guest lands on — sign in, see your time, buy more.',
		what: 'Phone login, a dashboard showing remaining time, and a top-up flow. It is the only app a guest ever sees, and it must be reachable from behind the walled garden, which is why its address is a LAN address and not a public one.',
		how: '<code>apps/customer</code>, SvelteKit with <code>adapter-node</code>. Its own <code>betterAuth()</code> instance, cookie prefix <mark>veent-portal</mark>, separate secret from admin. <code>ORIGIN</code> must be the guest-reachable walled-gardened LAN portal address — never <code>localhost</code> and never the tunnel.',
		steps: [
			['Land', 'Captive redirect arrives with the MAC.'],
			['Login', 'Phone number, then a one-time code.'],
			['Dashboard', 'Shows time left and whether this device is bound.'],
			['Top up', 'Starts a Maya checkout.']
		],
		cond: []
	},

	{
		id: 'OT',
		code: 'OT',
		name: 'OTP and SMS',
		short: 'OTP / SMS',
		group: 'portal',
		gx: 4,
		gy: -4.5,
		w: 2.5,
		d: 2.5,
		h: 38,
		kind: 'box',
		one: 'Sends the one-time code and watches whether it actually arrived.',
		what: 'The guest types a phone number, a code goes out over SMS, and every send attempt is logged. Only one of the SMS providers can tell us whether the message was really delivered.',
		how: '<code>apps/customer/src/lib/server/otp.ts</code> writes an append-only row to <code>customer_otp_delivery_log</code> per attempt — the insert is <mark>awaited inside its own try/catch</mark>, because an un-awaited rejection escapes onto the guest login path. Only <b>Cast</b> has real delivery receipts; itexmo, unisms and smsgate rows are written but never swept. <code>api/otp/sweep-delivery</code> alerts on rejected sends inside a 30-minute window and prunes rows after 48h.',
		steps: [
			['Send', 'Gateway call, then log the attempt.'],
			['Verify', 'Guest types the code back.'],
			['Sweep', 'Cron checks Cast delivery receipts.'],
			['Prune', 'Rows older than 48h are dropped.']
		],
		cond: [
			{
				q: 'Is the Cast delivery-receipt response shape stable beyond the one observed REJECTD case?',
				to: 'Blocked on Cast activating a real sender ID for live traffic'
			}
		]
	},

	{
		id: 'MY',
		code: 'MY',
		name: 'Maya payments',
		short: 'MAYA',
		group: 'money',
		gx: 8.5,
		gy: -4.5,
		w: 2.5,
		d: 2.5,
		h: 38,
		kind: 'box',
		one: 'The hosted checkout where the guest actually pays.',
		what: 'The guest is sent to Maya, pays with GCash or a Maya wallet, and comes back. Maya also calls us server-side to confirm, and a reconciler catches anything the callback missed.',
		how: 'Hand-rolled HTTP in <code>packages/core/src/integrations/payments/maya.ts</code> — no SDK. Webhooks reach dev through a registered ngrok tunnel. <mark>The browser return and the webhook use different origins</mark>: the return uses <code>event.url.origin</code>, the webhook uses <code>TUNNEL_ORIGIN</code>. Crossing them fails with <code>ERR_CONNECTION_CLOSED</code> because the guest is still captive at redirect time.',
		steps: [
			['Checkout', 'Portal creates the checkout and redirects.'],
			['Pay', 'Guest pays on Maya’s page.'],
			['Webhook', 'Maya calls the portal server-side.'],
			['Reconcile', 'Cron sweeps anything the webhook missed.']
		],
		cond: []
	},

	{
		id: 'LD',
		code: 'LD',
		name: 'Ledgers',
		short: 'LEDGERS',
		group: 'money',
		gx: 18,
		gy: 0,
		w: 2.5,
		d: 2.5,
		h: 26,
		kind: 'store',
		one: 'Append-only records of money in and time out.',
		what: 'Credits bought, points earned, transactions recorded. Nothing is ever edited in place, so the finance page can always be rebuilt from the trail.',
		how: '<code>credit_ledger</code>, <code>points_ledger</code>, <code>payment_transactions</code>, <code>payment_checkouts</code> — all <code>timestamptz</code> since migration <code>0052</code>. Duplicate crediting is caught by walking the drizzle error cause-chain for SQLSTATE <mark>23505</mark>, checking both <code>constraint_name</code> and <code>constraint</code> because drivers differ.',
		steps: [
			['Credit', 'A settled payment writes a credit row.'],
			['Spend', 'A grant draws it down.'],
			['Report', 'Finance reads a merged, deduped activity list.']
		],
		cond: []
	},

	{
		id: 'SS',
		code: 'SS',
		name: 'Sessions and grants',
		short: 'SESSIONS',
		group: 'money',
		gx: 13,
		gy: 0,
		w: 3,
		d: 2.5,
		h: 46,
		kind: 'box',
		one: 'Decides how much time a device gets and when to take it back.',
		what: 'Free time for new guests, paid time for those who bought it, and an expiry sweep that revokes access when the clock runs out. It also pauses everyone’s clock when their access point goes down.',
		how: '<code>packages/core/src/services/</code> — <code>sessions.ts</code>, <code>credits.ts</code>, <code>points.ts</code>, <code>freeTime.ts</code>, <code>outage.ts</code>. Pause and resume select on <code>network_sessions.network_id</code>, which is why the circuit-id-first binding matters. Revocation runs from a cron endpoint, wrapped in <code>Sentry.withMonitor</code>.',
		steps: [
			['Resolve device', 'Circuit-id first, then interface name.'],
			['Grant', 'Write the session row, call the router.'],
			['Pause', 'Freeze the clock during an AP outage.'],
			['Revoke', 'Expire the session and unbind the MAC.']
		],
		cond: []
	},

	{
		id: 'NC',
		code: 'NC',
		name: 'NetworkController',
		short: 'ROUTER SEAM',
		group: 'shared',
		gx: 13,
		gy: 4.5,
		w: 2.5,
		d: 2.5,
		h: 42,
		kind: 'cards',
		one: 'The one interface everything uses to talk to the router.',
		what: 'A single narrow door between the business logic and the network hardware. Swap the real router for a fake one and every test still runs, which is the only reason this codebase can be tested without hardware.',
		how: '<code>packages/core/src/integrations/network/</code> — <code>types.ts</code> defines the interface, <code>mikrotik.ts</code> is the real provider, <code>stub.ts</code> is the fallback, and <code>index.ts</code> picks one from <code>NETWORK_CONTROLLER</code>. <code>traceMethods()</code> wraps every method in a Sentry span at the factory seam. Timeouts throw <code>RouterUnreachableError</code>, which is <mark>downgraded to warning level</mark> because the cron monitor already alerts.',
		steps: [
			['Choose', 'Env picks mikrotik or stub.'],
			['Trace', 'Each method is wrapped in a span.'],
			['Call', 'Grant, revoke, probe, provision, wipe.'],
			['Degrade', 'Timeout becomes a typed, warning-level error.']
		],
		cond: []
	},

	{
		id: 'DB',
		code: 'DB',
		name: 'Postgres',
		short: 'DATABASE',
		group: 'shared',
		gx: 18,
		gy: 4,
		w: 3,
		d: 3,
		h: 30,
		kind: 'store',
		one: 'One database, one schema package, shared by all three apps.',
		what: 'Everything durable lives here — guests, staff, sessions, ledgers, incidents, rate limits, AP health. The apps never share code with each other; they share this.',
		how: '<code>@veent/db</code> is the sole schema and migration authority: <code>packages/db/src/schema/index.ts</code> plus <mark>53 migrations</mark>. The dev DB is push-managed, so <code>db:migrate</code> fails on journal drift — apply new DDL directly to verify locally, but still generate the migration file for the record.',
		steps: [
			['Define', 'Schema files under src/schema/.'],
			['Generate', 'drizzle-kit writes the migration.'],
			['Apply', 'Direct DDL in dev; the runbook in prod.'],
			['Share', 'All three apps read the same tables.']
		],
		cond: []
	},

	{
		id: 'LO',
		code: 'LO',
		name: 'Locator map',
		short: 'LOCATOR',
		group: 'shared',
		gx: 8.5,
		gy: 12.5,
		w: 2,
		d: 2,
		h: 36,
		kind: 'screen',
		one: 'A public map of where the hotspots are. No login.',
		what: 'The smallest app in the repo. It reads hotspot locations and draws them on a map for anyone who visits.',
		how: '<code>apps/locator</code>, Leaflet, two env vars (<code>DATABASE_URL</code>, <code>ORIGIN</code>), no auth surface at all. Reads the shared database directly.',
		steps: [
			['Read', 'Query hotspot locations.'],
			['Draw', 'Render Leaflet markers.']
		],
		cond: []
	},

	{
		id: 'AD',
		code: 'AD',
		name: 'Admin dashboard',
		short: 'ADMIN',
		group: 'staff',
		gx: 8.5,
		gy: 8,
		w: 3,
		d: 3,
		h: 54,
		kind: 'screen',
		one: 'Where staff run the shop — networks, finance, incidents, staff accounts.',
		what: 'Access points and their health, the finance activity list and CSV export, the incident board, staff accounts with two-factor, and the router setup scripts. It is deliberately separate from the guest portal.',
		how: '<code>apps/admin</code>. Authed routes sit in the <code>(app)</code> route group; login, 2FA and password reset sit outside it. Its own <code>betterAuth()</code> instance, cookie prefix <mark>radius-admin</mark>, secret at least 32 characters. Every issue mutation runs in a transaction that appends an <code>admin_issue_event</code> row in the same transaction — never a fire-and-forget log write.',
		steps: [
			['Sign in', 'Password, then TOTP.'],
			['Operate', 'Networks, finance, issues, staff, map.'],
			['Provision', 'Run setup:router against the live box.'],
			['Audit', 'Every mutation writes its own event row.']
		],
		cond: [
			{
				q: 'Does the manager issue board need row pagination?',
				to: 'Backlog — lazy event loading shipped; row pagination still open (GH backlog)'
			}
		]
	},

	{
		id: 'HL',
		code: 'HL',
		name: 'AP health and outage',
		short: 'AP HEALTH',
		group: 'staff',
		gx: 13,
		gy: 8.5,
		w: 2.5,
		d: 2.5,
		h: 40,
		kind: 'job',
		one: 'Watches the access points and freezes guest clocks when one dies.',
		what: 'Probes each access point, records whether it is up, and if it goes down, pauses the paid time of everyone connected to it so nobody loses minutes to an outage.',
		how: '<code>packages/core/src/services/networkHealth.ts</code> plus <code>outage.ts</code>, writing <code>network_health</code>. AP name collisions are retried by walking the drizzle cause-chain for a unique violation — which only works while the call sites stay <b>outside</b> a transaction. A static tripwire spec fails the build if either admin call site is ever wrapped in <code>db.transaction(</code>.',
		steps: [
			['Probe', 'Ask the router about each AP.'],
			['Record', 'Upsert the health row, retry on name collision.'],
			['Pause', 'Freeze sessions bound to a down AP.'],
			['Resume', 'Unfreeze when it comes back.']
		],
		cond: [
			{
				q: 'Has the live down-AP case been observed end to end in production?',
				to: 'Accepted known-gap — tracked in the general-plans backlog'
			}
		]
	},

	{
		id: 'CR',
		code: 'CR',
		name: 'Scheduled jobs',
		short: 'CRON',
		group: 'shared',
		gx: 13,
		gy: 12.5,
		w: 2,
		d: 2,
		h: 34,
		kind: 'job',
		one: 'There is no cron app — just guarded HTTP endpoints someone else calls.',
		what: 'Four jobs: revoke expired sessions, reconcile payments, sweep OTP delivery, refresh AP health. In production an external scheduler calls them; in development a script polls them.',
		how: 'Endpoints guarded by an <code>x-cron-secret</code> header. <code>scripts/dev-cron.ts</code> polls on a single one-minute interval — but <mark>the OTP sweep is designed for a five-minute prod cadence</mark>, so that schedule must be set on the real scheduler, not inferred from dev. The sweep’s alert path has no atomic claim, so genuinely overlapping runs could double-alert.',
		steps: [
			['Revoke', 'Expire finished sessions.'],
			['Reconcile', 'Catch payments the webhook missed.'],
			['Sweep', 'Check OTP delivery receipts.'],
			['Refresh', 'Re-probe AP health.']
		],
		cond: [
			'The five-minute OTP sweep cadence has to be configured on the external prod scheduler — nothing in the repo enforces it.'
		]
	},

	{
		id: 'SN',
		code: 'SN',
		name: 'Sentry and incidents',
		short: 'SENTRY',
		group: 'staff',
		gx: 18,
		gy: 8.5,
		w: 2.5,
		d: 2.5,
		h: 38,
		kind: 'box',
		one: 'Errors come in, staff turn them into tracked incidents.',
		what: 'All three apps report errors. Staff can pull a Sentry issue onto the incident board, assign it, and work it. Personal data is stripped before anything leaves the building.',
		how: '<code>@sentry/sveltekit</code> in all three apps, <code>@sentry/core</code> in <code>packages/core</code>. A shared <code>scrubEvent</code> redactor is wired into every <code>beforeSend</code>: it drops secrets and masks emails, MACs and phone numbers. Tracking a Sentry issue <mark>round-trips the Sentry API before persisting</mark> and fails closed if the lookup fails. Permalink hosts are pinned to sentry.io.',
		steps: [
			['Capture', 'Error is caught and scrubbed.'],
			['Classify', 'Router timeouts drop to warning level.'],
			['Track', 'Staff pull it onto the incident board.'],
			['Resolve', 'Assignment and events are audit-logged.']
		],
		cond: []
	},

	{
		id: 'MR',
		code: 'MR',
		name: 'Multi-router support',
		short: 'MULTI-ROUTER',
		group: 'off',
		ghost: true,
		gx: 0,
		gy: 9,
		w: 2.5,
		d: 2.5,
		h: 40,
		one: 'Later: more than one router, and third-party APs that speak their own API.',
		what: 'Today the system assumes one MikroTik. The plan is to support several sites, and access points from a vendor whose API we do not have credentials for yet.',
		how: 'Plan archived to <code>process/general-plans/completed/multi-router-support_13-07-26/</code> as deferred but revisitable. Phase B is blocked on Fatap AP-API credentials, tracked as GH #100.',
		steps: [
			['Credentials', 'Get Fatap AP-API access.'],
			['Generalise', 'Make NetworkController multi-instance.'],
			['Route', 'Bind each session to its own router.']
		],
		cond: [
			{
				q: 'When do we get Fatap AP-API credentials?',
				to: 'GH #100 — plan archived as deferred/revisitable (2026-07-30)'
			}
		]
	}
];

export const FLOWS = [
	{
		id: 'free',
		name: 'A guest gets online free',
		hops: [
			['G', 'MT', 'associate', { mac: 'AA:BB:CC:11:22:33', ssid: 'Veent' }, 'xy'],
			['MT', 'CU', 'captive redirect', { mac: 'AA:BB:CC:11:22:33', to: '/login' }, 'yx'],
			['CU', 'OT', 'send code', { phone: '+639••••••123', provider: 'cast' }, 'xy'],
			['OT', 'CU', 'verified', { ok: true }, 'yx'],
			['CU', 'SS', 'grant free time', { minutes: 30, reason: 'free_session' }, 'xy'],
			['SS', 'NC', 'allow mac', { mac: 'AA:BB:CC:11:22:33' }, 'yx'],
			['NC', 'MT', 'ip-binding', { type: 'bypassed' }, 'xy'],
			['MT', 'G', 'internet', { state: 'granted' }, 'yx']
		]
	},
	{
		id: 'paid',
		name: 'A guest pays',
		hops: [
			['CU', 'MY', 'create checkout', { amount: 20, currency: 'PHP' }, 'yx'],
			['MY', 'CU', 'webhook: paid', { status: 'PAYMENT_SUCCESS' }, 'xy'],
			['CU', 'LD', 'credit', { credits: 20, ref: 'chk_…' }, 'yx'],
			['LD', 'SS', 'spend', { minutes: 120 }, 'xy'],
			['SS', 'NC', 'allow mac', { mac: 'AA:BB:CC:11:22:33' }, 'yx'],
			['NC', 'MT', 'ip-binding', { type: 'bypassed' }, 'xy']
		]
	},
	{
		id: 'garden',
		name: 'Staff rebuild the walled garden',
		hops: [
			['AD', 'NC', 'setup:router --wipe', { dryRun: false }, 'xy'],
			['NC', 'WG', 'provision 3 groups', { tags: ['probe', 'payment', 'portal'] }, 'yx'],
			['WG', 'MT', 'write rows', { host: 14, ip: 2 }, 'xy'],
			['GS', 'WG', 'gcash-auto ip', { every: '5m' }, 'yx']
		]
	},
	{
		id: 'health',
		name: 'An access point goes down',
		hops: [
			['CR', 'HL', 'refresh health', { secret: 'x-cron-secret' }, 'xy'],
			['HL', 'NC', 'probe aps', { count: 6 }, 'yx'],
			['NC', 'MT', 'ping', {}, 'xy'],
			['MT', 'NC', 'no reply', { rtt: null }, 'yx'],
			['HL', 'DB', 'mark down', { networkId: 'ap-3' }, 'xy'],
			['HL', 'SS', 'pause clocks', { sessions: 4 }, 'yx']
		]
	},
	{
		id: 'incident',
		name: 'An error becomes an incident',
		hops: [
			['CU', 'SN', 'scrubbed error', { level: 'error', pii: 'masked' }, 'xy'],
			['SN', 'AD', 'track issue', { verified: true }, 'yx'],
			['AD', 'DB', 'issue + event', { tx: true }, 'xy']
		]
	}
];

export const CH = [
	{
		id: 'guest',
		title: 'A guest and the router',
		reveal: ['G', 'MT'],
		lede: `Strip everything away and this is the shop: a phone joins the WiFi, and a router decides whether it gets anywhere.`,
		story: `<p>The guest is identified by one thing — its MAC address. The router holds it, hands it an address, and refuses to pass its traffic. <mark>Nothing else in the system matters until this device is let through.</mark></p>`,
		flow: [
			['G', 'MT', 'associate', { mac: 'AA:BB:CC:11:22:33' }],
			['MT', 'G', 'held captive', { state: 'unauthorised' }]
		]
	},

	{
		id: 'garden',
		title: 'The short list of allowed hosts',
		reveal: ['WG', 'CU'],
		lede: `Before paying, a guest can reach exactly two kinds of place: our portal, and the payment gateway.`,
		story: `<p>The walled garden is the router's allow-list, and it is <mark>owned by code, not by hand-edits in Winbox</mark>. Three tagged groups are written in order — the captive-probe denies first, then payment hosts, then the portal's own addresses. The portal has to be on that list or the guest can never reach the page that sells them time.</p>`,
		flow: [
			['G', 'MT', 'probe', { url: '/generate_204' }],
			['MT', 'WG', 'check allow-list', { host: 'portal' }],
			['MT', 'CU', 'captive redirect', { to: '/login' }],
			['CU', 'G', 'sign-in page', { status: 200 }]
		]
	},

	{
		id: 'who',
		title: 'Proving who you are',
		reveal: ['OT'],
		lede: `A phone number and a six-digit code — no passwords, no accounts to remember.`,
		story: `<p>The code goes out over SMS and <mark>every attempt is logged before we know whether it landed</mark>. Only one of the four SMS providers reports real delivery receipts, so for the others we know we sent, not that it arrived. That is a deliberate limit, not a bug.</p>`,
		flow: [
			['CU', 'OT', 'send code', { phone: '+639••••••123' }],
			['OT', 'CU', 'verified', { ok: true }]
		]
	},

	{
		id: 'grant',
		title: 'Giving out time',
		reveal: ['SS', 'NC'],
		lede: `Now the interesting part: the portal has to reach through and change the router.`,
		story: `<p>Sessions decides how many minutes a device gets. But it never speaks RouterOS itself — it goes through <mark>one narrow seam, NetworkController</mark>. That seam is why the whole codebase can be tested without a router in the room: swap the real provider for a stub and nothing above notices.</p>`,
		flow: [
			['CU', 'SS', 'grant free time', { minutes: 30 }],
			['SS', 'NC', 'allow mac', { mac: 'AA:BB:CC:11:22:33' }],
			['NC', 'MT', 'ip-binding', { type: 'bypassed' }],
			['MT', 'G', 'internet', { state: 'granted' }]
		]
	},

	{
		id: 'pay',
		title: 'Paying for more',
		reveal: ['MY', 'LD'],
		lede: `Free time runs out. Buying more means leaving the portal and coming back — while still captive.`,
		story: `<p>The guest is sent to Maya's hosted checkout, pays with GCash or a Maya wallet, and returns. The trap here bit us once already: <mark>the page they return to must be a walled-gardened address</mark>, because the device is still behind the router at that moment. Payments are written to append-only ledgers, and a duplicate credit is caught by a unique violation, not by a lock.</p>`,
		flow: [
			['CU', 'MY', 'create checkout', { amount: 20 }],
			['MY', 'CU', 'webhook: paid', { status: 'PAYMENT_SUCCESS' }],
			['CU', 'LD', 'credit', { credits: 20 }],
			['LD', 'SS', 'spend', { minutes: 120 }]
		]
	},

	{
		id: 'store',
		title: 'Where everything is written',
		reveal: ['DB', 'LO'],
		lede: `Three apps, no shared code between them — one database instead.`,
		story: `<p>The apps never import each other. What they share is <code>@veent/db</code>, the single schema and migration authority, and <code>@veent/core</code>'s services. <mark>The dev database is push-managed, so the migration chain drifts</mark> — apply new DDL directly to verify, then still generate the migration file for the record. The public locator map is the smallest reader: two env vars and no auth at all.</p>`,
		flow: [
			['SS', 'DB', 'write session', { table: 'network_sessions' }],
			['LD', 'DB', 'write ledger', { table: 'credit_ledger' }],
			['LO', 'DB', 'read hotspots', { auth: null }]
		]
	},

	{
		id: 'staff',
		title: 'Staff run the shop',
		reveal: ['AD'],
		lede: `A completely separate dashboard, with its own login, its own cookie, its own secret.`,
		story: `<p>Admin and the guest portal share a database but nothing else — <mark>two auth instances that must never be cross-wired</mark>. Staff manage access points, finance and incidents here, and they run the router setup scripts from here too. Every incident mutation writes its own audit event inside the same transaction.</p>`,
		flow: [
			['AD', 'NC', 'setup:router --reconcile', { dryRun: true }],
			['NC', 'WG', 'prune drifted rows', { removed: 3 }],
			['AD', 'DB', 'read finance', { scope: 'unified' }]
		]
	},

	{
		id: 'watch',
		title: 'Watching the access points',
		reveal: ['CR', 'HL'],
		lede: `If an access point dies, nobody should lose the minutes they paid for.`,
		story: `<p>A scheduled job probes each AP. When one goes down, every session bound to it is paused, and resumed when it returns. This only works if a session is bound to the <mark>physical access point, not the shared bridge in front of it</mark> — which is why the device lookup resolves the DHCP circuit-id first and only then falls back to the interface name.</p>`,
		flow: [
			['CR', 'HL', 'refresh health', {}],
			['HL', 'NC', 'probe aps', { count: 6 }],
			['NC', 'MT', 'ping', {}],
			['MT', 'NC', 'no reply', { rtt: null }],
			['HL', 'SS', 'pause clocks', { sessions: 4 }]
		]
	},

	{
		id: 'break',
		title: 'When things break',
		reveal: ['SN'],
		lede: `Errors are scrubbed before they leave, then staff turn the real ones into tracked work.`,
		story: `<p>All three apps report to Sentry through one shared redactor that drops secrets and masks emails, MACs and phone numbers. Router timeouts are deliberately downgraded to warnings — the cron monitor already alerts on those, so raising them twice is noise. Pulling a Sentry issue onto the board <mark>round-trips the Sentry API first and fails closed</mark> if the lookup does not confirm it.</p>`,
		flow: [
			['CU', 'SN', 'scrubbed error', { pii: 'masked' }],
			['SN', 'AD', 'track issue', { verified: true }],
			['AD', 'DB', 'issue + event', { tx: true }]
		]
	},

	{
		id: 'later',
		title: 'The odd corners and what is next',
		reveal: ['GS', 'MR'],
		lede: `One live workaround that had to become code, and one thing not built yet.`,
		story: `<p>GCash hides behind a CDN and the router cannot follow the redirection, so a five-minute job on the router looks up the address and allows it directly. That started as a manual fix on live hardware and is now provisioned from code. <mark>Multi-router support is designed but switched off</mark> — it is waiting on credentials we do not have.</p>`,
		flow: [
			['GS', 'WG', 'gcash-auto ip', { every: '5m' }],
			['WG', 'MT', 'write ip row', { tag: 'gcash-auto' }]
		]
	},

	{
		id: 'all',
		title: 'The whole system',
		reveal: [],
		lede: `Everything at once, with five flows to choose from.`,
		story: `<p>Pick a flow bottom-left. Hover anything to read it, click to pin, <b>→</b> goes inside a structure to see its steps. The <mark>Open questions</mark> tab lists every question by ID, with the ones already answered struck through.</p>`,
		flow: null
	}
];

export const HOW_HTML = `<div class="eyebrow">veent_wifiportal · staging</div><h1 class="t">How it's built</h1><div class="sub">a bun monorepo: three SvelteKit apps, two shared packages, one database</div>
<h3 class="sec">Shape</h3><pre>apps/
  admin/     staff dashboard (networks, finance, issues, staff, map)
  customer/  captive portal (login, dashboard, top-up, probes)
  locator/   public hotspot map, no auth
packages/
  core/      services + integrations (network, payments, email)
  db/        sole schema + 53 migrations</pre>
<h3 class="sec">Stack</h3><p>SvelteKit 2 on Svelte 5 (runes forced project-wide, no <code>svelte.config.js</code> — config lives inline in each <code>vite.config.ts</code>), Tailwind 4, Drizzle + postgres.js, better-auth, Sentry, <code>node-routeros</code>. Package manager and runtime: bun. All three apps use <code>adapter-node</code>.</p>
<h3 class="sec">Seams that matter</h3><p>Everything that touches the router goes through <code>NetworkController</code>. Everything durable goes through <code>@veent/db</code>. The two auth instances never meet. Integration providers all follow the same factory + stub pattern, wrapped in Sentry spans at the seam.</p>
<h3 class="sec">Gates</h3><p>There is <b>no CI</b>. Quality gates are run by hand: <code>check</code> → <code>lint</code> → <code>test</code> → admin e2e. Feature branches merge into <code>staging</code>, which is the current frontier; there is no production deploy process yet. Agents never commit — they stage changes and suggest a message.</p>`;
