# Plan: De-mock the admin app — make every page DB-driven

> Living tracker for this task. Check items off as they land.

## Context

A teammate finished the admin backend (dashboard/users `load()`s, the Users
`block`/`unblock`/`kick` actions, the `/api/connected` SSE stream, and the
`@veent/core` services). The frontend is only partly connected, and two pages have
**no backend at all**. The goal this session: **remove `$lib/mocks.ts` entirely** so
every admin page reads/writes real data.

Current mock dependence:
- **Dashboard / Users** — lists already render from `load()` data, but the
  **interactive bits are stubs**: `UsersTable` Kick/Block buttons call nothing
  (marked *"Stub actions — wired to backend later"*); `SessionsTable` is a static
  snapshot that never opens the SSE stream.
- **Networks** — imports `networks` from mocks; **no DB table exists** (decision:
  build a seeded `network_health` table; data is synthetic placeholder until a real
  router/controller telemetry feed lands).
- **Staff** — imports `currentUserRole` + `staff`, all mutations frontend-only;
  **no role model, no table, no actions** yet.

Decisions taken (this session):
- **Roles simplified to `owner` | `admin`** — the `moderator` role is removed
  everywhere (per supervisor). Owner is the singular bootstrap account; every invited
  staff member is an `admin`.
- **Authorization model:**
  - **Staff page + all staff actions → owner-only** (server-enforced; hidden from
    admins in the sidebar). With no `moderator` beneath them, admins have no one to
    manage, and "only the owner manages admins" → owner-only.
  - **Customer Users `block`/`kick`/`unblock` → any active staff** (owner *and* admin
    both may). Since the only roles are owner/admin and both are permitted, this needs
    no per-role guard beyond the existing `(app)` auth gate.
  - Dashboard / Networks / Users → visible to both roles.
- Networks → **new seeded `network_health` table** + query + load.
- Staff → DB-backed list / enable-disable / remove **+** an **Add** that creates a
  *pending, activation-ready* `admin` account (no login until the invitee sets their
  password via an activation link). There is no role-change action (only one assignable
  role). **SMTP transport stays deferred**: the invite generates + stores the
  activation token and *stub-sends* it (logs the activation URL); a real mailer is a
  later task.

## Scope

In: dashboard SSE wiring · users actions wiring · networks table+query+page · staff
table/profile/actions/activation · drop public admin self-signup · delete
`$lib/mocks.ts`. All work stays within `apps/admin` and its deps (`@veent/core`,
`@veent/db`).

Out: real SMTP send · TOTP (CLAUDE.md mentions it; admin uses email+password today —
note only) · customer app.

---

## Phase 1 — Data layer (`@veent/db`)

**`packages/db/src/schema/admin.ts`** (currently `export {}`): add two tables,
following the `customer_profile` 1:1-extension convention.
- [x] `adminProfile` — `userId` PK → `adminUser.id` (cascade), `role` text
  default `'admin'` (`owner` | `admin` only), `status` text default `'pending'`,
  `lastActiveAt` timestamp nullable. (Role/status live here, NOT in the better-auth
  `admin_user` table — same reasoning as `customer_profile`.)
- [x] `networkHealth` — `id` serial, `name`, plus **raw** metrics: `online` bool,
  `uptimePct` numeric, `latencyMs` integer nullable, `users` integer, `throughputMbps`
  integer, `lastSampleAt` timestamp. (Store raw; the app derives tone/labels.)

The schema barrel (`schema/index.ts`) already re-exports `./admin` — no change.

- [x] **Migration:** generated `drizzle/0003_slim_baron_strucker.sql`, applied via
  `db:migrate`.
- [x] **`packages/db/src/seed.ts`:** idempotent seed for `network_health` (4 sample
  APs) added and run.

## Phase 2 — Domain services (`@veent/core`)

- [x] **`config.ts`** — added `STAFF_ROLE` (`owner`/`admin`) and `STAFF_STATUS`
  (`active`/`pending`/`disabled`) const maps.
- [x] **`services/staff.ts`** (new) — `getAdminRole`, `setStaffStatus`, `removeStaff`,
  `activateStaff` (owner row protected on status/remove).
- [x] Export from `services/index.ts`.

## Phase 3 — Admin server (`apps/admin/src/lib/server` + routes)

- [x] **`queries.ts`** — added `listStaff(db)` (join `adminUser`+`adminProfile`,
  `formatLastActive`) and `listNetworkHealth(db)` (raw metrics → tone/labels).
- [x] **`(app)/+layout.server.ts`** — reads `getAdminRole`, returns
  `{ user: { ...user, role } }`. Sidebar filters `ownerOnly` nav entries by role
  (`nav.ts` Staff entry flagged; `Sidebar.svelte` takes a `role` prop).
- [x] **`networks/+page.server.ts`** (new) — `load` → `{ networks }`.
- [x] **`staff/+page.server.ts`** (new) — owner-only `load` (`error(403)`), actions
  `invite` / `setStatus` / `remove`, each re-checking owner via `getAdminRole` →
  `fail(403)`. Invite uses `auth.api.signUpEmail` (throwaway pw) + `adminProfile`
  pending row + `auth.api.requestPasswordReset` (fires the stub activation email in
  `auth.ts`). `self`-remove blocked; owner protected in the service.

## Phase 4 — Activation flow (unauthenticated route)

- [x] **`routes/activate/+page.server.ts` + `+page.svelte`** (new, logged-out): form
  sets the password via `auth.api.resetPassword`; the `onPasswordReset` hook in
  `auth.ts` flips `pending → active` (via `activateStaff`, scoped to pending so a
  disabled member can't self-reactivate).
- [x] **Sign-in guard:** `login` action checks `getStaffStatus` after sign-in; non-active
  users are signed back out with a clear message (pending vs disabled).

## Phase 5 — Wire the components to the APIs

Use the progressive-enhancement pattern already in `login/+page.svelte`
(`use:enhance`). All forms post to the route actions above; on success SvelteKit
re-runs `load()` so rows refresh from the DB.

- [x] **`ui/IconButton.svelte`** — add optional `type: 'button' | 'submit' = 'button'`
  (backward-compatible) so an icon button can submit a form.
- [x] **`feature/UsersTable.svelte`** — replace the two stub `IconButton`s with
  `use:enhance` forms (hidden `userId`): **Kick** (`?/kick`) + **Block**/**Unblock**
  toggled on `user.tone === 'blocked'`. Kick hidden for already-blocked users.
- [x] **`dashboard/+page.svelte`** — `let liveSessions = $state(data.activeSessions)`; in
  an `$effect`, open `new EventSource('/api/connected')`, parse each message into
  `ActiveSession[]`, assign to `liveSessions`; cleanup `es.close()`. Pass to
  `<SessionsTable>` (component unchanged). (Business rule #5: live, not polled.)
- [x] **`lib/types.ts`** — `StaffRole = 'owner' | 'admin'` (drop `'moderator'`); update
  the doc comment.
- [x] **`feature/AddStaffForm.svelte`** — **remove the role `<Select>`** (invites are
  always `admin`); convert the `onAdd` callback to a real
  `<form method="POST" action="?/invite" use:enhance>`; surface action `form` errors/
  success instead of local `$state` notices.
- [x] **`feature/StaffTable.svelte`** — drop the role-change control; convert
  `onToggleStatus`/`onRemove` to `use:enhance` forms posting `?/setStatus` / `?/remove`.
  The `owner` row shows no actions.
- [x] **`staff/+page.svelte`** + **`networks/+page.svelte`** — drop `$lib/mocks` imports;
  read `data`. Staff page is owner-only (route already guards; no `canManage` client
  flag needed).

## Phase 6 — Security cleanup + remove mocks

- [x] **`login/+page.server.ts`** — **remove the public `signUpEmail` action** (open
  admin self-registration is a hole; accounts now come only from owner invites). Keep
  `signInEmail`.
- [ ] **Owner bootstrap:** since no admin users are seeded, add a small one-off
  bootstrap (admin-app script or `db:seed:owner`) that creates the first owner from
  `OWNER_EMAIL`/`OWNER_PASSWORD` env via better-auth + an `admin_profile`
  `{role:'owner', status:'active'}`. Document in `.env.example`.
- [ ] **Delete `apps/admin/src/lib/mocks.ts`** once no imports remain
  (`grep -rn "\$lib/mocks" apps/admin/src` returns nothing).

## Security notes
- Staff page + actions enforce **owner-only on the server** (`fail(403)`/`error(403)`),
  not just UI; the Staff nav entry is hidden for admins.
- Customer `block`/`kick`/`unblock` are available to any active staff (owner or admin)
  **by design** — both roles are permitted, so the existing `(app)` auth gate is the
  only guard needed.
- No new *unauthenticated* surface except `/activate`, which is token-gated and only
  sets a password for a valid pending invite.
- Pending/disabled staff cannot sign in.
- Activation tokens: single-use, short TTL, stored hashed.

## Risks / things to confirm at implementation
- Exact better-auth API for create-without-login + set-password on activation
  (`createUser` vs `signUpEmail`+`resetPassword`) — verify against the installed
  `better-auth ~1.4.21` before committing to one.
- `network_health` is **synthetic** until a real telemetry feed exists — call this out
  in the seed + page (e.g. a subtle "sample data" note), don't imply live metrics.

## Status: ✅ COMPLETE — all phases implemented & verified end-to-end

Extra fix made during verification (not in the original plan):
- **`api/connected/+server.ts`** — the SSE abort handler called `controller.close()` on
  an already-closed controller, throwing `ERR_INVALID_STATE` and **crashing the whole
  dev server** on every client disconnect. Now wrapped in try/catch. (Surfaced because
  the dashboard now opens/closes the stream on navigation.)

Verified via a curl-driven end-to-end run (server on :5174):
- DB migrated (`0003_…`), `network_health` seeded (4 APs), owner bootstrapped
  (`owner@veent.io`, role=owner/active). `bun run check` → 0 errors / 0 warnings.
- SSE: two client disconnects → server stays up (was the crash above).
- Owner: sign-in ok, `/staff` 200, invite → pending account + activation link logged.
- Activation: setting password flips `pending → active`; the activated admin can sign in.
- Authz: activated **admin** (non-owner) → `/staff` 403, invite action 403 (no user
  created), `/dashboard` 200. **Disabled** member with the correct password → no session
  (blocked). Owner-only guards confirmed in DB (no `x@veent.io` row from the blocked invite).
- Pages render DB data: networks (4 seeded APs), dashboard (KPIs/revenue/sessions), staff.
- `grep -rn "$lib/mocks" src` → empty; `mocks.ts` deleted.
- `svelte-autofixer` clean on dashboard / AddStaffForm / StaffTable.

> Note: a usable owner account `owner@veent.io` / `owner-pass-123` was created in the
> local dev DB during testing. Re-run `bun run bootstrap:owner` with your own
> `OWNER_EMAIL`/`OWNER_PASSWORD` to set the real one (idempotent).

## Verification (manual recipe)
1. `bun run --filter @veent/db db:generate && db:migrate`; `bun run db:seed` →
   `network_health` populated; bootstrap the owner.
2. `cd apps/admin && bun run check` — type-checks.
3. `bun run dev`, sign in as owner:
   - **Users:** Block → row flips to *Blocked* + `[network:stub] REVOKE …` logged;
     Unblock reverts; Kick logs revoke without blocking. Works with JS off (native POST).
   - **Dashboard:** DevTools → Network shows one open `connected` EventStream pushing
     ~every 5s; table updates live; closes on navigate-away.
   - **Networks:** renders the 4 seeded APs from DB (no mock import remains).
   - **Staff:** Add a member → appears as *Pending* `admin`, activation URL logged;
     visit it, set a password → status *Active*, can now sign in. Disable / remove
     reflect after reload. As an **admin** (non-owner), the Staff nav entry is hidden
     **and** visiting `/staff` or POSTing its actions returns 403. An admin can still
     block/kick on the Users page.
   - Public `/login` no longer exposes signup.
4. `grep -rn "\$lib/mocks" apps/admin/src` → no results; `mocks.ts` deleted.
5. Validate touched `.svelte` files with the `svelte-autofixer` MCP tool.
