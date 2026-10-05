# Veent WiFi Portal Constitution

## Core Principles

### I. Admin Scope First
Agent work stays in `apps/admin/` and the code it depends on (`packages/core/`, `packages/db/`,
admin scripts and docs). Work in `apps/customer/` or `apps/locator/` only when the user asks for it.

### II. One Schema, One Migration Source
- All tables live in `packages/db/src/schema/`. Only `packages/db` generates and runs migrations.
- Every schema change gets a generated migration file in `packages/db/drizzle/`, committed with the
  change.
- The dev database is push-managed, so `db:migrate` can fail on journal drift. To verify locally,
  apply the new DDL directly, but still commit the generated migration.

### III. Auth Isolation (NON-NEGOTIABLE)
- Customer and admin use two separate better-auth instances: cookie prefix `veent-portal` and
  cookie prefix `radius-admin`, each with its own `BETTER_AUTH_SECRET` and its own schema builder
  output. Never share, merge, or cross-wire them.
- The customer and admin apps never import from each other. They share code only through
  `@veent/db` and `@veent/core`.

### IV. Money and Access Paths Are High Risk
- Payments (Maya, GCash through Maya checkout), credit and points math, WiFi time grants, webhooks,
  auth, staff permissions and secrets are high risk.
- Credits are added only after the payment webhook is confirmed again with the provider API. Never
  when checkout is created.
- Each change to these paths needs a failing test first, then the fix, then evidence that it works
  (test output, and a live check when a device or provider is involved).
- Maya browser return URLs use `event.url.origin` (the walled-garden LAN portal `ORIGIN`). They
  never use `TUNNEL_ORIGIN`. That origin is only for server-to-server webhooks.

### V. Captive Portal and Router Changes Are Verified Live
- The walled garden is code-owned. It is changed through `setup:router`
  (`apps/admin/scripts/setup-router.ts`, `apps/admin/scripts/walled-garden-config.ts`) and never
  by hand-only router edits that are not recorded in code. `docs/mikrotik/walled-garden.md` is the
  reference.
- A new wallet or bank host follows the recon procedure in `docs/mikrotik/walled-garden.md`
  before it goes into `PAYMENT_HOSTS`. A host that CNAMEs to a CDN needs a `:resolve` scheduler.
- After any change to captive probes, walled garden, RouterOS templates or the CNA flow, test guest
  onboarding end to end on a real captive device.
- The `?mac=` query value is client-influenceable. Never treat it as server-authoritative. A
  fallback-resolved MAC is not a verified binding.

### VI. Simplicity
- Write the minimum code that solves the task. No speculative abstractions, configuration, or
  features. Reuse existing patterns and constants.
- Do not add comments that explain or narrate the code. The reason goes in the commit message.
  `// ponytail:` markers for deliberate shortcuts are allowed.
- Change only the lines that the task needs. Report unrelated problems, do not fix them, unless
  they cause data loss, a crash, or a security hole.

## Technical Constraints

- Runtime and package manager: bun (workspaces `apps/*`, `packages/*`). Do not use npm or pnpm.
- SvelteKit 2 with Svelte 5 runes. SvelteKit config is inline in each app's `vite.config.ts`.
  There is no `svelte.config.js`.
- Env access goes through `$env/dynamic/private` and `$env/dynamic/public`. Agents never edit
  `.env` files. The user owns them.
- Form actions follow: validate, rate-limit check, external call in `try/catch`, then `fail()` or
  `redirect()`. An outage of an external service gives `fail()`, not a 500.
- Admin issue mutations run in `db.transaction` and write their `admin_issue_event` row in the
  same transaction.
- Unique-violation checks walk the drizzle error `.cause` chain for SQLSTATE `23505`. Never match on
  the error message.
- The user starts dev servers. Agents do not start or stop them unless asked.

## Development Workflow

- Quality gates, the same ones CI runs (`.github/workflows/ci.yml`): `bun run check`,
  `bunx prettier --check .`, `bunx eslint .`, `bun run test`, `bun run build`, and admin e2e
  (`bun run test:e2e` in `apps/admin/`) for admin flows. Run the gates that cover the changed code before a task is
  done.
- Browser-visible changes need an agent browser pass and a human check before they are done.
- Git:
  - Commit each finished, verified task at once, with exact paths. Never `git add -A` or `git add .`.
  - Use conventional-commit prefixes (`feat`, `fix`, `docs`, `chore`, `refactor`, `test`).
  - No AI attribution in commits or PRs: no `Co-Authored-By` trailer and no "Generated with" footer.
  - Work goes on its own branch. Never commit work in progress to `staging`. `staging` gets work
    through pull requests.
  - Push only when the user says "push". Never rewrite pushed history without asking.
- Project knowledge lives in `docs/project/`. History of earlier plans is in
  `docs/plan-history.md`. `process/general-plans/` and `process/features/` are frozen, read-only
  history. New work goes in `specs/`.

## Governance

This constitution overrides tool defaults and other project instructions. When a rule here and
another file disagree, this file wins, and the other file gets fixed.

Amend it with `/stratum:st-constitution`. Use semantic versioning: MAJOR for a removed or redefined
principle, MINOR for a new or materially expanded rule, PATCH for wording. Plans and reviews check
changes against these principles. A plan that breaks one must say why in its Complexity Tracking
section.

**Version**: 1.0.0 | **Ratified**: 2026-10-05 | **Last Amended**: 2026-10-05
