---
name: note:gcash-walled-garden-ip-productionize
description: "Productionize GCash/Alipay walled-garden entries in setup-router.ts — hostname rules don't match GCash HTTPS; needs IP-based allows, replacing the operator's temporary manual gcash-test IP rule."
date: 23-07-26
metadata:
  node_type: memory
  type: note
  feature: general-plans
---

# Productionize GCash/Alipay walled-garden entries (setup-router.ts)

## Why this exists

During a live Maya (sandbox→live) test on 23-07-26, GCash checkout failed with
`ERR_CONNECTION_CLOSED` loading `payments.gcash.com`. Root cause: MikroTik `dst-host` (hostname)
walled-garden rules do NOT match GCash HTTPS traffic — the existing hostname rules showed `hits=0`
and no dynamic IP entries were being created. The Ant/Alipay-powered cashier embedded in GCash
checkout also pulls `*.alipay.com` / `*.alipayobjects.com` / `*.alicdn.com`, which are equally
unmatched by hostname rules.

The operator fixed this LIVE with a **temporary manual IP allow** on the router:
```
/ip hotspot walled-garden ip add dst-address=<resolved payments.gcash.com IP>
```
This is not durable — the resolved IP can change, and Alipay's supporting asset hosts were not
added at all (untested whether they're also required for GCash to load fully).

This is a **separate root cause** from the browser-return-URL issue investigated the same session
(see `process/general-plans/completed/maya-return-url-revert_23-07-26/` and the Maya payments
section of `process/context/all-context.md`) — do not conflate the two when picking this up.

## What needs to happen

- Add IP-based walled-garden allow entries for GCash + its Alipay-cashier dependency hosts to
  `apps/admin/scripts/setup-router.ts` `PAYMENT_HOSTS` (cross-referenced from
  `process/context/all-context.md` §Maya payments), replacing/supplementing the hostname-only rules
  that don't match.
- Options to evaluate:
  1. IP-based walled-garden allows for the known GCash/Alipay host IPs (simplest, but IPs can
     rotate — may need periodic re-resolution or a wider CIDR allow).
  2. Force hotspot DNS through the router (so hostname-based walled-garden rules can actually
     resolve and match dynamically) — more durable but a bigger MikroTik config change.
- Whichever approach is chosen, verify live (real GCash checkout, not sandbox) since this class of
  bug is only reproducible against Maya's live/production wallet integrations.

## Scope note

Not started. No design work has been done — the temporary IP rule is the only thing keeping GCash
functional right now. Feasibility-probe (live router test) before committing to option 1 vs 2.
