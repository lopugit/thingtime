# Batch independent small-file uploads

Branch: `codex/sync-small-file-batches`. Base: `a6e4d4a08bef2bd486e24715d250702b05505807`.

The existing small-file path repeats source/native/account and metadata control
requests for every file. A measured installed window spent 80.2% of elapsed
window time occupying the ordinary serial native lane (overlapping/nested
phase counters are not additive). This change introduces one explicit bounded
bulk operation instead of removing current authorization checks individually.

## Resulting behavior

Trusted Mac upload/backup streams negotiate native `fileUploadBatchVersion`
1.0.0 (Mac access 1.13.0) and selected-origin `api.file-sync-batches` 1.0.0.
Independent absent-target regular files of 1–256 KiB share at most 256 members
and 32 MiB. The first eligible file flushes immediately. Existing targets,
conflicts, folders, empty/large files and old/generic adapters retain the old
executor. Hardlink paths remain durable and are split across batches.

Bounded read-only metadata observation reuses common ancestry. Durable index
entries are provisional preparation input, never access authority. Native
checks the batch's current identity before/after the operation, plus each
file's grant, path, pinned descriptor and revision before disclosure/PUT, after
PUT and after stored fingerprint lookup. Electron owns authenticated API and
signed destinations; neither credentials nor URLs cross XPC. New PUT dispatch
expires after 30 seconds; the entire operation and callbacks expire by 180
seconds. PUT concurrency is at most 16, with no network-held coordinated file
lock. Staged presigned grants may outlive remote revocation until expiry;
fresh final configuration/server authorization still gates canonical visibility.

The five control requests are observe, receipt-only prepare probe, checksum
prepare, stored-content verify and canonical commit. The initial probe does no
provider work or source IO for already-confirmed receipts. Original ready
content avoids another PUT. Prepare returns all members; verify/commit return
only requested ordinals. Descriptors are capped at 320 KiB, requests at 512 KiB
and host-only signed responses at 2 MiB. New weighted bulk accounting and eight
provider slots per owner/process preserve existing identity/global limits.

The journal reserves original operation IDs relationally. Commit dispatch
markers are durable before POST; unknown outcomes cannot be rekeyed or retired
merely because a receipt is initially missing. Partial failures recover
individually before regrouping. Restart/old-host fallback retains these claims;
version 14 prevents old clients ignoring them. Root serialization, per-path
revision order, priority ancestry and contiguous source/baseline proof remain
intact. A separate narrow fix retries only typed transient scan-changes identity
failures at the unchanged durable cursor, preserving independent safe transfers.

## Verification and limits

- Full shared file-sync suite and focused mixed/recovery/migration tests cover
  first-transfer-before-index-completion, hardlinks, exact priority prefixes,
  preference changes, full preparation capacity, A→B→A, unknown commits, partial
  receipts and negotiated renderer fallback. V1/V2 no-ignore configurations use
  the same canonical encoding; ASCII/Unicode vectors are shared with Swift.
- Complete 32-file nested planner/journal/consumer/batch-service comparison:
  385→5 native calls and 288→9 cloud requests. With synthetic 5 ms native / 2 ms
  API delays: 3.284→0.514 seconds in the recorded run. A 256-file orchestration
  test confirms all files using two launches/nine requests and ≤16 PUT workers.
- Complementary isolated actual native/host/HTTP fixture: 256 real 1 KiB files,
  262,144 bytes, one launch, two native identity HTTP/two host account HTTP,
  256 verified PUTs, 18,622 ms. It uses synthetic API/provider/auth and excludes
  canonical commit; real XPC is tested separately. This is approximately 13.7
  files/s in that fixture, not evidence of 100 files/s or installed throughput.
- Nested real fixture: 128×1 KiB, eight path components and 32 sibling
  directories per ancestor, 128 accepted/verified, no deadline/source failures,
  5,947 ms. One native launch/two identity/two account HTTP requests, PUT max12.
- Production Commander indexed-entry→strong bulk source validation passes;
  changed bytes are rejected. Full native package: 231 tests, two explicit
  hardware skips; shared Apple package: 108 tests, no skips.
- Raw TypeScript remains at 92 pre-existing diagnostics on both exact base and
  head, with no added/removed diagnostics or fileSync errors. The canonical
  ratchet is nonblocking and warns against its older 89-error baseline.
- Owned structural graph refresh preserves unrelated snapshots. Documentation
  semantic freshness is unverified; no broad semantic rebuild is claimed.

Installed same-Home sustained throughput, retained priorities, acknowledged-byte
accuracy and independent recovery remain acceptance gates. Deploy the exact
server capability before installing so generation-scoped feature negotiation
cannot silently exercise fallback during rollout. Preserve the user's live job,
receipts, local files and settings; no reset or manual retry loop is part of this
change.


## Built-server smoke harness follow-up

The actual signed c92c4f7 bundle passes both public manifests, registered batch
route/docs (four phase discriminators) and same-origin unauthenticated POST401.
The harness now checks its private scratch against the parent's canonical temp
root independently of child TMPDIR, and supplies a credential-free synthetic
loopback Mongo URI solely to satisfy the runtime configuration-presence guard.
The unchanged OS boundary denies that DB port; no database, real account or
credential is used. Child HOME/TMPDIR/cwd stay private, scratch stays0700, and
all owned listeners are removed. Four runner regressions pass. This is a
harness-only follow-up; the bundled product behavior is unchanged. The final
signed build still must embed the final published head.
