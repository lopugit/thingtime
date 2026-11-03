# PR 1226: Match the final Add drawer row and expose its editable Thing template

The Add control now follows all built-in, contextual, editor and custom drawer items. It uses the same row styling as ordinary navigation, including the emoji slot, typography, spacing, hover and focus. Layout editing is available in Settings rather than normal navigation.

## Editable Thing integration

Settings → Appearance → Drawer menu template edits the exact custom-menu document rendered in the drawer. Its icon, label, repeated link template and dialog controls are separate Builder blocks. Authenticated layouts use the existing private Webpage Thing adapter and revision fence. Existing account/origin/data-plane-scoped device layouts render as a fallback and remain untouched; no automatic migration write occurs. Custom link entry data retains its existing account-scoped device preference storage.

## Verification

- Navigation 27/27 and settings 57/57 unit tests pass. Focused lint has no errors and one existing cleanup warning. Client and Node server builds pass.
- The typecheck ratchet reports 92 existing diagnostics against a baseline of 89; no diagnostic is in a changed file. This is not a clean repository-wide typecheck.
- The full isolated real-API acceptance run passes 18 scenarios, nine row comparisons and 21 layout checks, with no browser errors. It uses a disposable Mongo replica set, synthetic API identities and OS network restrictions for browser and backend; direct-IP and redirect escape attempts are denied.
- Measured default Add and Home rows match: 35px height, 14px text, 13px emoji slot, 7px/12px padding. Desktop and 390px mobile checks cover top/bottom scrolling, long titles, many entries, hover preview, modal focus, dark theme, Commander selection, CRUD and account separation.
- Nested icon/label/repeated-field Builder edits survive save and reload; independent API readback confirms the private Webpage Thing. Legacy layout bytes remain unchanged and no account Thing is automatically written.
- A focused finite-menu More run passes collapsed and expanded states at 1440px and 390px: four additional exact row comparisons, five layout checks and no browser errors. This supplements the main run, whose initial default was unlimited. All task-owned listeners were removed after testing.

## Test harness recovery

Slow local startup and hydration exposed test synchronization issues. The harness now waits for the hydrated drawer trigger, observes actual open/closed state, closes the mobile overlay before Settings interaction, and uses bounded database/navigation readiness. It does not broaden network access or substitute mock state for the real save path.

Deployment and final graph status are recorded in the PR. Local evidence does not establish production acceptance.
