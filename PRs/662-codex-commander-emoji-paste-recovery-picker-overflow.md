# PR #662: Commander emoji paste recovery

## Cause

The native window frame and text size stay fixed in the supplied recording. An implicit CSS Grid auto column expands to the minimum content width of the long Accessibility error in the footer. This widens the toolbar and emoji grid underneath the fixed native window mask, stretching cells and clipping the right controls. The picker also recorded recents and learned rankings before checking whether paste succeeded, so repeated denied attempts reshuffled the grid.

The installed app's saved macOS Accessibility grant still matches its older Apple Development signature. The installed binary uses Developer ID. System Settings reports the toggle on, but macOS TCC logs explicitly report `Failed to match existing code requirement` for Commander. The previous native resize-session cancellation is still present and its regression passes; this incident is a separate layout and permission-recovery failure.

## Change

- Bound the picker to one `minmax(0, 1fr)` column and allow feedback to wrap within the window; keep recovery content scrollable at short window heights.
- Record successful emoji actions only, preserve selection after successful reordering, and serialize pending actions.
- Clear stale permission feedback after a successful retry.
- Present the permission error with an explicit settings link, existing-grant recovery guidance and Copy Emoji button. Opening settings does not alter privacy permissions.
- Check trust and target availability before a keep-clipboard paste can change the pasteboard, including its change counter.
- Preserve the installed Developer ID designated requirement. Refresh only the existing Commander Accessibility grant after explicit user approval; never reset unrelated grants.

## Validation

- Full typecheck and build passed.
- 205 JavaScript/TypeScript tests, 68 Rust tests and 28 Swift tests passed.
- Added regression coverage for denied paste preserving the clipboard change count, recents, learned ranking and selection, explicit settings/copy recovery, and overlapping Return presses.
- The full verified build was signed with the existing Developer ID requirement, notarized, stapled and installed. Native denied-paste checks confirmed a stable window/grid, readable recovery controls, the Actions menu, and scrolling to the end of the results.
- Narrow-window inspection identified a second inset mismatch: the generic launcher used 8px of padding beneath an 18px native mask. The emoji surface now preserves the native inset at the minimum window size. The final UI build and eight focused emoji regressions passed after this adjustment and successful-retry feedback cleanup.
- Refreshing the stale Accessibility grant requires a user-approved off/on change and macOS authentication. Successful-paste acceptance and the final installed source revision are recorded in the PR validation when that step completes.
- Chrome's URL policy blocked a local QA file. Native installed-app checks are used for visual acceptance; no browser-policy workaround was attempted.
- Graphify semantic extraction completed through the local proxy. The existing graph reported cross-source identifier collisions; those warnings do not constitute complete semantic coverage of the affected unrelated nodes.
