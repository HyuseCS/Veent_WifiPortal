# Admin App — Bug Log

Running list of bugs in the admin app, captured as they're reported. Not yet triaged or fixed —
this is a capture file only.

## Bugs

### 1. Session Limits — form fields blank out after saving

**Where:** Content Management → Session Limits.

**Observed:** After saving changes, all the form fields go blank. The admin has to refresh the page
to get the saved values back into the fields.

**Expected:** The fields should keep showing the saved values after a successful save (no refresh
needed).

---

### 2. Packages — edit form has no scroll/visibility cue when editing

**Where:** Content Management → Packages.

**Observed:** When editing any package, the edit form appears at the TOP of the page, but the view
doesn't auto-scroll to it (or otherwise draw attention), so on a long list it's not obvious the
edit form opened.

**Decision needed:** Either (a) auto-scroll up to the edit form, or (b) make the form pop up
inline below the item being edited. To be decided.

