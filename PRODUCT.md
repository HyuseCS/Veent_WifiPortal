# Product

## Register

product

## Users

**WiFi Guests** — primary. Everyday people at commercial venues in the Philippines (cafes, malls, hotels, transit waiting areas). On a personal phone, often mid-activity. They did not plan to pay for WiFi; the portal intercepts them. Their job is to understand the offer, log in or register, and get online in under 60 seconds. Most have GCash or Maya already installed. Many are first-time captive-portal users.

**Venue Operators / Staff** — secondary. Small business owners or hired staff managing a deployed access point. On a desktop or laptop in the back office. They check active connections, review revenue, and handle credit issues. They are not engineers; they need clarity and quick action, not BI dashboards.

## Product Purpose

Veent is a monetized WiFi portal deployed by venue operators across the Philippines. Guests pay for internet time through a credit system: a free-time window, pay-as-you-go tiers, and top-up bundles. The portal bridges web authentication with physical router firewall control (`grant_url`). Success is a guest going from "no internet" to "online and browsing" in under a minute, with operators able to see exactly what's happening on their network without digging.

## Brand Personality

Reliable. Direct. Local.

Not a startup. Not a telco. The kind of product you trust because it's clear, not because it's polished. Voice inside the portal is informational — tell the guest exactly what they get, what it costs, what to do next. No marketing language past the landing page.

## Anti-references

- Globe/PLDT/DITO captive portal — corporate teal gradient, stock imagery of towers, 8pt fine print, weak typography
- Generic SaaS fintech — navy + amber, hero metric cards, gradient text, Stripe/Linear visual vocabulary
- Fast-food WiFi portals — oversized brand logo, bright primaries, nothing of design interest
- Startup landing page patterns — glassmorphism, AI-purple gradients, `01 / 02 / 03` section markers, identical card grids

## Design Principles

1. **The portal is a task, not a product.** Guests don't want to admire the UI. Clear path from landing → authenticated → online. Remove every friction that isn't legally or operationally necessary.
2. **One thing at a time.** Each screen answers one question (Who are you? What do you want? Is your payment done?). Never surface multiple decisions simultaneously.
3. **Trust through clarity, not decoration.** Users hand over payment credentials on this screen. Trust is earned by showing the price, the time, and the receipt — not by gradient badges or reassurance copy.
4. **Operators need speed, not ceremony.** Admin UI is for quick action and status-checking. Dense and scannable beats elegant and spacious.
5. **The smallest viable page.** The customer portal loads under pre-auth bandwidth restrictions. Every asset is justified.

## Accessibility & Inclusion

WCAG AA minimum throughout. Customer portal must be operable one-handed on a phone. Minimum 44×44px touch targets on all interactive elements. No color-only state indicators — always pair with text or an icon. System font fallbacks on all web font declarations.
