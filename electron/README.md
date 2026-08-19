# Thingtime Electron

This directory packages the existing `remix/` web app, the bounded MCP desktop
runtime, and the signed native macOS Thingtime Node as one desktop application.
It does not duplicate the web source. The deterministic resource build stages:

- the Vite client and Nitro server under `electron/dist/web`;
- `ai-connectors.mjs` and `thingtime-node-runtime.mjs` under `electron/dist/ai`;
- the signed `Thingtime Node.app` under `electron/dist/native`.

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

The Electron main process starts the bundled Nitro server on a free
`127.0.0.1` port and opens the desktop window to that local origin. External
links are opened with the OS browser unless the user has explicitly switched
the desktop window to that URL's origin. The renderer keeps `nodeIntegration`
disabled and uses a narrow preload bridge for desktop metadata, validated URL
switching, and normalized AI source batches. AI discovery and reads accept only
the bundled app, Thingtime production/dev, or an exact comma-separated origin
supplied through `THINGTIME_DESKTOP_AI_TRUSTED_ORIGINS` for an intentional local
test. The bridge never returns provider credentials, cookies, archive paths, or
raw app-data roots.

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
followed by an unconditional immediate kickstart. The agent launches the
embedded node and gives it the Electron executable plus
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

Accessibility and Screen Recording are preflight-only here. No startup path,
renderer call, or login-agent action prompts for TCC permission. Device writes
are refused while the session is locked, and non-telemetry writes require an
unspoofable native Electron confirmation dialog before the signed bridge marks
them approved.

On macOS, the desktop window uses a hidden native titlebar so the web UI can
occupy the titlebar row. The preload metadata exposes titlebar measurements;
the renderer applies `html.thingtime-electron-desktop` and reserves the traffic
light area before placing the drawer trigger and top nav content. The top nav is
marked draggable, with inputs, links, and buttons marked non-draggable.

The drawer settings modal shows an **Electron** section inside the desktop app.
It writes the selected destination to
`thingtime.settings.electron.${sessionHash}URL`, where `sessionHash` is derived
from Electron's app data path for this install. Blank/unset means "use the
bundled local app". The app also exposes a Thingtime menu with **Load Bundled
App** and **Load Production** entries so users can recover if they load a URL
that does not include the switcher UI.

The same settings surface includes an **Updates** section. Auto-check is stored
at `thingtime.settings.electron.${sessionHash}AutoUpdateEnabled` and defaults to
on. The current build checks recent GitHub releases for one named or describing
`Electron App Release`, then downloads the best matching app bundle asset from
that release into `~/Downloads`. Prefer release assets with names or labels that
include `Electron App Release`, `Thingtime`, `Electron`, and a macOS bundle
extension such as `.dmg`, `.zip`, or `.pkg`.

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

Production publication is intentionally blocked until the protected workflow
has a **Developer ID Application** certificate and notarization credentials.
Apple Development is correct for stable local TCC testing, and Apple
Distribution is for App Store workflows; neither substitutes for Developer ID
direct distribution; Gatekeeper rejection is expected for the local Apple
Development build. `pnpm --dir electron dist` requires an imported Developer
ID Application identity plus one complete electron-builder notarization set
(App Store Connect API key, Apple ID app-specific password, or a keychain
profile). It enables Hardened Runtime and `mac.notarize`, then requires strict
signature, Gatekeeper, and stapling validation. There is no unsigned/ad-hoc
release command.

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

In local development, the Electron shell loads `remix/.env`, `remix/.env.local`,
and `remix/.env.auto` before starting Nitro so the desktop app sees the same
server-side env as the web dev stack. Do not commit secret-bearing env files.
