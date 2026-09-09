# Commander testing checklist

## Launcher

- [ ] Type a misspelling in the root launcher and confirm macOS does not show a correction/replacement popover.
- [ ] Search for an application or path-backed file/folder and confirm its real Finder icon replaces the generic Commander glyph.
- [ ] Run a broad query with at least 30 path-backed results, then move selection rapidly through the rows. Generic or
      cached icons must paint immediately; every visible row must progressively receive its real Finder icon (selected
      first) through the bounded queue. Rerun the query to confirm cached icons return without a bridge burst, and the
      macOS cursor must never become a rainbow beachball while visible results are already available.
- [ ] Create a disposable file and folder beneath an indexed root, run Index Files Now and Index Directories Now,
      then verify both appear in root search with native icons, Open, Show in Finder, Copy Path, and Finder-compatible drag-out.
- [ ] Right-click a disposable app, file, and directory result. Verify the type-appropriate menu offers Open, Show in
      Finder, Copy File, Copy Path, and Copy Name; Move to Trash is recoverable, while Delete Permanently requires
      explicit confirmation and removes only the selected disposable item. Confirm filesystem roots, mounted-volume
      roots, the current home folder, and the running Commander bundle are rejected by both destructive actions.
- [ ] Search `index now`; verify the built-in Index Now command appears with separate Apps, Commands, Files, and
      Directories commands. Run Index Apps after installing a disposable app and verify it appears without restarting Commander.
- [ ] Search typo variants such as `settngs`, `extensoin`, and `raycsat`; verify apps, built-ins, extension commands,
      files, and folders use the same typo-tolerant ordering. Choose a lower equivalent result several times, repeat
      the same query, and verify the selected item is promoted without affecting an unrelated query. Quit/relaunch
      and verify the learned ordering persists locally.
- [ ] With a large mixed application/file index containing many one-token matches, search `raycast stop`; verify the
      separator-equivalent `raycast-stop` application is surfaced above `raycast-start`, `raycast-status`, and noisy
      files. Run the broad-fuzzy indexer regression with a one-result output limit and verify all 129 matching FTS
      candidates are evaluated before ranking. Type several refinements quickly and verify only the active and latest
      query complete.
- [ ] With an index above one million records, search a separator-equivalent multiword application such as
      `thingtime recovery`; verify the strict FTS path returns the application promptly. Then search a long,
      nonexistent multiword phrase and verify the bounded fuzzy/path fallbacks reach No results in under two seconds
      rather than leaving the centered Searching spinner visible until the five-second client timeout.
- [ ] Create an extensionless executable named `raycast-start`, a hidden file, a broken symlink, and a nested `.app`
      bundle beneath a disposable root. Index All and verify each reference is searchable without crawling the app
      bundle or following the link.
- [ ] With more results than fit in the launcher, use a mouse wheel or trackpad over the rows and confirm the list scrolls while the header and footer remain fixed.
- [ ] Start from populated results, type a different query, and verify the prior rows disappear immediately rather
      than being presented as matches for the new input. The first exact or nearest-prefix cached batch for the new
      query may paint before the live filesystem batch; it must be query-relevant, and an identical final batch must
      not remount the rows.
- [ ] Start a search that takes long enough to show progress and verify exactly one loading spinner remains beside
      the result count. It must rotate smoothly at one fixed speed without wobbling, stacking, accelerating, or
      restarting as cached and live result batches stream into the list.
- [ ] With an index above one million records, time cold and repeated two-character filesystem searches such as `ea`.
      Verify the cold path uses the bounded indexed prefix lookup rather than a whole-database contains scan, then
      type a refinement and repeat the query to confirm warmed candidate and exact-result cache frames paint promptly.
- [ ] Verify populated search results render as Apps, Commands, and Files & Folders sections. App names omit the
      filename suffix while showing a compact `.app` badge. A very strong text/learned match may place a lower-priority
      section first instead of category preference forcing an irrelevant result above it.
- [ ] Type `256*2` directly into the root search field. Verify Calculator appears first with `512`, Product, and
      Five Hundred Twelve while ordinary search matches remain underneath. Return must copy `512`, close the floating
      launcher, and preserve the calculation in History. Verify incomplete `256*`, bare `256`, and date-like
      `22/08/2026` queries stay in ordinary search; also check parentheses, `100 + 10%`, `sqrt(81)`, and `5!`.

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
- [ ] Open an indexed application, URL, and System Settings result; if Launch Services takes time to launch any of
      them, Commander must still dismiss/reopen and accept typing immediately without a rainbow beachball.
- [ ] Search `accessibility`; verify Accessibility Settings is the first `System` result and Return opens Privacy & Security → Accessibility without changing any permission. Repeat with `screen recording`, `full disk access`, and `login items`.
- [ ] Search `displays` on a machine whose file index contains many `display*` names. Verify Displays Settings remains the first result above matching applications/files and Return opens System Settings → Displays.
- [ ] Search for an application and drag its result into a disposable Terminal prompt. Verify the exact shell-escaped `.app` path is inserted, no app opens during the drag, and ordinary click/double-click execution still works. Cancel or clear the prompt without running it; do not mutate macOS Privacy & Security permissions during routine QA.
- [ ] Verify default and compact modes; expansion never shows an unrendered blank region.
- [ ] Force-terminate the native host once; its parent watchdog must stop the daemon and Rust child and release port 47820 before relaunch.
- [ ] Drag the launcher by its icon/header chrome; the window follows the pointer without moving focus into the search field.
- [ ] Drag each launcher corner and edge inward and outward in default and compact modes. Verify native resize cursors
      appear, the panel follows the pointer down to its mode-specific minimum, and content remains usable without an
      opaque outer rectangle.
- [ ] While resizing, trigger an emoji insertion or press Return to paste from Commander’s Emoji & Symbols picker,
      release the mouse, press Escape, change focus, hide, or close the launcher. The resize session must cancel
      immediately, so later pointer movement cannot resize the panel. In
      General, turn custom resize handling off and verify AppKit's standard edge resizing works; turn it back on and
      verify Commander’s inner resize handles work again after relaunch.
- [ ] Pin the launcher from the bottom-right window icon, focus another app, and verify the pinned window remains
      visible. Command-Space must focus the most recently used Commander window on the current display. Right-click
      the icon and choose Open New Window; verify the newly created window starts pinned even when the global default
      is off, and both windows retain independent queries. Exercise the configured pin/unpin shortcut and confirm the
      icon's active opacity follows native pinned state.
- [ ] Run an index while the launcher is visible. Verify the idle footer is replaced by the active source label and
      processed/indexed counts, advances without reopening the launcher, then returns to ready when complete.
- [ ] Search `emoji` or `symbols`, run Search Emoji & Symbols, and verify the launcher changes into the eight-column picker without opening Settings or an external app.
- [ ] In the emoji picker, search `heart`; verify semantic matches, category and skin-tone selectors, Left/Right/Up/Down navigation, selected-cell scrolling, and Command-K actions. Command-Return copies and Shift-Command-C copies Unicode code points.
- [ ] Type `ear` and verify macOS does not show a spelling/correction pill over the picker; while the search field remains focused, arrow keys must move the selected emoji instead of entering correction UI. Search misspellings such as `haert` and `hert` and verify relevant heart emoji still appear.
- [ ] Search `heart`, arrow to a non-leading heart, and choose it twice. Reopen the picker and search `heart` again; verify that emoji is promoted. Quit/relaunch Commander and repeat the query to verify the bounded device-local query/emoji counts persist.
- [ ] Bind Search Emoji & Symbols to Command-E. With another app active, press Command-E and immediately type `heart`; the picker must remain visible and focused. Dismiss it, then press Command-Space once and verify the normal launcher reappears. Repeat after hiding Commander with Command-H to confirm the global shortcut restores the app in one press.
- [ ] Open Commander over a disposable TextEdit document, choose an emoji, and press Return. With Commander trusted in Accessibility, verify the launcher closes and the emoji is pasted into that original app; without trust, verify the picker stays open, explains how to recover access, and preserves the clipboard unless Copy Emoji was explicitly chosen. Never prompt on launch.
- [ ] In Extensions → Bundled, change Emoji & Symbols' Return action among Paste to Current App, Paste and Keep a
      Copy, Copy Emoji, and Copy Unicode. Verify each persists across relaunch. For Paste to Current App, seed the
      clipboard with unique text, paste an emoji into TextEdit, then verify the unique clipboard content is restored.
- [ ] With Accessibility denied (or a stale enabled grant), select a non-leading emoji and repeatedly press Return or double-click it. The native window, font size, eight-column grid width, selected emoji, recents and learned ranking must remain stable. The complete explanation, Open Accessibility Settings and Copy Emoji controls must fit at standard, minimum, compact and large-text sizes; scroll to the final emoji and open Actions without clipping. The keep-clipboard action must not change the pasteboard change count even transiently. Only an explicit Copy Emoji action may replace it.
- [ ] For a signing-identity migration, compare the installed app's designated requirement with its prior build. If macOS still shows the old grant enabled but rejects paste, refresh only Commander's Accessibility toggle after explicit user approval, relaunch the same installed bundle, and verify Return and double-click paste into a disposable TextEdit document while retaining the previous clipboard.
- [ ] Reopen Commander after leaving the emoji picker and verify the normal launcher returns with an empty query. Reopen the picker and verify its Recently Used ordering and selected skin tone persist locally.

## Settings

- [ ] Run the launcher results for Extensions and Accounts. Each opens the matching Settings tab rather than General; direct `?tab=extensions` and native tab events do the same.
- [ ] In Advanced, select Production and Develop and verify each immediately fills its built-in Thingtime URL and public client ID. Add a named custom environment, select it after reopening Settings, edit it, then remove it; existing custom URL/client overrides must remain available as “Custom configuration” rather than being replaced.
- [ ] Search `commander cpu` and open Commander Activity. Verify the native Activity tab refreshes every two seconds
      with Commander host/daemon CPU, memory, storage, and process count plus local Mac CPU, best-effort GPU,
      memory, thermal state, and filesystem values. Disconnect the native bridge only in a test shell and verify the
      unavailable state appears without sending machine metrics to the daemon or Thingtime.
- [ ] In Activity, verify System memory shows used/total plus Active, Wired, Cached, Compressed, and Purgeable values;
      verify Filesystem includes the macOS purgeable-capacity estimate. Sort the full-width process table by every
      available header, enable Group by parent, and confirm CPU, memory, and disk rows update without crashing the
      native host. GPU and network process columns must remain unavailable rather than showing fabricated values.
- [ ] In Activity → Responsiveness signals, verify a UI app is only called unresponsive after two timed-out
      accessibility probes. Verify agents and services remain visible with their type and an “AX probe inconclusive”
      badge and explain that they are alive but generically unprobeable. Every listed process must retain Quit,
      Force quit, and Quit & restart controls for deliberate management; only Force quit and Quit & restart show
      their data-loss confirmation before proceeding.
- [ ] In Activity → Thingtime network, verify a 15-second uncached latency refresh splits request/send, response/receive,
      and round-trip times. Run the explicit test and confirm its five fixed packet sizes (56 KiB, 500 KiB, 2 MiB, 5 MiB,
      and 10 MiB) produce download/upload rates. Turn on periodic testing, verify the saved cadence survives relaunch,
      and confirm it defaults off and cannot be configured below 15 minutes in the UI.
- [ ] Toggle launch at login and verify `SMAppService.mainApp.status` changes after relaunch.
- [ ] Record a non-conflicting shortcut containing Option (for example Command-Option-J), verify the physical key is retained instead of its generated symbol, close Settings, and verify the new shortcut opens Commander.
- [ ] Drag Settings by its centered title-bar chrome and verify buttons and fields remain independently clickable.
- [ ] Toggle menu-bar visibility and verify exactly one Commander item exists when enabled.
- [ ] Verify light, dark, and system appearance plus default/large text size without clipping.
- [ ] Verify favourites-in-compact-mode is disabled unless Compact is selected.
- [ ] In General → Pinned Windows, toggle pinning, default-pinned behavior, and current-display recent-window focus;
      record a non-conflicting pin shortcut, relaunch, and verify every control remains effective.
- [ ] In Search → Results & Cache, drag all three result sections into a new order and verify the launcher follows it.
      Set a custom cache folder, size, and expiry; close/reopen Settings, verify they persist, reveal the effective
      folder, clear it, and verify size/entry count return to zero without changing the filesystem index.
- [ ] Open Search → Search Index. Verify application, command, file, and folder counts update while a scan runs;
      Index All and each scoped button remain responsive and Settings can scroll to the final ignore row without clipping.
- [ ] Verify Include hidden files starts enabled, Maximum entries starts blank/Unlimited, and the database footprint
      displays in B, KB, MB, or GB. Set a custom entry cap, close/reopen Settings, verify it persists, then clear the
      field and verify the saved value returns to unlimited.
- [ ] With an index above one million records, leave Search Settings open for at least four status polls. Counts and
      database size must stay populated, each poll must complete within five seconds, and no timeout may replace the
      last-known values with zeroes. Search a long nonexistent term afterward and verify status polling recovers.
- [ ] Change Scanner threads, Parallel tasks, Open folders, Max CPU, and Max memory; close/reopen Settings and verify
      every value persists. Run a scan and verify the last-run line reports effective workers, average CPU, peak RAM,
      and throttle time. Set the three concurrency ceilings to different values and verify effective workers use the
      smallest value (also bounded by logical CPUs).
- [ ] Against a disposable standalone database, run the same synthetic tree at 100% and 5% CPU and sample process CPU;
      verify the low profile is throttled and remains searchable. Set RAM below current RSS and verify a `resource_limit`
      error leaves the prior snapshot searchable; verify traversal directory handles never exceed effective workers.
- [ ] Against a disposable large index, compare one, two, three, and four worker profiles and keep the measured winner as
      the default. Re-run the winning profile unchanged; verify schema 3 avoids FTS churn, keeps the result count stable,
      and finishes materially faster than a fresh build. Open a schema-2 fixture and verify it upgrades in place without
      rebuilding or losing searchable records.
- [ ] On macOS, verify the prominent macOS whole-volume access card at the top of Search reports Full Disk Access
      granted or not granted from the native read-only TCC probe, and Recheck updates the same state. Verify Open Full Disk Access opens Privacy & Security
      → Full Disk Access without changing the toggle.
      With access withheld and a deliberately blocking root, verify the scan stops after 90 seconds, the writer recovers,
      actionable guidance appears, and the last committed index remains searchable.
- [ ] In Search → Search Index → Index reliability, enter a digits-only custom timeout in milliseconds, close/reopen
      Settings, and verify it persists without a product maximum. Force a disposable scan past that limit; verify the
      timeout appears in Timed out attempts, the recent timing summary remains visible, and Commander sends one macOS
      notification recommending a higher limit while preserving the prior committed index.
- [ ] Add a disposable index root. With `.gitignore` in a parent directory, verify ignored descendants stay absent;
      add wildcard `**/build/**` and regex `(^|/)scratch-[0-9]+(/|$)` rules and verify matching paths disappear after reindex.
      Verify a `large.noindex` directory is skipped by the defaults and descendant globs prune their directory tree.
- [ ] Enter an invalid regular expression and run a scan. Verify Commander reports the error and continues serving
      results from the last committed index; remove the rule and reindex successfully.
- [ ] Set a disposable standalone index source above its entry cap. Verify the capped results remain searchable and
      Settings reports the warning instead of rolling the source back to an empty index.
- [ ] Leave Commander running, add an `.app` bundle to `~/Applications` and to a mounted volume, and verify the
      volume watcher makes it searchable promptly. Verify `/` indexes the boot disk plus mounted volumes without
      crossing a mount boundary twice; the user-visible ignore and `.gitignore` rules must still exclude matches.
      The six-hour app reconciliation is only a safety net for missed volume events, as are the six-hour default
      file/folder refreshes.

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
- [ ] Verify the macOS System built-in exposes its indexed destinations and per-command shortcut controls on macOS, while Windows/Linux bootstrap catalogs omit it.
- [ ] Open Bundled and verify Emoji & Symbols appears separately from installed/sideloaded extensions with its built-in badge, Raycast-inspired description, Search Emoji & Symbols command count, and default Return-action control.
- [ ] In Extensions → Bundled, verify Calculator has its own built-in card. Disable Automatic Results and confirm a
      valid expression no longer creates a Calculator section; re-enable it, change maximum decimal places, relaunch,
      and verify both the setting and formatted answer persist.
- [ ] Import `Commander/extensions/raycast/`, run its no-view Open Commander command from Raycast after Commander has quit, and verify the installed app relaunches with a focused, empty query.

## Thingtime accounts and sync

- [ ] Upgrade a state file whose `thingtimeClientId` is blank and verify Commander restores the bundled public client ID while preserving explicit non-blank overrides.
- [ ] Start sign-in in the system browser; redirect only to the exact registered loopback callback.
- [ ] Complete PKCE exchange and verify token exists in Keychain, not `state.json`, logs, command line, or UI storage.
- [ ] Add two accounts, switch in both directions, restart, and verify public profiles paint immediately from local state.
- [ ] Unlock each token from Keychain and sync `commander.settings.v1` through the real app-data API.
- [ ] Remove an account and verify its Keychain credential is deleted without affecting the other account.

## Visual QA

- [ ] Open the native launcher above light and dark desktop content; only the compositor-masked rounded launcher
      surface and its shadow are visible, with no larger rectangular panel/WebView background at first paint, after
      at least ten seconds focused, after focus loss/return, or after search/actions updates. The inner launcher
      surface itself must remain fully opaque throughout.
- [ ] Compare launcher and settings screenshots against `design/commander-concept.png` and the three user references.
- [ ] Inspect every settings tab and the open Actions state at native window sizes.
- [ ] Resize Settings to its minimum and a large desktop size; no clipping, overlap, or horizontal overflow.
- [ ] Verify keyboard focus, VoiceOver labels, reduced motion, and high-contrast/dark appearance.


## Signed releases

- [ ] Follow the root TESTING.md Commander release checklist. Verify the downloaded
      archive with `script/verify-production-bundle.sh`, then check the installed
      copy's signature, bundled executable, daemon health, and launcher search.
- [ ] Confirm Recovery lists the GitHub build and commit in Commander and Recovery
      caches, preserves the previous app, and leaves Electron's cache unchanged.
