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
  /* Palette — default theme: teal + coral */
  --color-brand:        oklch(0.38 0.130 185);
  --color-brand-hover:  oklch(0.32 0.130 185);
  --color-cta:          oklch(0.62 0.180 28);
  --color-cta-hover:    oklch(0.56 0.180 28);

  /* Surfaces */
  --color-bg:           oklch(1.000 0.000 0);
  --color-surface:      oklch(0.975 0.008 185);
  --color-border:       oklch(0.920 0.008 185);

  /* Text */
  --color-ink:          oklch(0.14 0.020 190);
  --color-muted:        oklch(0.52 0.010 190);

  /* Status — semantic, not themeable */
  --color-online:       oklch(0.50 0.150 155);
  --color-warning:      oklch(0.65 0.150 72);
  --color-blocked:      oklch(0.55 0.180 22);
}
```

**Admin-only additions** (in `apps/admin/src/routes/layout.css`):

```css
@theme {
  /* inherits everything above, adds: */
  --color-sidebar:       oklch(0.10 0.020 195);
  --color-sidebar-text:  oklch(0.75 0.010 195);
  --color-sidebar-muted: oklch(0.48 0.008 195);
}
```

### Theme presets

The admin dashboard exposes a theme selector that persists to the database and injects a `data-theme` attribute on `<html>`. Each preset overrides only `--color-brand`, `--color-brand-hover`, `--color-cta`, and `--color-cta-hover` — the semantic structure stays constant.

```css
/* Teal + Coral (default) */
[data-theme="teal"] {
  --color-brand:       oklch(0.38 0.130 185);
  --color-brand-hover: oklch(0.32 0.130 185);
  --color-cta:         oklch(0.62 0.180 28);
  --color-cta-hover:   oklch(0.56 0.180 28);
}

/* Jade + Amber */
[data-theme="jade"] {
  --color-brand:       oklch(0.34 0.130 155);
  --color-brand-hover: oklch(0.28 0.130 155);
  --color-cta:         oklch(0.72 0.170 72);
  --color-cta-hover:   oklch(0.65 0.170 72);
}

/* Cobalt + Lime */
[data-theme="cobalt"] {
  --color-brand:       oklch(0.44 0.190 255);
  --color-brand-hover: oklch(0.37 0.190 255);
  --color-cta:         oklch(0.78 0.165 135);
  --color-cta-hover:   oklch(0.72 0.165 135);
}

/* Near-black + Teal */
[data-theme="mono"] {
  --color-brand:       oklch(0.14 0.010 200);
  --color-brand-hover: oklch(0.10 0.010 200);
  --color-cta:         oklch(0.55 0.150 182);
  --color-cta-hover:   oklch(0.48 0.150 182);
}
```

Text on `--color-brand` and `--color-cta` is always `white` — all four presets are mid-to-dark saturation, never pale fills.

---

## Typography

### Customer portal

**[Plus Jakarta Sans](https://fonts.google.com/specimen/Plus+Jakarta+Sans)** — variable font, loaded once for the whole app.

```css
@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');

/* In @theme: */
--font-sans: 'Plus Jakarta Sans', system-ui, sans-serif;
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

**Primary CTA** — coral, used once per screen:

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

**Brand action** — teal, for secondary actions that are still important (login, confirm):

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
    <!-- Theme selector at bottom -->
    <div class="border-t border-white/10 p-3">
      <!-- ThemePicker component -->
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
- **One Google Fonts request.** The Plus Jakarta Sans import handles it. Don't add a second `@import`.
- **SSR auth pages.** The landing (`/`), login, and register pages must render fully without client JavaScript. No `onMount` data fetch on these routes.
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
