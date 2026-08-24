# Thingtime Electron

This directory packages the existing `remix/` web app, the bounded MCP desktop
runtime, and the signed native macOS Thingtime Node as one desktop application.
It does not duplicate the web source. The deterministic resource build stages:

- the Vite client and Nitro server under `electron/dist/web`;
- `ai-connectors.mjs` and `thingtime-node-runtime.mjs` under `electron/dist/ai`;
- the signed local/production or ad-hoc UNSIGNED `Thingtime Node.app` under
  `electron/dist/native`.

`electron-builder` places the node at
`Thingtime.app/Contents/Helpers/Thingtime Node.app` and the runtime under
`Contents/Resources/ai`. Electron creates the per-user LaunchAgent only after
an explicit confirmed registration action; no second static agent is packaged.

## Commands

From the repository root:

```sh
corepack pnpm@10.12.1 --dir electron install
npm run build-electron
```

Useful direct commands:

```sh
corepack pnpm@10.12.1 --dir electron build:web
corepack pnpm@10.12.1 --dir electron verify:web
corepack pnpm@10.12.1 --dir electron build:native
corepack pnpm@10.12.1 --dir electron verify:native
corepack pnpm@10.12.1 --dir electron test
corepack pnpm@10.12.1 --dir electron dev
corepack pnpm@10.12.1 --dir electron dist
corepack pnpm@10.12.1 --dir electron dist:unsigned
corepack pnpm@10.12.1 --dir electron install:local
```

Use the repository's exact Corepack pin for packaging. The build preflights
that version and gives electron-builder's nested dependency collector an
isolated temporary `pnpm` shim resolving to the same pin, so an unrelated
global pnpm cannot silently change the packaged dependency graph. The shim is
removed after success or failure.

`build:web` runs the Remix/Nitro build with `NITRO_PRESET=node_server`,
materializes `remix/.output` into `electron/dist/web/.output` without external
worktree symlinks, and builds both MCP desktop entry points. `build:native`
builds the SwiftPM helper and one-shot XPC bridge, signs them with the explicit
`THINGTIME_NODE_SIGNING_IDENTITY` or the first available Apple Development
identity, verifies that signature, and stages a clean copy. `verify:web` also
requires the MCP runtime, while `verify:native` checks bundle identifiers,
same-leaf-certificate stable signatures, paths, the Electron-authoritative
login-registration contract, and symlink-free resources.

`build` is the local path. It requires a real Apple Development identity,
builds all resources, asks `electron-builder` to sign the full app with that
same identity and Hardened Runtime, then validates the outer app, nested node,
bridge, bundle identifiers, team identifiers, and designated requirements. It
never falls back to an ad-hoc signature. `install:local` accepts only that
verified build, copies it to `~/Applications/Thingtime.app`, verifies the
installed copy again, registers it with LaunchServices, and asks Spotlight to
index it. If the exact managed Thingtime Node service is registered, installation
stops it before replacement and restarts it only after the installed signature
and executable verify. Any replacement or restart failure restores the prior app
before restoring its service; foreign LaunchAgents and unmanaged node processes
are left untouched. Building does not install or launch the app; installation
remains an explicit separate command.

The dated local signature, designated-requirement, executable-hash, install,
and open acceptance boundaries for PR #68 are recorded in its
[implementation notes](../PRs/68-codex-thingtime-mcp-desktop-connectors--add-consent-first-thingtime-mcp-desktop-chat-bridge.md).

## Runtime

The Electron main process always starts and renders the packaged Nitro/React
build from a private `127.0.0.1` port. Remote deployment profiles are API/data
targets only: the bundled server proxies relative `/api` calls to the selected
origin, and the persistent node uses that same selected origin. A build can
seed an intended preview with `THINGTIME_DESKTOP_DEFAULT_ENDPOINT`; subsequent
selection is persisted by normalized URL (not a build-specific profile ID), so
relaunches, reinstalls, and renamed/removed build metadata cannot silently move
the app back to production. If the API target is offline, the packaged
interface still starts and can present the offline/error state instead of
navigating to a remote UI. External links open with the OS browser. The
renderer keeps `nodeIntegration` disabled and uses a narrow preload bridge for
desktop metadata, validated endpoint settings, and normalized AI source
batches. The bridge never returns provider credentials, cookies, archive
paths, custom-icon paths, or raw app-data roots.

For a local Vite checkout without self-hosted Mongo/JWT configuration, place a
public deployment origin such as
`THINGTIME_API_FALLBACK_ORIGIN=https://preview.example.com` in the ignored
`remix/.env.local`. Only HTTPS origins (or HTTP loopback origins for local
development) are accepted. Packaged Electron sets this value from its validated
desktop settings automatically; no database secret is bundled into the app.

The same origin check protects the local-node bridge. Renderer code gets fixed
operations only: node status, login-service register/unregister, pairing,
non-prompting permission preflight, allowlisted connector operations, and four
safe device action kinds. It cannot choose a native method, executable, shell
command, LaunchAgent field, environment variable, or XPC destination. Every
connector/device mutation carries a caller-provided `commandId`; the native
durable journal rejects conflicting reuse and replays completed results.
Pairing and resume are native-confirmed separately. After an ambiguous response
or renderer restart, status exposes only `recoverablePairing: true`; the signed
node replays its Keychain-held claim through `pairing.resume` without returning
the pairing secret, key, nonce, credential, or proof to web code. The signed
claim provides integrity/key continuity and replay fencing, not platform
attestation.

Electron invokes the signed `ThingtimeNodeBridge` as a bounded one-shot process.
That bridge is the only process that talks to the node's Mach-service XPC
endpoint. The node independently requires the same macOS user, an Apple-generic
signature from the same team, and one of its three exact client bundle IDs.
Requests and replies are capped at 1 MiB and time out; neither bridge uses a
shell, AppleScript, cookies, provider databases, or raw private app stores.

Login registration is always an explicit confirmed user action. Electron writes
a per-user LaunchAgent containing valid ordinary `<key>` fields and absolute
paths into the installed signed app, validates the plist, then calls
`/bin/launchctl` with fixed arguments (never through a shell). Bootstrap is not
followed by an unconditional immediate kickstart. The agent is `RunAtLoad` and
`KeepAlive`, so a Privacy & Security **Quit & Reopen** or crash produces one
launchd-owned replacement. The embedded helper refuses a direct LaunchServices
start unless its private Mach-service marker is present, preventing a second
menu item when macOS relaunches the permission identity. The agent receives the
selected endpoint and menu-icon identifier, plus the Electron executable and
`thingtime-node-runtime.mjs`. The MCP child receives only a small operational
environment allowlist (`PATH`, home/temp/user/locale paths, and `CODEX_HOME`),
plus `ELECTRON_RUN_AS_NODE`; API keys and arbitrary renderer values are never
copied.

The native connector drains its long-lived child pipe incrementally through
`AsyncBytes` instead of waiting for EOF. Each process generation owns its read
tasks, so completion from a canceled stale generation cannot clear or terminate
the replacement child. Approval replay after a web reload exposes only the
opaque/redacted safe projection, never private tool details.

Closing the Electron window still leaves the macOS application process and
registered node available; quitting Thingtime is a distinct action, and the
registered login node remains independently managed until the user turns it
off. The PR #68 installed-app acceptance additionally proves that Cmd+Q stops
Electron while both the launchd node and connector remain running.

Accessibility and Screen Recording remain non-prompting during startup and
status refresh. The settings UI's explicit **Request access** action invokes the
prompting system API in the signed native helper, then opens the exact Privacy &
Security pane and refreshes preflight after the system relaunch cycle. Device
writes are refused while the session is locked, and non-telemetry writes
require an unspoofable native Electron confirmation dialog before the signed
bridge marks them approved.

On macOS, the desktop window uses a hidden native titlebar so the web UI can
occupy the titlebar row. The preload metadata exposes titlebar measurements;
the renderer applies `html.thingtime-electron-desktop` and reserves the traffic
light area before placing the drawer trigger and top nav content. The top nav is
marked draggable, with inputs, links, and buttons marked non-draggable.

The drawer settings modal shows a **Thingtime desktop** section inside the
desktop app. Endpoint profiles are stored locally in a versioned, atomic `0600`
`desktop-settings.json` under Electron's app-data directory. Production,
development, and the build's intended preview are pre-populated; users can add
up to 32 named HTTPS (or loopback HTTP) origins and remove inactive custom
profiles. Switching first probes `/api/v1/devices`, confirms the change, then
updates the renderer and LaunchAgent transactionally; a failed switch restores
both. Credentials, paths, query strings, fragments, and cross-origin redirects
are rejected. The Thingtime application menu mirrors the saved profiles so a
working endpoint remains selectable if a remote renderer is broken.

The same local settings choose the native menu-bar artwork: coloured,
template, black, white, pink, or blue four-square tree; coloured/template/
black/white full pixel wordmark; or one private custom image normalized to a
bounded PNG. Only the chosen public identifier enters the LaunchAgent unless
the custom option is active. The Electron app icon is an Icon Composer
`.icon` bundle whose exact Thingtime canopy/trunk artwork has light and dark
background appearances; electron-builder compiles it during macOS packaging.
The nested `Thingtime Node.app` carries a separate generated ICNS: the four
green/brown Thingtime squares are smaller and separated, with each connected to
a central pink/red mesh square. Native bundle verification requires both that
resource and its `CFBundleIconFile` declaration before the helper can be
embedded.

The same settings surface includes **Thingtime versions & recovery**. It follows
every public GitHub Releases page returned by the API (with loop detection),
searches by SemVer, PR, branch, or commit, and accepts only a GitHub-hosted
macOS `.zip` asset. Before a version can be launched or installed, Thingtime
extracts it into
`~/Library/Application Support/com.thingtime.desktop/release-cache/`,
checks the full nested app for its Developer ID signature, hardened runtime,
notarization staple, exact Thingtime bundle IDs, and matching signed native
node. A failed download or verification never changes the installed app.

**Launch** performs a recovery handoff: it starts a tiny detached helper, quits
the current Thingtime instance, and only then opens the selected cached app, so
two versions never operate the same user data concurrently. **Install** first
caches the presently installed production app, then uses that same handoff to
run the existing atomic installer, restart the managed node only if it was
registered, verify the replacement, and reopen it. That installer restores the
prior app and node if any replacement step fails. The cache keeps up to twelve
explicitly verified bundles; remove an old entry from the UI before adding a
thirteenth. **Reveal cache** makes the recovery folder accessible even if a
future app UI is broken. If GitHub is offline, the settings surface still shows
and permits launch/install of local recovery bundles; only browsing or caching
new remote versions waits for GitHub to return.
Auto-check remains stored at
`thingtime.settings.electron.${sessionHash}AutoUpdateEnabled` and defaults to
on; it is a notification preference, never permission to install silently.

### Standalone Thingtime Recovery

`macos/ThingtimeRecovery` builds **Thingtime Recovery.app**, a small native
SwiftUI application which stays separate from every Electron app version. It
reads the shared desktop cache above, keeps its own verified launcher copies in
`~/Library/Application Support/com.thingtime.desktop/recovery-cache`, and uses
a separately signed helper to wait for the current app to exit before atomically
switching either app. Replacing Thingtime Desktop saves the current verified
desktop bundle first; replacing Recovery saves the current launcher first.

The native app queries public GitHub Releases and distinguishes
`Thingtime-Electron-App-Release-*.zip` from
`Thingtime-Recovery-App-Release-*.zip`; Electron will never mistake a recovery
asset for a desktop update. Build and install the local Apple Development copy
with:

```sh
swift test --package-path macos/ThingtimeRecovery
macos/ThingtimeRecovery/script/build_and_run.sh --verify
```

Production CI passes its imported Developer ID identity and notarization API
key to `macos/ThingtimeRecovery/script/build-production-release.sh`. That
script signs the helper before the outer bundle, notarizes a ZIP, staples the
app, then runs strict codesign, Gatekeeper, and stapler verification before it
emits the companion release ZIP. While those credentials are absent, the
owner-approved PR workflow can call
`macos/ThingtimeRecovery/script/build-unsigned-release.sh`: its output is
ad-hoc signed only, carries `UNSIGNED` in both asset name and SemVer suffix,
and needs explicit macOS approval before first launch.

## GitHub Releases

`.github/workflows/electron-release.yml` is the event-entry shim on `main`. It
runs after a push changing `electron/**`, `MCP/**`, `macos/**`, or the workflow
itself, then delegates without running repository code to the protected
`github-actions` control plane. That protected workflow must
type-check/test/bundle MCP, test and release-build both Swift executables, and
run the Electron bridge tests before packaging. It creates a tag like
`electron-v0.1.0+build.10423`, and attaches the generated `.dmg`, `.zip`, or
`.pkg` assets to a GitHub Release titled `Thingtime Electron App Release
0.1.0+build.10423`.

The trusted production lane is intentionally blocked until the protected
workflow has a **Developer ID Application** certificate and notarization
credentials. Apple Development is correct for stable local TCC testing, and
Apple Distribution is for App Store workflows; neither substitutes for
Developer ID direct distribution. `pnpm --dir electron dist` requires an
imported Developer ID Application identity plus one complete electron-builder
notarization set. It enables Hardened Runtime and `mac.notarize`, then requires
strict signature, Gatekeeper, and stapling validation.

`pnpm --dir electron dist:unsigned` is a separate temporary PR-release command
which requires a version ending in `.unsigned`. It deliberately uses ad-hoc
signatures, no Apple team identity, and no notarization. It must never be
described as a verified update. Thingtime Recovery shows those releases with an
UNSIGNED badge and requires acknowledgement before caching, launching, or
installing one; macOS may still require **Privacy & Security → Open Anyway**.

The protected workflow currently lives on another ref and remains stale, so its
signing change must be made there before publication can resume. The required
control-plane patch is recorded in [PRODUCTION_RELEASE.md](./PRODUCTION_RELEASE.md).
Until that patch and its GitHub secrets exist, release failure is expected and
safer than publishing a TCC-unstable artifact. See electron-builder's official
[macOS notarization](https://www.electron.build/docs/notarization/) and
[macOS signing](https://www.electron.build/docs/features/code-signing/code-signing-mac/)
documentation for the credential contract.

The base version is read from `electron/package.json` and is not changed by CI.
The workflow appends SemVer build metadata from the GitHub Actions run number
for automated builds only. Change the base version in `electron/package.json`
only when a human intentionally asks for a real product version bump. The
packaged app stores the full CI release version in `electron/dist/web/metadata.json`
so the updater can distinguish `0.1.0+build.10423` from `0.1.0+build.10424`
without requiring source-controlled version churn.

The signed **pre-release builder/releaser** is executable only on the protected
`github-actions` branch. `develop` carries a tiny
`.github/workflows/electron-pr-release.yml` listener that passes trusted PR or
manual events to that worker; the product PR itself never supplies signing,
notarization, or publishing code. The central worker revalidates a
same-repository owner PR with the `desktop-release` label, checks out its exact
head SHA without persisting a GitHub credential, tests before loading signing
material, builds both the Electron ZIP and independently signed/notarized
Recovery ZIP, then publishes a GitHub prerelease. Its SemVer includes source
provenance, for example
`0.1.0-pr.68.codex-thingtime-mcp-desktop-connectors.gabcdef123456`. The PR
number, normalized branch, and full commit are also retained in the release
notes. See [PRODUCTION_RELEASE.md](./PRODUCTION_RELEASE.md) for the required
secrets and exact gate.

In local development, the Electron shell loads `remix/.env`, `remix/.env.local`,
and `remix/.env.auto` before starting Nitro so the desktop app sees the same
server-side env as the web dev stack. Do not commit secret-bearing env files.
