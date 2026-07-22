---
name: report:ims-e2e-spec-modernization-pvl-iteration-001
description: "PVL cycle 1 — 3 CONCERNs + 1 non-blocking recommendation from the first-pass CONDITIONAL promoted from Execute-Agent Instructions into the plan checklist body."
date: 20-07-26
metadata:
  node_type: memory
  type: report
  feature: incident-management
  cycle: 1
---

# PVL Iteration 001 — ims-e2e-spec-modernization

**Plan:** `ims-e2e-spec-modernization_PLAN_20-07-26.md`
**Entering verdict:** `Gate: CONDITIONAL` (first pass) — 0 FAILs, 3 CONCERNs
**Action taken:** supplement cycle (user-chosen over accept-as-documented)
**Exiting signal:** `SUPPLEMENT_APPLIED — 4 gap(s) addressed`

## Why a supplement rather than acceptance

The prior plan in this session (otp-delivery-observability) closed an equivalent
first-pass CONDITIONAL by leaving fixes as Execute-Agent Instructions, and that
worked. The difference here is the failure mode of the load-bearing concern:

- There, C1's failure was **loud** — an unhandled promise rejection on the guest
  login path. A miss would surface.
- Here, C2's failure is **silent** — a green e2e test certifying a security
  property it never exercised. A miss would not surface, and would actively
  mislead future readers into believing the property is covered.

Silent-failure concerns belong in the plan body, not in a companion document a
reader may not open.

## Gaps addressed

| # | Severity | Gap | Resolution |
|---|---|---|---|
| 1 | CONCERN | Piece 1's "Mark all read" cleanup had no failure-resilience; an early throw in the 1.1–1.5 rewrite would silently reintroduce test 2's cascade failure | New item 1.5a — `try/finally` (or `afterEach`) around the modal-interaction block |
| 2 | CONCERN | Piece 3's raw tamper POST omitted `Origin`; SvelteKit's CSRF guard 403s form-content-type POSTs with a missing/mismatched `Origin`, so the request would never reach `selfReport` | Item 3.3 — mandates `headers: { origin: TEST_ORIGIN }` **and** a pre-assertion that the response is not a CSRF 403, ordered before any assignee-discard assertion |
| 3 | CONCERN | Item 3.3's wording implied both an honest UI submit and a raw tamper POST — ambiguous, and the honest submit proves nothing while consuming a rate-limit slot | Item 3.3 — raw tamper POST is now the sole create action; 3.4 targets its issue id |
| 4 | non-blocking | Piece 3 reused `bea@veent.test`, the fixture `finance-export.e2e.ts` depends on staying un-enrolled; `loginNonManager` would enroll it permanently, with only alphabetical file ordering preventing breakage | Items 3.2/3.3 — swapped to `cleo@veent.test`, confirmed untouched by every other spec |

## Note on gap 2's assertion ordering

Adding the `Origin` header alone is insufficient. A request rejected at the CSRF
layer creates no `admin_issue_assignee` rows — identical to a request whose
assignees were correctly discarded. So an assertion of "zero assignee rows"
passes in both cases. The requirement that the response is demonstrably not a
403, checked before the discard assertions, is what makes the rest of the test
meaningful.

## Bookkeeping

- Plan artifact validator: 0 failures, 0 warnings (post-supplement)
- `## Validate Contract` section left untouched — VALIDATE owns it and re-runs from V1
- No source or spec file modified
- Next: re-spawn `vc-validate-agent` from V1 against the amended plan
