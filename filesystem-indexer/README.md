# Shared filesystem indexer

One first-party Rust workspace for Thingtime and Commander. Consumers build from
this directory through local Cargo paths; no registry, publishing step, source
copy, or separate checkout is required. All crates have `publish = false`.

```
filesystem-indexer/
  Cargo.toml                 workspace and dependency resolution
  Cargo.lock                 one reproducible dependency graph
  crates/core/               portable search/ranking primitives
  crates/indexer/            filesystem discovery, SQLite, hashes and CLI
  crates/ffi/                in-process C ABI for sandboxed native hosts
```

The existing crate and executable names are retained for protocol compatibility.
`commander-indexer` is the engine used by both products, not a Commander-only
implementation. Search, private sync inventories and content observations share
one database implementation; permission scopes and complete-coverage evidence
remain independent. Search membership never grants folder access or proves a
file was deleted.

## Consumers

| Consumer | Local reference | Runtime adapter |
| --- | --- | --- |
| Commander | `script/build_and_run.sh`, `script/dev-parallel.sh` | Typed Node JSON-lines client in `Commander/packages/filesystem-indexer` |
| Thingtime Mac / Electron | `macos/ThingtimeNode/scripts/build-bundle.sh` | Signed helper and AppleFileSync transport |
| Thingtime iOS | `filesystem-indexer/scripts/build-ios.sh` | Static archive and AppleFileSync C/Swift bridge |
| Browser device sync | Native capability contract | Uses the selected device; no browser filesystem walker |

The adapters own platform permissions, bookmarks, host lifecycle and UI. New
indexing, database, fingerprint and invalidation logic belongs here, not in a
second Swift, JavaScript or UI implementation. File reads and writes retain their
native permission and exact-version checks.

## Build and verify

From the repository root:

```sh
cargo build --locked --manifest-path filesystem-indexer/Cargo.toml --workspace
cargo test --locked --manifest-path filesystem-indexer/Cargo.toml --workspace
apple/FileSync/test-embedded-rust.sh
macos/ThingtimeNode/scripts/test-commander-backup.sh
```

Default build artifacts live in `filesystem-indexer/target/`. Packagers may set
`CARGO_TARGET_DIR` to an isolated build cache; they must build this same workspace
and copy only verified executable/archive artifacts into the app.

For a new Rust consumer, reference `crates/indexer` with a Cargo `path` dependency.
For a process host, use the existing typed JSON-lines protocol and manifest.
Sandboxed hosts use `crates/ffi` through the C adapter; never pass a database path
or filesystem authority supplied by a web page.

## iOS prerequisites

Install Rust with rustup and add `aarch64-apple-ios`, `aarch64-apple-ios-sim` and
`x86_64-apple-ios` targets. XcodeGen's canonical Thingtime build phase compiles the
required SDK/architectures and force-links `libcommander_indexer_ffi.a`. A missing
compiler or target fails the build; there is no Swift scanning fallback.
`THINGTIME_RUST_CARGO` may identify a task-specific Cargo executable. Keep its
matching `RUSTUP_HOME` and `CARGO_HOME` in the build environment when using an
isolated toolchain. The canonical script also recognizes a project toolchain in
`~/Library/Caches/Thingtime/{cargo,rustup}` without changing global shell settings.
Generated archives and toolchains are not committed.

The standalone Swift package can compile without Rust linked, reporting the
embedded engine as unavailable. The linked acceptance command above explicitly
requires the real engine and fails if the archive is absent.

## Coverage by host

Mac uses FSEvents and Linux uses inotify to fence strict filesystem captures.
iOS's available recursive backend is polling, so the engine explicitly reports
`strictCoverage: false` and refuses strict filesystem sealing. iOS uses
provisional, deletion-free folder Backup and separately verified PhotoKit
inventories. A two-way iOS folder feature requires a reliable event-coverage
implementation; a timer delay is not a substitute. Browser clients use the
selected native device's capabilities. Android work remains deferred.
