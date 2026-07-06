# Admin App — Bug Log

Running list of bugs in the admin app, captured as they're reported. Not yet triaged or fixed —
this is a capture file only.

## Bugs

### 1. Session Limits — form fields blank out after saving — FIXED

**Where:** Content Management → Session Limits.

**Observed:** After saving changes, all the form fields go blank. The admin has to refresh the page
to get the saved values back into the fields.

**Expected:** The fields should keep showing the saved values after a successful save (no refresh
needed).

**Fix:** The number inputs bind one-way (`value={f.get()}`), so their HTML `defaultValue` is empty.
SvelteKit's `enhance` default `update()` calls `form.reset()` on success, which reset every input to
that empty default → blank. Changed the save handler to `update({ reset: false })` so the entered
values stay on screen, and clear only the single-use authenticator code afterward.
(`apps/admin/src/routes/(app)/content/limits/+page.svelte`)

---

### 2. Packages — edit form has no scroll/visibility cue when editing — FIXED

**Where:** Content Management → Packages.

**Observed:** When editing any package, the edit form appears at the TOP of the page, but the view
doesn't auto-scroll to it (or otherwise draw attention), so on a long list it's not obvious the
edit form opened.

**Decision:** Went with (a) auto-scroll. On opening an edit or New package, the page smooth-scrolls
the edit panel into view and focuses the Name field. Done imperatively via `tick()` (not an `$effect`
on `editing`) so typing in the form doesn't re-trigger a scroll on every keystroke.
(`apps/admin/src/routes/(app)/content/packages/+page.svelte`)

