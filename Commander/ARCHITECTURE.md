# Commander architecture

Commander is a keyboard-first desktop command launcher built as a shared product with thin native shells.
The architecture intentionally follows the Raycast 2.0 direction without coupling product logic to one OS.

## Runtime map

```mermaid
flowchart LR
  UI["React + TypeScript UI"] <--> D["Long-lived Node daemon"]
  D <--> R["Rust search core"]
  UI <--> P["Typed native bridge"]
  P --> M["Swift/AppKit macOS shell"]
  P --> W["C#/WebView2 Windows shell"]
  P --> L["Linux WebKit shell"]
  D <--> T["Thingtime OAuth + app-data API"]
  D <--> E["Raycast compatibility workers"]
```

- **React/TypeScript** owns the launcher, actions palette, settings, extensions, and accounts UI.
- **Node.js** is the long-lived local control plane. It owns indexing, extension lifecycle, the loopback API,
  settings persistence, platform discovery adapters, and Thingtime sync requests.
- **Rust** owns deterministic, low-latency fuzzy search over the shared JSON-lines protocol. It builds for
  macOS, Windows, and Linux from one crate.
- **Swift/AppKit/WebKit** is the shipping macOS shell. It owns global shortcuts, native windows, the menu bar,
  launch-at-login, Keychain, file panels, application launching, activation, and lifecycle.
- **C#/.NET 8 + WPF/WebView2** is the Windows shell boundary. Its project and bridge contract live in `hosts/windows` so
  Windows support is implementation work, not an architectural rewrite.
- **Linux** uses the same daemon, UI, Rust binary, and bridge messages. Its host boundary is documented in
  `hosts/linux`; native integration can use WebKitGTK with a small Rust or C# shell.

## Trust boundaries

The daemon listens only on loopback and generates separate high-entropy UI and native tokens at each launch. Native
WebViews receive it in their initial URL; every mutation request requires it. Extension code executes in a
separate, bounded Node worker and never receives Thingtime credentials or the native bridge directly. Worker
threads contain lifecycle, crashes, timeouts, and JavaScript heap pressure; because they retain Node process
permissions, they are explicitly not an OS security sandbox.

Thingtime bearer tokens are credentials. The macOS shell persists them in Keychain under `{issuer, clientId,
userId}`. React is token-blind: a separate native-only daemon capability claims fresh tokens and unlocks saved ones
without returning bearer material to the renderer. The daemon never writes credentials to disk or logs request
authorization headers. Windows maps the same calls to Credential Manager; Linux should use Secret Service.

## One protocol

`packages/protocol` is the source contract for daemon, UI, Rust-facing models, and native bridge messages. The
shipping Swift bridge and the C# implementation contract mirror the same named methods; code generation and schema
conformance tests are the next portability gate. OS differences stop at that boundary. Per-command shortcut maps
and file drag requests cross this boundary as stable command IDs and absolute paths; only the native host registers
system hotkeys or constructs file-URL dragging sessions.

## Process lifecycle

1. The native host starts the bundled Node daemon on Commander's fixed loopback callback port and passes the bundled UI and Rust binary paths.
2. The daemon prints one JSON `ready` line containing the fixed callback port plus separate UI/native tokens.
3. The host creates the launcher and settings WebViews from that URL.
4. The daemon stays alive for the host lifetime; the host terminates the child process on exit.
5. Search requests stream through the persistent Rust child process, avoiding per-keystroke process startup.

The shared frontend builds separate entry points for Launcher and Settings. Settings is always a separate native
window. DOM overlays are acceptable only while they stay inside the launcher; platform popovers, action panels,
and tooltips move to native child windows when they need to escape bounds or preserve native focus semantics.

The launcher WebView stays warm between invocations and native compact/default mode changes resize the panel in
place. This keeps repeated global-shortcut presentation fast while preserving a separate settings window.

## IPC contract

| Link                  | Transport                                        | Required semantics                                                                                |
| --------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| React to native shell | WKWebView message handler / WebView2 postMessage | Correlation ID, 10-second timeout, bounded JSON values, one response per request                  |
| React to Node         | Authenticated loopback HTTP                      | Loopback only, per-launch 256-bit token, 1 MiB mutation cap, no-store responses                   |
| Native shell to Node  | Framed stdio handshake and process supervision   | Protocol version gate, ready deadline, one bounded restart, crash surfaced to UI                  |
| Node to Rust          | Persistent JSON-lines stdio                      | Ordered requests/responses, structured error envelope, 64 MiB request cap, timeout/fallback       |
| Node to extension     | Worker messages                                  | Completion/error envelope, execution timeout, 128 MiB old-generation heap cap, forced termination |

The loopback UI-to-Node connection is an intentional Commander divergence from Raycast's primarily stdio topology:
it lets all three system WebViews reuse ordinary fetch without exposing a non-loopback listener. The native shell
still owns daemon supervision and capability negotiation.

## Extension render protocol

Each loaded extension command runs in its own `worker_threads` V8 isolate with a 128 MiB old-generation cap,
independent event loop, ephemeral instance ID, and explicit unload lifecycle. `@raycast/api` React components are
not mounted as untrusted DOM. A custom reconciler converts them to a platform-neutral render tree (`List`, `Grid`,
`Detail`, `Form`, `ActionPanel`) with callback IDs. Workers send ordered JSON Patch revisions; the Commander frontend
renders the trusted component vocabulary and sends events back by instance/revision/callback ID. Unsupported APIs
fail with a named compatibility error and appear in a per-command compatibility report.

The first MVP includes the isolation and manifest boundaries. Full view reconciliation is an explicit compatibility
gate before Commander may claim a view extension works.

## Performance budgets

- Warm launcher keypress-to-visible: p95 below 100 ms; cold first open below 700 ms on supported Macs.
- Hidden steady-state target: native shell below 50 MiB, Node below 100 MiB, WebContent below 150 MiB before extensions.
- Extension workers are lazy, unloaded after a grace period at root, and individually capped at 128 MiB old-gen.
- Icon/image caches are byte-bounded and modules outside the launcher path load lazily.
- Telemetry records process RSS/physical footprint, V8 heap, cold/warm presentation time, and daemon/Rust restarts.

Linux shares the protocol and product implementation but remains runtime-unverified until WebKitGTK, global-hotkey,
tray, accessibility, IME, drag/drop, and credential-store behavior have dedicated testing.

## Extension compatibility

Commander reads Raycast `extension.json`/`package.json` manifests without translation and indexes their commands.
Runtime execution is intentionally isolated behind `packages/raycast-compat`. Public Raycast API coverage is
tracked in `docs/RAYCAST_COMPATIBILITY.md`; unsupported APIs must fail with a named capability error, never silently.

## System shortcut providers

Operating-system destinations use the portable `system` search-item kind and live in platform-gated built-in
extensions. The first provider is **macOS System**, a curated global index of System Settings destinations such as
Accessibility permissions, Screen Recording, Full Disk Access, networking, displays, keyboard, and login items.
Selecting one returns the same narrow `application.open` native request used for other trusted URLs; the macOS host
opens an `x-apple.systempreferences:` deep link and Commander never automates or changes the setting itself. Because
the entries are ordinary extension commands, they participate in fuzzy search, History, Command-K, and per-command
global shortcut binding without adding another execution path.

Stable URL destinations exposed by third-party apps can join the same provider model. A universal “open app, then
choose this menu item” index is a different trust boundary: app menus are localized, may only exist while the app is
running, and require macOS Accessibility access to inspect or invoke. Commander must implement that as an explicit,
opt-in live Accessibility provider with app identity and menu-path validation rather than recording brittle mouse or
keyboard macros in the static system catalog.

## Distribution

The macOS build stages a signed `.app` containing compiled React assets, daemon/worker bundles, the Rust search
binary, app icon, and a checksum-pinned Node 22 runtime, so the installed app does not depend on Homebrew Node.

Architecture source: Raycast's official May 2026 technical deep dive describes this four-part hybrid topology,
typed IPC, WebView rendering workarounds, and measured memory trade-offs:
https://www.raycast.com/blog/a-technical-deep-dive-into-the-new-raycast
