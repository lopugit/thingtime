# Native web bundle foundation — 11 November 2026

The canonical Electron `build:web` and `verify:web` commands passed. The build
records Electron 43.1.0 / Node 24.18.0 / native module ABI 148 for Darwin arm64,
using default shell version 0.1.2. It inventories the actual Vite renderer and
`node_middleware` Nitro output, not a separate mock application.

All 26 focused checks pass. The full Electron suite passes 489 tests with five
explicit skips and no failures. A later version-override correction preserves
prerelease/build metadata and matches portable packaging; fresh inspection of
the actual Electron runtime proves that the final helper produces exactly the
same metadata as the accepted default build. The receipt records source hashes
and keeps that parity check distinct from another full rebuild.

The [real-byte receipt](verification.json) comes from
`node electron/scripts/verify-web-bundle-store.cjs`. It covers 1,809 files and
269,396,784 bytes. A disposable in-memory signing key signs the completed build;
the store stages an independent verified copy and the test removes its source
publication. After a simulated successful-boot acknowledgment, an unconfirmed
second trial recovers the first release through a newly opened store. Temporary
release/cache data is removed at the end.

This does **not** execute the Nitro server or renderer, access an account, test
real production signing authority, activate an installed app, or establish iOS
runtime support. The acknowledgment is deliberately labeled simulated. No
private key, full build output or local cache is committed here.

Focused contract/store checks cover signatures, trust scopes, native compatibility,
tampering, replay, traversal, case collisions, private-state exclusion, symlinks,
special files, deterministic packaging, frozen caller inputs and cold recovery.
A deterministic bounded subprocess reproduces a regular-file-to-FIFO substitution
between `lstat` and `open`; nonblocking open now refuses it without hanging.

The [architecture and remaining gates](../../../docs/native-web-bundles.md)
retain API delivery, production trust provisioning, actual startup acknowledgment,
iOS compatibility and installed/device acceptance as unfinished work.
