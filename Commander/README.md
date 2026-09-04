# Thingtime Commander

Commander is a fast, keyboard-first desktop launcher for macOS, Windows, and Linux. The current milestone ships
and validates the macOS host while keeping all product UI, business logic, extension infrastructure, and search
portable from day one.

## What works in this milestone

- global Commander shortcut on macOS (defaults to Command-Space; customizable in Settings);
- typo-tolerant fuzzy application, command, extension, file, folder, and Store search with deterministic Rust
  ranking plus bounded device-local preference learning from the result a user actually chooses;
- disk-backed last-known-result caching and incremental search streaming, so a new query keeps useful prior results
  visible until live application, command, file, and folder matches arrive;
- grouped Apps, Commands, and Files & Folders sections with draggable category priority, a modest default app boost,
  native file icons, compact `.app` badges, and learned/text relevance that can still overcome the preferred order;
- an automatic, bounded expression evaluator that recognizes complete arithmetic directly in the root search field,
  leads with a dedicated Calculator result, keeps ordinary results underneath, and copies the answer with Return;
- automatic application-directory watching with five-minute reconciliation, configurable six-hour file/folder
  refresh, and built-in Index Now, Index Apps, Index Commands, Index Files, and Index Directories commands;
- inherited `.gitignore`/Git excludes plus user-defined wildcard and regular-expression ignore rules, editable with
  index roots, an optional entry cap, and live database size/status in dedicated Search Settings;
- unlimited filesystem entries and hidden files by default, including metadata-only references for executables,
  symlinks, special Unix file types, packages, and app bundles found outside standard application folders;
- reusable machine-resource controls for indexer threads, parallel work, open-directory handles, CPU share, and RAM,
  with transactional memory-limit rollback and measured per-run usage;
- per-command global shortcuts with click-to-record bindings in Extensions Settings, native conflict validation,
  and rollback to the previously working shortcut set;
- arrow-key selection, Return execution, Escape dismissal, and Command-K actions;
- type-aware right-click menus, including Finder reveal, file copy, path/name copy, recoverable Trash, and confirmed
  permanent delete actions for filesystem-backed results;
- searchable Commander Settings results with tab-aware deep links into the separate native settings window;
- a dedicated Activity settings tab that samples Commander host/daemon CPU, memory, storage, process count, plus
  local Mac CPU, best-effort system GPU, memory, thermal state, and filesystem capacity without uploading metrics;
- a Raycast-shaped built-in Commander extension with separate quit, hide-window, and open-window commands;
- a Bundled Commands catalog led by a Commander-native Search Emoji & Symbols picker inspired by Raycast, with
  semantic search, categories, skin tones, recents, keyboard navigation, configurable Return actions, and
  paste-back that restores the user's previous clipboard;
- launcher queries clear on every reopen while private, device-local search sessions remain available in a first
  History section, led by the newest command launched from each search and followed by its search term as a separate
  top-level result;
- launch-at-login, menu-bar icon, favourites-in-compact-mode, window mode, appearance, and text-size preferences;
- draggable native launcher and Settings chrome plus physical-key shortcut recording for modified macOS keys;
- optional pinned launcher windows, a configurable pin shortcut, per-display recent-window focus, and a native
  Open New Window action for keeping multiple independent Commander searches available;
- Finder-compatible drag-out from application/file search results using validated native file URLs, so a result can
  be dropped into Terminal, Finder, System Settings, or another macOS file target without browsing for it again;
- installed extension management, safe folder/ZIP sideloading with opt-in source builds, live Store browsing, and a
  macOS Your Raycast view that can add public sources or sync manifest-declared non-password preferences;
- timeout- and memory-bounded extension workers plus an explicit Raycast compatibility capability registry;
- Thingtime desktop OAuth/PKCE, multi-account UI, Keychain token storage, account switching, and private app-data
  settings sync;
- Swift/AppKit/WKWebView macOS host; C#/.NET 8/WPF/WebView2 Windows host boundary; Linux host contract;
- persistent Rust command-search and filesystem-index processes with stable cross-platform JSON-lines protocols.

## Compatibility promise

Commander targets **source compatibility** with Raycast extensions. It reads `package.json` and `extension.json`,
inspects conventional source/build entries, and can run an extension-authored build only after explicit consent.
Raycast’s private Store archive and host-RPC formats are undocumented, so binary compatibility is neither safe nor
promised. A complete Commander-owned `@raycast/api` render/runtime shim is still roadmap work.

The current runtime imports manifests and executes compatible prebuilt `no-view` commands inside bounded workers.
Workers contain crashes, hangs, and JavaScript heap growth but are not an OS permissions sandbox.
The Your Raycast importer never opens Raycast's encrypted database or Keychain: it discovers profile-linked
metadata from the exported preference domain and copies only manifest-declared non-password values. The view-command
React reconciler is not complete yet. Commander reports this as partial compatibility rather than claiming imported
metadata equals working compatibility. The exact matrix and roadmap are in
[`docs/RAYCAST_COMPATIBILITY.md`](docs/RAYCAST_COMPATIBILITY.md).

Commander-owned equivalents of Raycast commands that have no importable extension package appear separately under
**Extensions → Bundled**. Search Emoji & Symbols is a Commander-native command inspired by Raycast's picker. Its
searchable Unicode/CLDR catalog is powered by [Emojibase](https://emojibase.dev/) data under the MIT license, while
its view, actions, recents, and native paste behavior are implemented by Commander. Calculator is a separate bundled
extension that safely parses arithmetic without JavaScript evaluation or a command prefix; its card controls
automatic detection and maximum displayed decimal precision. The complete attribution is bundled with every app
build and tracked in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Architecture

The complete runtime diagram, trust boundaries, IPC contract, process budgets, and Raycast 2.0 design rationale are
in [`ARCHITECTURE.md`](ARCHITECTURE.md). The high-level stack is:

- React + TypeScript shared UI;
- one long-lived Node 22 daemon;
- persistent Rust command-search and standalone SQLite/FTS5 filesystem-index processes;
- Swift/AppKit + WKWebView on macOS;
- C#/.NET 8 + WPF + WebView2 on Windows;
- the same native bridge contract for Linux.

## Build and run on macOS

Requirements: macOS 14+, Xcode command-line tools, Node 22+, pnpm, and Rust 1.75+.

```bash
cd Commander
corepack pnpm install --frozen-lockfile
./script/build_and_run.sh --verify
```

The script builds the TypeScript workspaces and both Rust crates, builds the Swift host, stages and signs
`dist/Commander.app`, embeds a checksum-pinned Node 22 runtime, installs it to
`~/Applications/Commander.app`, launches that exact copy, and verifies the signed host owns the reported daemon
process and health endpoint. The daemon also watches its native parent so a forced host exit cannot leave port 47820
occupied by an orphaned service.

The Codex Run button is wired through `.codex/environments/environment.toml` to the same script.

### macOS signing policy

Normal Commander builds are direct-distribution builds. The script automatically selects an installed
`Developer ID Application` identity and uses a secure timestamp. It deliberately fails before touching the
currently installed app when that identity is unavailable: `Apple Development` is for local/TCC testing and
`Apple Distribution` is for App Store delivery; neither is a substitute for Developer ID distribution.

For an explicitly local-only iteration, use `COMMANDER_SIGNING_MODE=development ./script/build_and_run.sh --verify`.
That path is not a distributable Gatekeeper build. `COMMANDER_SIGNING_IDENTITY` may select a specific identity,
but distribution mode accepts only a `Developer ID Application` identity. Public downloads additionally need
Apple notarization credentials configured outside this repository; a valid Developer ID signature alone is not
a notarization ticket. Local distribution builds use the Keychain profile named `Commander Notarization` by default,
submit a ZIP with `notarytool`, staple the accepted ticket, and only then replace `~/Applications/Commander.app`.
Set `COMMANDER_NOTARY_PROFILE` to use another Keychain profile. The GitHub release workflow uses
`COMMANDER_NOTARIZATION_MODE=external` because it submits with its short-lived CI API-key credentials instead.

## GitHub Releases

`.github/workflows/commander-release.yml` follows the native Electron release
pattern. A qualifying `main` push, or an explicit dispatch, builds Commander on
macOS and publishes a GitHub Release with a ZIP of `Commander.app` plus a
SHA-256 checksum. Each release gets a monotonic SemVer build suffix and tag,
such as `commander-v0.1.0+build.10423`; the app stores `0.1.0` as its marketing
version and `10423` as its macOS build number.

The base version is deliberately human-controlled and shared by every
Commander workspace. Check it with `corepack pnpm version:check`; intentionally
bump it in a normal reviewed change with one of:

```bash
corepack pnpm version:bump -- patch
corepack pnpm version:bump -- minor
corepack pnpm version:bump -- major
corepack pnpm version:bump -- 1.2.3
```

The workflow's build metadata never writes back to source, so repeat builds are
uniquely versioned without noisy release-only commits. GitHub-hosted builds are
ad-hoc signed until an Apple Developer certificate and notarization credentials
are deliberately configured; the release notes make that trust boundary clear.

## Thingtime setup

Commander uses the real Thingtime API; it never reads the database directly.

Commander ships with its public Thingtime client registration for the exact loopback origin
`http://127.0.0.1:47820` and its native callback
`com.thingtime.commander://oauth/callback`. The latter is registered as an exact native redirect URI
(not a web origin), so the user signs in with their normal browser session and the browser hands the
one-time PKCE response straight back to Commander. The login requests `profile.username` and
`app-data`; Advanced settings retain a client-ID override for another Thingtime deployment.

The browser login uses authorization code + PKCE. Access tokens are saved only through the native credential bridge:
Keychain on macOS, Credential Manager on Windows, and Secret Service on Linux. Sync data is stored privately under
the app-data key `commander.settings.v1`.

The bundled client ID is public by design. Tokens, passwords, and other credentials never belong in this repository.

Whole-home filesystem indexing on macOS requires Full Disk Access for Commander. Search → Search Index links
directly to the system pane; without that permission, use explicitly allowed folders as roots. Unlimited scans get
a bounded 15-minute writer window; a custom-capped scan normally stops a blocked writer after 90 seconds, keeps the
prior committed snapshot searchable, and reports actionable guidance. Deliberately constraining a capped indexer
below 25% CPU extends that shorter deadline proportionally, up to 15 minutes.

The launcher footer replaces its idle status with the current source label and live processed/indexed count during
a scan. Search settings also expose the result-section order and a private cache policy: enable/disable, maximum
size, expiry, custom cache-directory override, reveal, and clear. Cache files contain result metadata only, use
owner-only permissions, and are never included in Thingtime cloud settings sync. Commander warms recent snapshots
into a bounded in-memory tier and re-ranks cached filesystem candidates while a refined live query completes. When
the input changes, it clears the prior query's rows first, so stale matches are never presented as results for the
new query.
Live trigram search has no pre-ranking candidate-count ceiling: every matching FTS row is scored, while only the
best requested results stay resident in memory. The indexer reader runs the active query plus only the latest queued
refinement, so rapid typing cannot build a stale backlog of uncapped searches.

## Raycast companion command

The existing Raycast extension now lives with Commander at `extensions/raycast/`. It preserves all of its legacy
image tools and includes an `Open Commander` no-view command at `extensions/raycast/src/openCommander.ts`. Build it
with its pinned pnpm 8 toolchain, then run the development command once to import it into Raycast:

```bash
corepack pnpm@8.15.9 --dir extensions/raycast install --frozen-lockfile
corepack pnpm@8.15.9 --dir extensions/raycast build
corepack pnpm@8.15.9 --dir extensions/raycast dev
```

After Raycast imports the extension, the development process can stop and the command remains available. It opens
the installed app by bundle identifier, so it can relaunch Commander after `Close Commander` has quit the host and
daemon. Recent launcher searches stay local to Commander's daemon state and are intentionally excluded from cloud
settings sync. The launcher shows the eight newest search sessions initially; Show More expands the retained local
history, and each session keeps up to eight de-duplicated commands for direct replay.

## Verification

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
cargo fmt --check --manifest-path crates/commander-core/Cargo.toml
cargo test --manifest-path crates/commander-core/Cargo.toml
cargo fmt --check --manifest-path crates/commander-indexer/Cargo.toml
cargo test --manifest-path crates/commander-indexer/Cargo.toml
swift build --package-path hosts/macos
./script/build_and_run.sh --verify
```

Windows and Linux compile/runtime testing is deliberately deferred, as requested. Their shared layers are covered
by the TypeScript and Rust checks; their native shells remain explicitly unverified.
