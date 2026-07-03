# DESIGN.md — Veent WiFi Portal (admin)

Design context for the operator **admin dashboard**. Derived from the source of truth,
`apps/admin/src/routes/layout.css` (`@theme` tokens), and `docs/design/DESIGN_GUIDELINES.md`.
Components never hardcode colors — they read the semantic `--color-*` tokens, which
Tailwind v4 exposes as utilities (`bg-brand`, `text-ink`, `bg-online/15`, …).

## Register

**Product** — the admin is a desktop tool; design SERVES the data. Data-dense,
calm, fast. (The customer captive portal is the separate "brand-ish" surface and is
out of scope here.)

## Color

Identity: **Parafiber royal-blue accent** (hue 262) + **deep-navy sidebar** (hue 266),
with a sparing **gold highlight**. One accent only — `cta` is an alias of `brand`.
Danger is a distinct **oxblood red** (`blocked`), the only red, so it never reads as the
accent. Neutrals are tinted toward the blue hue (264), never pure `#000`/`#fff`.

| Role | Light | Dark |
|---|---|---|
| `brand` / `cta` (accent) | `oklch(0.54 0.22 262)` | `oklch(0.64 0.2 262)` |
| `highlight` (gold, sparing) | `oklch(0.86 0.18 98)` | `oklch(0.87 0.18 98)` |
| `bg` (raised card) | `oklch(1 0 0)` | `oklch(0.18 0.055 264)` |
| `canvas` (recessed page bg) | `oklch(0.972 0.007 264)` | `oklch(0.14 0.05 264)` |
| `surface` (in-card tint) | `oklch(0.975 0.006 264)` | `oklch(0.23 0.055 264)` |
| `border` | `oklch(0.91 0.006 264)` | `oklch(0.33 0.045 264)` |
| `ink` (text) | `oklch(0.16 0.01 264)` | `oklch(0.95 0.005 264)` |
| `muted` (text) | `oklch(0.5 0.01 264)` | `oklch(0.68 0.01 264)` |
| `online` | `oklch(0.52 0.15 150)` | `oklch(0.68 0.15 150)` |
| `warning` | `oklch(0.62 0.15 75)` | `oklch(0.74 0.14 75)` |
| `blocked` (oxblood) | `oklch(0.42 0.15 18)` | `oklch(0.6 0.16 18)` |
| `sidebar` (navy) | `oklch(0.24 0.11 266)` | `oklch(0.23 0.11 266)` |

Text on `brand`/`cta` is always `white`. The `canvas` ↔ `bg` relationship (recessed
gutter behind raised cards) holds in both modes — that's why white cards lift off it.

## Theme

**Light and dark modes** (not color presets). The `ModeToggle` in the sidebar writes
`data-theme` on `<html>` and persists to `localStorage` (`radius-admin-theme`); initial
value falls back to `prefers-color-scheme`. `@theme` is the light base; `:root[data-theme='dark']`
overrides only what changes (accent + status lifted for AA, hues fixed). Components need
no `dark:` variants — semantic tokens re-resolve live when the attribute flips.

## Typography

No web font — system stacks (admin is a desktop tool):

```css
--font-sans: system-ui, -apple-system, 'Segoe UI', sans-serif;
--font-mono: ui-monospace, 'Cascadia Code', Menlo, monospace;
```

`--font-mono` carries any value where digit alignment matters: KPI numbers, MAC/IP
addresses, timestamps, session durations. Everything else is sans. Scale is tight
(~1.15 steps): KPI values `font-mono text-3xl font-bold`, dashboard title `text-xl
font-semibold`, table headers `text-xs font-semibold uppercase tracking-wide text-muted`,
rows/labels `text-sm`.

## Elevation & layout

Flat, border-first. Cards are `rounded-lg border border-border bg-bg`; grouping inside a
card uses a `border-t` divider or spacing, **never a nested card**. Raised cards sit on the
recessed `canvas` gutter — that, not shadow, carries most of the elevation. KPI grids use
`repeat(auto-fit, minmax(240px, 1fr))` so they reflow at tablet widths without breakpoints.
Shell: fixed `w-60` navy sidebar (off-canvas drawer below `md`) + `h-16` topbar, scrollable `main`.

## Components

- **Buttons / interactive**: every interactive element is `min-h-[44px]`, `cursor-pointer`,
  with a visible `focus-visible` ring. Accent button = `bg-cta text-white hover:bg-cta-hover`.
- **Status badges**: color + text + dot (never color alone) — `bg-{online|warning|blocked}/15`
  pill with matching text/dot. Degraded/offline dots use the slow `.status-pulse` breathe.
- **Tables**: `surface` header row, `divide-y divide-border` rows, `hover:bg-surface`,
  monospaced MAC/IP/time columns.
- **Icons**: Lucide Svelte only, no emoji icons. Icon-only buttons get an `aria-label`.
  Sizes `h-4 w-4` dense, `h-5 w-5` buttons/nav.

## Motion

CSS-only, no JS deps. Micro-interactions 120–220ms ease-out; entrance animations
(`.animate-fade-in`, `.animate-fade-in-up`, chart `draw-line`) run ~200–650ms once on
mount. Animate `transform`/`opacity`/`stroke` only — never layout properties. A global
`prefers-reduced-motion` block collapses all durations to ~0 (animations resolve to their
final visible state, so nothing is hidden).

## Anti-patterns (admin)

- No nested cards; no card where a divider or spacing would do.
- No second accent — keep `cta == brand`. Gold is a highlight, not a status.
- `blocked` oxblood is the only red. Don't introduce another red for the accent.
- No `dark:` variants in components — read semantic tokens.
- No emoji as icons; no color-only status.
