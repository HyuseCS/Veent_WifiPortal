# 001 issues-board-pagination

What: The manager board (`/issues`) loads every incident. Load 25 per page with search done in SQL. Page and search live in the URL (`?page=N&q=text`). GitHub #99 (backlog note `process/features/incident-management/backlog/manager-board-pagination_NOTE_10-07-26.md`, Option 2 already shipped). Built in commit 7b62fe2.
FRs: none (no spec.md for this feature; Fast lane chosen by the user)
Impact area: core runtime + screens (one board; not privacy or access: the manager gate in the load is unchanged)

## Decisions

- D1. Order must move into SQL. Today `sortRows` (issues.ts:188) sorts in JS after loading all rows: status rank (open, in_progress, resolved), then priority rank (high, medium, low), then newest. Paging on `createdAt` alone would give wrong pages. New `ORDER BY` uses `CASE` for both ranks, then `created_at DESC`, then `id DESC` (stable pages). `sortRows` stays for the other readers.
- D2. Search matches title, description, `network_name` (a plain column on `admin_issue`, no join) and assignee names. Assignee names use `EXISTS (select 1 from admin_issue_assignee join admin_user ... where issue_id = admin_issue.id and name ilike q)`. Case-insensitive `ilike`. Escape `\`, `%`, `_` in the user text so they match literally. Trim `q`; empty means no filter; cap `q` at 100 chars.
- D3. Page handling. `page` parsed with `Number`; not an integer or < 1 gives 1. Count first, then clamp to `pageCount` (min 1), then query with `limit 25 offset (page-1)*25`. So a bad or stale page (for example after deleting the last row of the last page) shows the last page, with no error and no redirect.
- D4. Search is debounced (300 ms) in the table component and calls `goto('?q=..&page omitted', { replaceState: true, keepFocus: true, noScroll: true })`. New search resets to page 1. No existing pager or URL search in admin (`finance/transactions` hard-codes `page: 1`), so the pager is two plain `<a href>` links (Previous / Next, `q` kept) in the Table `footer` snippet. Works without JS, no new ui component.
- D5. Actions keep the current page. Row forms use `enhance` + `update()`, which re-runs the load on the same URL, so `page` and `q` stay. `create` can add a row that sorts onto another page; accepted, no redirect logic.
- D6. Footer text becomes "Showing A-B of TOTAL incidents" (TOTAL is the filtered count). Empty-state wording unchanged (`q` from the server decides "No incidents match").
- D7. `listIssues` has one caller (the manager load). It is replaced by `listIssuesPage`, not kept. Non-manager branch is not touched.

## Files

- apps/admin/src/lib/server/issues.ts:204 - replace `listIssues` with `listIssuesPage(db, { page, q })` returning `{ issues, total, page, pageCount }`. Add `ISSUES_PAGE_SIZE = 25`. Build one `where` (D2), `count(*)`, clamp (D3), then `select ... orderBy(rank CASEs, createdAt desc, id desc).limit().offset()`, then the existing `hydrate` (its JS sort is a no-op on already-ordered rows). Add `asc`, `sql`, `or`, `ilike`, `exists`, `count` to the drizzle imports as needed.
- apps/admin/src/routes/(app)/issues/+page.server.ts:46 - manager branch reads `event.url.searchParams` `page` and `q`, calls `listIssuesPage`, returns `issues`, `total`, `page`, `pageCount`, `q`. The non-manager branch also returns `total`, `page: 1`, `pageCount: 1`, `q: ''`, because svelte-check needs the same keys on both branches.
- apps/admin/src/routes/(app)/issues/+page.svelte:26 - pass `total`, `page`, `pageCount`, `q` to `IssuesTable`.
- apps/admin/src/lib/components/feature/IssuesTable.svelte - drop `filtered` ($derived, lines 89-99). Props add `total`, `page`, `pageCount`, `q`. `query` starts from `q`. A `$effect` with a 300 ms timeout does the `goto` (D4) when `query` differs from `q`. `afterNavigate` resets `query = q` on every navigation that is not a `goto` (sidebar click, Back); without it the old search is re-applied after 300 ms. Clearing the search goes to `/issues` with no trailing `?`. The search `goto` carries `// eslint-disable-next-line svelte/no-navigation-without-resolve` (the rule rejects `${resolve()}?...`; the same directive is in 7 other files). Page size 25 is written in the component with a `// ponytail:` marker, because the client cannot import `ISSUES_PAGE_SIZE` from `$lib/server`. Rows iterate `issues`. Footer shows the range and Previous/Next links (disabled look on the ends).

## Tests (written first, must fail before the build)

- apps/admin/src/lib/server/issues.spec.ts (new, real Postgres via PGlite, same setup as `apps/admin/src/lib/server/queries.spec.ts`: real migrations, TRUNCATE in `beforeEach`). The mock-db style in `issues.test.ts` cannot see WHERE, ORDER or LIMIT, so it is not used here. Seed 30 incidents plus staff and assignees. Cases:
  1. Page 1 returns 25 rows, page 2 returns 5, `total` is 30, `pageCount` is 2, no id appears on both pages.
  2. Order across the page edge: seed resolved/low rows newer than open/high rows; every open/high row comes before any resolved row on page 1 (proves SQL order, not JS order of a slice).
  3. `q` matches title, description, `network_name`, and an assignee's name (one case each); `total` equals the match count; a non-match returns 0 rows and `pageCount` 1.
  4. `q` of `%` and `_` matches only literal text (no match-all).
  5. Clamp: page 99, 0, -3, `NaN` give the last page / page 1, never an error or empty page when rows exist.
  6. Each returned row still has its assignees (hydrate on the sliced rows only).
  7. `ISSUES_PAGE_SIZE` is 25.
  Fails now: `listIssuesPage` does not exist. - `cd apps/admin && bunx vitest run src/lib/server/issues.spec.ts`
- apps/admin/e2e/incident-board-pagination.e2e.ts (new, follows the other `incident-*.e2e.ts` specs) - with 26+ seeded incidents: board shows 25 rows and "Showing 1-25 of 26"; Next goes to `?page=2` with 1 row; typing in search sets `?q=` and drops `page`; reload keeps both. The search case expects 10 rows. An `afterAll` deletes the "Pager probe %" rows. Fails now: no pager. - `cd apps/admin && bun run test:e2e -- incident-board-pagination`

Gates after the build: `bun run check`, `bunx prettier --check .`, `bunx eslint .`, `bun run test`, `bun run build`. Existing `incident-*.e2e.ts` specs must still pass (they may assume all rows on one page).

## Behavior change

Search now matches the text within one field (title, description, AP name, or one assignee name). The old client filter matched across the fields joined together.

## Verified

vitest 181/181, svelte-check 0 errors 0 warnings, full admin e2e 27/27. R1 did not occur.

## Risks

- R1. Existing e2e specs that seed fewer than 25 incidents are unaffected; any that seed more and look for a row on page 2 will fail. Check when running the e2e set.
- R2. `ilike` with a leading `%` does a sequential scan. Fine at this volume (the reason for #99 is payload size, not query time); no index added.
- R3. The count and page queries are two statements, so a row created between them can shift one row across the page edge. Accepted.
- R4. Expanded rows, the confirm-delete state and cached history are client state keyed by issue id; they reset only if the component remounts. Paging via `goto` keeps the component, so stale expanded rows from a previous page are simply not shown. No fix needed.
