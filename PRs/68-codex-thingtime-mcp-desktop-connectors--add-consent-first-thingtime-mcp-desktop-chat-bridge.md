# PR #68 — Add consent-first Thingtime MCP desktop chat bridge

- Branch: `codex/thingtime-mcp-desktop-connectors`
- Pull request: <https://github.com/lopugit/thingtime/pull/68>
- Date: 2026-07-13; platform integration updated 2026-08-21

## Goal

Begin Thingtime's AI-chat interoperability layer with a standalone MCP package
that can accept explicit data from MCP-capable desktop hosts and normalize
user-approved exports from other AI applications, while preparing a safe
relational shape for later ThingtimeDB storage and platform chat views.

## Delivered

- A TypeScript MCP stdio server at `MCP/`, built on the stable v1 MCP SDK.
- Eight tools covering capability discovery, connector listing, archive import,
  current-host-chat handoff, staged-import listing, bounded conversation reads,
  paged Thingtime ingestion previews, and confirmed local deletion.
- Built-in ChatGPT and Claude JSON adapters.
- A versioned `thingtime.ai-desktop-export` manifest for any other application
  to implement without coupling its private storage format to Thingtime.
- A normalized version-1 model for chats, ordered message parts, participants,
  settings, metadata, attachments, files, source identity, and provenance.
- Private staging under `THINGTIME_MCP_STATE_DIR`, with allowlisted filesystem
  reads, symlink-safe canonical path checks, copied attachment bytes, SHA-256
  fingerprints, credential-key redaction, size/count limits, and no implicit
  remote downloads.
- Relational ingestion previews: one `ai-chat` parent record and one
  `ai-chat-message` child record per message.
- Setup, architecture, connector contract, safe workflow, example manifest,
  `.env` placeholders, and root README/changelog pointers.

### 2026-08-17 Messenger + Electron integration

- The packaged Electron app now bundles the desktop normalizer and exposes a
  narrow preload API for source discovery, expiring in-memory sync sessions,
  bounded batch reads, cancellation, and native export selection. The renderer
  never receives an export path or direct filesystem primitive. Build staging
  materializes Nitro dependencies instead of shipping absolute worktree
  symlinks, and local installation signs/verifies the exact self-contained app
  copied to `~/Applications/Thingtime.app`.
- Three independent Mac sources are recognized: ChatGPT Work/Codex local
  history, the main Claude desktop profile, and Claude Thingtime. Official
  ChatGPT/Claude JSON and ZIP exports cover provider history not present in
  local app stores.
- `/api/v1/ai/connections` registers authenticated, rate-limited discovery and
  sync. Projects/workspaces become communities, grouped conversations become
  channels, ungrouped conversations become chats, and imported messages remain
  bounded relational `chat-message` rows.
- Stable source keys are hashed with the authenticated owner. Interrupted and
  repeated batches reuse the same connection, community, chat, membership, and
  message rows; replaying an identical import changes neither row count nor
  account usage.
- Messenger exposes **✦ AI** in both Spaces and Chats modes, progress and
  connection counts, source avatars/badges, and read-only provider rows.
  Thingtime reactions, threads, and replies remain writable without posting
  back to ChatGPT or Claude.
- Every user-owned Messenger and imported-AI row now uses the same exact
  transactional account-storage ledger as posts and other Things. Relationship
  rows are charged to their `ownerId`; attachment object bytes remain separately
  charged on protected attachment Things. Accounting version 2 forces a safe
  idempotent recount of legacy posts, Messenger rows, and attachments.
- Related multi-row mutations are transactional: container plus owner
  membership, message plus receipt/preview/attachment bindings, community
  membership revocation, invite redemption, section removal/reorder, and
  bounded imported-message chunks. A quota error cannot leave an unmetered or
  inaccessible half-write.

### 2026-08-19 persistent mesh node + live sessions

- Protected device, state, connector, command-event, approval, and screen
  session records now back a dedicated `/api/v1/devices` family. Pairing is a
  two-step, nonce-bound Ed25519 exchange: the node persists its pending bearer
  credential and signing key before prepare, the server binds that key to the
  one-use challenge, and complete signs an exact length-prefixed claim. Lost
  responses replay the same proof and credential after a crash. This provides
  integrity, key continuity, and replay fencing—not hardware/app attestation.
  Node bearer credentials are stored hashed server-side, state revisions are
  monotonic, and owner/device identity always comes from authentication rather
  than request fields.
- Connector heartbeats are complete snapshots: a newer revision atomically
  updates present rows and tombstones removals, while stale snapshots are a
  whole-request no-op. Live sync requires the connector revision to equal the
  current device snapshot and to have been observed within two minutes.
- Commands use a closed typed allowlist, owner/device/request-id idempotency,
  random hashed leases, ten-second renewal heartbeats, and durable terminal
  reporting. A failed renewal can never be reported as success; ambiguous work
  becomes `needs-review`, while a rejected billable state upload does not
  strand command claim/report. Volume,
  brightness, app focus/launch/quit, lock, and screen start/stop always require
  server approval; an approval-required command cannot be leased until its
  approval changes it transactionally to queued. Expired ambiguous work becomes
  `needs-review` instead of executing twice.
- The signed macOS menu/login node now has a concrete HTTPS adapter, Keychain
  pairing, bounded telemetry, a journaled connector subprocess, same-user/team
  XPC, and Electron's fixed one-shot bridge. Closing the Electron window does
  not stop the node; the embedded login service is managed separately from app
  Quit and accepts no renderer-selected executable, method, environment, or
  LaunchAgent fields.
- Launch/runtime hardening writes a syntactically valid LaunchAgent plist with
  ordinary `<key>` fields, avoids an unconditional immediate `kickstart` after
  bootstrap, drains the long-lived connector pipe incrementally through
  `AsyncBytes`, and uses a connector-generation guard so a stale canceled read
  cannot tear down its replacement process.
- The Codex connector talks to the documented local app-server protocol for
  session list/read/create, queue/steer/interrupt, visible streaming updates,
  and opaque approvals. A bounded local-history fallback exposes only visible
  user/assistant messages. Project paths remain in a private local registry;
  Thingtime receives only opaque project ids and short labels.
- Semantic Accessibility adapters cover the allowlisted ChatGPT/Codex and
  Claude desktop bundles with exact fail-closed selectors. Only already-visible
  user/assistant content is read; new-chat/send requires an unlocked Mac and
  explicit command approval. Window titles, URLs, coordinates, private app
  stores, reasoning, tools, attachments, shell, and AppleScript are excluded.
- `/things` merges a dedicated cache-first device projection into root/search
  without exposing protected device rows to generic select/copy/move/share or
  delete. The responsive device drawer renders observed versus desired state,
  permissions, apps, connectors, command history, and approvals with capability
  policy enforced before dispatch.
- Messenger now discriminates immutable imported history from live sources.
  Live chat controls reconcile idempotent queue/steer/stop commands and opaque
  approvals, resume bounded cursor events, coalesce visible deltas, and replace
  them with completed relational messages. Approval reload replays only the
  privacy-safe opaque/redacted projection. Session summaries, transcript pages,
  and completed user/assistant text are materialized transactionally and charged
  to the same account-byte ledger as posts. Quota-neutral command/event delivery
  state is byte/count bounded and TTL-expiring; submitted prompt text is redacted
  from command rows once its billed Messenger message is durable.
- A view-only ScreenCaptureKit primitive provides explicit approval, lock and
  TCC preflight gates, deterministic display selection, bounded JPEG frames,
  and newest-frame backpressure with audio/input disabled. No peer media
  transport is claimed: screen UI remains `not installed` until one exists.
- The Electron packaging path embeds and verifies the signed native node,
  bridge, login-agent template, and MCP runtime. Local builds require a stable
  Apple Development identity. Direct distribution remains fail-closed until the
  protected `github-actions` workflow receives Developer ID Application and
  notarization credentials; the exact control-plane patch is recorded under
  `electron/PRODUCTION_RELEASE.md`.

### 2026-08-21 installed-node follow-up

- Electron now owns a versioned, atomic local endpoint-profile store. It seeds
  production, development, and the preview intended by the build; accepts up to
  32 named custom HTTPS/loopback origins; rejects credentials, paths, query
  strings, fragments, and cross-origin redirects; and probes the devices API
  before a confirmed transactional switch. The renderer and LaunchAgent always
  use the same selected origin, while native Keychain credentials and durable
  journals are separately scoped by its canonical hash. Production migrates
  the legacy credential and keeps the legacy production journal files so an
  upgrade cannot forget an in-flight idempotency outcome or live cursor.
- The old plain URL override is removed. The drawer's **Thingtime desktop**
  settings and the native application menu expose the same recoverable endpoint
  choices. Custom profiles remain local and may be added/removed independently;
  neither local endpoint metadata nor custom-icon paths are sent to Thingtime.
- The node status item is now artwork-only and selectable: colour, template,
  black, white, pink, or blue four-square trees; colour/template/black/white
  full pixel wordmarks; or a normalized private custom image. Electron packages
  exact Thingtime canopy/trunk artwork as an Icon Composer `.icon` with light
  and dark background appearances.
- Permission status stays non-prompting during startup and polling. An explicit
  **Request access** action now invokes the signed helper's native Accessibility
  or Screen Recording request, opens the matching system pane, and refreshes
  after focus/relaunch. The helper remains the TCC identity.
- The managed agent is unconditionally `KeepAlive`, while an Electron-managed
  bundle exits when macOS tries to start it outside the private Mach-service
  launch context. This converts Privacy & Security **Quit & Reopen** into one
  launchd-owned replacement instead of duplicate menu items. Pair/resume/unpair
  and permission operations now have one native confirmation and a 120-second
  bridge response window instead of competing confirmations and a 15-second
  timeout.

### 2026-08-23 expanded safe machine controls

- The paired-node command vocabulary now covers mute/unmute; default output,
  input, and system-sound-effect devices; app hide/unhide; Wi-Fi connect to a
  visible saved/open network, disconnect, and radio power. The native snapshot
  reports mute state and a bounded, path-free audio-device list so callers can
  choose a reported device identifier.
- App control now also includes **Hide other apps** in the Applications
  heading menu and **Force quit** in each app's contextual menu. Force quit is
  separately capability-gated and always enters the approval flow, including
  for a paired device configured for routine always-allow controls, because it
  can discard unsaved work.
- Every new mutation remains behind the existing signed pairing capability,
  device command lease, idempotency key, approval state, unlocked-session gate,
  and native action policy. The Electron bridge uses the same closed allowlist.
  Wi-Fi accepts only an SSID—passwords, arbitrary network configuration,
  AppleScript, shell execution, and private frameworks are intentionally
  excluded.
- The device drawer now exposes mute/unmute alongside volume. The authenticated
  device drawer needs a live paired account/device session for end-to-end UI
  exercise; no real Wi-Fi, audio-route, or TCC state was changed during local
  validation.
- The controls now have a deliberately quiet default layout: everyday quick
  controls and applications open first, while Audio & routing, Network &
  connectivity, Power, permissions, and diagnostic sections start collapsed.
  Audio routes use compact menus, per-application actions live in a **More**
  context menu, Wi-Fi accepts only a saved/open SSID, and the only public
  system-power action offered is approval-gated Sleep. Restart and shutdown
  remain intentionally unavailable without shell or AppleScript execution.

### 2026-08-24 consented media-volume follow-up

- Apple Music and Spotify now have distinct, capability-gated app-volume
  commands in addition to their existing fixed play/pause/previous/next
  controls. The only accepted volume input is a finite numeric level from 0
  through 1; the native node converts it to each app's documented 0–100 sound
  volume property. The player must already be running, and every operation
  requires both a fresh Thingtime approval and macOS Automation consent.
- Chrome now has one separate, capability-gated active-tab volume command for
  direct YouTube and YouTube Music pages. It runs one fixed local JavaScript
  expression through Chrome's documented AppleScript command, with no remote
  script, selector, URL, tab ID, browser profile, title, history, media
  metadata, or page content accepted or reported. Chrome must be running, the
  Mac user must enable **Allow JavaScript from Apple Events**, and an active
  tab without a direct media element fails closed. Cross-origin embeds and
  generic browser-player control remain out of scope.
- The node reports only installed/running availability for these three media
  surfaces; it never performs Automation requests while publishing telemetry.

### 2026-08-24 unsigned PR-release fallback

- The protected `github-actions` release worker now chooses a trusted
  Developer ID/notarized lane only when its full six-secret configuration is
  present. When all six are absent it publishes an explicit `.unsigned` PR
  SemVer and `UNSIGNED` Electron/Recovery ZIP names; a partial configuration
  fails before publication.
- The fallback uses ad-hoc signatures solely to keep nested macOS executables
  functioning. It has no Apple team identity or notarization and the release
  notes instruct the user to approve the first launch via **Privacy & Security
  → Open Anyway**.
- Thingtime Recovery recognizes the marker plus asset name, maintains a
  separate UNSIGNED cache status, requires a deliberate acknowledgement, then
  allows cache, launch, and atomic install. The normal signed cache remains
  strict and never presents an unsigned build as verified.
  All three volume effects retain the journalled `needs-review` boundary after
  an Apple Event, rather than claiming the audible result was observed.
- The four paired-device API contracts are now `1.7.0`; Electron refuses to
  activate the desktop control bridge against an older manifest.

### 2026-08-24 consented remote input follow-up

- The node now exposes a closed, individually capability-gated remote-input
  surface: screen-relative pointer move, left/right/middle click, bounded
  pixel scroll, bounded text entry, and an allowlisted keyboard-shortcut set.
  Each command creates a fresh approval even when other device controls use
  always-allow, is denied while the session is locked, and requires macOS
  Accessibility at execution time.
- Input has no generic scripting escape hatch. It neither records keys nor
  accesses the clipboard, Input Monitoring, Full Disk Access, root, shell,
  arbitrary AppleScript, event taps, process input, or browser automation.
  Pointer coordinates are verified against a currently online display and all
  payloads reject unknown fields. Quartz enqueueing is journalled as
  `needs-review` because it cannot independently prove the target app accepted
  the event.
- The device drawer includes a visible Remote pointer and Remote keyboard
  panel. Text is never placed in its idempotency-control key; it is sent only
  as the individually approved command payload.
- The four paired-device API contracts are now `1.8.0`; Electron refuses to
  activate the desktop control bridge against an older manifest. The existing
  screen-session endpoint still persists only lifecycle metadata and explicitly
  rejects frames, screenshots, audio, SDP, ICE, and TURN data. A real live
  screen view awaits a separately selected privacy-preserving peer-to-peer
  transport rather than storing pixels in Thingtime.

### 2026-08-24 display, hardware, and lifecycle controls

- The paired-computer contract now has individually capability-gated controls
  for every active display: mode/resolution/refresh rate, per-display
  brightness, virtual origin/layout, and mirroring. The node reports bounded
  display modes, current layout and read-only HDR state; callers can select
  only ids and modes that the node just advertised.
- The safe hardware surface now includes default-printer selection, preferred
  camera selection, connect/disconnect for already-paired Bluetooth devices,
  connect/disconnect for configured remote-access/VPN services, and a
  per-node no-idle-sleep assertion. Telemetry is bounded and excludes device
  addresses, camera content, network credentials, paths, and provider
  configuration. Bluetooth addresses are one-way digested before leaving the
  Mac.
- Restart, shutdown, and log out are now fixed, argument-free System Events.
  They never run caller-supplied scripts or shell commands; every request
  always opens a fresh approval even when the device otherwise allows routine
  actions. Their result is intentionally recorded as `needs-review`, since a
  correctly accepted lifecycle request can terminate the node before it can
  prove the final OS effect.
- The Device drawer adds **Displays & system hardware** with display mode,
  brightness, origin and mirroring controls, plus compact printer, camera,
  Bluetooth, VPN, and keep-awake controls. The Power menu now makes the
  lifecycle actions visible with the same approval/recovery semantics.
- HDR toggling, Focus modes, AirDrop radio/state, Bluetooth radio power, and
  global media playback remain intentionally absent: current macOS public APIs
  do not offer a supported, scoped setter, and this PR does not substitute
  private frameworks or UI automation. The API capability contracts for
  paired devices, node state, command creation, and command leasing are
  bumped to `1.1.0`.

### 2026-08-24 scoped Apple Music and power-status follow-up

- Paired-node state now reports the public `ProcessInfo` Low Power Mode value
  and the minimum Apple Music availability state (installed/running). Neither
  state is remotely mutable.
- The media surface is intentionally limited to four fixed Apple Music events:
  play, pause, previous, and next. It admits neither generic media commands
  nor an application id, script, queue, library, track, title, history, or any
  other caller-controlled input. Each action has its own pairing capability,
  always opens a new approval, requires macOS Automation consent, and records
  `needs-review` rather than claiming an Apple Event proves external playback.
- Focus modes, AirDrop, Bluetooth radio power, camera-privacy state, HDR
  toggling, Low Power Mode toggling, and global media playback remain omitted:
  current public macOS APIs do not provide a safe, scoped setter. Private
  frameworks and UI automation are not substitutes.
- The four paired-device capability-manifest endpoint contracts are bumped to
  `1.2.0`. Focused device tests (51) and native node tests (106) cover the
  closed input envelopes, mandatory approval, unpaired fail-closed behavior,
  telemetry projection, and Apple Music's no-arbitrary-script boundary.

### 2026-08-24 fixed Spotify playback follow-up

- Spotify is now an equally narrow, app-specific media surface: paired-node
  state reports only installed/running, and the node accepts only fixed play,
  pause, previous, and next events from Spotify's published Mac scripting
  dictionary. It accepts no generic media target, application id, script,
  queue, library, track, title, or history input.
- Each Spotify command has its own capability, always opens a fresh approval,
  requires macOS Automation consent, and resolves as `needs-review` after the
  Apple Event; acceptance cannot prove external playback reached the requested
  state. State normalization, API command validation, UI command construction,
  and native policy tests independently enforce the closed four-operation
  boundary.
- The four paired-device capability-manifest endpoint contracts are bumped to
  `1.3.0`.

### 2026-08-24 persistent idle-timer follow-up

- Paired-node telemetry now reports the three documented IOKit idle timers:
  display dim, system sleep, and disk spindown. The matching command accepts
  exactly one named scope (`display`, `system`, or `disk`) and a whole-minute
  value from 0 (Never) through 180. It cannot carry an arbitrary `pmset` key,
  power profile, shell input, or other control-plane settings.
- Every timer update has its own device capability, always creates a fresh
  approval, uses `IOPMSetAggressiveness`, and reads the exact value back before
  reporting success. A rejected or clamped OS update is fail-closed as a
  policy error rather than claiming a changed setting.
- The four paired-device capability-manifest endpoint contracts are bumped to
  `1.4.0`. Native policy, unpaired-node, telemetry-payload, and device-core
  tests cover strict parameters, fresh approval, no side effect before pairing,
  and the bounded state projection.

### 2026-08-24 user-reviewed AirDrop and camera policy-profile follow-up

- The paired-device surface now exposes two intentionally fixed policy
  proposals: global AirDrop availability and global camera availability. Each
  accepts exactly one `enabled` boolean, has its own signed capability, and
  always receives a fresh approval before the node writes the proposal.
- The node creates only a deterministic `com.apple.applicationaccess`
  configuration profile in its private Application Support proposal directory
  and opens it in macOS’s review flow. It never performs a silent install,
  creates an MDM enrollment, accepts a profile payload/key/identifier from the
  caller, or changes per-app Camera TCC grants. Installing or declining stays
  a local macOS user decision.
- The four paired-device capability-manifest endpoint contracts are bumped to
  `1.5.0`. Native profile-serialization and action-policy tests, unpaired-node
  regression coverage, and device-core validation enforce the closed envelope
  and fail-closed pairing boundary.

### 2026-08-24 persistent resolution and refresh follow-up

- Display mode changes now use `CGConfigureDisplayWithDisplayMode` inside the
  existing permanent Core Graphics configuration transaction. They therefore
  persist across a Thingtime Node restart just like display origin and
  mirroring, while remaining limited to a current node-advertised display and
  mode id. The paired-device manifest contracts are bumped to `1.6.0` for the
  durable side-effect correction, and Electron now refuses to activate its
  device surface against an origin below that declared minimum.

## Security and product boundaries

MCP gives a host a standard way to invoke this server; it does not give the
server universal access to all open desktop chats, application cookies, local
storage, passwords, or settings. The standalone staging package therefore uses
two honest capture paths: explicit current-chat handoff from the host, or an
approved file inside a configured root. Imports and deletes require a literal
`confirmedByUser: true` argument.

The standalone MCP staging tools still do not write the database directly.
ThingtimeDB persistence is enabled only through authenticated Thingtime API
families, so the current Thingtime session or paired-device credential,
membership projections, rate limits, schema registry, storage admission, and
normal API error boundary remain authoritative. Local capture is deliberately
split between explicit staging/import, the documented native Codex app-server
protocol, and exact semantic Accessibility selectors for the already-visible
chat. Discovery filters hidden reasoning, tool calls, internal context,
cookies, credentials, and raw paths; imported provider rows remain read-only.

## Validation

### Automated and build gates (2026-08-21)

- Swift: `swift test --package-path macos/ThingtimeNode` passed 94/94 tests;
  the final real long-lived connector-pipe regression slice passed 10/10. Both
  `ThingtimeNode` and `ThingtimeNodeBridge` passed the release build.
- MCP: typecheck, ordinary build, and `build:desktop` passed; the final suite
  passed 36/36 tests twice sequentially, including Codex app-server, bounded
  local-history fallback, project registry, cancellation, live wire, and
  internal-context redaction coverage.
- Electron: the bridge, registration, verifier, installer, packaging-contract,
  and pinned-package-manager suite passed 47/47 tests. Changed main/preload and
  script files also passed their syntax checks.
- Remix focused coverage passed 181/181 tests: devices 42, Messenger 34,
  storage 9, quota 11, collections 16, schemas 62, Things 6, and rate limiting
  1. The fresh complete `test:unit` gate passed 29 TAP groups / 615 Node tests
     plus its AI model-routing self-test gate.
- The canonical repository-root `npm run build:vercel` passed, including the
  Vite client, Nitro Vercel output, static shell, and filesystem-route verifier.
- Targeted lint over 78 changed feature files reported zero errors and five
  pre-existing `ThingsPage` warnings. The final typecheck ratchet passed with
  135 total errors, down from the repository baseline of 143.
- Disposable MongoDB replica-set proofs passed for quota admission,
  idempotency, rollback, and the prior 64-index migration: posts, Messenger
  content, and persistent device mirrors are account-byte metered; attachments
  remain separately metered; identical replay adds no bytes; failed admission
  leaves no partial related rows. Ephemeral command/event delivery remains
  byte/count bounded and TTL-expiring rather than an unmetered archive.

### Canonical local package and install (2026-08-21)

- `THINGTIME_DESKTOP_DEFAULT_ENDPOINT=https://pr-68.previews.dev.thingtime.com/`
  `THINGTIME_DESKTOP_DEFAULT_ENDPOINT_LABEL='PR #68 preview'`
  `corepack pnpm@10.12.1 --dir electron build` completed with the local Apple
  Development signing mode. Its metadata records exact source head
  `4705ea3cc` and the selected PR #68 deployment. The unpacked app is
  `/Users/lopu/.codex/worktrees/ai-desktop-messenger/thingtime/electron/release/mac-arm64/Thingtime.app`.
- The source bundle passed `codesign --verify --deep --strict` and
  `electron/scripts/verify-signed-app.mjs --mode local`. Its outer identifier is
  `com.thingtime.desktop`, and the outer app and embedded node both resolve to
  team `6DQQ9V7C84`.
- `install:local` atomically installed a byte-identical verified bundle at
  `/Users/lopu/Applications/Thingtime.app`; the installed copy passed the same
  strict and repository verifier checks. Built and installed designated
  requirements matched for the outer app, node, and bridge. Final executable
  SHA-256 values matched between build and install:
  `1f9cba2b161934fcf83bddbe63c5f91f52b5c7189a90ca3e05e76c523c24e18a`
  (outer), `1d7ad9245605868e3ffc87dbd8a5fc2d98b32b82b28d4df61f17de99c8d4b505`
  (node), and
  `6d7e85417783b7ae0006482ac09d10417371cd6b021edf7eba66caa3234ae883`
  (bridge). The packaged ASAR also matched at
  `9182230f6529ebeba37ca015a8a5797039b142be8e0ad7ea9a0004b81c649cfa`;
  the packaged endpoint metadata matched at
  `d5eeb4eccf331714704f20ee1a6f663a273c331f58d5669c676043ef72c55137`.
- The installed app opened the PR #68 origin and its devices route returned an
  authenticated `401` JSON response instead of the former `404`. Its settings
  showed production, development, and PR #68 endpoint choices plus the full
  built-in icon list. Switching colour tree -> pink -> colour tree reconciled
  the LaunchAgent each time with exactly one image-only menu item.
- Cmd+Q removed Electron while node PID 76406 remained. Terminating that exact
  managed helper then produced one launchd replacement, PID 78050; a direct
  LaunchServices start of the embedded helper exited without creating a second
  node or menu item. After Electron relaunched, the exact installed node,
  connector, and Electron processes remained singular for more than six
  minutes and the LaunchAgent retained the PR #68 API origin.
- A signed-renderer permission read returned Accessibility `authorized` and
  Screen Recording `denied` without prompting. This proves status is read from
  the helper's live TCC identity rather than hard-coded denied; the denied grant
  was deliberately not changed or reset.

### Desktop titlebar and drawer acceptance (2026-08-22)

- The installed Apple Development-signed app was exercised against the current
  local renderer. Direct renderer measurements confirmed the draggable region
  ends at the 52px titlebar background (`z-index: 10130`), while the inactive
  Commander host at y=60..108 is explicitly `no-drag`; that former overlap was
  the cause of Lopu notification text and the close control becoming difficult
  to select or hover. Lopu surfaces now compute to `no-drag`/`user-select: text`,
  and the close target is 28x28px with a pointer cursor.
- The installed titlebar rendered drawer, Back, Forward, home, search, then the
  signed-in account on the left. Both history controls navigated a real
  `/things/Content` -> `/` -> `/things/Content` sequence. With the drawer under
  the pointer its panel rose to `z-index: 10120`, remained below the 10130
  titlebar, and hit-testing still resolved the titlebar controls. The menu's
  extra Electron top padding is zero and the collapsed hover surface uses the
  same 10px top and side gutter.
- Browser acceptance covered the open and closed drawer at exactly 390 CSS px,
  including a complete scroll through the footer. Document and body widths
  stayed equal to the viewport with no horizontal overflow. The ordinary web
  nav retained its existing right-side Login placement; the history controls
  and left-side account placement remain Electron-only.
- Focused lint completed with no errors (only the existing Lopu/useDrawer
  warnings), the Vite client build passed, Electron tests passed 47/47, and the
  canonical local Electron package/install flow passed strict signing checks.
  The temporary local renderer endpoint used for this acceptance was removed
  from desktop settings afterward.

### Multi-account pairing and menu follow-up (2026-08-22)

- Pairing links remain short-lived and single-use, but the native credential
  store is now a versioned Keychain vault retaining up to 32 independent
  account/device credentials per canonical endpoint. The legacy single value
  migrates in place. One account can still own many separately paired computer
  rows, while one Mac now starts an isolated authenticated scheduler, lease
  renewer, heartbeat, and device-bound live-sync journal for every retained
  account. Connector events are copied only into those explicitly paired
  account scopes; opaque device IDs let `/things` identify whether the current
  account is already connected without exposing credentials.
- Pair/resume now fail before claim when the renderer origin differs from the
  node's configured origin, and the public load-URL path reconciles the selected
  endpoint instead of silently moving only the renderer. Ordinary native and
  Electron errors are preserved in the bounded Lopu toast rather than collapsed
  into “Try again from Thingtime Desktop.” The setup card distinguishes
  “paired elsewhere” from “paired to this account” and explains that every link
  is one-use even though both sides support multiple relationships.
- Fresh desktop settings and native fallbacks now select the pink four-square
  menu icon; existing choices remain untouched. Full wordmarks use a sealed,
  tightly cropped PNG at 86x16pt instead of reconstructing fractional SVG
  rectangles, removing join seams and excess vertical/outer whitespace. The
  status menu uses Thingtime-only copy, exposes separate Restart and Quit
  commands, and managed Quit boots out the LaunchAgent so KeepAlive cannot
  immediately respawn it.
- Installed-app acceptance used the current local renderer, then restored and
  removed that temporary endpoint. The signed titlebar showed drawer, Back,
  Forward, home, search, account, and notifications in that order; Back/Forward
  traversed `/` and `/things`; the focused/open drawer stayed beneath the
  controls with even top/side spacing; an animated Lopu toast allowed visible
  drag-selection of its description and its close control dismissed it. The
  restored production settings and LaunchAgent report `https://thingtime.com/`
  plus `tree-pink`.
- A fresh canonical package after the final status-menu copy contract passed
  deep/strict signing and `verify-signed-app.mjs --mode local`, then
  `install:local` atomically replaced and reverified the exact
  `/Users/lopu/Applications/Thingtime.app`. The installed outer, node, bridge,
  and ASAR SHA-256 values are respectively
  `9e12509ace5ba93a608f945bb17355137889e15c1e595b4cebe43a31a8445332`,
  `457e68c51123dc8427412f99f3b49273b4ec971b151aa3a5cfe65e15a1c0d805`,
  `6915c2106f4aaf354e513541041043c6dd7800f53539a74463c1fbcd1d3a6a25`,
  and `cafa07acc0bb841893f44146f41793e4f319b2744c2fdb3b6941580a971df21`.
  The installed LaunchAgent restarted once at PID 49687 from the exact helper,
  retained `https://thingtime.com/` and `tree-pink`, and the relaunched outer
  app rendered that production origin.
- Automated coverage proves two independent credentials survive pairing on one
  Mac and that the normalized Electron status retains both device IDs. A real
  second-account pairing was deliberately not performed during this pass: it
  creates a durable relationship and remains an explicit user acceptance step.

### Bundled-renderer endpoint persistence follow-up (2026-08-22)

- The Electron window now always renders the packaged Thingtime web build from
  its private loopback server. Production, development, PR-preview, and custom
  desktop endpoints are API and Thingtime Node targets only; they are no longer
  eligible renderer origins. Remote links still open in the user's browser.
  This corrects the earlier behavior where the installed bundle hosted a local
  fallback but `BrowserWindow.loadURL()` immediately replaced it with the
  selected remote deployment.
- Desktop settings schema 2 persists the selected endpoint's canonical URL and
  label as well as its build-generated ID. Schema 1 migrates while its metadata
  is available, and the selected URL remains authoritative if a later build
  omits or renames the profile ID. Malformed or unsafe targets continue to fail
  closed. The bundled Nitro and local Vite servers read the selected target
  dynamically and only accept HTTPS or loopback HTTP origins.
- Real installed-app acceptance selected PR #68 and confirmed the window stayed
  at `127.0.0.1` while a local `/api/v1/devices?limit=1` response carried
  `x-thingtime-api-fallback: https://pr-68.previews.dev.thingtime.com`. The
  preview's separate logged-out session rendered `Login` as expected; no
  production cookie or account session was copied between deployments.
- The same saved PR #68 target and local renderer survived a renderer reload,
  a full Cmd+Q/relaunch, and a second atomic reinstall of the verified app. The
  private renderer port changed across launches (`62236`, `62957`, `63005`,
  `64242`),
  proving the persisted setting is independent of that ephemeral local port.
  Browser acceptance scrolled the local development page top-to-bottom at
  1280px with document width equal to the viewport and no horizontal overflow.
- A canonical Apple Development build with PR #68 embedded as its default
  passed deep/strict signing and the repository local verifier, then
  `install:local` reverified the source, temporary destination, and exact
  `/Users/lopu/Applications/Thingtime.app`. Built and installed SHA-256 values
  matched: `659fc07569aa644d75a154989c1fba54b37174ad0cdecd0d25338bd3e47b279c`
  (outer executable),
  `cd3255f4c688f512b79dde3f57fa35884eeda2341e6535454686e3943714c935`
  (node), `9f9af3b6353805731f2aab4070b60f48a35308172d6171d66ef9535a4aa932b7`
  (bridge), `96c21523e17e949d878351716713afa7bde13315d6770a631cef89f1c006667f`
  (ASAR), and
  `88ecee30eb896ac803467ce22faab3103970aa7d7b58823c441a6cc38148e93b`
  (web metadata). Metadata records source head `a644f5182`, build time
  `2026-08-22T04:57:47.526Z`, and the URL-stable PR #68 profile.
- Regression coverage is Electron 51/51, root-data/API-fallback 4/4, and device
  42/42. The architectural Electron test asserts settings and API target setup
  happen before the bundled server starts, `createWindow()` receives no remote
  URL, and all renderer loads use the local app origin. API tests additionally
  prove that same-host/different-loopback-port traffic still proxies correctly.

The packaged interface therefore opens without network access, including its
last locally available shell and assets. Account reads, mutations, pairing, and
sync still require a reachable selected API target; this change does not claim
an offline database or offline conflict resolution layer.

### Pairing reconciliation and node app icon follow-up (2026-08-22)

- The installed pairing failure was local and deterministic, not a lost server
  response: `KeychainDeviceCredentialStore` opted into the Data Protection
  Keychain, but this manually Apple Development/Developer ID signed helper has
  no provisioning-authorized application identifier/access group. Security
  returned `errSecMissingEntitlement` (`-34018`) before prepare was sent. The
  credential vault now uses the encrypted traditional macOS login Keychain with
  `AfterFirstUnlockThisDeviceOnly`, which a same-identity signed probe proved can
  create/read/delete successfully. A local Keychain failure is now definitive
  `credential_store_unavailable`, makes no network request, and cannot be
  mislabeled as an unconfirmed remote response.
- The native controller now treats an ambiguous pairing response as the
  replayable protocol state it already is: within the single approved XPC
  operation it makes at most three attempts, reusing the prepared proof and
  exact durable signed complete request. A first lost response therefore
  reconciles without another native dialog or duplicate device row. Three
  consecutive ambiguous outcomes still reset the journal to retryable and
  retain the Keychain pending claim for `pairing.resume`; a later definitive
  4xx clears it as before.
- The `/things` local-node hook now refreshes status after an action failure.
  When the native pending record is recoverable, the card immediately changes
  to **Resume pairing** and the toast explains that the exact request is saved,
  instead of leaving a stale **Pair this account** control beside the raw IPC
  error.
- `Thingtime Node.app` now has its own deterministic SVG design source and
  1024px RGBA package master: the original three green canopy squares and brown
  trunk square are smaller and more widely separated, with cardinal stems and
  relay pixels joining each to a central pink/red hub. The bundle uses only the
  rendered PNG/ICNS at runtime, avoiding SVG join seams. The bundle build
  derives the full ICNS size set, declares
  `CFBundleIconFile`, and the native packaging verifier plus Electron contract
  test fail if either the resource or declaration disappears.
- Follow-up source validation is green: Swift `97/97` and its production build,
  including regressions for the entitlement-free Keychain query and definitive
  local-failure classification. Electron passed `52/52`; device server/UI
  passed `42/42`, along with focused ESLint and Prettier and the typecheck
  ratchet at `135` errors versus its `143` baseline with no changed-file
  diagnostic. The
  canonical Apple Development package passed native-resource verification and
  deep/strict signing, then installed atomically at
  `~/Applications/Thingtime.app`. Installed hashes are outer executable
  `70b958dd1b25aa13fd092447fe15a113530c5c861456d2b8de2b4889682b41ec`,
  node executable
  `5fc0f17b45117cb36fcf4a33a4ca3bb4cbbbb4f6faa5e5406d21f46cf2b4ff1c`,
  and node ICNS
  `5af230ec606212ba34b613e7b001713e62bec8a94ef747000be118d906d2867e`.
  Built and installed hashes match exactly. Metadata records source head
  `dfa5743f5`, build time `2026-08-22T08:25:11.395Z`, and the PR #68 API
  target while the renderer stays on private loopback.
  The relaunched window rendered from loopback `127.0.0.1`, `/things` reached
  **Ready to pair**, and launchd ran the exact installed helper as PID `13037`.
  No live pairing was performed automatically because accepting it creates a
  durable account-to-computer relationship.

### Paired-node optimistic UI, drawer, reload, and auto-start follow-up (2026-08-22)

- The local node card now separates harmless background status refresh from
  mutations. A known paired badge and every unrelated control remain rendered
  while a small green spinner reports the refresh; only the exact action in
  flight owns a busy state. Pure presentation and hook regressions cover paired
  refresh, per-action pending keys, overlapping-refresh fencing, and the
  always-available **Add Codex project** control.
- Device and Messenger detail drawers now place their complete Chakra portal
  container above the dim overlay, not only the inner drawer panel. The exact
  installed `/things?device=c5afb0b6-9e79-497e-807b-aef761ef3a1b` view opened
  the online `lopu’s MacBook Pro (2)` drawer, exposed its controls above the
  overlay, accepted a real pointer click on Close, and returned to the live
  grid. Destructive device controls were deliberately not invoked.
- Nitro now seals the built React index as a server asset, so its catch-all can
  serve the packaged client shell without depending on a mutable source-tree
  file. A staged Nitro proof returned HTTP 200 and the React root for both `/`
  and `/things?device=reload-proof`. In the signed installed app, Cmd+R on the
  real paired device deep link stayed at private loopback port `53346`, restored
  the drawer, and never displayed `Client app has not been built yet.`
- Desktop settings schema 3 adds **Auto-start node on Thingtime launch**, on by
  default. It only restarts a service that already has an Electron-managed
  LaunchAgent plist; it never installs a never-enabled node. The installed
  Settings modal showed the switch enabled. An exact `launchctl bootout`
  matching the native menu's **Quit Thingtime** implementation removed the
  running service while preserving the managed plist hash
  `359ce0eb4933b6dbcfa8862c3f5a50dbe4f007d8e0ae87584c55556c185ee46a`.
  After the desktop process fully exited, reopening the exact installed app
  restored one and only one node process at PID `48869`, from
  `/Users/lopu/Applications/Thingtime.app/Contents/Helpers/Thingtime Node.app/Contents/MacOS/ThingtimeNode`.
- Final focused source validation is Electron `56/56`, devices `45/45`, and
  Messenger `34/34`; focused ESLint, Node syntax, `build:web`, `verify:web`,
  the staged Nitro deep-link proof, and the typecheck ratchet (`135` versus the
  `143` baseline, with no changed-file diagnostic) all pass. The isolated
  canonical build passed deep/strict signing and both local and runtime
  repository verifiers with Team ID `6DQQ9V7C84`, then `install:local`
  reverified the temporary and final copies at
  `/Users/lopu/Applications/Thingtime.app`. Built and installed hashes match:
  `62e8c1ab56da722049ee0bca2d040b480982cd7b491b7520939e82af81b9e79c`
  (outer executable),
  `f3416f5570e0dd95faa67002fb15a7a4d5912f65227c0917c9f2468e80b66bf1`
  (ASAR),
  `c534b762d63ebf9f15b0296c555e37616e8ec610f5332e49c0d56dfcff773f22`
  (node), and
  `ac9e44ea6ab1662101c7d74881b34d14e2913c99e2555efbeac8c6fe22f4d0c5`
  (bridge).

### Resizable and collapsible device drawer follow-up (2026-08-22)

- The device drawer surface, its enlarged 44px close control, resize separator,
  and disclosure buttons are explicit Electron `no-drag` regions. This keeps
  them interactive even when the portal overlaps the native title-bar drag
  band. After installed-app feedback showed that the original half-outside,
  hover-only edge was too difficult to discover and hit, the desktop drawer now
  keeps a 24px pointer-captured resize target wholly inside the panel and shows
  a persistent centred grip. It remains bounded to 420–900px and the available
  viewport, supports keyboard resizing and a double-click reset, and leaves
  mobile full width without a resize handle.
- Node, observed state, applications, connectors, screen, approvals, and
  command activity are independently accessible disclosure sections. Each
  control exposes its current expanded state and associated panel without
  closing or blocking the rest of the drawer.
- The exact signed installed app at `/Users/lopu/Applications/Thingtime.app`
  reopened the authenticated online `lopu’s MacBook Pro (2)` drawer. A real
  pointer click on **Close device details** dismissed it. After reopening, all
  seven sections collapsed and reopened independently. Real left-edge drags
  changed the accessible drawer width from 560px to 432px and then to 573px;
  double-click restored 560px. After the visible-grip follow-up, the exact
  rebuilt installed app exposed the persistent grip and 24px in-panel target;
  real drags changed its splitter from 560px to 435px and then to 703px, and a
  double-click again restored 560px. No device mutation was invoked.
- **2026-08-23 correction:** the earlier splitter-only proof did not establish
  visible resizing. Chromium emitted `pointerdown` followed by compatibility
  `mousedown`, and the second handler replaced the active pointer id; once that
  was removed, Chakra's inline full-width drawer style still visually masked
  valid state changes. The final implementation uses one window-level pointer
  stream and an authoritative responsive width. In the exact rebuilt and
  installed app, the drawer opened at a visibly measured 560px and a real drag
  moved both its splitter and left panel boundary to the 420px minimum. The
  before/after boundary moved by 140px.
- **2026-08-23 mobile follow-up:** the mobile-only early return, hidden handle,
  and forced `width: 100%` have been removed. Narrow viewports now open at the
  available width and retain the same pointer/keyboard resize behavior down to
  a 280px mobile-safe minimum (or the viewport itself below that). The 24px
  in-panel hit target remains, but it renders only the slim edge line—no dotted
  grip pill. The rebuilt signed installed app visually confirmed the pill is
  gone and a real edge drag still moved the visible desktop panel from 560px to
  420px; deterministic 390px layout coverage confirms 390px → 330px → 280px
  clamping without overflow. Exact installed 390px pointer acceptance remains
  a manual check because the active Electron window could not be narrowed by

### Per-account/device action preference follow-up (2026-08-23)

- Every account/computer pairing now defaults to **Always allow**, including
  older stored pairs that do not yet carry a preference field. The softly green
  paired-account badge reflects that healthy connection without implying a
  repeated approval requirement.
- The device drawer exposes **Always allow**, **Ask every time**, and **Deny**.
  The preference is durably scoped to the owning account and selected computer;
  it is optimistically reflected in the cached device projection and enforced
  transactionally before a device command is queued. Ask every time preserves
  the existing command-approval lifecycle, while Deny rejects future remote
  commands. Pairing integrity, connector freshness/capability, an active
  unlocked desktop session, and macOS privacy permission checks remain
  independent fail-closed gates in every preference.
  the available UI automation surface.

### Per-machine drawer layout and web Commander follow-up (2026-08-23)

- The device-details drawer now keeps a deliberately small, local-only
  preference keyed by the paired device ID: its eight disclosure states and
  chosen width. Closing/reopening the drawer, switching computers, and a
  browser refresh recover that computer's own layout without persisting any
  device telemetry, approvals, command input/output, messages, or paths.
- Browser chrome now uses the same 52px bar and 36px control grid as the
  drawer trigger, removing the previous content-height offset between the
  drawer and home/account/notification controls. The global Commander trigger
  is no longer Electron-only; it remains a desktop-width web control and uses
  the existing `openSearch` Commander state transition.
- Focused validation: device tests `51/51`, nav chrome test `1/1`, targeted
  ESLint clean, client build, typecheck ratchet (`135`, below its `143`
  baseline), and a fresh signed local Electron bundle at
  `electron/release/mac-arm64/Thingtime.app`. The in-app Browser reached local
  `/things` with the correct `[LC] Thingtime` title but returned an empty
  accessibility snapshot, so authenticated visual click/geometry acceptance
  remains a manual pre-merge check rather than claimed automated proof.
- Final focused validation is devices `49/49`, Electron `56/56`, and the
  typecheck ratchet at `136` errors versus its `143` baseline. The canonical
  build and installed copy both pass deep/strict code-signing verification with
  Team ID `6DQQ9V7C84`. Their outer executable hashes match at
  `7d2374ee9b29000b321e5b8338dfeada87614e10de29736da2f0df9b8aedcd58`,
  and their ASAR hashes match at
  `f3416f5570e0dd95faa67002fb15a7a4d5912f65227c0917c9f2468e80b66bf1`.
  The final packaged and installed responsive renderer asset
  `index-CMT9dIqL.js` matches at
  `afe6e5365b08736a720dbfa6a3c717a2a49d3bc67ca507bcce5833c93cd57d7a`.

### Deployment peer discovery follow-up (2026-08-24)

- `/api/v1/peers` establishes a bounded first-party deployment gossip protocol.
  Each active deployment is a separate `deploymentPeers` TTL lease; peer
  discovery is HMAC-authenticated with method/path/timestamp/raw-body binding,
  streams cursor-paginated NDJSON, and limits every sync to a small
  breadth-first budget. The fixed production origin is the bootstrap seed, but
  each trusted peer shares its own known peers, so later syncs converge without
  a central all-peers list or fan-out storm.
- Required fork-safe configuration is documented with placeholders only:
  `THINGTIME_PEER_DISCOVERY_SECRET`, a persistent
  `THINGTIME_PEER_SIGNING_PRIVATE_KEY`, `THINGTIME_PUBLIC_ORIGIN`, optional
  bootstrap origin, and an explicit first-party hostname suffix allowlist.
  HMAC admits only mesh members while Ed25519 signatures give each request and
  streamed peer event a public-verification layer; public keys pin to origins
  and unexpected rotation fails closed. Anonymous callers, stale signatures,
  loopback/non-first-party origins, unbounded responses, and arbitrary outbound
  targets fail closed.
- The production bootstrap also advances the mesh with a five-minute
  `CRON_SECRET`-protected `/api/v1/peers/sync` schedule. Previews and other
  platforms use the same bounded endpoint from an equivalent trusted deploy
  hook or scheduler; no peer credential is ever shipped to a client.

### Endpoint compatibility follow-up (2026-08-23)

- `/api/v1/capabilities` is a public, origin-scoped generated contract
  manifest. It emits independently versioned `api.*` semantic features from
  the API-doc registry and `route.*` entries from the live route map, so every
  executable endpoint—including intentionally undocumented diagnostics—is
  discoverable without exposing account or environment data. Electron ships a
  small requirement map for only the capabilities it uses; it accepts
  compatible minor/patch changes, rejects a missing or breaking feature, and
  retains the previous `/api/v1/devices` probe only for older deployments that
  return a manifest 404.
- The Electron main process now treats the selected remote deployment and its
  bundled loopback proxy as a single compatibility contract. It accepts a
  signed-out `401` or `403` from `/api/v1/devices` as proof that the protected
  route exists, requires JSON for successful responses, and rejects missing,
  redirected, unreachable, or cross-origin endpoints.
- Startup, endpoint selection, manual retry, and node registration all run the
  check. A direct route must be compatible _and_ the packaged proxy must
  identify the exact selected fallback origin before Electron can reconcile or
  register the managed node. A delayed preview remains visibly selected and
  reports its incompatible state instead of silently appearing as production.
- Settings now shows a non-blocking compatibility line with **Check now**;
  unrelated settings stay interactive during the check. Focused probe tests
  cover authenticated route acceptance, an arbitrary-success rejection, stale
  proxy mismatch, bad URL rejection, and a real local `401` test endpoint.

### Acceptance boundaries still open

- The user explicitly completed one authenticated current-branch pairing before
  this follow-up, and the final installed acceptance observed that account and
  its online device without creating, removing, or rotating any relationship or
  Keychain credential. Desktop device-drawer open/close, reload, edge resizing,
  and every disclosure section are now real account-level proof. A
  second-account pairing, destructive device commands, live remote chat
  queue/steer/interrupt/approval flows, and the device drawer at 390 CSS px
  remain manual acceptance; automated coverage is not represented as proof of
  those unperformed operations.
- Accessibility and Screen Recording paths were validated for non-prompting,
  fail-closed preflight and bounded behavior, but no TCC toggle was automated.
  A real protected Accessibility focus/read and ScreenCaptureKit capture still
  require the user to grant the exact installed signed app and then run the
  checklist. The system-lock mutation was not invoked during validation.
- Screen work is foundation only. No peer media transport is installed, so the
  product correctly renders screen sharing as `not installed` and exposes no
  synthetic or remotely playable stream.
- This is a local Apple Development build, not a production-distribution
  artifact; Gatekeeper rejection is expected. No Developer ID Application
  identity is installed locally, and notarization/stapling were not attempted.
  The protected `github-actions` release workflow is still stale and production
  remains blocked until it receives the documented Developer ID/notarization
  patch and credentials; see `electron/PRODUCTION_RELEASE.md`.

## Follow-up slices

1. Complete authenticated installed-app pairing and desktop/mobile acceptance,
   then perform real TCC-protected operations only after the user grants the
   exact installed signed app.
2. Add explicit disconnect/delete-local-copy controls and source retention
   policy once product semantics are chosen.
3. Add object-backed import of provider-export attachments after each export
   format exposes stable, verifiable file references.
4. Install and validate a real peer media transport before enabling any screen
   stream UI; keep capture foundation unavailable until then.
5. Merge the dedicated protected builder/releaser and thin `develop` listener,
   configure their Developer ID/notarization secrets, then validate a stapled
   Gatekeeper-accepted artifact before production publication.

### Signed PR release and recovery updater follow-up (2026-08-24)

- The signed PR builder/releaser is intentionally delivered as a separate
  `github-actions` control-plane change, not executable code in this product
  PR. A thin `develop` listener forwards only trusted lifecycle/manual events;
  the protected worker revalidates the same-repository owner plus
  `desktop-release` gate, checks out its immutable head SHA without retaining a
  GitHub write token, tests before importing secrets, and publishes the
  deterministic SemVer form `base-pr.<PR>.<branch>.g<commit>` as a GitHub
  prerelease.
- Desktop Settings now fetches and filters GitHub releases by version, PR,
  branch, and commit. It treats a release as installable only after extracting
  a GitHub-hosted macOS ZIP to the user-local recovery cache and re-verifying
  the production nested signature, hardened runtime, and notarization.
- A cached release launches through a detached handoff only after the current
  Thingtime process exits, so two versions cannot share one local profile at
  once. Installing first caches the current installed production bundle, then
  delegates to the existing transactional installer after the Electron process
  exits. The cache is intentionally bounded to twelve explicit recovery apps
  and can be revealed in Finder, so a broken future updater UI does not strand
  a person on that version.

### Recovery updater verification follow-up (2026-08-24)

- Release browsing now follows every GitHub API Link page rather than stopping
  at 2,000 records. A loop is reported visibly instead of silently omitting
  history. Download redirects stay on GitHub-controlled release hosts, and a
  stale/tampered manifest entry cannot exhaust the twelve recovery slots or
  leave a partial verified-app directory behind. GitHub outage state preserves
  the local cache catalog so launch/install recovery actions remain usable
  offline.
- The earlier branch-local candidate release worker was exercised manually for
  this branch. Owner manual run
  `32712878513` reached its real dependency gate and exposed a concrete
  runner-only defect before any signing material was accessed: `MCP/` is
  npm-managed and has `package-lock.json`, so a frozen pnpm install could never
  succeed. The workflow now uses `npm ci --prefix MCP`; its contract test locks
  that package-manager boundary before the next signed release attempt. A
  second run then spent more than five minutes in its unnecessary full-history
  checkout, so the exact resolved SHA now uses `fetch-depth: 1`; this shortens
  the gate without widening the selected source or signing authority.
- The first complete unsigned native build on the GitHub macOS SDK then exposed
  `PMPrinterGetID`/`PMPrinterGetName` as unretained Core Foundation references,
  unlike the local overlay that had masked the issue. Printer telemetry and
  selection now normalize Swift, Core Foundation, and unmanaged Core Foundation
  string declarations through the Core Foundation Get rule before comparison.
- That next runner exercised an existing scheduler-test race: a fixed dispatch
  sleep sometimes yielded only two renewal ticks under GitHub's scheduler. The
  test now holds dispatch until all three intended renewals arrive (with a
  bounded timeout), then confirms renewal stops after completion; it no longer
  treats a wall-clock assumption as correctness.
- The following runner then exposed a second genuine test-gate race: the
  deliberately unavailable local Codex stub could close its stdin between the
  transport writable check and an asynchronous write, emitting an unhandled
  `EPIPE`. The JSONL transport now consumes that stream error for the life of
  the child pipe and fails all pending work with the existing closed connector
  error, so teardown never crashes the node host.
- Run `32716251316` passed every unsigned MCP, native, and Electron test on the
  GitHub macOS runner, then stopped at the intentional credential boundary.
  Repository and relevant environment secret listings contain none of the
  required values, so the job received empty `MAC_CSC_LINK`,
  `MAC_CSC_KEY_PASSWORD`, `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID`,
  `APPLE_API_ISSUER`, and `APPLE_TEAM_ID` inputs. The release is therefore
  correctly blocked before an unsigned or unnotarized artifact can be built;
  configuring those six repository secrets plus merging the dedicated
  control-plane worker/listener split are the remaining release prerequisites.

### Independent Recovery launcher follow-up (2026-08-24)

- Added `macos/ThingtimeRecovery`, a native SwiftUI `Thingtime Recovery.app`
  with stable identifier `com.thingtime.desktop.recovery`. It can query the
  public GitHub release catalog, cache separately named Desktop and Recovery
  ZIPs, browse the local cache without GitHub, launch an old desktop bundle,
  atomically install a selected desktop version, and update itself without
  loading an Electron app.
- Desktop rollback entries are now held at the stable shared location
  `~/Library/Application Support/com.thingtime.desktop/release-cache`; recovery
  launcher entries live beside it in `recovery-cache`. The Electron main
  process carries a regular legacy per-userData cache forward non-destructively
  the first time it reaches the new shared location. Electron deliberately
  rejects `Thingtime-Recovery-App-Release-*.zip` as a desktop update asset.
- The signed native installer only accepts strict cache layouts, regular
  directories, the expected bundle identifier, and the same signing team. A
  production Recovery app adds Developer ID, Gatekeeper, and notarization-staple
  requirements. It asks the running target app to quit, retains the replaced
  verified bundle before atomic replacement, and leaves the target unchanged on
  verification or handoff failure.
- Local acceptance built the app in a clean Library/Caches stage, signed both
  nested installer and outer app with the stable Apple Development requirement,
  installed and re-verified `~/Applications/Thingtime Recovery.app`, inspected
  its release/cached-recovery UI, deliberately rejected an invalid historical
  GitHub desktop asset, and completed an actual signed Recovery self-replace /
  relaunch. Production publication remains correctly blocked on the existing
  Developer ID + notarization credential prerequisite.

### Unsigned Recovery handoff audit (2026-08-24)

- The unsigned catalog/cache UI already exposed explicitly acknowledged
  `UNSIGNED` assets, but the detached Recovery installer unconditionally used
  signed-team verification. That made an ad-hoc release cacheable yet unable to
  launch or install—a broken fallback path.
- The installer now resolves the selected app back to its constrained cache
  manifest and derives the trust lane from `isUnsigned`; callers cannot supply
  their own unsigned flag. An unsigned Recovery launcher can therefore verify
  and launch/install only explicitly marked ad-hoc bundles. A missing legacy
  marker remains strict signed behavior and fails closed when the unsigned
  launcher has no team identity. Replaced bundles are classified and cached in
  their matching lane before an atomic replacement.
- The Electron detached handoff also repeats its production Developer ID,
  notarization, and nested-code verification after the main process exits and
  immediately before either a cached launch or install. This is separate from
  the explicitly opt-in unsigned native Recovery lane.
- Verified locally with 78 Electron tests and 9 Recovery-core tests, including
  a real ad-hoc app fixture that launches via the detached unsigned Recovery
  path and a regression proving a missing `isUnsigned` marker cannot downgrade
  verification. A fresh release-mode unsigned Recovery ZIP round-trip also
  passed. A live GitHub unsigned release requires the still-open protected
  control-plane PR #390 to merge before the release worker can publish one.
- The first full Electron unsigned build also revealed that electron-builder's
  implicit macOS target produced a DMG but no updater ZIP. `electron/package.json`
  now explicitly requests both `dmg` and `zip`, with a contract test that locks
  the rollback artifact in place. The final local release-mode artifacts both
  verified independently at version
  `0.1.0-pr.68.updater.g2048de7d6262.unsigned`.

### Index-budget consolidation follow-up (2026-08-28)

- Lopu's repository review correctly found the merged lineage at 62/64 Things
  indexes, violating this PR's own four-slot safe-upgrade invariant. The five
  new uniqueness families for AI connections, imported communities/chats/
  messages, and device idempotency now share the existing protected root
  `uniqueKeys` multikey index as domain-prefixed Binary values. The complete
  home plan is 57/64 without weakening the guard.
- Existing preview rows are upgraded before their obsolete indexes are
  retired. New writes stamp root keys atomically, exact/batched reads prefer
  those indexed keys, and crystal fallbacks keep an interrupted pre-upgrade row
  recoverable. Device documents no longer add the redundant
  `crystal.deviceUniqueKeys` plaintext array.
- The migration is home-only. Custom data endpoints receive the additive
  current index set but are no longer scanned, rewritten, or stripped of
  historical index names owned by their users.
- Validation: collections 19/19, devices 52/52, messenger 41/41, the complete
  unit battery, targeted ESLint, and the production/Vercel build all pass. A
  live worktree server also passes auth 22/22 (cold service-account creation
  128 ms) and Things 31/31 API groups; the imported-AI and device entry routes
  are present and auth-guarded.
