---
name: plan:test-env-integration-coverage-gap
description: "TEST_ENV does not enumerate every external integration — Maya payments is not covered and admin e2e reachability to it is unverified"
date: 20-07-26
feature: incident-management
---

# Backlog: `TEST_ENV` does not enumerate every external integration (Maya payments not covered)

**Priority:** High (payments surface — unverified live-call risk, not just a cosmetic gap)

**Origin:** discovered as a side-effect finding during `sentry-issueid-provenance_20-07-26`
(M4d). Not IMS-specific — `TEST_ENV` is a repo-wide e2e harness mechanism
(`apps/admin/e2e/config.ts`), so this note may belong in `process/general-plans/backlog/` if a
general maintainer picks it up independently. Recorded here because it was found during this
feature's work, matching the pattern already used for
`repo-wide-lint-prettier-drift_NOTE_10-07-26.md`.

## Problem

`apps/admin/e2e/config.ts`'s `TEST_ENV` object is the sole isolation mechanism keeping the admin
e2e suite from making live calls to real external services (there is no `.env.test` file — see
`process/context/tests/all-tests.md`). It currently blanks/stubs 4 integrations: DB (throwaway
`radius_admin_test`), router (`NETWORK_CONTROLLER: 'stub'`), mailer (`RESEND_API_KEY: ''`), and —
as of this session — Sentry (`SENTRY_AUTH_TOKEN`/`SENTRY_ORG_SLUG`/`SENTRY_PROJECT_ID` blanked).

The Sentry gap was silent for as long as it existed (the affected code path degraded gracefully on
failure, so nothing ever went red — see the M4d EXECUTE report's "Standalone hygiene finding")
until M4d made that path fail loudly. **There is no enforcement anywhere that a newly-added
external integration gets added to `TEST_ENV`.** The Sentry incident is evidence this class of gap
recurs silently.

**Maya payments is NOT in `TEST_ENV` and was explicitly NOT investigated during this session.**
Whether the admin e2e suite can reach Maya (sandbox or production) is unknown — this must not be
assumed safe just because Sentry turned out to be the only prior gap found. Maya is a payments
surface (money movement / webhook flows), so an unnoticed live-call leak here carries materially
higher risk than the Sentry case (API quota noise / non-fatal reads) — hence Priority: High rather
than Medium.

## Root cause

`TEST_ENV` is a hand-maintained allowlist with no structural check that it stays in sync with the
set of external integrations the codebase actually calls. Nothing fails loudly when a new
integration is added to the app without a corresponding `TEST_ENV` override — the gap is only
discovered when (a) someone reads the whole env surface manually, or (b) a code change makes the
unguarded path fail loudly enough to notice (as M4d did for Sentry).

## Fix options

1. **Immediate:** investigate whether `apps/admin` e2e specs ever exercise a Maya-calling code
   path at all (grep for Maya imports reachable from admin routes/specs — admin may not touch Maya
   at all, in which case this is a non-issue for the *admin* e2e suite specifically; also check
   `apps/customer/e2e` since Maya lives closer to the customer portal). If reachable, blank the
   Maya credential env vars in the relevant `TEST_ENV` object(s), mirroring the Sentry fix.
2. **Structural:** add a lint/test check that cross-references every `env`-reading integration
   module (or a maintained list of external-integration env var prefixes) against `TEST_ENV`'s
   override keys, failing CI/local lint if a new integration's vars aren't present. Higher effort,
   prevents recurrence rather than just fixing the current instance.
3. **Documentation-only (minimum bar):** at minimum, record the current `TEST_ENV` coverage list
   and the "must be extended when adding an integration" rule in
   `process/context/tests/all-tests.md` so future integration work has a visible checklist item
   even without automated enforcement — see this session's context update to that file.

## Notes

Not blocking any current work — no evidence Maya is currently leaking, only that it was never
checked. Investigate before assuming safety, especially before any e2e spec touches
payment/checkout flows.
