# Commander testing checklist

## Launcher

- [ ] Global shortcut opens the launcher over the active application without moving focus elsewhere first.
- [ ] The first visible frame contains rendered UI; there is no white, transparent, or stale flash.
- [ ] Type `settings`; Settings / Commander Settings is first and Return opens the separate settings window.
- [ ] Type `exit`; the built-in Commander extension's Close Commander command is first and Return quits the host, daemon, and Rust child, releasing port 47820.
- [ ] Reopen Commander, type `hide window`, run Close Commander Window, and verify the launcher disappears while the host and daemon remain alive; use the global shortcut to reopen it.
- [ ] Type a unique query and launch a command from its results. Hide and reopen with the global shortcut; verify the input is blank while the launched command appears first under History and its search term appears next as a separate full-width top-level result. Return reruns the command from its row and restores the query from the search-term row. Quit/relaunch Commander and verify both persist.
- [ ] Create at least nine distinct search sessions. Verify only the newest eight appear initially, Show More expands the retained history, Show Less collapses it again, and arrow navigation keeps every revealed row visible.
- [ ] With text in the search field, Command-A selects the complete query and typing replaces it; on Windows/Linux shells, repeat with Control-A.
- [ ] Up/Down selection stays visible through the complete result list. Return runs the selected primary action.
- [ ] Hover a lower result, stop moving the pointer, then keep typing. The refreshed list resets to its first result; the stationary pointer must not steal selection until it moves again.
- [ ] Type a new query and press Return immediately, before the search debounce settles. Commander must never execute an item left over from the previous query.
- [ ] Command-K opens Actions for the selected item; Escape closes Actions before closing Commander.
- [ ] Open an application, reveal it in Finder, and copy its path through Actions.
- [ ] Search for an application and drag its result into a disposable Terminal prompt. Verify the exact shell-escaped `.app` path is inserted, no app opens during the drag, and ordinary click/double-click execution still works. Cancel or clear the prompt without running it; do not mutate macOS Privacy & Security permissions during routine QA.
- [ ] Verify default and compact modes; expansion never shows an unrendered blank region.
- [ ] Force-terminate the native host once; its parent watchdog must stop the daemon and Rust child and release port 47820 before relaunch.
- [ ] Drag the launcher by its icon/header chrome; the window follows the pointer without moving focus into the search field.
- [ ] Search `emoji` or `symbols`, run Search Emoji & Symbols, and verify the launcher changes into the eight-column picker without opening Settings or an external app.
- [ ] In the emoji picker, search `heart`; verify semantic matches, category and skin-tone selectors, Left/Right/Up/Down navigation, selected-cell scrolling, and Command-K actions. Command-Return copies and Shift-Command-C copies Unicode code points.
- [ ] Open Commander over a disposable TextEdit document, choose an emoji, and press Return. With Commander trusted in Accessibility, verify the launcher closes and the emoji is pasted into that original app; without trust, verify the picker stays open and clearly reports the clipboard-only fallback without prompting on launch.
- [ ] Reopen Commander after leaving the emoji picker and verify the normal launcher returns with an empty query. Reopen the picker and verify its Recently Used ordering and selected skin tone persist locally.

## Settings

- [ ] Run the launcher results for Extensions and Accounts. Each opens the matching Settings tab rather than General; direct `?tab=extensions` and native tab events do the same.
- [ ] Toggle launch at login and verify `SMAppService.mainApp.status` changes after relaunch.
- [ ] Record a non-conflicting shortcut containing Option (for example Command-Option-J), verify the physical key is retained instead of its generated symbol, close Settings, and verify the new shortcut opens Commander.
- [ ] Drag Settings by its centered title-bar chrome and verify buttons and fields remain independently clickable.
- [ ] Toggle menu-bar visibility and verify exactly one Commander item exists when enabled.
- [ ] Verify light, dark, and system appearance plus default/large text size without clipping.
- [ ] Verify favourites-in-compact-mode is disabled unless Compact is selected.

## Extensions

- [ ] In Installed, click Record Shortcut beside a command, press a modified key combination, close Settings, and invoke it while another app is active. Rebind it, verify the old shortcut stops firing, then press Delete in recording mode and verify the binding clears.
- [ ] Try assigning the launcher shortcut or another command's shortcut to a command. macOS must reject the conflict, show the error, keep the previous command bindings registered, and leave persisted settings unchanged.
- [ ] Sideload the `Commander/extensions/raycast/` fixture and a ZIP copy; verify commands appear with honest compatibility state.
- [ ] Choose Inspect Only and Build & Add separately; no package script runs without explicit consent.
- [ ] Try an invalid folder; the error is visible and the installed list is unchanged.
- [ ] Search Store, open the live Raycast catalog, and verify Commander does not pretend an uninstalled result is installed.
- [ ] Open Your Raycast and verify it lists the current macOS Raycast profile with metadata/counts only; no preference value, password, token, encrypted database content, or Keychain content reaches the renderer.
- [ ] For a disposable public extension, choose Add to Commander and verify its bounded source snapshot is installed without dependency installation or package scripts, then verify only manifest-declared non-password settings are reported as copied.
- [ ] For an already installed extension, choose Sync to Commander and verify its safe extension/command preferences refresh. Password fields remain protected, and development extensions direct the user to Sideload instead of guessing a source path.
- [ ] Execute a compatible prebuilt no-view command and confirm a worker crash cannot terminate the daemon.
- [ ] Verify Installed contains the enabled built-in Commander extension with Close Commander, Close Commander Window, and Open Commander native commands.
- [ ] Open Bundled Raycast Commands and verify Emoji & Symbols appears separately from installed/sideloaded extensions with its built-in badge and Search Emoji & Symbols command count.
- [ ] Import `Commander/extensions/raycast/`, run its no-view Open Commander command from Raycast after Commander has quit, and verify the installed app relaunches with a focused, empty query.

## Thingtime accounts and sync

- [ ] Upgrade a state file whose `thingtimeClientId` is blank and verify Commander restores the bundled public client ID while preserving explicit non-blank overrides.
- [ ] Start sign-in in the system browser; redirect only to the exact registered loopback callback.
- [ ] Complete PKCE exchange and verify token exists in Keychain, not `state.json`, logs, command line, or UI storage.
- [ ] Add two accounts, switch in both directions, restart, and verify public profiles paint immediately from local state.
- [ ] Unlock each token from Keychain and sync `commander.settings.v1` through the real app-data API.
- [ ] Remove an account and verify its Keychain credential is deleted without affecting the other account.

## Visual QA

- [ ] Open the native launcher above light and dark desktop content; only the compositor-masked rounded launcher surface and its shadow are visible, with no larger rectangular panel/WebView background at first paint or after search/actions updates.
- [ ] Compare launcher and settings screenshots against `design/commander-concept.png` and the three user references.
- [ ] Inspect every settings tab and the open Actions state at native window sizes.
- [ ] Resize Settings to its minimum and a large desktop size; no clipping, overlap, or horizontal overflow.
- [ ] Verify keyboard focus, VoiceOver labels, reduced motion, and high-contrast/dark appearance.
