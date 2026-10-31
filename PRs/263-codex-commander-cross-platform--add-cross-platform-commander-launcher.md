# PR #263 — Add cross-platform Commander launcher

Branch: `codex/commander-cross-platform`
PR: https://github.com/lopugit/thingtime/pull/263

## Product scope

- Added `Commander/` as a new repository-root application with a native macOS
  host, React/TypeScript UI, persistent Node.js daemon, and Rust search core.
- Added configurable global activation, a menu-bar presence, launcher and
  separate Settings windows, app/command search, arrow navigation, and a
  keyboard-driven Command-K action chooser.
- Added settings for launch at login, menu-bar visibility, hotkey, appearance,
  text size, window mode, and favourites in compact mode.
- Added Thingtime SSO with exact-loopback S256 PKCE, native Keychain storage,
  multi-account switching, and private app-data settings sync.
- Added Raycast Store discovery, bounded folder and ZIP sideload handling, and a
  privacy-preserving Your Raycast importer for local extensions and settings.
- Added a standalone Rust/SQLite filesystem metadata index, a reusable typed
  Node client, Commander file/folder search, inherited Git ignores, custom
  wildcard/regex exclusions, live status, and scoped Index Now commands.

The process split follows Raycast's published architecture: native lifecycle
and operating-system integration stay in Swift/AppKit, portable business logic
runs in a long-lived Node process, and deterministic search scoring runs in a
small Rust JSONL service.

## Native and runtime design

- The signed app bundle includes a checksum-pinned Node 22.23.2 runtime, the
  compiled daemon/UI, and the release Rust search binary, so a Finder launch
  does not depend on a Homebrew shell path.
- The native bridge accepts only the daemon's exact scheme, host, and port.
  Other destinations are rejected or opened externally before they can invoke
  privileged handlers.
- Native settings apply as one validated transaction. A failed replacement
  hotkey restores the prior registration instead of leaving activation broken.
- The daemon receives the native host PID and exits when its parent changes;
  the verifier confirms the health PID, parent relationship, bundled paths,
  and exact daemon arguments.
- Thingtime access tokens never enter React state. The native host stores them
  in Keychain under issuer, client, and user identity and uses claim/ack calls
  for daemon handoff.

## Raycast compatibility boundary

This is an intentionally incremental compatibility layer, not a claim that all
Raycast extensions already work. Commander currently supports:

- public catalog metadata and source discovery;
- Raycast manifest/source inspection;
- immutable, bounded folder or ZIP sideload preparation;
- explicit opt-in builds with filtered environments and process-group timeout;
- compatible prebuilt `no-view` commands in bounded workers.
- macOS Raycast-profile discovery plus manifest-declared, non-password
  preference import for compatible workers.

Full `@raycast/api` view reconciliation, List/Grid/Detail/Form components,
the complete preferences API shim, storage, OAuth providers, menu-bar commands,
and integrated source build consent remain follow-up work. Worker threads
constrain lifetime and heap size; they are not an operating-system permission
sandbox.

Windows and Linux protocol contracts are present for portability, but native
shells for those platforms are not implemented or verified in this PR.

## Thingtime OAuth security model

- Only explicit unprivileged HTTP loopback callbacks on `127.0.0.1` or `[::1]`
  are accepted.
- Authorization codes are signed, five-minute, purpose-scoped sessions and are
  consumed atomically before a 30-day app token is issued.
- S256 PKCE, exact client and redirect binding, app state, user existence, and
  origin registration are rechecked during exchange.
- OAuth-code, app, app-sandbox, PAT, and unknown named session purposes fail
  closed on full-account authorization paths.
- The existing app token has no refresh token; Commander reauthorizes after
  expiry or revocation.

Production login requires the new routes to be deployed and Commander's exact
loopback callback/client registration to be added to the intended Thingtime
environment.

## Built-in registration and launcher follow-up

- Commander now ships with its production public client ID. The matching
  Thingtime app is owned by the verified `commander-app` service account at
  `commander@thingtime.com` and permits only the loopback origin
  `http://127.0.0.1:47820`.
- Legacy state files whose client ID is blank migrate to the bundled ID. An
  explicit non-blank Advanced override remains supported for other Thingtime
  deployments.
- The launcher WebKit canvas is transparent at the native view, under-page,
  backing-layer, document-root, and cold-start surface levels. The native host
  also shape-masks WebKit to the exact inset rounded Commander surface, so a
  backing tile cannot paint the outer rectangle; the window shadow follows the
  masked alpha shape.
- The focused launcher search field handles Command-A directly on macOS and
  Control-A on other platforms, restoring full-query selection even though the
  accessory AppKit host intentionally has no conventional Edit menu while
  preserving macOS's standard Control-A editing behavior.
- The built-in Raycast-shaped Commander extension exposes separate native
  no-view `Close Commander`, `Close Commander Window`, and `Open Commander`
  commands. Close Commander terminates the host and its supervised daemon/Rust
  children; the window command only hides the launcher; Open Commander presents
  and focuses it.
- Reopening the floating launcher clears its query before presentation. The
  previous non-empty query is de-duplicated into a device-local History section
  that appears before Suggestions and persists across full relaunches. History
  is modeled as search sessions: each term owns the de-duplicated commands
  launched from that term. Each session leads with its newest executed command,
  followed by older commands and then the search term as a separate full-width
  top-level result; command rows
  directly replay their saved action. The newest eight sessions appear
  initially; Show More expands up to 50 retained sessions without turning the
  initial display cap into data loss.
- The repository's existing Raycast extension moved intact from root `raycast/`
  to `Commander/extensions/raycast/`, keeping its image tools, assets, and pinned
  package alongside the real no-view Open Commander command. That command opens
  the installed app by bundle identifier, including after a complete Commander
  quit.
- Launcher and Settings title chrome now starts an exact-origin native AppKit
  drag operation while leaving inputs and buttons interactive. Shortcut
  recording captures at the window level and resolves physical key codes, so
  Option-modified keys persist as their intended key instead of symbols such as
  `∆`.
- The service-account password remains outside the repository and app bundle
  in user-only local storage. No password, service token, or OAuth access token
  is tracked.
- The latest follow-up QA install used the configured Apple Development
  identity and preserved the stable bundle identifier and designated
  requirement.
- Extensions Settings now has a **Your Raycast** tab. The daemon reads Raycast's
  exported macOS preference domain, returns only sanitized extension metadata
  and counts to React, and never opens Raycast's encrypted database or Keychain.
  Password fields, OAuth credentials, and Raycast LocalStorage stay protected.
- **Add to Commander** fetches a public extension with one time-bounded sparse
  checkout from the official `raycast/extensions` repository, then re-applies
  Commander's file-count, byte, path, and link limits before installation. It
  never installs dependencies or executes package scripts. **Sync to Commander**
  refreshes only manifest-declared non-password extension and command values.
  Development extensions remain visible but direct users to Sideload because
  Raycast does not expose their source path.
- Launcher settings results now carry a validated settings-tab deep link through
  the daemon and native bridge, so Extensions and Accounts open their exact tabs.
  Result selection now reacts to pointer movement instead of hover re-entry, so
  a stationary cursor cannot steal keyboard selection after a query rerender.
- Extensions Settings now separates Commander-owned **Bundled Commands**
  from imported extensions. The first bundled equivalent is Emoji & Symbols:
  semantic Unicode/CLDR search, an eight-column keyboard grid, categories, skin
  tones, local recents, copy/Unicode actions, and native paste-back to the app
  that was active before Commander opened. The picker uses MIT-licensed
  Emojibase data and reports a clipboard-only fallback when macOS Accessibility
  trust is unavailable; it does not overstate third-party Raycast Grid support.
  The picker and its catalog are lazy-loaded, keeping the normal launcher entry
  chunk at about 242 KB instead of adding the full dataset to Command-Space.
- A separate built-in Calculator extension now provides automatic root-search evaluation without a command prefix.
  Its bounded tokenizer and parser never invoke JavaScript evaluation, shell commands, or network services; complete
  arithmetic, percentages, powers, factorials, constants, and common numeric functions produce a dedicated leading
  Calculator card while ordinary search continues underneath. Return copies the answer through the native bridge and
  dismisses the launcher. Bundled settings control automatic detection and maximum decimal precision, with legacy
  state migrated to safe defaults.
- Starting a new query now clears the prior result set synchronously, closing a
  debounce race where an immediate Return could execute the previously rendered
  command before fresh search results arrived.
- Installed and bundled extension commands now expose click-to-record global
  shortcuts. Commander persists them by stable extension-command item ID,
  validates the complete active set with macOS before saving, rejects duplicate
  or system conflicts, restores the last working registrations on failure, and
  dispatches accepted shortcuts through the same daemon execution path as Return.
- Application results with a real source path now start a native AppKit
  `NSDraggingSession` after WebKit's pointer threshold. The pasteboard carries a
  validated file URL and native file icon, preserving normal click execution
  while allowing direct drag-out to Finder-compatible macOS targets.
- Command-shortcut presentation now has an explicit native-to-renderer readiness
  handoff. The AppKit host presents and focuses the panel before dispatching a
  command, protects the lazy command view from transient key-window loss, and
  restores an app-hidden launcher before evaluating toggle state. Search Emoji
  & Symbols therefore remains visible when Command-E is followed immediately by
  typing, and Command-Space recovers Commander in one press even after app hide.
- Emojibase 17 permits either one emoticon or an array of aliases. Commander now
  flattens both shapes into string keywords before indexing, fixing the
  production-only first-character failure where typing `h` attempted Unicode
  normalization on an array and blanked the picker. A top-level renderer error
  boundary also keeps any future view failure visible and reloadable instead of
  masquerading as a native app crash.
- The emoji search field now explicitly disables WebKit spelling,
  autocorrection, and autocapitalization UI so macOS cannot capture arrow-key
  navigation with a correction pill. Emoji matching tolerates bounded edit and
  adjacent-transposition mistakes, while a versioned, validated local model
  records each normalized query/emoji selection as an n+1 count. Logarithmic
  boosts promote learned choices without hiding semantic matches; storage is
  capped at 128 queries and 16 emoji per query and contains no account data.
  The exact-origin WebKit renderer now uses its persistent website-data store
  so learning, recents, and tone survive a complete app quit; credentials
  remain exclusively in the native Keychain bridge.
- Commander now has a portable `System` result kind and a platform-gated
  **macOS System** built-in extension. Its curated global index exposes 39
  System Settings destinations—including Accessibility permissions, Screen &
  System Audio Recording, Full Disk Access, Login Items, Displays, networking,
  input devices, and Spotlight—through validated `x-apple.systempreferences:`
  deep links. The commands automatically participate in search, History,
  Command-K, and per-command global shortcuts; other platforms never receive
  the macOS-only catalog. Stable third-party app deep links can use the same
  provider shape, while arbitrary app-menu indexing remains an explicit future
  Accessibility provider rather than an unsafe static macro.
- Corrected the Rust rank bands so true exact, title-prefix, and contained-title
  matches outrank typo-only filesystem candidates. This keeps destinations such
  as Displays Settings visible above `_displayindex.py` and similar indexed
  files even when the 30-result window is otherwise full.
- Commander now packages a second persistent Rust service for local file,
  folder, and application metadata. It stores paths/names/kinds plus optional
  size and mtime—not contents—in an owner-only SQLite/FTS5 index. The scanner
  inherits parent `.gitignore`, `.git/info/exclude`, and global Git excludes;
  compiles custom wildcard and regex rules before traversal; treats application
  and macOS document/media bundles as opaque; and avoids hydrating dataless File
  Provider folders. A name-only trigram FTS schema keeps large indexes compact,
  migrates the earlier path-token schema transactionally, and uses time-bounded
  coarse-name/path fallbacks only when indexed name candidates have no hit.
- Application roots now refresh from native directory watchers with a five-minute
  reconciliation, replacing the former startup-only snapshot that missed newly
  installed apps. Files/folders reconcile every six hours by default. The
  built-in Commander extension exposes Index All plus separate Apps, Commands,
  Files, and Directories commands; dedicated Search Settings exposes the same
  controls, roots, ignore rules, and status cards.
- Commander now defaults to unlimited entries and includes hidden files. The
  versioned migration removes the former 500,000 default cap while preserving
  future explicit caps; Search Settings exposes a blank-means-Unlimited input
  and the live SQLite/WAL/SHM footprint. A configured cap still commits a
  searchable partial snapshot with an actionable warning. Unlimited scans get
  a bounded 15-minute writer window, while capped scans retain the shorter
  privacy-blocked deadline and prior-snapshot recovery.
- Root and extension-settings search, Raycast Store discovery, apps, built-ins,
  extension commands, and filesystem results now tolerate bounded omissions,
  substitutions, and adjacent transpositions. Executed query/item/action counts
  persist in bounded device-local state; exact-query frequency, global usage,
  and recency apply a capped ranking boost after relaunch without entering cloud
  settings sync.
- Filesystem classification now retains extensionless executables, aliases and
  hard links, file/directory symlinks (including broken links), sockets, FIFOs,
  device nodes, and `.app` bundles outside standard application roots as safe
  metadata-only references. Links remain untraversed and packages remain opaque.
- Search Settings now exposes five persisted machine-resource ceilings:
  scanner threads, parallel directory tasks, open directory handles, total-machine
  CPU share, and resident RAM. The reusable Rust protocol applies the strictest
  concurrency ceiling, sizes its bounded channel and SQLite cache from the RAM
  budget, reports effective/measured usage, and rolls a scan back if RSS crosses
  the configured limit. Low-CPU profiles receive a proportional isolated-writer
  timeout rather than being mistaken for a hung scan.
- The measured balanced default is two traversal workers. CPU duty cycling uses
  process CPU time divided by all logical machine capacity and performs a final
  accounting gate, while lower-frequency RSS sampling keeps the governor off the
  traversal/SQLite hot path. SQLite temporary pages remain memory-backed inside
  the explicit cache/RSS budgets.
- Filesystem schema 3 migrates the FTS update trigger in place and fires it only
  when a filename actually changes. Scheduled generation reconciliation can
  still delete vanished paths without deleting and recreating every unchanged
  trigram row. Status now uses indexed row counts rather than repeated distinct
  scans, retains its last good snapshot across a transient failure, and restarts
  a protocol child after timeout so a pathological query cannot poison later
  searches or status polls.

## Streaming search, native result actions, and window follow-up

- Search now serves newline-delimited cache, catalog, and filesystem phases. The
  renderer keeps the previous result set visible but non-executable until a
  matching cached/live phase arrives, removing both the empty flash and the
  stale-Return race. Result snapshots are private owner-only files with
  configurable enablement, directory, size, expiry, reveal, and clear controls.
- The cache now warms its newest snapshots into a bounded in-memory LRU and
  persists the raw filesystem candidate set beside each final frame. Exact
  repeats return without a disk read; query refinements re-rank the nearest
  compatible cached candidate set while the live index catches up. A cached
  filesystem frame is never replaced by a catalog-only intermediate frame, and
  byte-for-byte-equivalent live results retain their mounted React rows.
- One- and two-character Rust index queries now use the `(kind, name)` prefix
  index with a bounded per-kind candidate read. They no longer perform a
  `%term%` name/path scan over the full filesystem database; trigram substring
  and typo search continues from three characters onward.
- Launcher results are grouped into Apps, Commands, and Files & Folders. Their
  order is draggable in Settings and expressed as a modest rank boost, so an
  exceptionally strong text or learned match can still win. Application rows
  hide the filename suffix while retaining an explicit `.app` badge.
- Filesystem-backed rows gained type-aware right-click menus. Native handlers
  provide open/reveal, Finder-style file copy, path/name copy, recoverable Trash,
  and a separately confirmed permanent delete boundary. Filesystem roots,
  mounted-volume roots, the current home folder, and the running app bundle are
  hard-blocked from both destructive operations.
- Rust index requests now emit correlated per-source progress events without
  changing the single final JSONL response. The reusable Node client exposes an
  optional progress callback, Commander aggregates simultaneous sources, and
  the launcher footer paints the active label and processed/indexed counts.
- Launcher panels now support native pin/unpin state, a configurable global pin
  shortcut, current-display most-recent focus, and multiple independent windows
  from the icon's context menu. Pinned panels leave transient collection
  behavior and do not dismiss on key loss.
- Borderless launcher panels now carry AppKit's native resizable style,
  mode-specific minimum sizes, and panel-level edge-drag handling aligned to
  the visible rounded surface rather than its transparent shadow gutter. Every
  edge and corner can therefore resize the WebKit launcher without restoring
  the opaque outer rectangle. The explicit Open New Window action overrides
  the global default and always creates its new launcher pinned.
- The WebKit canvas remains transparent outside the shaped panel, while the
  actual launcher surface is an isolated solid surface rather than a delayed
  backdrop-filter composition. This preserves the rounded exterior without the
  inner window becoming translucent after focus/compositor changes.
- Extensions now uses the generic **Bundled** label. Emoji & Symbols alone notes
  its Raycast inspiration and exposes a persisted default Return action. The
  default native paste snapshots and restores the prior macOS pasteboard;
  paste-and-copy, copy emoji, and copy Unicode remain explicit alternatives.
- The repository's canonical AI guidance now requires a reasonably chosen
  settings surface for future meaningful features whenever user customization
  is safe and coherent, together with defaults, migration, and tests.

## Commander responsiveness hardening

- Every visible result row can now receive its real Finder icon. Renderer-side
  icon work is coalesced by canonical path, cancellation-aware, and constrained
  by a 512-entry/24 MiB LRU plus two in-flight bridge requests; the selected
  row is prioritized while background rows are briefly debounced.
- The native bridge applies matching path coalescing and cache limits, then
  yields between individual AppKit icon renders. Broad searches therefore keep
  the launcher responsive instead of submitting a main-thread icon burst.
- Application launches are submitted to the native opener rather than executed
  inline in the WebKit message handler. The build verifier covers both a
  healthy launch and a deliberately hanging `/usr/bin/open` helper so a
  blocked Launch Services request cannot beachball Commander.

## Verification

- Commander TypeScript: 134 tests passed across protocol (12), filesystem client
  (3), compatibility (19), UI (59), and daemon (41) packages; typecheck,
  ESLint, Prettier, and package builds passed.
- Rust: 56 tests passed across command search (24 unit + 5 JSONL) and filesystem
  indexing (26 unit + 1 JSONL); formatting and strict Clippy with warnings
  denied passed.
- Swift: thirteen WebKit/panel, resizing, pin-state, settings-deep-link,
  file-drag, and command-hotkey regressions passed; the release build passed
  with warnings treated as errors.
- `Commander/script/build_and_run.sh --verify` built, Apple Development signed,
  installed, and launched the exact follow-up app at
  `~/Applications/Commander.app`.
- The installed signature, stable designated requirement, Node JIT
  entitlements, process ancestry, daemon health, and bundled executable paths
  were verified.
- Installed multi-display WebKit QA showed the launcher on the display containing
  the pointer, with Apps grouped above Files & Folders, a native Commander icon,
  the explicit `.app` badge, a solid inner surface, and only transparent pixels
  outside the rounded panel. The installed Settings window rendered the new
  Search tab alongside the existing sections without clipping.
- On the installed 1.19-million-row index, an exact two-character cache frame
  painted in 14.9 ms and its fresh filesystem frame completed in 67.6 ms; an
  uncached two-character query completed in 81 ms, its repeat cache painted in
  2.4 ms, and a nearest-prefix refinement painted cached candidates in 17.8 ms
  before its 37.8 ms live frame. Direct long-lived Rust queries measured about
  99-122 ms for one- and two-character prefixes and 25 ms for a three-character
  query, replacing the former 2.5-2.7 second full-database short-query scan.
- Physical CoreGraphics pointer QA against the installed signed panel resized
  bottom-right from 780x560 to 875x636, then expanded top-left, top-right, and
  bottom-left with the correct anchored edges. The live launcher remained
  responsive and visually clipped to its rounded solid surface at 1055x756,
  then returned cleanly to 780x560. Compact mode separately resized from
  720x360 to 780x400 through its narrower visible gutter before the saved mode
  was restored to Default. The real footer context menu's Open New Window
  action created a focused launcher whose pin control reported `on` even though
  the original and global default were unpinned.
- Before the unlimited migration, the optimized standalone indexer scanned
  500,000 real home metadata entries in
  15.6–17.0 seconds with the measured two-worker default (versus 21.9 seconds at
  one worker, 16.5 at three, 16.8 at four, and the earlier 29.0-second baseline).
  An unchanged schema-3 reconciliation completed in 12.4 seconds instead of
  rewriting the full trigram index. A separate 100,000-entry stress run held its
  configured whole-machine CPU average at exactly 5%, recorded 4.5 seconds of
  throttling, and stayed below its 512 MiB RAM ceiling. That capped database
  upgraded in place to schema 3, retained all 500,340 records, and committed
  387,797 files and 112,203 directories alongside 340
  applications, checkpointed its WAL to zero, and retained `0600` permissions on
  the database and live sidecars.
- Final unlimited migration indexed 1,191,259 real metadata rows in 51.5 seconds:
  944,242 files, 246,484 directories, and 533 application-source records. The
  database plus live sidecars measured 1,111,007,232 bytes, retained
  `raycast-start` as both its executable file and nested `.app`, and included
  hidden entries. Eight consecutive installed-daemon status polls completed in
  131–187 ms with stable counts and no error; standalone cold-process benchmarks
  completed status in 0.59 s, `nite` fuzzy search in 0.50 s, and a long missing
  query in 1.38 s.
- Installed-WebKit QA rendered the dedicated Search tab top-to-bottom with
  unlimited capacity, hidden files enabled, 1 GB database size, live counts,
  resource usage, and ignore rules without clipping. The launcher ranked Search
  Settings first for `serch setings` and returned both the application and
  executable `raycast-start` results for `raycsat strt` with native icons.
- A separate 129-sample OS audit of the live Rust PID observed exactly two
  traversal workers, no more than two numeric directory handles, and four total
  process threads (main SQLite writer, walker coordinator, and the two workers),
  matching the documented distinction between traversal-worker and mandatory
  process threads.
- Earlier resource-control QA rendered and persisted the measured defaults (2 scanner
  threads, 2 parallel tasks, 16 open folders, 60% CPU, 512 MiB RAM), showed the
  real last-run worker/CPU/RSS/throttle report, visibly entered and exited the
  Apps `Indexing…` state, and remained aligned while scrolling through the final
  ignore/cap warning.
- Installed-WebKit QA opened Search Emoji & Symbols, typed the formerly
  crashing first character `h`, continued to `heart`, and kept the picker
  visible and focused with 46 results before returning to the launcher.
- Installed-WebKit QA typed `ear` without a macOS correction pill, retained
  input focus while Right Arrow moved from Ear to Ear With Hearing Aid, and
  returned 45 relevant results for the transposition typo `haert`. It then
  learned `heart` → Heart With Ribbon, fully quit the native host and daemon,
  relaunched with a new session, and restored Heart With Ribbon as the first
  result for that query.
- Installed-WebKit QA searched `accessibility` in the final signed bundle,
  rendered Accessibility Settings first with the `System` kind, executed it,
  and confirmed System Settings opened the exact Privacy & Security →
  Accessibility permission list without changing a permission.
- Native macOS QA covered physical-key custom-hotkey recording and restoration,
  per-command recording and Delete-clear behavior, and a real Finder-compatible
  file-URL drop of `/Applications/Hermes.app` into an isolated native receiver,
  all three built-in lifecycle commands, complete quit versus window-only hide,
  empty-query reopen, persistent History, and Raycast-driven app relaunch,
  native launcher/Settings drag gestures, search ranking,
  full-query Command-A selection, separate Settings presentation, Command-K
  action navigation/execution, menu focus, and daemon exit after a forced host
  termination.
- The relocated `Commander/extensions/raycast/` extension built with its pinned pnpm 8 lockfile,
  imported in Raycast development mode, and its Open Commander command
  relaunched the fully quit installed app with persisted History and an empty
  focused query.
- Packaged-daemon browser QA listed 23 profile-linked extensions, completed a
  real Text Decorator Add through the sparse official-repository path, changed
  its action to Sync to Commander, completed a second sync, traversed the full
  settings list, and reported no browser warnings or errors. Raw Raycast values
  and Commander session tokens were kept out of the renderer and QA logs.
- Remix desktop OAuth tests passed 6/6; schema tests passed 25/25; targeted lint
  passed; the typecheck ratchet improved from 143 to 138; the production/Vercel
  build passed.
- A final security and release audit found no release blockers, tracked build
  caches, environment files, private keys, credentials, or token patterns.

## Release delivery

- Commander now follows the established Electron release architecture: the
  main-branch listener delegates to a protected GitHub Actions control-plane
  workflow, which builds the native macOS bundle, publishes a ZIP plus SHA-256,
  and creates an idempotent `commander-v<base>+build.<run-number>` release tag.
- `Commander/script/release-version.mjs` keeps the six shipping workspace
  package versions synchronized for reviewed patch/minor/major or explicit
  base-version changes. CI contributes only build metadata; it never commits
  a release-only source change. The bundle now records the base version and
  GitHub build number in `CFBundleShortVersionString` and `CFBundleVersion`.
- Local end-to-end packaging with `COMMANDER_BUILD_NUMBER=42` completed with
  the app reporting `0.1.0 (42)` and passing strict deep code-signature
  verification. The GitHub build intentionally uses ad-hoc signing until
  notarization credentials are configured, and its release notes say so.

## CodeQL follow-up

- Replaced the Raycast regex replacement converter's ordered replacement chain
  with a single-pass escape decoder. Each original supported escape is decoded
  exactly once, unknown escapes remain intact, and focused Vitest coverage now
  guards against backslash double-unescaping.

## Follow-up coverage

- Add database-backed OAuth exchange integration tests for concurrent replay,
  expiry, wrong client/redirect/verifier, and app revocation.
- Implement and validate the Windows and Linux native shells.
- Expand the Raycast API compatibility runtime beyond prebuilt `no-view`
  commands.
- Decide whether the fixed daemon port should move to a negotiated origin while
  preserving strict native-bridge origin pinning.
