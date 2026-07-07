# Staff roles & access

Who can do what in the **admin** app (`apps/admin`). This is a reference; the source of
truth is the code (see [Enforcement](#enforcement)). Keep this in sync when a gate changes.

## Roles

There are exactly **two** staff roles (`STAFF_ROLE` in `packages/core/src/config.ts`):

| Role    | How you get it                    | Summary                                                        |
| ------- | --------------------------------- | ------------------------------------------------------------- |
| `admin` | Invited by an owner (`/staff`)    | Day-to-day operations; read-only on config; no staff/content. |
| `owner` | **Promotion** only (not invite)   | Everything an admin can do **plus** all config + destructive + staff. |

`owner` is marked **non-assignable** in the `admin_role` catalog — it's never handed out by
invite. A fresh deployment gets its first owner via `bun run --filter radius-admin bootstrap:owner`;
everyone else is invited as an `admin` and can later be **promoted**.

## Access matrix

| Area                                                                | Admin | Owner |
| ------------------------------------------------------------------- | :---: | :---: |
| **Dashboard** — view                                                |  ✅   |  ✅   |
| **Networks** — view health, refresh sample                          |  ✅   |  ✅   |
| **Networks** — bind interface, set AP config / bandwidth caps, delete AP, wipe networks | ❌ | ✅ |
| **Router models** — add / edit / delete                             |  ❌   |  ✅   |
| **Map** — view                                                      |  ✅   |  ✅   |
| **Users** — view, block / unblock / kick, dev "Allow WiFi"          |  ✅   |  ✅   |
| **Users** — delete customer, wipe customer database                 |  ❌   |  ✅   |
| **Finance** — view                                                  |  ✅   |  ✅   |
| **Sentry** — view                                                   |  ✅   |  ✅   |
| **Content Management** (packages/tiers, FAQ, session limits) — view *and* edit | ❌ | ✅ |
| **Staff** (invite, set status, remove, promote, owner-change)       |  ❌   |  ✅   |

**In short:** admins run day-to-day operations and manage *customer* accounts (block/unblock/kick);
owners additionally hold all config, destructive, and staff-management power. The two fully
owner-only sections are **Content Management** and **Staff**.

## Owner lifecycle

- **First owner:** `bootstrap:owner` script (one-time).
- **New staff:** owner-only invite on `/staff` → created as `admin` (public sign-up is disabled).
- **Promotion:** an owner promotes an `admin` to `owner` on `/staff`.
- **Owner change / step-down:** demoting or removing an owner (incl. an owner stepping down) needs
  **unanimous approval from every *other* owner** — a request/approve flow
  (`createRequest` → `recordApproval` → `evaluate` in `owner-change.ts`, `OwnerChangeDialog.svelte`),
  so no single owner can unilaterally remove another.

## Enforcement

- **Base gate** — `apps/admin/src/routes/(app)/+layout.server.ts` requires **signed-in + 2FA
  enrolled** for every page in the app shell. It does *not* gate on role; it just reads the role and
  passes it down.
- **Per-action** — owner-only handlers call `requireOwner(userId)`
  (`apps/admin/src/lib/server/auth-guard.ts`), which **re-reads the role from the DB** (never trusts
  client state) and returns `fail(403)` otherwise. Loads don't run on form POSTs, so each mutating
  action re-asserts it itself.
- **Owner-only sections** — `/content` and `/staff` gate at their layout load
  (`throw error(403)`), so admins can't even view them.
- **Sidebar** — `nav.ts` marks `ownerOnly` items (Content Management, Staff) and `Sidebar.svelte`
  hides them for non-owners. This is **cosmetic** — the server-side gates above are the real
  boundary.
- **Session on demote** — sessions aren't force-invalidated on a demotion; the per-request role
  re-check in `hooks.server.ts` covers it (a demoted owner loses access on their next request).

### Where the boundary lives (source of truth)

| Concern                | File                                                        |
| ---------------------- | ---------------------------------------------------------- |
| Role names             | `packages/core/src/config.ts` (`STAFF_ROLE`)               |
| Owner check            | `apps/admin/src/lib/server/auth-guard.ts` (`requireOwner`) |
| Base auth + 2FA gate   | `apps/admin/src/routes/(app)/+layout.server.ts`            |
| Content section gate   | `apps/admin/src/routes/(app)/content/+layout.server.ts`    |
| Nav visibility         | `apps/admin/src/lib/nav.ts` (`ownerOnly`)                  |
| Owner-change flow      | `apps/admin/src/routes/(app)/staff/+page.server.ts`        |
