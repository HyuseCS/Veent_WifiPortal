---
name: note:gotyme-followups
description: 'Out-of-scope findings from the GoTyme walled-garden recon: stale walled-garden.md CLI block, hard-reset note missing gotyme-auto, admin check not covering apps/admin/scripts, Licel ELB 1-of-3 IP residual.'
date: 02-10-26
metadata:
  node_type: memory
  type: note
  feature: general-plans
---

Source: `process/general-plans/completed/gotyme-walled-garden-recon_22-09-26/`. None blocks GoTyme (VERIFIED).

1. **Stale doc CLI block** (priority 3). `docs/mikrotik/walled-garden.md` `veent-admin:payment` CLI block (~lines 117-170) claims to mirror `PAYMENT_HOSTS` but still lists removed Google Pay / PayMongo / Xendit hosts and lacks `*.gotyme.com.ph`. Fix: regenerate from `apps/admin/scripts/walled-garden-config.ts`.
2. **Hard-reset note incomplete** (priority 3). Hard-reset section (~line 394) mentions only `gcash-auto`; a wipe also clears `gotyme-auto` (the `gotyme-resolve` scheduler re-adds it within 5 min). Fix: mention both.
3. **Test-infra gap** (priority 2). `bun run --filter radius-admin check` does not typecheck `apps/admin/scripts/` (tsconfig lists 0 files there); a wrong-arity call in `setup-router.ts` still gave 0 errors. Covered only by a manual `tsc --noEmit`. Fix: include `scripts/` in an admin tsconfig or add a dedicated check script.
4. **Licel ELB 1-of-3 residual** (priority 2, revisitable). `aws-gate.licelus.com` returns 3 A records but RouterOS `:resolve` returns 1, so `gotyme-resolve` opens 1 IP per 5-min run; login may fail intermittently (Code 3103000). Options: resolve and add all IPs per run, or shorten the interval. If it recurs, compare `/ip hotspot walled-garden ip print where comment="gotyme-auto"` with `/ip dns cache print where name~"prod-gate"`.
