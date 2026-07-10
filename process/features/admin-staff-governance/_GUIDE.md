# admin-staff-governance

<!-- Part of veent_wifiportal -->

## Scope

Staff account and access governance for the admin app: staff accounts and roles, 2FA/step-up
authentication, and the invite / promote / owner-change / wipe-verification workflows that manage
who has admin access and at what privilege level.

## Key Source Files

- `apps/admin/src/routes/(app)/staff` -- staff management UI/routes
- `apps/admin/src/routes/activate` -- account activation flow
- `apps/admin/src/routes/enroll-2fa` -- 2FA enrollment
- `apps/admin/src/routes/login`, `apps/admin/src/routes/login/2fa` -- login + 2FA challenge
- `apps/admin/src/routes/forgot-password`, `apps/admin/src/routes/reset-password` -- password reset flow
- `apps/admin/src/routes/logout` -- logout route
- `apps/admin/src/lib/server/auth.ts` -- better-auth instance (admin, cookiePrefix `radius-admin`)
- `apps/admin/src/lib/server/auth-guard.ts` -- route protection guard
- `apps/admin/src/lib/server/twoFactor.ts` (+ test) -- 2FA logic
- `apps/admin/src/lib/server/step-up.ts` -- step-up re-auth for sensitive actions
- `apps/admin/src/lib/server/owner-change.ts` -- owner-change workflow
- `apps/admin/src/lib/server/wipe-verification.ts` -- wipe-verification workflow
- `apps/admin/src/lib/server/postLogin.ts` -- post-login hook logic
- `apps/admin/src/lib/server/adminBypass.ts` (+ spec), `adminAccess.spec.ts` -- admin access bypass/spec coverage
- `apps/admin/src/lib/server/emails/activation.ts`, `owner-change.ts`, `wipe-code.ts`, `reset-password.ts` -- governance email templates
- `packages/core/src/services/staff.ts` -- staff domain service
- `packages/core/src/services/adminAccess.ts` -- admin access domain service
- `packages/db/src/schema/admin.ts` -- admin account schema
- `packages/db/src/schema/admin-two-factor.ts` -- 2FA schema
- `packages/db/src/schema/admin-owner-change.ts` -- owner-change schema
- `packages/db/src/schema/auth-admin.ts` -- better-auth generated admin auth schema
- `e2e/invite.e2e.ts`, `e2e/owner-change.e2e.ts`, `e2e/promote.e2e.ts`, `e2e/wipe.e2e.ts`, `e2e/content-mfa.e2e.ts` -- E2E coverage
- `docs/dev/STAFF_ROLES.md` -- staff role reference doc

## Related Context

- `process/context/all-context.md` -- root context router
- `process/context/auth/all-auth.md` -- two-instance auth isolation (admin `radius-admin` vs customer `veent-portal` cookie prefixes, separate `BETTER_AUTH_SECRET`s, guard pattern, 2FA/step-up, `auth:schema` generation command)
- `process/context/database/all-database.md` -- schema ownership (`packages/db/src/schema/*`), migration commands

## Current Status

Status: stable

Mature surface with no active task. This folder was created proactively (not in response to a
queued task) because staff governance changes fall under the high-risk classes defined in
`process/development-protocols/orchestration.md` §High-Risk Execution Handoff (auth/identity,
permission/trust-boundary logic) — any future work here should invoke the
`vc-risk-evidence-pack` manual-first evidence flow before finalize/review closure.

## Folder Contents

```text
process/features/admin-staff-governance/
  active/       -- in-progress plans for this feature (each task lives inside a {slug}_{date}/ task folder)
  completed/    -- archived completed plans
  backlog/      -- deferred/future plans
```

All artifacts (plans, specs, reports, references) colocate inside each `{slug}_{date}/` task folder. Do NOT create `reports/` or `references/` sibling dirs.
