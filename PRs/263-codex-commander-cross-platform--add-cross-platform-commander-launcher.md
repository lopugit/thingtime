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
- Extensions Settings now separates Commander-owned **Bundled Raycast Commands**
  from imported extensions. The first bundled equivalent is Emoji & Symbols:
  semantic Unicode/CLDR search, an eight-column keyboard grid, categories, skin
  tones, local recents, copy/Unicode actions, and native paste-back to the app
  that was active before Commander opened. The picker uses MIT-licensed
  Emojibase data and reports a clipboard-only fallback when macOS Accessibility
  trust is unavailable; it does not overstate third-party Raycast Grid support.
  The picker and its catalog are lazy-loaded, keeping the normal launcher entry
  chunk at about 242 KB instead of adding the full dataset to Command-Space.
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

## Verification

- Commander TypeScript: 83 tests passed across UI (46), daemon (19), and
  compatibility (18) packages; typecheck, ESLint, Prettier, and package builds
  passed.
- Rust: 21 unit and 5 JSONL integration tests passed; formatting and strict
  Clippy with warnings denied passed.
- Swift: nine WebKit/panel, settings-deep-link, file-drag, and command-hotkey
  regressions passed; the release build passed with warnings treated as errors.
- `Commander/script/build_and_run.sh --verify` built, Apple Development signed,
  installed, and launched the exact follow-up app at
  `~/Applications/Commander.app`.
- The installed signature, stable designated requirement, Node JIT
  entitlements, process ancestry, daemon health, and bundled executable paths
  were verified.
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

## Follow-up coverage

- Add database-backed OAuth exchange integration tests for concurrent replay,
  expiry, wrong client/redirect/verifier, and app revocation.
- Implement and validate the Windows and Linux native shells.
- Expand the Raycast API compatibility runtime beyond prebuilt `no-view`
  commands.
- Decide whether the fixed daemon port should move to a negotiated origin while
  preserving strict native-bridge origin pinning.
