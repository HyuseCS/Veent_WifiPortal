---
name: plan:m2-secret-rotation-reminder
description: "M2 — RESOLVED (no action): e2e auth fixtures self-rotate each run against a throwaway DB, so leaked history values are dead test creds; git rm --cached was sufficient"
date: 10-07-26
feature: incident-management
---

# Backlog: M2 leaked-secret rotation reminder

**Status:** RESOLVED — no action needed (see Resolution below). The `git rm --cached` that shipped is sufficient; the fixtures self-rotate by design.

**Origin:** `ims-audit-remediation_10-07-26` Phase 3 (M2), plan note: "the committed secret is in
history and should be rotated."

## Problem

`apps/admin/e2e/.auth/owner.json` (session cookie) and `apps/admin/e2e/.auth/owner-totp.txt` (TOTP
seed) were tracked in git despite being covered by `.gitignore` (`e2e/.auth/`). This session's
Phase 3 ran `git rm --cached` to stop tracking them going forward, but the secret values remain
readable in git history (any prior commit that included them).

## Resolution (2026-07-10) — no action needed

On inspection the leaked values are already dead:

- `apps/admin/e2e/global-setup.ts` re-enrolls the owner's 2FA from scratch on **every** e2e run
  (no `existsSync` guard — it always drives `/enroll-2fa`, captures a **new** TOTP secret, and writes
  a **fresh** `storageState`), and it runs against the **throwaway `radius_admin_test` DB**, which is
  dropped and recreated each run.
- So the historical `owner.json` session authenticates only against a DB state that no longer exists
  (dead), and every historical `owner-totp.txt` secret is superseded on the next run. The current
  on-disk files were already regenerated during the 2026-07-10 e2e runs.
- The M2 fix that shipped — `git rm --cached` (commit `5a78dbe`) — is therefore sufficient. There is
  no live secret to rotate; the fixtures self-rotate by design.

**Git-history scrub: not recommended.** Purging the dead values would mean `git filter-repo`/BFG
rewriting commits already merged into `staging` (e.g. `668cc0e`, `016210d`) plus a force-push of
shared branches — high disruption for zero real security benefit (dead, test-only, throwaway-DB
credentials). Only pursue if a repo-hygiene policy specifically requires purging all historical
secrets, and coordinate the force-push with the team.
