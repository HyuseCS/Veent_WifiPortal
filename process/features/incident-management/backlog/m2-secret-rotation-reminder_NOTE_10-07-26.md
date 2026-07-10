---
name: plan:m2-secret-rotation-reminder
description: "M2 — owner.json + owner-totp.txt removed from git tracking but remain in git history; rotate the session cookie + TOTP secret"
date: 10-07-26
feature: incident-management
---

# Backlog: M2 leaked-secret rotation reminder

**Priority:** Medium (real secret exposure, low blast radius — throwaway test-harness credentials)

**Origin:** `ims-audit-remediation_10-07-26` Phase 3 (M2), plan note: "the committed secret is in
history and should be rotated."

## Problem

`apps/admin/e2e/.auth/owner.json` (session cookie) and `apps/admin/e2e/.auth/owner-totp.txt` (TOTP
seed) were tracked in git despite being covered by `.gitignore` (`e2e/.auth/`). This session's
Phase 3 ran `git rm --cached` to stop tracking them going forward, but the secret values remain
readable in git history (any prior commit that included them).

## Fix

1. Rotate the owner session cookie / auth secret referenced by `owner.json` so the historical
   value is no longer valid.
2. Rotate/regenerate the TOTP seed in `owner-totp.txt` (re-enroll 2FA for the throwaway e2e
   harness owner account).
3. Confirm the throwaway `radius_admin_test` e2e harness self-heals (per plan note: "the throwaway
   harness regenerates creds (TOTP re-enroll) on next e2e run") after rotation.

## Notes

Low real-world risk — this is a throwaway test-harness account on a non-production, isolated
`radius_admin_test` DB, not a production credential. Still worth rotating as hygiene since the
value is permanently in git history.
