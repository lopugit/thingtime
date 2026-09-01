# Thingtime Node for macOS

`ThingtimeNode` is the signed native foundation for making a Mac appear as a
Thingtime mesh node even when the Electron window is closed. It is intentionally
small: a menu-bar/login-agent executable, a reusable Swift core, a bounded local
XPC surface, and a supervised connector subprocess boundary.

## Implemented boundaries

- Device snapshots: name/model/OS/architecture, output volume, session state,
  running applications, active displays, and Accessibility/Screen Recording
  **preflight** state. Startup and status reads never prompt. A separate
  journaled `permissions.request` method is available only through the signed,
  presence-gated bridge after the user presses **Request access**.
- Safe actions: telemetry refresh, output volume, activate a running app, and
  launch an installed app. Remote mutations deny while locked and require an
  explicit approval bit.
- Pairing/key storage: a two-step Ed25519 prepare/complete exchange binds the
  one-use server challenge, node nonce, server nonce, locally generated bearer
  credential, normalized device descriptor, and sorted capabilities into one
  length-prefixed signed claim. Pending key/proof material is saved in Keychain
  before network transmission and can be resumed after a lost response or app
  restart without exposing it to the renderer. This proves claim integrity,
  key continuity, and replay identity; it is not hardware/app attestation.
  Keychain items use `AfterFirstUnlockThisDeviceOnly` in the traditional macOS
  login Keychain. The helper is manually Apple Development/Developer ID signed
  outside Xcode, so it deliberately does not request the Data Protection
  Keychain access group that requires a provisioning-authorized application
  identifier and otherwise fails with `errSecMissingEntitlement` (`-34018`).
- Local IPC: a one-megabyte, sorted-JSON `Data` request/reply protocol over the
  `com.thingtime.desktop.node.xpc` Mach service. Connections must have the same
  effective user and Apple signing team as the node, and match the allowlisted
  client identifiers (`com.thingtime.desktop` and the node itself by default).
- Connector runtime: one explicitly configured absolute executable, no shell,
  explicit arguments/environment, bounded NDJSON frames, request timeouts,
  streamed events, and no automatic restart loop.
- Live desktop chats: the bundled Codex runtime uses `codex app-server` for
  paged session reads, project-scoped creation, queue/steer/interrupt, visible
  deltas, and opaque approvals. Documented semantic Accessibility adapters for
  the allowlisted ChatGPT/Codex and Claude apps can list opaque visible chat
  tokens, read only the already-selected visible transcript, and create/send
  only when the Mac is unlocked and the command carries explicit approval.
  They never read window titles, URLs, positions, private app databases,
  cookies, hidden reasoning, tool payloads, or paths, and never use coordinates,
  AppleScript, a shell, or private APIs.
- HTTPS control plane: `ThingtimeAPIClient` claims a pairing with a locally
  generated bearer credential, posts monotonic complete device/connector
  snapshots, long-polls one leased command, renews its 30-second lease every
  ten seconds during execution, and reports a journaled terminal outcome.
  State-upload failure is isolated from command claim/report; a lease-renewal
  failure reports an uncertain outcome for review rather than stale success. It
  accepts HTTPS plus loopback HTTP for development, uses an ephemeral session,
  rejects cross-origin redirects and oversized responses, and stores the
  credential only in Keychain. Live AI session summaries, transcript pages,
  and closed visible events are queued through a durable exact-retry sync
  journal; completed visible chat text is persisted by the server while
  transient deltas/control events expire separately.
  Ambiguous pairing responses are replayed up to three times inside the one
  locally approved operation. Each retry reuses the same key-bound prepare and
  durable signed complete request; only after the bound is exhausted does the
  node expose `recoverablePairing` for an explicit later resume.
- Endpoint isolation: every canonical deployment origin gets a separate
  Keychain account, command journal, and live-sync journal. Production alone
  migrates the former unscoped credential and retains the legacy production
  journal filenames, preserving in-flight idempotency and live cursors across
  upgrade; selecting a preview cannot reuse or leak that pairing state.
- Menu-bar identity: the status item is artwork-only (with an accessibility
  label) and renders the selected Thingtime tree or full pixel wordmark in
  colour, template, black, white, pink, or blue variants. A custom local image
  is fitted to the status-item canvas without exposing its path remotely.
- View-only capture foundation: ScreenCaptureKit selects a display
  deterministically and emits bounded JPEG frames only after explicit approval,
  unlocked-session validation, and a non-prompting Screen Recording preflight.
  Audio and input injection are disabled; size, frame rate, queue depth, and
  frame bytes are hard-capped with newest-frame backpressure.

The package intentionally does **not** provide arbitrary computer control,
input synthesis, shell execution, or a remote screen media transport. Until an
authenticated peer transport is installed, the web UI must report screen view
as unavailable and must not start capture or invent a stream. No startup or
telemetry path calls a TCC prompting API; permission requests remain an
explicit signed-app user gesture.

## Idempotent command contract

Every mutating node method requires the server's `commandId`. `CommandJournal`
hashes the canonical method/parameters payload and persists its state before
execution:

- the same ID and payload replay the stored terminal outcome;
- the same ID with another payload is rejected;
- a concurrent retry reports `command_in_progress`;
- a node/runtime crash during delivery becomes `command_outcome_uncertain` and
  cannot silently execute again;
- pairing claim/resume is the sole exception: its exact persisted proof and
  credential are explicitly marked crash-retryable, so a committed response
  loss can replay without creating a second device or changing input;
- terminal entries are deterministically evicted from the bounded 4,096-entry
  store, while running/uncertain entries are never evicted.

The journal lives at
`~/Library/Application Support/Thingtime Node/command-journal.json` with mode
`0600`; its directory uses mode `0700`.

## Build and test

```bash
swift test --package-path macos/ThingtimeNode \
  --scratch-path "$HOME/Library/Caches/com.thingtime.desktop.node/swiftpm-tests"

macos/ThingtimeNode/scripts/build-bundle.sh
macos/ThingtimeNode/scripts/build-and-run.sh
```

The scripts build into
`~/Library/Caches/com.thingtime.desktop.node/bundle-stage/Thingtime Node.app`,
select a stable `Apple Development` identity (or the explicit
`THINGTIME_NODE_SIGNING_IDENTITY`), enable hardened runtime, verify the bundle,
and install the verified copy at `~/Applications/Thingtime Node.app`. They do
not fall back to ad-hoc signing. `build-bundle.sh` also derives a complete ICNS
set from the tracked 1024px RGBA `Resources/ThingtimeNodeIcon.png` master and
the bundle declares it as `ThingtimeNode.icns`, giving native prompts a unified
five-node identity: four smaller, widely separated green/brown Thingtime squares
joined through pixel relays to a central pink/red square instead of the generic
application icon. `Resources/ThingtimeNodeIcon.svg` is the deterministic
editable source; only the rendered PNG/ICNS reaches the app, avoiding
fractional SVG join seams at runtime.

For direct distribution, use a `Developer ID Application` identity and notarize
and staple the outer Thingtime bundle. Keep the bundle identifier, signing team,
entitlements, and installed path stable so macOS privacy grants retain a stable
designated requirement.

## Electron embedding

The final Electron bundle should contain:

```text
Thingtime.app/
  Contents/
    Helpers/Thingtime Node.app/
```

The Electron app is authoritative for login registration. After an explicit
user action it writes a marked per-user LaunchAgent with absolute paths to the
installed helper and bundled connector runtime, the canonical selected API
origin, and the selected menu-icon identifier, then registers that file with
`launchctl`. The agent is `RunAtLoad`/`KeepAlive`; the embedded bundle carries
an Electron-managed marker and exits harmlessly when LaunchServices tries to
start it without launchd's private Mach-service environment. This keeps Privacy
& Security **Quit & Reopen** to one node and one menu item. Do not package a
second static LaunchAgent in either application bundle. Sign nested code first,
then sign the outer Electron app with the same leaf certificate. A production
release must update the Electron packaging workflow to include this Swift
build, Developer ID signing, hardened runtime, notarization, and staple
verification.

The standalone bundle includes the equivalent self-relative LaunchAgent plist
so its menu can enable or disable login startup during native development.
