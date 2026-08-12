# Thingtime Commander

Commander is a fast, keyboard-first desktop launcher for macOS, Windows, and Linux. The current milestone ships
and validates the macOS host while keeping all product UI, business logic, extension infrastructure, and search
portable from day one.

## What works in this milestone

- global Commander shortcut on macOS (defaults to Command-Space; customizable in Settings);
- application and command search with deterministic Rust fuzzy-search process plus TypeScript fallback;
- arrow-key selection, Return execution, Escape dismissal, and Command-K actions;
- a searchable Commander Settings command and separate native settings window;
- launch-at-login, menu-bar icon, favourites-in-compact-mode, window mode, appearance, and text-size preferences;
- installed extension management, safe folder/ZIP sideloading with opt-in source builds, and live Store browsing;
- timeout- and memory-bounded extension workers plus an explicit Raycast compatibility capability registry;
- Thingtime desktop OAuth/PKCE, multi-account UI, Keychain token storage, account switching, and private app-data
  settings sync;
- Swift/AppKit/WKWebView macOS host; C#/.NET 8/WPF/WebView2 Windows host boundary; Linux host contract;
- a persistent Rust core with stable cross-platform JSON-lines search protocol.

## Compatibility promise

Commander targets **source compatibility** with Raycast extensions. It reads `package.json` and `extension.json`,
inspects conventional source/build entries, and can run an extension-authored build only after explicit consent.
Raycast’s private Store archive and host-RPC formats are undocumented, so binary compatibility is neither safe nor
promised. A complete Commander-owned `@raycast/api` render/runtime shim is still roadmap work.

The current runtime imports manifests and executes compatible prebuilt `no-view` commands inside bounded workers.
Workers contain crashes, hangs, and JavaScript heap growth but are not an OS permissions sandbox.
The view-command React reconciler is not complete yet. Commander reports this as partial compatibility rather than
claiming imported metadata equals working compatibility. The exact matrix and roadmap are in
[`docs/RAYCAST_COMPATIBILITY.md`](docs/RAYCAST_COMPATIBILITY.md).

## Architecture

The complete runtime diagram, trust boundaries, IPC contract, process budgets, and Raycast 2.0 design rationale are
in [`ARCHITECTURE.md`](ARCHITECTURE.md). The high-level stack is:

- React + TypeScript shared UI;
- one long-lived Node 22 daemon;
- a persistent Rust search/indexing process;
- Swift/AppKit + WKWebView on macOS;
- C#/.NET 8 + WPF + WebView2 on Windows;
- the same native bridge contract for Linux.

## Build and run on macOS

Requirements: macOS 14+, Xcode command-line tools, Node 22+, pnpm, and optionally Rust 1.85+.

```bash
cd Commander
corepack pnpm install --frozen-lockfile
./script/build_and_run.sh --verify
```

The script builds the TypeScript workspaces, builds the Rust core when Cargo is available, builds the Swift host,
stages and signs `dist/Commander.app`, embeds a checksum-pinned Node 22 runtime, installs it to
`~/Applications/Commander.app`, launches that exact copy, and verifies the signed host owns the reported daemon
process and health endpoint. The daemon also watches its native parent so a forced host exit cannot leave port 47820
occupied by an orphaned service.

The Codex Run button is wired through `.codex/environments/environment.toml` to the same script.

## Thingtime setup

Commander uses the real Thingtime API; it never reads the database directly.

Commander ships with its public Thingtime client registration for the exact loopback origin
`http://127.0.0.1:47820` and callback `http://127.0.0.1:47820/oauth/callback`. The login requests
`profile.username` and `app-data`; Advanced settings retain a client-ID override for another Thingtime deployment.

The browser login uses authorization code + PKCE. Access tokens are saved only through the native credential bridge:
Keychain on macOS, Credential Manager on Windows, and Secret Service on Linux. Sync data is stored privately under
the app-data key `commander.settings.v1`.

The bundled client ID is public by design. Tokens, passwords, and other credentials never belong in this repository.

## Verification

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
cargo fmt --check --manifest-path crates/commander-core/Cargo.toml
cargo test --manifest-path crates/commander-core/Cargo.toml
swift build --package-path hosts/macos
./script/build_and_run.sh --verify
```

Windows and Linux compile/runtime testing is deliberately deferred, as requested. Their shared layers are covered
by the TypeScript and Rust checks; their native shells remain explicitly unverified.
