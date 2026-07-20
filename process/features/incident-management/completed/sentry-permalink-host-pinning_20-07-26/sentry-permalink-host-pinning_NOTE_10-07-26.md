---
name: plan:sentry-permalink-host-pinning
description: "H1 hardening — pin the configured Sentry org host in permalink validation (beyond the https:// gate)"
date: 10-07-26
feature: incident-management
---

# Backlog: Sentry permalink host pinning (H1 hardening)

**Status: CLOSED (20-07-26).** Implemented — `httpsUrl()` in
`apps/admin/src/lib/server/sentry/map.ts` now parses the permalink and pins `hostname` to
`sentry.io` or a regional subdomain (e.g. `de.sentry.io`), anchored on a leading dot so
`sentry.io.evil.com` is rejected (suffix-confusion safe). Verified: `map.test.ts` extended with a
"pins the permalink host to sentry.io" unit case plus a host-pinning case in the
`validateSentrySnapshot` suite (both confirmed present in the tree, `map.test.ts:42-49,142-149`).

**Deliberate scope decision:** the allowlist is hardcoded (`SENTRY_HOST = 'sentry.io'` in
`map.ts`) rather than env-driven, to preserve the module's no-env/no-I/O purity (`map.ts` must stay
pure per the M4d plan's Non-Goals and this repo's convention that `validateSentrySnapshot` never
reads env or does I/O). **Consequence:** a self-hosted Sentry instance on a non-`sentry.io` domain
would be rejected by this check. Not a concern today (this deployment uses sentry.io), but anyone
migrating to self-hosted Sentry must revisit this gate.

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
