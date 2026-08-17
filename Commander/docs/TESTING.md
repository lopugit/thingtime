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
- [ ] Command-K opens Actions for the selected item; Escape closes Actions before closing Commander.
- [ ] Open an application, reveal it in Finder, and copy its path through Actions.
- [ ] Verify default and compact modes; expansion never shows an unrendered blank region.
- [ ] Force-terminate the native host once; its parent watchdog must stop the daemon and Rust child and release port 47820 before relaunch.
- [ ] Drag the launcher by its icon/header chrome; the window follows the pointer without moving focus into the search field.

## Settings

- [ ] Toggle launch at login and verify `SMAppService.mainApp.status` changes after relaunch.
- [ ] Record a non-conflicting shortcut containing Option (for example Command-Option-J), verify the physical key is retained instead of its generated symbol, close Settings, and verify the new shortcut opens Commander.
- [ ] Drag Settings by its centered title-bar chrome and verify buttons and fields remain independently clickable.
- [ ] Toggle menu-bar visibility and verify exactly one Commander item exists when enabled.
- [ ] Verify light, dark, and system appearance plus default/large text size without clipping.
- [ ] Verify favourites-in-compact-mode is disabled unless Compact is selected.

## Extensions

- [ ] Sideload the `Commander/extensions/raycast/` fixture and a ZIP copy; verify commands appear with honest compatibility state.
- [ ] Choose Inspect Only and Build & Add separately; no package script runs without explicit consent.
- [ ] Try an invalid folder; the error is visible and the installed list is unchanged.
- [ ] Search Store, open the live Raycast catalog, and verify Commander does not pretend an uninstalled result is installed.
- [ ] Execute a compatible prebuilt no-view command and confirm a worker crash cannot terminate the daemon.
- [ ] Verify Installed contains the enabled built-in Commander extension with Close Commander, Close Commander Window, and Open Commander native commands.
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
