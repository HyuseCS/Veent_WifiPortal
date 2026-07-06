# Design Brief: Veent WiFi Portal — Customer Captive Portal Refresh

## What I'm building
Veent is a **WiFi captive portal** for guests on a public/venue network in the
Philippines. A guest connects to the WiFi, lands on this portal in their phone's
captive browser, and uses it to get online — either via a free time allowance or
by buying internet access with credits. It's paired with an operator admin
dashboard, but **this brief is only the guest-facing customer portal.**

Design a cohesive, mobile-first refresh of the full customer portal. Deliver
high-fidelity mockups for every screen listed below, plus brief notes on
hierarchy, key states, and rationale.

## The core change driving this refresh
**Pricing must be visible BEFORE login.** Today a guest can't see what anything
costs until they've authenticated. I want the public landing page (`/`) to
present the full pricing scheme up front, so guests understand the offer before
committing. The pricing on the landing page is **view-only** — there is no
purchase or tier-selection from the logged-out state; every pricing CTA points
to a single login/connect action.

## Who's using it & the context (this shapes everything)
- **Device:** almost always a phone, in a captive-portal mini-browser. Small
  viewport, one thumb, possibly impatient, possibly on a slow first connection.
- **Mindset:** "I just want to get online." Friction is the enemy.
- **Mobile-first, single column.** Max content width ~28rem (`max-w-sm`).
  Large tap targets (min 44px height). No hover-dependent interactions.

## The #1 job of the new landing page
**Get the guest to log in / connect, using the free time offer as the hook.**
Free Time is the bait: lead with "get 15 minutes free, right now," make logging
in feel like the obvious next tap. The paid pricing is shown as supporting
context — "and here's what more time costs" — so expectations are set, but the
primary conversion is the login/connect action. Login is phone-number + SMS OTP.

## Brand & design system — TREAT AS HARD CONSTRAINTS
Do not invent a new visual identity. Refine layout, hierarchy, and components
within this system:

- **Font:** Plus Jakarta Sans (400/500/600/700), system-ui fallback.
- **Color tokens (OKLCH), use these semantically — don't hardcode new colors:**
  | Token | Value | Role |
  |---|---|---|
  | `--color-brand` | `oklch(0.38 0.13 185)` | Teal — primary accent |
  | `--color-brand-hover` | `oklch(0.32 0.13 185)` | Teal hover |
  | `--color-cta` | `oklch(0.62 0.18 28)` | Coral — call-to-action buttons |
  | `--color-cta-hover` | `oklch(0.56 0.18 28)` | Coral hover |
  | `--color-bg` | `oklch(1 0 0)` | White page bg |
  | `--color-surface` | `oklch(0.975 0.008 185)` | Off-white card bg |
  | `--color-border` | `oklch(0.92 0.008 185)` | Light borders |
  | `--color-ink` | `oklch(0.14 0.02 190)` | Primary text |
  | `--color-muted` | `oklch(0.52 0.01 190)` | Secondary text |
  | `--color-online` | `oklch(0.5 0.15 155)` | Green — online/success |
  | `--color-warning` | `oklch(0.65 0.15 72)` | Amber — badges/warnings |
  | `--color-blocked` | `oklch(0.55 0.18 22)` | Red — blocked/errors |
- **CTA = coral, brand accent = teal.** Coral is reserved for the primary
  action on a screen; don't dilute it.
- Clean, calm, trustworthy. This is a payment-adjacent utility, not a flashy
  marketing site. Whitespace over decoration. No emojis as icons (icon set is
  Lucide-style line icons).
- Respect `prefers-reduced-motion`; keep motion subtle and purposeful.

## The pricing model (use these REAL numbers in the mockups)
- **Free Time:** 15 minutes of access, once per 12-hour cooldown window. This is
  the hook.
- **Credit bundles** (buy credits with money, in PHP ₱):
  | Price | Credits | Note |
  |---|---|---|
  | ₱20 | 50 credits | |
  | ₱50 | 150 credits | |
  | ₱100 | 350 credits | **Best value** — highlight it |
- **Access tiers** (spend credits for a block of internet time):
  | Tier | Cost | Duration |
  |---|---|---|
  | 1 Hour | 20 credits | 60 min |
  | 3 Hours | 50 credits | 180 min |
  | 1 Day | 150 credits | 1440 min |
- The mental model: **money → credits (bundles) → time (tiers).** Free Time
  needs no credits. Make this two-step model legible to a first-time guest on
  the landing page without overwhelming them.
- Payments go through the Maya gateway; **credits are only added after payment
  is confirmed** — reflect that trust messaging at checkout.

## Screens to design

### 1. Landing `/` (logged-out) — the priority screen
Public, no auth. Must:
- Lead with the **Free Time hook** and a prominent **login/connect** CTA (coral).
- Present the **full pricing scheme** (Free Time, bundles, tiers) as view-only
  context — clear, scannable, with the ₱100 bundle flagged as best value.
- Convey the money→credits→time model simply.
- Every pricing element's CTA resolves to the same login/connect action (no
  tier is "selected" or carried into login).
- Also design the **logged-in variant** of `/`: a brief "you're signed in as
  {name}, you're good to go" state with a link to the dashboard.

### 2. Login / Register
Phone-number entry → SMS OTP. Design:
- Phone number input (PH format) for login.
- Register variant: name + phone number.
- **OTP verification** screen: enter the code from SMS, with resend affordance.
- Keep it to the absolute minimum taps. This is the conversion moment.

### 3. Dashboard `/dashboard` (the hub, logged-in)
The main authenticated screen. Shows:
- **Balance header:** greeting + current credit balance (balance is data —
  consider a mono treatment for numeric values).
- **Free Time section:** if eligible → "Start 15-min Free Access" button; if
  used → "Free time used. Next session at {time}." with countdown.
- **Buy Access (tiers) section:** the access tiers as cards (name, cost in
  credits, duration) each with a "Buy" action that spends credits.
- Links to **Top up credits** and **Sign out**.

### 4. Top-up `/top-up` (storefront, logged-in)
- Current balance, prominent.
- The **credit bundles** as a selectable list (radio-style), defaulting to best
  value, with the best-value badge.
- "Continue to payment" CTA → with a pending/redirecting state ("Redirecting to
  payment…").
- Trust footer: "Secured by Maya · credits are added after payment."

### 5. Top-up processing `/top-up/processing` (waiting room)
After returning from the payment gateway. A calm "confirming your payment…"
waiting state that resolves to success (credits added, push back to dashboard).
Design the **pending**, **success**, and **failed/timeout** states.

## Key states to cover across screens
For each screen, show the important states, not just the happy path:
- Free Time **eligible** vs **on cooldown** (with next-eligible time).
- **Insufficient credits** when trying to buy a tier.
- Payment **pending / success / failed**.
- Loading/redirecting states (slow captive-portal network).
- Empty/error states where relevant.

## What to deliver
1. High-fidelity mockups of each screen above (and the called-out variants/states).
2. The **logged-out landing page** as the hero deliverable — get this one right.
3. Brief annotations per screen: what's primary, what the key states are, and
   any component reused across screens.
4. Note the reusable components you'd standardize (e.g. tier card, bundle row,
   balance display, primary CTA button, OTP input).

## Hard constraints recap
Mobile-first single column · max ~28rem width · 44px min tap targets · Plus
Jakarta Sans · teal brand / coral CTA / the OKLCH tokens above · pricing on
landing is view-only and routes to login · Free Time is the conversion hook ·
calm, trustworthy, utility-grade — not a flashy marketing page.
