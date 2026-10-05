# UI

## Where UI code lives

| App      | Location                                                                | Notes                                        |
| -------- | ----------------------------------------------------------------------- | -------------------------------------------- |
| Admin    | `apps/admin/src/lib/components/{ui,feature,layout}/`                    | The only managed design-system library.      |
| Customer | `apps/customer/src/lib/dashboard/` and `apps/customer/src/lib/*.svelte` | Flat. No `ui/`, `feature/`, `layout/` split. |
| Locator  | `apps/locator/src/`                                                     | Thin Leaflet map. No component library.      |

Do not import across apps. Customer and locator must not use admin's `ui/`. When you build customer UI, copy patterns from a component in the same app (for example `dashboard/FreeTimeCard.svelte`). Nothing imports across app `src/lib` roots today. Keep it so.

## Admin components

- `ui/` (barrel `index.ts`): generic building blocks with no domain logic. 17 primitives: `Card`, `SectionHeading`, `Table`, `StatusBadge`, `FilterTabs`, `SearchInput`, `EmptyState`, `RouteSkeleton`, `LiveDot`, `LiveStatusPill`, `IconButton`, `Button`, `Field`, `Avatar`, `Select`, `BaseDialog`, `Sparkline`.
- `feature/` (own `index.ts`, has a `feature/sentry/` subfolder): domain components for issues, staff, networks, finance, sentry, owner-change, map.
- `layout/`: app shell. `Sidebar.svelte`, `Topbar.svelte`, `MobileDrawer.svelte`, `ModeToggle.svelte`, `index.ts`.

Put a component in `ui/` only if it is generic. Otherwise use `feature/` or `layout/`.

Customer dashboard components: `AccessBand`, `BuyRail`, `BuySheet`, `DashboardHeader`, `FreeTimeCard`, `FreeTimeCooldown`, `NeedsConnectCard`, `SignOutDialog`. Other customer shared components: `Icon.svelte`, `Toast.svelte`, `DeviceList.svelte`, `SocialLinks.svelte`.

## Tailwind 4 and tokens

- Tailwind v4. No `tailwind.config.js`. Tokens are `@theme { --color-*: oklch(...) }` in each app's `layout.css`. Each `--color-*` becomes a utility class (`bg-brand`, `text-ink`, `bg-online/15`).
- Token files (not shared): `apps/admin/src/routes/layout.css`, `apps/customer/src/routes/layout.css`, `apps/locator/src/routes/layout.css`.
- Token rationale: `docs/design/DESIGN_GUIDELINES.md`. Also `docs/design/DESIGN_BRIEF_pricing-prelogin.md`.
- Plugin: `@tailwindcss/vite`, registered in each app's `vite.config.ts`.

## Dark mode

Dark mode flips semantic tokens. It does not use `dark:` variants.

- In admin, `:root[data-theme='dark']` in `layout.css` overrides the surface, text, status, and accent vars.
- Components use semantic tokens (`bg-brand`, `bg-canvas`). They re-resolve when `ModeToggle.svelte` changes `data-theme`.
- Do not write `dark:bg-...` in components.

## Svelte 5

- Runes are forced for the whole project. Each `vite.config.ts` has a `runes: ({ filename }) => ...` predicate in the `sveltekit()` options. Library code is exempt.
- Use `$props()`, `$state()`, `Snippet` types, and `{@render children()}`. Do not use Svelte 4 `export let` or slots.
- Example: `apps/admin/src/lib/components/ui/Button.svelte` (typed `$props()` intersected with `HTMLButtonAttributes`, `children: Snippet`).

## Icons

Admin imports lucide icons one by one: `import LoaderCircle from 'lucide-svelte/icons/loader-circle'`. Do not import the whole icon barrel.

## Formatting

Prettier orders Tailwind classes (`prettier-plugin-tailwindcss`, pointed at admin's `layout.css` so it knows custom tokens). Run `bun run format` after hand-editing class strings. Do not reorder by hand.
