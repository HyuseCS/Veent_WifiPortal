---
name: plan:sentry-permalink-host-pinning
description: "H1 hardening — pin the configured Sentry org host in permalink validation (beyond the https:// gate)"
date: 10-07-26
feature: incident-management
---

# Backlog: Sentry permalink host pinning (H1 hardening)

**Priority:** Low (hardening, not a live vulnerability — H1's https-only gate is already closed)

**Origin:** deferred scope item from `ims-audit-remediation_10-07-26` (see plan `## Backlog`), audit
finding H1.

## Problem

`validateSentrySnapshot()` (`apps/admin/src/lib/server/sentry/map.ts`) rejects any non-`https://`
`sentryPermalink`, which closes the stored-XSS vector (H1). It does not additionally verify the
permalink's host matches the configured Sentry org (`PUBLIC_SENTRY_ORG_SLUG` /
`SENTRY_PROJECT_ID`-adjacent config). A staff member with `?/track` access could submit a
syntactically valid `https://` URL pointing at an attacker-controlled host.

## Root cause

The https gate is a necessary but not sufficient check — it doesn't pin the trusted origin.

## Fix options

1. Add a host allowlist check (`new URL(permalink).host === expectedSentryHost`) in
   `validateSentrySnapshot()`, sourced from an env var or the existing Sentry org config.
2. Document the Sentry org host as a required env var if not already present.

## Notes

Not blocking — the https gate alone closes the actual stored-XSS execution vector (arbitrary
`javascript:`/non-https schemes). This is defense-in-depth only.
