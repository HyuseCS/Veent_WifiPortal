# MikroTik AP Liveness Bypass Runbook

**Every new physical AP MAC must be exempted from the hotspot walled garden — as a
`type=bypassed` entry in `/ip/hotspot/ip-binding` — or the admin dashboard reads that AP as
permanently DOWN even when it is fully healthy.** This is currently **THE primary mitigation** for
the AP false-DOWN bug (paid guests getting frozen on an AP that only *looks* offline), because the
code-side outage guard was found impossible as designed — see
[the deferral note](../../process/general-plans/backlog/ap-outage-false-down-code-safeguard_NOTE_21-07-26.md).

## Why

Admin liveness (`refreshNetworkHealth` → `/networks`) decides an AP is UP by pinging it. But every
physical AP is itself an **un-bypassed hotspot client** on the guest network. The hotspot installs a
dynamic `hs-unauth-to` rule (`action=reject reject-with=icmp-host-prohibited`) that drops ICMP to
any client that is neither authenticated nor bypassed. So the router's own ping to a non-bypassed AP
is rejected, the AP times out, and it reads **DOWN** — a false negative, not a real outage.

This was verified live: two real APs (`AP-Pabayo` 10.210.59.7, `AP-Headend` 10.210.59.33), both
`bypassed=false`, returned 100% ICMP loss and read DOWN; the one bypassed host on the same segment
(10.210.59.11, `bypassed=true`) replied normally and read UP. Both APs were physically healthy.

The downstream harm: a falsely-DOWN AP can trigger outage auto-pausing, freezing paid guests who are
actually online through that AP.

## The fix — bypass every AP MAC

Add each physical AP's MAC to the hotspot ip-binding table as `type=bypassed`. A bypassed client
skips the `hs-unauth-to` reject, so router→AP ICMP succeeds and liveness reads correctly.

```
# One entry per AP MAC. type=bypassed exempts it from the hotspot walled garden entirely.
/ip hotspot ip-binding add mac-address=E4:67:1E:B6:FC:60 type=bypassed comment=veent-ap
/ip hotspot ip-binding add mac-address=E4:67:1E:B6:FB:9C type=bypassed comment=veent-ap
```

If you prefer to pin by address instead of MAC, add the AP's IP/CIDR to the walled garden IP layer
(see [walled-garden.md](./walled-garden.md) → "IPs to allow") — either exemption path lets ICMP
through. `type=bypassed` on the MAC is preferred because it survives DHCP address changes.

## Verify

```
# 1. Confirm each AP MAC is present and bypassed.
/ip hotspot ip-binding print where type=bypassed

# 2. From the router, ping each AP — a bypassed AP must now reply.
/ping E4:67:1E:B6:FC:60   # or the AP's IP
```

Then reload the admin `/networks` page and confirm the AP reads **UP**. A still-DOWN AP after
bypassing means a genuine reachability problem (power, uplink, wrong MAC) — not this walled-garden
artifact.

## Cross-links

- [walled-garden.md](./walled-garden.md) — the hotspot walled-garden / ip-binding model and the
  `comment=veent-admin` tagging convention.
- Evidence source:
  `process/general-plans/active/per-ap-visibility_16-07-26/live-verification_REPORT_17-07-26.md`
  (Probe 4 / G16 — the live ICMP-vs-bypass comparison above).
- Deferred code safeguard:
  `process/general-plans/backlog/ap-outage-false-down-code-safeguard_NOTE_21-07-26.md`.
