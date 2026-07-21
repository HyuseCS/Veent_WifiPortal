---
name: note:test-env-integration-coverage-gap
description: "MOVED — superseded by customer-locator-e2e-harness-integration-gaps_NOTE_20-07-26.md in process/general-plans/backlog/. Original Maya/admin concern investigated and closed; real gap found in apps/customer instead."
date: 20-07-26
metadata:
  node_type: memory
  type: note
  feature: incident-management
---

# MOVED — see `process/general-plans/backlog/customer-locator-e2e-harness-integration-gaps_NOTE_20-07-26.md`

This note originally flagged that `TEST_ENV` (admin e2e) didn't cover Maya payments and that
Maya reachability from admin e2e was unverified.

Investigated 20-07-26: **admin has no Maya code path at all** — the concern was closed as a
non-issue. The real (latent) exposure was found in `apps/customer`/`apps/locator`'s Playwright
`webServer` configs, which had no env override and would have loaded live payment/SMS
credentials into any future e2e spec. That finding, the fail-closed tripwire that was shipped
for it, and the remaining open work (payments/SMS stubs + a customer test-DB harness) are now
tracked at:

`process/general-plans/backlog/customer-locator-e2e-harness-integration-gaps_NOTE_20-07-26.md`

This stub is left here only as a pointer — no action needed on this file.
