# Responsive sync controls and optional resource ceilings

Pause previously awaited stop persistence and native cleanup before aborting the
active transfer. It now aborts immediately, fences automatic restart for the exact
connection, retains journal authority through cleanup and exposes Pausing/Paused.
The UI keeps Pause available during status loading; routine progress subscribers,
cache writes and journal reads are coalesced. Folder selections remain unchanged.

Configuration3 adds optional directional byte ceilings, maximum transfer/index
concurrency and an attributed sync-only CPU upper budget. Shared JS/Swift codecs
retain old IDs and use new float-bit canonical fields only for version3. API
minimums are api.things1.39.0/api.file-sync-batches1.2.0; native limits1.0.0.
Native Commander workers, bounded source IO and a private task-owned transfer
process enforce limits without measuring shared UI process CPU. CPU shares are
conservatively split three ways; unused shares are not borrowed. Browser scalar
streaming remains subject to platform/CORS support and must report incompatibility.
CPU-limited native downloads use api.attachment-content1.17.0 plus native download
1.0.0: owner-only60-second signed exact-version/range targets, independently
re-resolved by the host, credentials-omitted child GET and native staging. URLs
are never persisted. Unsupported providers/clients fail closed.

## Validation in progress

Final integration also covers cancellation of low-rate reservations, adaptive
100ms payload quanta and stall deadlines that exclude intentional throttle waits.
Control/signing timeouts remain bounded; original operation IDs stay fixed.

- Runtime/journal/cache pause regressions:38 pass.
- Coalesced journal event regression:2 pass.
- Full file-sync suites:621 pass; API capability111 pass.
- Isolated actual Chromium desktop/mobile Pause, draft/focus and Builder controls pass.
- Final native Node113/Mac58 tests and isolated actual Electron Node-mode transport
  smoke pass. UI/resource-status Builder acceptance passes at both viewports.
  Signed final bundle, installed copy and deployed-origin acceptance remain pending.
- Existing unrelated typecheck baseline errors remain; owned new errors are fixed
  before publication. Never update the baseline to hide them.

The earlier upload-speed investigation is shelved by user request. The user removed
the home source and closed the app; do not restore that selection or start a real
backup as part of development. No source data is removed.

Graph refresh preserves existing semantic data with AST-only incremental output;
the installed CLI cannot limit semantic refresh to the four edited documents,
and a broad corpus LLM run was avoided under the user’s usage ceiling.
