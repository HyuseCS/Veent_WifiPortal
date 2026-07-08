# Veent WiFi Portal — Design System

Two apps, one design language. The customer portal strips everything down to the path of least friction. The admin dashboard layers data on top of the same foundation.

Both are built on a token system so the admin can switch color themes at deployment time without touching component code.

---

## Token System

All color, type, and spacing decisions reference CSS custom properties. A theme is just a different set of values for the same tokens. Components never hardcode colors.

Define tokens in each app's `layout.css`:

```css
@import 'tailwindcss';

@theme {
  /* Palette — customer portal: Parafiber navy (brand) + blue (cta) */
  --color-brand:        rgb(0, 18, 107);
  --color-brand-hover:  rgb(0, 12, 78);
  --color-cta:          rgb(10, 98, 169);
  --color-cta-hover:    rgb(7, 75, 135);

  /* Surfaces */
  --color-bg:           oklch(1 0 0);
  --color-surface:      rgb(244, 249, 255);
  --color-border:       rgb(223, 234, 247);

  /* Text */
  --color-ink:          rgb(12, 34, 58);
  --color-muted:        rgb(92, 112, 138);

  /* Status — semantic, not themeable */
  --color-online:       oklch(0.50 0.15 155);
  --color-warning:      oklch(0.65 0.15 72);
  --color-blocked:      oklch(0.55 0.18 22);
}
```

### Admin theme

The admin dashboard does **not** inherit the customer's navy+blue base — it ships its own `@theme` in `apps/admin/src/routes/layout.css`. Identity: a Parafiber royal-blue accent (hue 262) with a deep-navy sidebar (hue 266) and a sparing gold highlight. `cta` is a deliberate alias of `brand` (one accent, kept as a separate token only so the ~16 files using `bg-cta`/`text-cta` don't need editing).

```css
@theme {
  /* Accent — Parafiber royal blue. cta == brand (single accent). */
  --color-brand:        oklch(0.54 0.22 262);
  --color-brand-hover:  oklch(0.48 0.22 262);
  --color-cta:          oklch(0.54 0.22 262);
  --color-cta-hover:    oklch(0.48 0.22 262);

  /* Highlight — bright Parafiber gold. Sparing (e.g. OWNER badge), never a status. */
  --color-highlight:    oklch(0.86 0.18 98);

  /* Surfaces — `bg` is the raised card; `canvas` is the recessed page background
     behind cards (white cards lift off a light-gray gutter); `surface` is the
     in-card tint (table headers, hover, pills). */
  --color-bg:           oklch(1 0 0);
  --color-canvas:       oklch(0.972 0.007 264);
  --color-surface:      oklch(0.975 0.006 264);
  --color-border:       oklch(0.91 0.006 264);

  /* Text */
  --color-ink:          oklch(0.16 0.01 264);
  --color-muted:        oklch(0.5 0.01 264);

  /* Status — blocked = oxblood danger, the only red, so it never reads as the accent. */
  --color-online:       oklch(0.52 0.15 150);
  --color-warning:      oklch(0.62 0.15 75);
  --color-blocked:      oklch(0.42 0.15 18);

  /* Sidebar — deep saturated Parafiber navy in both modes. */
  --color-sidebar:       oklch(0.24 0.11 266);
  --color-sidebar-text:  oklch(0.86 0.05 264);
  --color-sidebar-muted: oklch(0.67 0.06 264);
}
```

### Light / dark mode

The admin ships **light and dark modes**, not color presets. A `ModeToggle` in the sidebar (`light` / `dark`) writes `data-theme` on `<html>` and persists to `localStorage` (`radius-admin-theme`); the initial value falls back to `prefers-color-scheme`. `@theme` is the light base; `:root[data-theme='dark']` overrides only what changes — accent and status colors are lifted for AA on dark surfaces while hues stay put, and `canvas` becomes a real dark navy (darker than the sidebar, so the sidebar still frames the content). Because components read the semantic tokens, none of them need `dark:` variants.

```css
:root[data-theme='dark'] {
  color-scheme: dark;
  --color-brand:    oklch(0.64 0.2 262);
  --color-cta:      oklch(0.64 0.2 262);
  --color-bg:       oklch(0.18 0.055 264);
  --color-canvas:   oklch(0.14 0.05 264);
  --color-surface:  oklch(0.23 0.055 264);
  --color-border:   oklch(0.33 0.045 264);
  --color-ink:      oklch(0.95 0.005 264);
  --color-muted:    oklch(0.68 0.01 264);
  --color-sidebar:  oklch(0.23 0.11 266);
  /* status + highlight also lifted — see layout.css */
}
```

Text on `--color-brand`/`--color-cta` is always `white` — the accent is mid-to-dark saturation in both modes, never a pale fill.

---

## Typography

### Customer portal

**[Plus Jakarta Sans](https://fonts.google.com/specimen/Plus+Jakarta+Sans)** for body/UI, **Montserrat** for headings — self-hosted via `@fontsource` (no external font request; the portal loads over a captive connection).

```css
/* Self-hosted @font-face from @fontsource — no Google Fonts request. In @theme: */
--font-sans:    'Plus Jakarta Sans', system-ui, sans-serif;
--font-heading: 'Montserrat', var(--font-sans);            /* applied to h1–h6 */
--font-mono:    'JetBrains Mono', ui-monospace, monospace; /* numeric data */
```

Usage:
- Page titles: `text-2xl font-bold tracking-tight` (28px / 700)
- Section headings: `text-xl font-semibold` (20px / 600)
- UI labels, button text: `text-sm font-medium` (14px / 500)
- Body: `text-base font-normal` (16px / 400) — never go below 16px in the portal

The heading scale is fixed, not fluid. `clamp()` sizing is for brand surfaces; the portal is a task interface and the hierarchy doesn't change with viewport.

### Admin dashboard

No web font. Admin is a desktop product tool — system-ui is the right call.

```css
--font-sans: system-ui, -apple-system, 'Segoe UI', sans-serif;
--font-mono: ui-monospace, 'Cascadia Code', Menlo, monospace;
```

`--font-mono` carries KPI numbers, MAC addresses, IP addresses, timestamps, and session durations — any value where digit alignment matters. Everything else is sans.

Admin type scale (tighter ratio, 1.15 steps):
- Dashboard title: `text-xl font-semibold` 
- Section: `text-base font-semibold`
- Table header: `text-xs font-semibold uppercase tracking-wide text-[--color-muted]`
- Table rows, labels: `text-sm`
- KPI values: `font-mono text-3xl font-bold`

---

## Components

### Buttons

All interactive elements enforce `min-h-[44px]`. That's the one non-negotiable on the customer portal — this runs on Android phones tapped with thumbs.

**Primary CTA** — blue, used once per screen:

```html
<button class="w-full min-h-[44px] cursor-pointer rounded-lg px-4 py-3
               bg-[--color-cta] text-sm font-semibold text-white
               hover:bg-[--color-cta-hover] active:scale-[0.98]
               focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[--color-cta]
               disabled:opacity-40 disabled:cursor-not-allowed
               transition-[background-color,transform] duration-150">
  Connect Now
</button>
```

**Brand action** — navy, for secondary actions that are still important (login, confirm):

```html
<button class="min-h-[44px] cursor-pointer rounded-lg px-4 py-2.5
               bg-[--color-brand] text-sm font-semibold text-white
               hover:bg-[--color-brand-hover]
               focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[--color-brand]
               transition-colors duration-150">
  Sign In
</button>
```

**Ghost** — for back/cancel paths:

```html
<button class="min-h-[44px] cursor-pointer rounded-lg px-4 py-2.5
               border border-[--color-border] bg-[--color-bg] text-sm font-medium text-[--color-ink]
               hover:bg-[--color-surface]
               transition-colors duration-150">
  Back
</button>
```

**Loading state** — disable the button, swap in a spinner, never leave the user wondering:

```svelte
<button disabled={pending} class="...">
  {#if pending}
    <span class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden="true"></span>
    <span class="sr-only">Loading…</span>
  {:else}
    Connect Now
  {/if}
</button>
```

### Form inputs

No placeholder-only inputs. Label is always visible and associated.

```html
<div class="space-y-1.5">
  <label for="email" class="block text-sm font-medium text-[--color-ink]">
    Email
  </label>
  <input
    id="email"
    type="email"
    autocomplete="email"
    class="w-full min-h-[44px] rounded-lg border border-[--color-border] bg-[--color-bg] px-4 py-3
           text-sm text-[--color-ink] placeholder:text-[--color-muted]
           focus:border-[--color-brand] focus:outline-none focus:ring-2 focus:ring-[--color-brand]/20
           transition-colors duration-150"
    placeholder="you@example.com"
  />
  <!-- Error — shown conditionally, never hidden with display:none -->
  <p class="text-xs text-[--color-blocked]" role="alert">
    Invalid email address
  </p>
</div>
```

### Status badges

Pair color with text — color alone isn't enough for screen readers or colorblind users.

```html
<!-- Online -->
<span class="inline-flex items-center gap-1.5 rounded-full bg-[--color-online]/15 px-2.5 py-1 text-xs font-medium text-[--color-online]">
  <span class="h-1.5 w-1.5 rounded-full bg-[--color-online]" aria-hidden="true"></span>
  Online
</span>

<!-- Low balance / warning -->
<span class="inline-flex items-center gap-1.5 rounded-full bg-[--color-warning]/15 px-2.5 py-1 text-xs font-medium text-[--color-warning]">
  <span class="h-1.5 w-1.5 rounded-full bg-[--color-warning]" aria-hidden="true"></span>
  Low Balance
</span>

<!-- Blocked / offline -->
<span class="inline-flex items-center gap-1.5 rounded-full bg-[--color-blocked]/15 px-2.5 py-1 text-xs font-medium text-[--color-blocked]">
  <span class="h-1.5 w-1.5 rounded-full bg-[--color-blocked]" aria-hidden="true"></span>
  Blocked
</span>

<!-- Live pulsing dot — admin dashboard only -->
<span class="relative flex h-2 w-2" aria-label="Live">
  <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-[--color-online] opacity-60"></span>
  <span class="relative inline-flex h-2 w-2 rounded-full bg-[--color-online]"></span>
</span>
```

### Cards

**Customer portal card** — single-column, max-w-sm, everything centered:

```html
<div class="rounded-xl border border-[--color-border] bg-[--color-surface] p-6 shadow-sm">
  <!-- content -->
</div>
```

No nested cards. If something needs visual grouping inside a card, use a `border-t border-[--color-border]` divider or spacing, not another card.

**Credit balance card** — the one place the brand color saturates the surface:

```html
<div class="rounded-xl bg-[--color-brand] p-6 text-white">
  <p class="text-sm font-medium opacity-75">Your Balance</p>
  <p class="mt-1 font-mono text-4xl font-bold">₱ 48.00</p>
  <p class="mt-2 text-xs opacity-60">≈ 120 credits · expires when used</p>
</div>
```

**Admin KPI card:**

```html
<div class="rounded-lg border border-[--color-border] bg-[--color-bg] p-5">
  <p class="text-xs font-semibold uppercase tracking-wide text-[--color-muted]">Gross Revenue</p>
  <p class="mt-1 font-mono text-3xl font-bold text-[--color-ink]">₱12,480</p>
  <p class="mt-1 text-xs text-[--color-online]">+8.2% vs last week</p>
</div>
```

### Data table (admin)

```html
<div class="overflow-hidden rounded-lg border border-[--color-border] bg-[--color-bg]">
  <table class="w-full text-sm">
    <thead>
      <tr class="border-b border-[--color-border] bg-[--color-surface]">
        <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[--color-muted]">
          MAC Address
        </th>
        <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[--color-muted]">
          Package
        </th>
        <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[--color-muted]">
          Time Left
        </th>
        <th class="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-[--color-muted]">
          Status
        </th>
        <th class="px-4 py-3"></th>
      </tr>
    </thead>
    <tbody class="divide-y divide-[--color-border]">
      <tr class="cursor-pointer transition-colors hover:bg-[--color-surface]">
        <td class="px-4 py-3 font-mono text-xs text-[--color-ink]">AA:BB:CC:DD:EE:FF</td>
        <td class="px-4 py-3 text-[--color-ink]">30 Min</td>
        <td class="px-4 py-3 font-mono text-[--color-ink]">18:42</td>
        <td class="px-4 py-3"><!-- status badge --></td>
        <td class="px-4 py-3 text-right"><!-- action button --></td>
      </tr>
    </tbody>
  </table>
</div>
```

Monospaced columns: MAC addresses, IPs, timestamps, session durations. Everything else is sans.

### Network health card (admin)

```html
<div class="rounded-lg border border-[--color-border] bg-[--color-bg] p-4">
  <div class="flex items-center justify-between">
    <h3 class="text-sm font-semibold text-[--color-ink]">AP — Floor 2</h3>
    <!-- status badge + live dot -->
  </div>
  <dl class="mt-4 grid grid-cols-3 divide-x divide-[--color-border] text-center">
    <div class="pr-3">
      <dt class="text-xs text-[--color-muted]">Uptime</dt>
      <dd class="mt-0.5 font-mono text-sm font-semibold text-[--color-ink]">99.8%</dd>
    </div>
    <div class="px-3">
      <dt class="text-xs text-[--color-muted]">Latency</dt>
      <dd class="mt-0.5 font-mono text-sm font-semibold text-[--color-ink]">12ms</dd>
    </div>
    <div class="pl-3">
      <dt class="text-xs text-[--color-muted]">Users</dt>
      <dd class="mt-0.5 font-mono text-sm font-semibold text-[--color-ink]">14</dd>
    </div>
  </dl>
</div>
```

---

## Layout

### Customer portal shell

Single-column, vertically stacked. On desktop it looks like a tall mobile frame centered on the page — that's intentional; the portal is a phone UI.

```svelte
<!-- apps/customer/src/routes/+layout.svelte -->
<main class="min-h-screen bg-[--color-bg] flex items-start justify-center px-5 pt-10 pb-8">
  <div class="w-full max-w-sm space-y-4">
    {@render children()}
  </div>
</main>
```

Logo sits above the card stack, centered, `h-8` max. No nav. No hamburger menu. There is nowhere else to go until the guest is authenticated.

### Admin shell

```svelte
<!-- apps/admin/src/routes/+layout.svelte -->
<div class="flex h-screen overflow-hidden bg-[--color-bg]">
  <!-- Sidebar -->
  <aside class="flex w-60 shrink-0 flex-col bg-[--color-sidebar] text-[--color-sidebar-text]">
    <div class="flex h-14 items-center px-5">
      <!-- Logo -->
    </div>
    <nav class="flex-1 space-y-0.5 px-3 py-2">
      <!-- Nav items -->
    </nav>
    <!-- Light/dark mode toggle at bottom -->
    <div class="border-t border-white/10 p-3">
      <!-- ModeToggle component -->
    </div>
  </aside>

  <!-- Content area -->
  <div class="flex flex-1 flex-col overflow-hidden">
    <header class="flex h-14 shrink-0 items-center border-b border-[--color-border] bg-[--color-bg] px-6">
      <!-- Topbar -->
    </header>
    <main class="flex-1 overflow-y-auto p-6">
      {@render children()}
    </main>
  </div>
</div>
```

Admin content grids use `repeat(auto-fit, minmax(240px, 1fr))` for KPI cards so they reflow at tablet widths without breakpoint overhead.

---

## Icons

Lucide Svelte throughout. Icon-only buttons always get an `aria-label`.

```svelte
<script>
  import { WifiOff, CreditCard, AlertTriangle } from 'lucide-svelte';
</script>

<button aria-label="Block user" class="cursor-pointer ...">
  <WifiOff class="h-4 w-4" />
</button>
```

Sizes: `h-4 w-4` inline/dense · `h-5 w-5` buttons · `h-5 w-5` sidebar nav.

---

## Captive Portal Constraints

The customer portal loads in a captive portal mini-browser over a restricted, pre-auth connection. These rules are non-negotiable:

- **No external images in the critical path.** SVG or CSS only for decorative elements. If you need a logo image, inline the SVG.
- **No external font request.** Fonts are self-hosted via `@fontsource` (Plus Jakarta Sans + Montserrat). Don't add a Google Fonts `@import`.
- **SSR auth pages.** The landing (`/`), login, and OTP verify pages must render fully without client JavaScript. No `onMount` data fetch on these routes.
- **`overscroll-behavior: contain` on the portal root.** Prevents accidental pull-to-refresh on Android.
- **No animations on auth pages.** Motion loads after JS; auth pages must be immediately usable.

---

## Motion

```
State transitions (hover, focus, active):  150ms ease-out
Skeleton pulse:                            animate-pulse (Tailwind default)
Live ping indicator:                       animate-ping (Tailwind default)
Loading spinner:                           animate-spin (Tailwind default)
```

Use `transform` and `opacity` exclusively — never `width`, `height`, `top`, or `left`.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

No orchestrated page-load sequences. No entrance animations on the customer portal. The admin can have skeleton loading states; the customer portal shows real content or a spinner, nothing in between.

---

## Z-index

```
10  Dropdowns, tooltips
20  Sticky table headers
30  Modal backdrop
40  Modal content
50  Toast notifications
```

No `z-999`. If something needs to escape an `overflow: hidden` ancestor, use the native `popover` attribute or `position: fixed` — not a higher z-index.
