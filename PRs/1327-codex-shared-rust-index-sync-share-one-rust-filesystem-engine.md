# PR 1327: Share one Rust filesystem engine across Commander and native sync

[Pull request](https://github.com/lopugit/thingtime/pull/1327) · [Workspace build and protocol](../filesystem-indexer/README.md) · [Plan and outstanding acceptance](../PLAN/shared-rust-index-sync.md)

- Moved the core, filesystem indexer and native ABI to the top-level `filesystem-indexer/` Cargo workspace. All consumers build from local paths; the crates are not published.
- Commander uses Rust for live child discovery and forwards watcher invalidations into scoped inventories. Search acquires its SQLite write reservation before reading its generation so concurrent native inventory writes do not invalidate its transaction. Read-only live observations remain independent of a held search writer.
- The Mac native bridge reads strict inventory and backup from the Rust engine. Stale event and digest reuse requires local APFS on Mac; unknown or coarse filesystems revalidate instead. The Linux filesystem allowlist was not exercised at runtime. iOS links Rust in process, keeps platform security scopes and PhotoKit authority, supports deletion-free folder backup and explicitly refuses strict folder modes until reliable change coverage is available. Android work is deferred.
- Validation covers real Rust/SQLite and OS watcher integration, AppleFileSync and ThingtimeNode suites, an embedded Swift fixture, an iOS simulator build with backup restart and capability tests, web sync and TypeScript, and release-script contracts. The Commander suite passed 314 tests; web sync passed 696.
- Installed signed acceptance, physical device and provider checks, and real account cloud-to-local transfer remain separate from this checkout's evidence.
