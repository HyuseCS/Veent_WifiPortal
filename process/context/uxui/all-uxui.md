---
name: context:all-uxui
description: "Admin's ui/ design-system primitives, Tailwind 4 tokens, and Svelte 5 runes conventions — the uxui group entrypoint/router"
keywords: uxui, ui, tailwind, svelte, runes, design system, component, layout.css, tokens, dark mode, lucide-svelte, prettier-plugin-tailwindcss, design guidelines
related: []
date: 10-07-26
---

# Uxui Context

This file is the canonical uxui context entrypoint for veent-wifiportal.

Use it after `process/context/all-context.md` when the task needs an admin UI component, a Tailwind
token change, or Svelte 5 component conventions.

---

## Scope

This group covers:

- `apps/admin/src/lib/components/ui/` — the design-system primitive library (barrel `index.ts`) —
  the canonical home for generic, domain-agnostic building blocks
- `apps/admin/src/lib/components/feature/` and `.../layout/` — admin's domain components and
  app-shell chrome, and how they relate to `ui/`
- Tailwind CSS v4 setup (`@tailwindcss/vite`), design tokens (`@theme` block +
  `:root[data-theme]` dark overrides), and `prettier-plugin-tailwindcss` class ordering
- Svelte 5 runes conventions (`$props()`, `$state()`, `Snippet`, `{@render}`) as forced project-wide
- `lucide-svelte` icon import pattern (admin only)
- Per-app UI boundaries: `apps/customer` and `apps/locator` do NOT import from admin's `ui/` — each
  app owns its own component surface

It does not cover:

- Server-side logic backing a component (form actions, load functions) — routed via the relevant
  context group or feature folder
- The customer captive-portal's component set beyond noting its location
  (`apps/customer/src/lib/dashboard/`) — it has no shared design-system library of its own to
  document yet
- `apps/locator`'s Leaflet map rendering — thin, no dedicated component library

## Read When

Read this entrypoint when:

- building or modifying an admin UI primitive (`components/ui/`)
- building or modifying an admin feature component (`components/feature/`) or layout chrome
  (`components/layout/`)
- changing Tailwind tokens, adding a new semantic color, or touching dark-mode overrides
- adding a new icon (lucide-svelte import pattern) in admin
- deciding whether a new component belongs in `ui/` vs `feature/` vs `layout/`
- working on customer or locator UI and needing to confirm it should NOT reach into admin's `ui/`

## Quick Routing

(No deeper uxui docs yet — this entrypoint is the only file in the group. Add routing entries here
when a `component-library.md`, `design-tokens.md`, or `svelte5-conventions.md` is split out.
`docs/design/DESIGN_GUIDELINES.md` and `docs/design/DESIGN_BRIEF_pricing-prelogin.md` are
pre-existing project docs — treat them as deeper reading, not part of this managed group.)

## Source Paths

- `apps/admin/src/lib/components/ui/index.ts` — barrel export of the primitive library: `Card`,
  `SectionHeading`, `Table`, `StatusBadge`, `FilterTabs`, `SearchInput`, `EmptyState`,
  `RouteSkeleton`, `LiveDot`, `LiveStatusPill`, `IconButton`, `Button`, `Field`, `Avatar`, `Select`,
  `BaseDialog`, `Sparkline` — 17 primitive components + the barrel itself (18 files total in the
  directory)
- `apps/admin/src/lib/components/feature/` — ~34 domain components (issues, staff, networks,
  finance, sentry, owner-change, map, etc.), including a `feature/sentry/` subfolder, plus its own
  `index.ts`
- `apps/admin/src/lib/components/layout/` — `Sidebar.svelte`, `Topbar.svelte`,
  `MobileDrawer.svelte`, `ModeToggle.svelte` + `index.ts`
- `apps/admin/src/routes/layout.css` — design tokens: `@theme` block (light-mode `--color-*` vars)
  + `:root[data-theme='dark']` override block; rationale documented in
  `docs/design/DESIGN_GUIDELINES.md`
- `apps/customer/src/routes/layout.css`, `apps/locator/src/routes/layout.css` — each app has its
  OWN token file; none are shared with admin
- `apps/admin/vite.config.ts` (and the customer/locator equivalents) — `@tailwindcss/vite` plugin
  registration + the `runes: ({ filename }) => …` forced-runes-mode predicate inside the
  `sveltekit()` plugin options
- `.prettierrc` (repo root) — `plugins: ["prettier-plugin-svelte", "prettier-plugin-tailwindcss"]`,
  `tailwindStylesheet: "./src/routes/layout.css"` (resolved per-app), tabs / single-quote /
  no-trailing-comma / `printWidth: 100`
- `apps/customer/src/lib/dashboard/` — `AccessBand`, `BuyRail`, `BuySheet`, `DashboardHeader`,
  `FreeTimeCard`, `FreeTimeCooldown`, `NeedsConnectCard`, `SignOutDialog` (8 components)
- `apps/customer/src/lib/{Icon,Toast}.svelte`, `DeviceList.svelte`, `SocialLinks.svelte` —
  customer's non-dashboard shared components, living at `lib/` root (no `ui/`/`feature/` split like
  admin)
- `docs/design/DESIGN_GUIDELINES.md`, `docs/design/DESIGN_BRIEF_pricing-prelogin.md` — pre-existing
  design docs (not managed by this group, but the authoritative source for token *rationale*)

## Update Triggers

Update this group when:

- a primitive is added, removed, or renamed in `components/ui/`
- the Tailwind token set (`@theme` block) changes — a new semantic color, a renamed token, a new
  dark-mode override
- the Svelte version, the runes policy, or the Tailwind major version changes
- a new app grows its own component library worth documenting (currently only admin has one)
- the group grows enough to split into `component-library.md` / `design-tokens.md`

## Canonical Notes

- **Admin's `ui/` is the only managed design-system library in the monorepo.** `apps/customer` and
  `apps/locator` have flat component sets with no `ui/`/`feature/`/`layout/` split — when building
  customer or locator UI, mirror an existing component's patterns WITHIN THAT APP (e.g. match
  `dashboard/FreeTimeCard.svelte`'s conventions for a new customer component) rather than importing
  from admin's `ui/`. Nothing today imports across app `src/lib` roots — keep it that way.
- **Tailwind v4, not v3:** tokens are defined via `@theme { --color-*: oklch(...) }` inside each
  app's `layout.css`, not a `tailwind.config.js` — v4 turns each `--color-*` var into a utility
  class automatically (`bg-brand`, `text-ink`, `bg-online/15`, …).
- **Dark mode is a semantic-token flip, not `dark:` variants.** In admin, `:root[data-theme='dark']`
  overrides only the surface/text/status/accent vars in `layout.css`; components never write
  `dark:bg-...` — they consume the semantic token (`bg-brand`, `bg-canvas`, etc.) and it re-resolves
  live when `data-theme` flips via `ModeToggle.svelte`.
- **Svelte 5 runes are forced project-wide** via a `runes: ({ filename }) => …` predicate in each
  app's `vite.config.ts` `sveltekit()` plugin options (exempting library code) — components use
  `$props()`, `$state()`, `Snippet` types, and `{@render children()}`, not the Svelte 4 `export let`
  / slots API. `apps/admin/src/lib/components/ui/Button.svelte` is a representative example: a
  typed `$props()` destructure intersected with `HTMLButtonAttributes`, and a `children: Snippet`.
- **Icons:** admin imports lucide icons individually —
  `import LoaderCircle from 'lucide-svelte/icons/loader-circle'` — not a barrel import of the whole
  icon set.
- **Prettier owns Tailwind class ordering** — `prettier-plugin-tailwindcss` is wired with an
  explicit `tailwindStylesheet` pointing at the app's `layout.css` (so it resolves custom `@theme`
  tokens, not just Tailwind's stock palette) — run `bun run format` after hand-editing class strings
  rather than manually re-ordering them.
