# PR #1046 · Recoverable file sync, home backups and live progress

[Pull request](https://github.com/lopugit/thingtime/pull/1046) · branch `codex/file-sync-release` · base `main`

## Result

Mac and iOS can pair devices and connect approved folders or Photos sources to private file-sync Things. Transfers retain recoverable operation journals and canonical Timeline versions. The home-backup preset starts paused, excludes Library, Applications and `.Trash` before native traversal, preserves additional exclusions, and disables deletion propagation.

The individually editable progress interface separates indexing from transfer. Folder totals aggregate descendants; paged and focused-folder navigation supports deep trees without mounting the entire inventory. Saved speed trackers have independent upload/download direction, averaging windows from one second to 24 hours and Kbps, Mbps, Gbps, Files/ps, Folders/ps or INodes/ps. Inodes are logical files plus folders. Counters use acknowledged payload bytes and newly durably confirmed entries. Recovered receipts and retained offsets do not inflate rates. A completed transfer labels frozen speed counters Complete; actual pauses remain Paused.

Portable backup and independent replica foundations retain their existing shared format. Android remains explicitly deferred, with unfinished source preserved.

## Integration

This PR replaces the delivery path of #1002, whose PR head remained stale despite verified pushed branch refs. It carries the home checkpoint `b2edbad0d` and speed source checkpoint `9ae5de0a3`, integrated with current main.

- Preserve main's Character identity selection, private password attachment guards, fail-closed local/test API behavior, streaming proxy and selected-origin fencing.
- Publish devices 1.13 and pairing-claim 1.2 so the older main contracts cannot falsely negotiate mobile additions. Retain attachment-content 1.15 and Things 1.36 alongside the current-main corrections.
- Bind the middleware listener to the selected or recovered renderer origin without probing an unrelated server or discarding automatic-origin history.
- Preserve the installed Password AutoFill adapter and standalone helper while retaining file-sync/export IPC. The installed ASAR audit matched PR #1035's provider adapter; its unrelated deletions of file-sync code must not be imported.
- Incorporate current-main subspace messaging and Commander login fixes without changing their permission or callback contracts.

## Verification · 19 October 2026

- Existing file-sync suite: 347 TypeScript tests plus one module-mock test; speed/settings integration: 46; focused integration: 209. All pass.
- Backup suite: 95 pass, including resumable restore above 10,000 folders and a 32,002-item metadata review within a 64 MiB heap.
- Initial native integration: 46 focused Swift and 70 Electron checks pass. Canonical Electron suite after the final AutoFill preservation and disconnect correction: 227/227 pass. Protected Keychain deletion failures propagate before authority changes; injected failures and retries are covered. Swift password-core tests: seven pass and two opt-in integration tests skipped. The standalone host/extension compiles unsigned without executing it or accessing user Keychain data.
- Current-main integration: 105 capability, 308 attachment, 69 subspace and 66 messaging checks pass. After Commander integration, both manifest test files pass 98 checks.
- Isolated Chromium: speed, hierarchy and home preset pass at desktop 1440 and mobile 390. This covers all units, independent windows, Add/remove, Builder nested edits/save/reload, paused and completed states, 13-level folder navigation, exclusions and three synthetic confirmed folder receipts. Full-page screenshots were inspected; no overflow or clipping was found.
- Full source typecheck reports 92 diagnostics outside this PR's changed files; the full web/server build passes.
- Earlier full iOS app/Watch/widget compilation and 26 selected isolated simulator tests are recorded in [the detailed #1002 ledger](1002-codex-mobile-file-sync-add-native-mobile-pairing-and-recoverable-file-sync-core.md). These are not real home-upload or provider throughput evidence.

## Release gates

- [x] Resolve main integration and publish a regular release PR.
- [x] Verify editable progress, home preset and speed controls in isolated desktop/mobile browsers.
- [x] Preserve installed Password AutoFill and pass affected native compilation and canonical Electron checks.
- [x] Verify full web/server build including Vercel static shell and route output.
- [ ] Refresh current graph artifacts and verify exact final-head CI/preview.
- [ ] Merge the verified release into main using the user's explicit authorization.
- [ ] Verify the matching deployed Files capability and canonical signed installed Mac build.
- [ ] Start the authorized home-folder upload with the reviewed exclusions, then verify actual progress, speed, destination and retained recovery state.

No personal home scan or upload has started. No installed app has been replaced by this release yet.

## Remaining scope

Native iOS whole-file upload byte telemetry is unavailable where the host reports retained offsets rather than distinct transferred bytes. Independent backup worker/job/vault integration, complete account restore coverage, configurable retention/pruning, key recovery, measured cloud-scale throughput and future physical-media delivery remain open in the [acceptance ledger](../docs/mobile-file-sync.md) and [portable backup contract](../docs/portable-backups.md). Android is reserved for a later date.
