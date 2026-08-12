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
- Added Raycast Store discovery plus bounded folder and ZIP sideload handling.

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

Full `@raycast/api` view reconciliation, List/Grid/Detail/Form components,
preferences, storage, OAuth providers, menu-bar commands, and integrated source
build consent remain follow-up work. Worker threads constrain lifetime and heap
size; they are not an operating-system permission sandbox.

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

## Verification

- Commander TypeScript: 28 tests passed across UI, daemon, and compatibility
  packages; typecheck, ESLint, Prettier, and package builds passed.
- Rust: 21 unit and 5 JSONL integration tests passed; formatting and strict
  Clippy with warnings denied passed.
- Swift: release build passed with warnings treated as errors.
- `Commander/script/build_and_run.sh --verify` built, signed, installed, and
  launched the exact app at `~/Applications/Commander.app`.
- The installed signature, stable designated requirement, Node JIT
  entitlements, process ancestry, daemon health, and bundled executable paths
  were verified.
- Native macOS QA covered global custom-hotkey activation, search ranking,
  separate Settings presentation, Command-K action navigation/execution, menu
  focus, and daemon exit after a forced host termination.
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
