# PR 1422: Native iOS LiDAR capture and private Thing saving

## Delivered behavior

The iOS drawer and editable web/Builder buttons open the native scanner. A
same-device Safari handoff checks the selected native origin. Recording requires
Start and normal camera permission; Finish seals an original-data TAR on-device
and automatically saves one private File Thing. The manifest records public
ARKit outputs, missing data and partial capture status. See
[archive and bridge format](../docs/native-lidar-scans.md).

The existing attachment and Files APIs carry the archive, with pinned account,
origin and Home data-plane checks. Raw bytes never pass through JavaScript.
Durable receipts prevent duplicates after uncertain completion; explicit Retry
continues the same scan. Discard writes independent no-upload tombstones before
deleting local bytes. Foreground refreshes and native-drawer notifications only
query status, avoiding automatic retry loops.

## Verification, 8 November 2026

- Final focused simulator suite: 13 passed, zero failures. App built, installed
  and launched; native drawer entry, same-origin handoff, mismatched-origin
  refusal and unsupported hardware alert observed.
- Native multipart against built Nitro and a disposable replica set: two parts,
  successful same-Thing retry after a lost commit response, independent download
  SHA-256 equality, anonymous refusal. Synthetic recorder archive; test state
  and credentials removed afterwards.
- Web typecheck and targeted lint passed (three unchanged ThingsPage warnings).
  Actions suite: 171 passed, one existing skip; final bridge regressions: seven
  passed. Isolated Chrome desktop/mobile fixture verified individual control
  editing/save/reload, retry, scope changes, foreground and drawer updates.
- Capability suite: 155 passed. System TAR byte extraction and PLY/recovery
  harnesses passed. Generic iPhone Release build passed on stable Xcode26.6;
  simulator tests used Xcode27/iOS27.
- Broad simulator run: 315 tests, 24 skipped, initially 20 failures. Two new
  fixture boxing defects were fixed and the final focused suite passed. The
  remaining 18 failures are in unchanged MobileFolderInventory and
  SharedRustInventory tests (resource_limit / unavailable shared index). This
  broad suite is not claimed green.

## Remaining acceptance and release boundaries

The paired physical iPhone was unavailable. Real LiDAR frames, camera permission,
long capture performance, physical background interruption and production upload
from that iPhone remain unverified. Simulator/fixture evidence does not substitute
for those checks. The canonical main-push iOS workflow separately signs, uploads
and waits for TestFlight processing after merge.

The large historical TESTING/changelog semantic pass was stopped after its
111-chunk workload exceeded the bounded indexing pass. The subsequent
seven-chunk feature-document pass failed Graphify's incomplete-extraction/shrink
guard. The available structural snapshot is retained; changed Markdown is not
claimed fully reindexed semantically.

Private Agent overview reporting was refused because the connected Thingtime
credential lacked the independent agents.report grant. No reporting identity,
record or access grant was fabricated.
