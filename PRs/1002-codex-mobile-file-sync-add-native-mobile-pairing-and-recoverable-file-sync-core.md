# PR #1002 — Native mobile pairing and recoverable file sync core

Branch: `codex/mobile-file-sync` → `develop`.
PR: https://github.com/lopugit/thingtime/pull/1002

This is the first implementation checkpoint toward the full mobile device and
Drive/Photos/Resilio-style sync request. The authoritative requirement/evidence
table and remaining work are in [mobile-file-sync.md](../docs/mobile-file-sync.md).
The second checkpoint adds native iOS pairing and its Things/Settings control.
The third checkpoint adds Android pairing and installed Things acceptance.
Full sync UI/worker acceptance remains incomplete.

## Delivered source

- One platform vocabulary supports iOS/Android through descriptor validation,
  safe server reads, browser types and the public device schema. Existing signed
  pairing, revocation and permission boundaries remain in place. Both manifests
  advertise devices 1.10.0 and pairing-claim 1.1.0.
- A shared reconciliation core detects concurrent edits, delete/edit conflicts
  (including new descendants beneath a deleted folder), invalid/incomplete
  inventories and identity changes. Upload/download/two-way/backup policies are
  explicit. Executors must use conditional, idempotent native/cloud writes.
- Immutable operation runs persist before effects, copy before removal, verify
  receipts and resume uncertain completion with the original IDs. Browser
  IndexedDB and Web Lock helpers provide durable journal/exclusion primitives.

## Verification — 2026-10-17

- 32 file-sync tests, 85 device tests, 95 capability tests and 265 schema tests
  passed; 477 focused tests total. Transfer adapters are synthetic and journal
  tests use fake IndexedDB, including close/reopen and concurrent transactions.
- Targeted lint passed. Full web/Vercel build passed, including packaged static
  output verification. Both compiled discovery handlers returned the expected
  local feature versions when fallback was pinned to the synthetic origin.
- Raw `tsc --noEmit` fails outside changed files. The final diagnostic output
  matches the initial diagnostic output; a new journal typing error found
  during development was fixed. This is not a clean whole-project typecheck.
- Graphify semantic extraction succeeded for the implementation checkpoint.
  The subsequent documentation refresh hit its semantic-shrink guard on the
  changelog, preserving the last complete semantics. The final structural
  refresh does not establish current semantic coverage for these PR notes.
  Legacy cache and unresolved hyperedge warnings also remain.
- The published preview URL responds, but its capability endpoint returned 404.
  Deployed feature validation remains pending.
- No native builds, installations or physical-device tests have been performed
  for this checkpoint. The iOS simulator and Android SDK are available locally
  for the native implementation stages. The conflicted primary checkout was
  preserved; all source work is in the isolated mobile-file-sync worktree.

## Next work

Complete installed-app iOS click-through, then add editable sync roots and
canonical guarded file-version/transfer APIs, native file/Photos workers,
background scheduling, progress/conflict/settings surfaces and real cross-device
acceptance. Keep the full goal active until the evidence table is satisfied.


## Native iOS checkpoint — 2026-10-17

- Implemented CryptoKit prepare/complete, a Keychain record per canonical
  origin/account, exact completion replay, explicit revocation recovery and
  foreground-only state reports. Native bridge 1.0.0 accepts only main-frame
  selected-origin requests and returns public status/ID, never credentials.
- Added one Things/Settings connection card. Browser QA of synthetic states at
  desktop and 390px confirmed bounded controls and no horizontal overflow.
- 28 selected native tests passed: eight protocol/recovery tests, 19 existing
  destination tests and one opt-in real local API/Keychain test. The latter
  created one online iOS device and proved repeat-pair/reload retained its ID.
  A shared signing vector is verified independently by Swift and the server.
- 88 device tests, targeted lint and full web/Vercel build passed. Raw TypeScript
  diagnostics remain identical to the original outside-file baseline.
- Built, installed and launched the iPhone 17 Pro iOS 26.5 simulator app from
  `/tmp/thingtime-mobile-ios-build/Build/Products/Debug-iphonesimulator/Thingtime.app`.
  Info.plist confirms `http://127.0.0.1:14900`; the installed app renders the
  local web shell. Build version remains 1.0 (31), not a TestFlight release.
- The first live test exposed missing simulator signing (Keychain access failed).
  The canonical acceptance script retains normal simulator signing and now
  passes without any secure-storage fallback. Account credentials are kept in
  an ignored fixture and injected through a protected, temporary test-run file.
- Remaining: actual signed-in installed-app click-through, physical iOS,
  Android app and Keystore, editable sync roots, real cloud/native transfer and
  Photos workers, offline/background recovery, conflict/settings UI and release.

- Final executable hashes match between build and simulator installation; the
  running executable was verified under simulator container
  `96D01CDD-6002-489C-A42E-366DF3B04AD9/Thingtime.app` (PID 56028).
- Native-checkpoint semantic extraction also hit Graphify's shrink guard on the
  changelog and broader docs. The last complete semantic graph is preserved;
  the final structural refresh covers source changes without claiming current
  semantic coverage of the edited documentation.

## Android checkpoint — 2026-10-17

- Added a native Android shell, exact-origin/main-frame bridge, bounded HTTP
  transport, Ed25519 proof protocol and atomic Keystore-encrypted account records.
  Uses the existing Things/Settings UI and advertises pairing only. No file or
  Photos permission, background worker or release-signing claim is introduced.
- Debug build and lint passed, with nine JVM tests and three emulator tests.
  Shared signature vector matches iOS/server. Lost completion response resumes
  exact bytes, cancellation/account changes block further mutation, revoked
  nodes remain revoked, and tampered/transplanted ciphertext fails closed.
- Real local API acceptance created one online Android device, reopened its
  encrypted record and retained its ID. The installed Things screen rendered
  the paired card and Check connection updated the native state revision.
  Native system-bar insets were visually checked; no horizontal page overflow.
- The existing local AVD image was incomplete. Testing used a separate temporary
  Android 35 Google APIs image, verified against Google's published checksum,
  without changing the original AVD data. The first live-test failure was the
  Java test cookie jar's quoted cookie formatting; the harness now sends ordinary
  name/value cookies. Production transport reads the WebView cookie manager.
- Setup, fork origin selection and private-fixture acceptance are documented in
  `android/README.md`. APK build output and test credentials remain untracked.
  Physical Android/iOS tests, iOS installed click-through, real file/Photos
  transfer adapters, background workers, sync configuration and release remain.

- Final Android checks also passed the minified unsigned release build and
  release lint. The installed connection-control test passed at both foldable
  and phone widths. Screenshots show duplicated device-card painting beneath
  the existing Things filters; the new connection card and native insets are
  verified, but broader Things rendering remains an open acceptance item.

- Android-checkpoint semantic extraction completed successfully (57,714 nodes
  before final source reconciliation). Existing cache-vintage, duplicate entity
  ID and out-of-scope extraction warnings remain; earlier checkpoint guard
  failures above are historical. Final source/manifest consistency is checked
  after the PR-note rename and activity-recreation serialization change.


## Content integrity checkpoint — 2026-10-17

- Attachment-content 1.13.0 returns an authorized, exact-version composite
  fingerprint without storage identifiers or signed URLs. Object identity,
  size, version, checksum format and post-HEAD lifecycle checks must all pass.
  The same canonical part plan drives attachment uploads and bounded local
  hashing. Sync entries now support that format without confusing it with
  whole-file SHA-256. Existing attachment lifecycle/accounting remain canonical.
- The live local HTTP test uploaded two real parts (8 MiB + 17 bytes), replayed
  start and completion, matched local/cloud fingerprints, independently hashed
  the downloaded bytes, denied anonymous reads and removed its synthetic file.
  Local MongoDB and the documented local storage stand-in were used; production
  S3 and native file transfer acceptance remain outstanding.
- Focused sync, attachment and capability suites cover malformed/missing
  checksums, exact-version mismatch, deletion during HEAD, ACL refusal,
  capability negotiation, scope changes during streaming and response bounds.
  This is the content-comparison foundation, not a completed sync worker.
- Empty files, native incremental hashing above the browser's 32 MiB part cap,
  stable logical file IDs and conditional replacement/Timeline history remain
  tracked under the full goal in `docs/mobile-file-sync.md`.

- Verification: 36 file-sync tests, 288 attachment tests and 95 capability
  tests pass (419 total). Targeted lint passes (the existing `.mts` files need
  the TypeScript parser/ES2021 flags). Full web/Vercel build and both compiled
  capability handlers pass at 1.13.0. Raw TypeScript retains the same 91
  pre-existing diagnostics with no additions. No native source changed in this
  checkpoint; the earlier native acceptance is not a new full-sync claim.

- The content-checkpoint semantic refresh refused a shrinking extraction of the
  PR note/README and preserved the complete prior semantics. No force/partial
  override was used. A final structural refresh supplies current source/manifest
  consistency; it does not establish current semantic coverage for these docs.
  The browser scope test also rejects mutation of the caller's original scope
  object during a request, not only replacement with a different scope object.


## Stable cloud file checkpoint — 2026-10-17

- Added protected `file` Things with an atomic home-plane `/api/v1/files` writer.
  Current content references immutable, separately charged attachments; previous
  versions stay bound to the stable file. Timeline stores metadata revisions and
  exact operation receipts. No parallel collection/history or new index.
- Client UUIDs and immutable payload hashes provide replay identity; the current
  Timeline head fences commits. Old retries return their original receipt after
  later edits. Client-authored draft events cannot impersonate API completion.
  Foreign, transient, blocked, linked, wrongly bound and unaccounted bytes fail.
- Things 1.34.0 lists live roots once; bulk 1.6.0 and the canonical folder-delete
  drain record file placement history, invalidating pre-move revisions. Trash
  and older-byte restoration are guarded commits; no retained bytes are refunded.
- Real local HTTP/Mongo/object-storage acceptance passed replacement with stable
  identity, exactly one concurrent winner, replay/lookup, seven Timeline entries,
  library listing, folder moves/deletion, Trash/restore, independent byte hashes,
  protected generic deletion and anonymous denial. Synthetic tiny fixtures remain
  privately in Trash with accounted versions; no cleanup backdoor was added.
- Full sharing, purge/retention, root inventories/path collision handling,
  production UI/transfer integration, native file/Photos workers and release
  acceptance remain on the original goal. The current UI's manual transfer path
  is unchanged. No native source changed in this checkpoint.

- Verification: 8 file API tests, 36 sync tests, 297 attachment/script tests,
  316 Things tests, 238 Timeline tests, 266 schema tests and 95 capability tests
  pass (1,256 total). Targeted lint and web/Vercel build pass; both compiled
  manifests expose the new contracts and the compiled file route rejects
  anonymous requests. Raw TypeScript remains at its unchanged 91 diagnostics.
  Large-document semantic coverage is reported separately from source/API proof.

## Cloud execution checkpoint — 2026-10-17

- Added prepared cloud destinations to the existing durable sync run, and a
  real upload/replace/remote-Trash port for the shared executor. No parallel
  history or queue database, new API/collection/index or native source change.
- Every API request pins the account and home data plane through canonical
  server headers. Signed part uploads omit credentials/referrers. Immutable
  upload request IDs, per-part/composite byte verification and file revision
  guards preserve interrupted work; no speculative abort/delete cleanup.
- Exact receipt recovery uses the original commit metadata and retained byte
  identity, so the server validates its request hash before returning a replay.
  A lost accepted response needs neither source access nor a second upload.
- Six new transport regressions pass (42 sync tests total). Real local
  HTTP/Mongo/storage acceptance passed multipart interruption, disk-run reload,
  accepted-write/lost-response recovery without source access, stable replacement,
  independent hashes of both versions, server identity/database fences and Trash.
  Synthetic versions remain privately in Trash and charged. Production S3 and
  native/background behavior are not covered by this local test.
- Explicitly resolved file destinations are supported. Directory inventories,
  concurrent path-creation collisions, folder writes, download publication,
  native streaming/empty files, production settings/worker UI, Photos, sharing,
  retention and release acceptance remain on the full goal.
- Final verification: 42 sync and 8 file API tests pass; targeted source/script
  lint and full web/Vercel build pass. Raw TypeScript matches all 91 pre-existing
  diagnostics with no additions/removals. Synced file/directory journal I/O and
  mode-0600 readback pass. The temporary fixture administrator was removed,
  PM2 restarted and non-admin identity plus private Trash state verified.
  Documentation semantic coverage remains separate from source/API acceptance.

## iOS folder access checkpoint — 2026-10-17

- Added `fileAccessVersion` 1.0.0 with explicit native Files selection and
  account/origin-scoped, device-only Keychain bookmarks. The web receives opaque
  root IDs, names, complete bounded inventories and requested version-pinned
  chunks. No arbitrary path grant, local writes or file deletion operations.
- Native scans coordinate provider access, use descriptor-relative no-follow
  reads, hash incrementally using the shared multipart contract, and refuse
  changed/missing/unsafe/incomplete roots. Native reads are limited to 64 KiB;
  the web source adapter assembles at most 32 MiB per requested buffer.
- The existing paired-device card exposes choose/check/remove access. Native
  cancellation releases waiting UI, stale picker delegates cannot complete a
  newer request, and StrictMode cleanup releases the pending-request slot.
  Cached folders remain visible on failed reads. Selecting a folder does not
  begin transfers; editable sync policy Things and native workers remain pending.
- Browser fixture QA at 1280×800 and 390×844 verified choose/check/remove,
  long-name wrapping, 40px action targets, no horizontal overflow, and retained
  selections on error. Native tests include real multipart hashing, Keychain
  isolation, traversal/symlink refusal, changed versions and request cancellation.
- The simulator build targets `http://127.0.0.1:14900`, retains simulator
  signing, and is installed/launched on iPhone 17 Pro / iOS 26.5. This does not
  prove signed-in system-picker click-through or physical/provider acceptance.
  Android folder access, native writes/schedulers, Photos and remaining full
  sync requirements stay in the authoritative acceptance ledger.
- Final native validation: 36 selected simulator tests passed (9 folder tests,
  8 pairing tests, 19 destination tests). The final build is
  `/tmp/thingtime-mobile-folder-build/Build/Products/Debug-iphonesimulator/Thingtime.app`,
  version 1.0 build 31. Its installed simulator executable and debug library
  hashes match the build, codesign verification passes, and launch succeeds.
- Web validation: 46 sync tests and 88 device tests passed, targeted lint and
  full Vercel web build passed. Raw TypeScript retains unrelated baseline
  failures; this is not a clean project typecheck.

## Android folder access checkpoint — 2026-10-17

- Added native Files tree selection and the shared mobile folder bridge contract.
  Read-only provider grants stay in an atomic encrypted no-backup registry,
  scoped to account/origin. Namespace-authenticated encryption prevents copying
  folder records into device-pairing storage. A shared URI reference is released
  only after its last saved owner reference is removed. No provider file writes
  or deletions, broad storage permission, new API or history store.
- Scans/read use tree-relative provider URIs, named cursor columns, cancellation
  signals and bounded streamed hashing. Unknown-size, virtual/loading/missing
  providers, unsafe paths, duplicate IDs/aliases, changed bytes and limits fail
  closed. Content fingerprints protect against unchanged/absent timestamps.
  Each 64 KiB bridge read currently rehashes the file; efficient large-file native
  workers remain required and are not claimed by this foreground adapter.
- Native selection intentionally survives the system picker's activity pause,
  but authenticates again after returning. Navigation, destruction, cancellation
  and request deadlines fence late results. Folder replies use the same owner,
  origin and request correlation as iOS. Web controls now negotiate both platforms.
- Verification: 16 JVM tests, 9 emulator tests across the full run and corrected
  provider-test rerun, debug and minified unsigned release builds/lint. Installed
  signed-in Things verifies the Android capability, folder controls and native
  authenticated list response. Real ContentResolver/DocumentsProvider fixtures
  verify descriptor bytes and partial/virtual-provider refusal. A test-fixture
  metadata error was corrected before the provider tests passed.
- System-picker click-through remains unverified: the running emulator window
  was not available through the desktop control tool. The optional manual-picker
  acceptance test is retained. Third-party providers, physical devices, native
  writes/schedulers, Photos and remaining full-sync requirements stay open.
- Web sync tests, targeted lint and complete web build pass. Raw TypeScript
  matches the same 91 pre-existing diagnostics. Browser fixture checks at 390px
  and 1280px retain folders after errors with no horizontal overflow. The installed
  foldable screenshot still shows the previously recorded duplicate card painting
  beneath Things filters; broader Things rendering is not claimed fixed here.


## Editable sync configuration checkpoint — 2026-10-17

- Added ordinary `file-sync` Things, private by default, through the canonical
  registry/Things writer. The public schema can be copied independently; no new
  collection, index, endpoint or secret. Things 1.35.0 appears in both manifests
  and the shared client negotiates it for configuration writes.
- Bounded device/root/cloud-folder references and explicit direction, pause,
  deletion, network, charging and exact-path exclusions. The factory defaults
  paused, two-way, Wi-Fi and no deletions. No native URI/bookmark/credential data.
- `configuredPlan.ts` consumes the real `author.id` projection, requires an owned
  private configuration and a matching separately supplied device-local approval,
  gates network/power state, and filters both inventories/baseline consistently.
  Excluded descendants block ancestor deletion. Full scan validation precedes
  filtering; current root authorization and per-effect rechecks remain mandatory.
- Focused configuration tests, schema/capability/Things suites and real local
  API create/list/read/update/invalid-input/private-read/stale-write checks pass.
  API acceptance caught and corrected an initial owner-projection mismatch.
  Public File sync reference and all eleven fields render in the local browser.
  Targeted lint has no errors; raw TypeScript retains the same 91 baseline
  diagnostics. The complete web build is checked separately before publishing.
- Scope remains incomplete: native approval persistence, connection editing UI,
  worker wiring, destination writes, efficient streaming, Photos, retention,
  peer behavior and physical-device acceptance are still required. The API test
  uses synthetic opaque IDs and does not exercise native grants or transfers.


## Mobile connection editor checkpoint — 2026-10-17

Paired mobile device cards now create/edit ordinary private `file-sync` Things.
The shared form exposes native/cloud folder selection and policy settings;
backup keeps deletion propagation off, and missing grants preserve saved data.
Complete local drafts are scoped by origin/account/data plane/device and read
before first paint. Verified persistence precedes dispatch. Fixed IDs, immutable
pending payloads and expected revisions recover accepted response loss without
creating duplicates; stale versions preserve the draft for explicit comparison
and replacement. Expected actor/plane headers pin requests across capability
awaits, and cancellation fences retired views and StrictMode remounts.

Validation: 66 sync + 20 request/payload/error + 88 device tests pass. Real
loopback API create/edit accepted-reply-loss cases each write exactly once and
survive draft serialization; stale edits and cleanup/logout pass. The production
editor with synthetic API/native responses passes draft reload, uncertain retry,
stale comparison/replacement and missing-grant checks at desktop 1280px and
mobile 390px/320px without horizontal overflow. Native app picker acceptance,
streaming writes/workers, Photos, peer behavior and retention remain open in the
full delivery ledger. Readback confirms current settings, not a permanent
operation receipt; an unresolved pending save is deliberately retained.

The prior-head CodeQL check flagged a test-only `startsWith` URL guard in
`cloudTransport.test.ts`. It now compares the parsed exact origin; no alert was
dismissed. Fresh remote scan completion remains required before calling CI clean.

Full web build and Vercel output validation pass. Targeted source/fixture lint
passes; the `.mts` acceptance script is executed and typechecked separately
because this repository's ESLint parser does not cover that extension. Raw
TypeScript remains at the same 91 pre-existing diagnostics, with none added or
removed. Structural Graphify refresh accompanies the checkpoint; semantic
freshness is not claimed after the earlier extraction shrink-guard failure.


## Cloud inventory checkpoint — 2026-10-17

Files 1.1.0 exposes a complete owned private folder tree on the existing GET
route. One Mongo snapshot covers ancestors and batched breadth reads, bounded
to 10,000 entries, 64 breadth levels, 8 MiB and 20 seconds across retries.
Files retain their canonical revision/fingerprint; folder stamps are observations.
Invalid ancestry, private/namespace violations, ambiguous names, malformed file
metadata and limits return no partial inventory. Notes and trashed files are
outside the filesystem view. The shared client pins identity/home storage/origin,
negotiates capabilities and bounds/cancels streamed response reads.

Real loopback API + Mongo + local object-storage acceptance passed: nested/empty
folders, exact retained file fingerprints, ordinary-note exclusion, anonymous
and mixed-selector refusal, case-collision refusal, plus existing replacement,
replay, retained-byte hashing and Trash/restore checks. Temporary fixture admin
configuration was removed and the managed app restarted successfully. Synthetic
folders/notes were deleted through the ordinary API; tiny accounted file versions
remain private in Trash. No production storage or native background execution
is claimed. Complete scans now supply the cloud observation prerequisite; native
approval persistence, directory writes, transfer coordination and the rest of the
full sync ledger are still pending.

Validation for this checkpoint: 73 shared sync tests, 18 Files service/route tests
and 95 API capability tests pass (186 total). Targeted lint and the full web build
with Vercel output verification pass. Raw TypeScript still has the same 91
pre-existing diagnostics, with no new normalized diagnostics. The preceding
181da877 checkpoint's remote CodeQL check is now successful. A new scan must
finish on the next pushed head before its CI can be described as clean.


## Nested cloud upload checkpoint — 2026-10-17

Files 1.2.0 creates ordinary private folders using the existing `createThing`
transaction/accounting path and canonical `thing-content` Timeline capture.
Immutable creation receipts retain the original identity/name/parent after later
edits or deletion. Replays do not create a replacement folder. Parent fences,
private ancestry checks, bounded sibling collision reads and operation validation
reject conflicting input; quota/history failure rolls back before commit effects.
Inventory and direct folder reads share one revision projection.

The cloud run preparer binds complete inventories to preallocated parent IDs.
The existing executor/journal creates nested parents before child byte uploads,
without reading a byte source for folders. Real loopback API + Mongo + local
storage acceptance passed a lost parent-creation reply, journal reload, multipart
interruption, lost accepted file commit, stable replacement and independent hashes
of both versions. Normal API cleanup removes folders and leaves accounted versions
in private Trash; original folder receipts remain readable. Temporary disposable
upload approval was removed and the managed app restarted successfully.

The adapter creates absent folders only. Ordinary folder name limits remain;
a name altered by schema normalization rolls back. Native schedulers, local
writes, directory deletion, Photos, peer behavior and the full delivery ledger
remain incomplete. This does not claim native background synchronization.

Validation: 75 shared sync, 25 Files and 95 capability tests pass (195 total).
Targeted lint and the full web/Vercel build pass. Raw TypeScript retains the same
91 pre-existing diagnostics with no new normalized diagnostics. Additional real
Mongo races verified identical concurrent creation replay, one winner for distinct
case-equivalent paths, immutable receipts after ordinary edits, and rollback when
normalization would change a folder name. All folder-only fixtures were removed
through normal APIs and the disposable session was signed out.


## Foreground upload controls and completion recovery — 2026-10-17

Mobile upload/backup connections now expose Upload now, Stop and Retry through
`foregroundSync.ts`. A button click supplies the reviewed revision; fresh checks
fence pairing, root/account/origin/data plane and live network/charging conditions
before mutations. Native file access 1.1.0 adds bounded policy signals using
NWPathMonitor/battery state and Android ConnectivityManager/battery broadcasts.
Existing native permission, ownership and origin checks still apply.

Version-2 IDB preserves old pending runs and atomically checkpoints only the
current confirmed run. Immutable cloud receipts recover the original common
baseline if checkpoint storage fails after acceptance. This lets a later local
edit replace the same file, while divergent remote changes remain conflicts.
Progress is cached immediately and queued root locks can be cancelled.

Validation: 81 sync tests; lint; full web/Vercel build; unchanged 91 TypeScript
baseline diagnostics (47 normalized); Android debug/JVM/lint plus 9 emulator
tests; iOS test build plus 17 selected simulator tests. Synthetic browser checks
cover network refusal, accepted folder-response loss and reload recovery,
Stop/reload/retry and desktop/mobile layout. Real local API/storage acceptance
covers a lost accepted file commit without reupload, failed completion checkpoint,
a later local edit, stable replacement, independent byte hash and repeat no-op.
Fixture configuration/root cleanup used normal APIs; tiny charged versions remain
in private Trash. Temporary fixture admin env was removed and PM2 restarted.

Boundaries: native grants/conditions/source are adapters in the real HTTP test;
actual native file upload remains unverified. This is foreground execution with
policy checks between requests, not native background or network-bound transfer.
Chunk rehashing and repeated root scans still require performance work. Native
writes/downloads, Photos, persistent approvals/workers, peers and Mac integration
remain on the full-scope ledger; this PR is not end-to-end delivery of that goal.


## Bounded verified Android ranges — 2026-10-17

Android file access 1.2.0 opt-in ranges verify 64 KiB chunk proofs from a complete
file scan. A process-local 512-file/8-MiB LRU is scoped to owner, origin, root
grant, document metadata and content-derived version. Missing proofs fall back
to full verification; old clients retain full-file reads. The shared source
contract adds a final full verification before cloud publication, including
retry when attachment upload is already complete. Changed sources preserve the
unfinished operation and cannot publish a new stable file.

Android's byte-count test reads one file of bytes per full aligned-range pass,
while same-stamp edits, boundary-crossing reads, foreign scope, eviction and
cancellation are guarded. Ten emulator tests pass, including generated real
ContentResolver descriptors and the installed 1.2.0 bridge. All 82 sync tests,
targeted lint, Android debug/JVM/lint and full web/Vercel build pass. Raw TS
remains at the same prior baseline. iOS already used descriptor-relative bounded
reads; the new full callback preserves those checks.

An optional installed-app picker/upload acceptance is compiled and documented,
but has not passed: the available computer-use surface cannot select the running
emulator window. The passing provider test is not that acceptance. No permission
or authentication bypass was added. Streaming-only providers may reread prefixes;
large proof sets fall back to full checks, and whole-root scans per operation,
background workers and remaining full-scope delivery remain open.


## Exact-version download ranges and staged execution — 2026-10-17

Attachment-content 1.14.0 extends the existing route with at most 2 MiB exact
version ranges, strict storage framing, reauthorization before bytes return and
private/no-store responses. The shared cloud source negotiates the capability,
checks pinned file identity/name/parent/version and validates every response.
No signed storage URL reaches the sync client; no new history or storage is added.

Download folder/file operations now bind to the complete inventory and reuse the
existing immutable run, IndexedDB queue and executor. `LocalSyncTarget` defines
native private staging, verified bytes, destination CAS, recoverable replacement
and durable receipts. Missing publishers refuse execution. Tests recover an
accepted publication after response loss and journal reopen without rereading or
republishing; local races, cloud edits and invalid staged proofs fail closed.

The real loopback API/storage acceptance passes for a 17 MiB + 17 byte file:
independent full SHA-256 and multipart hash, anonymous denial, wrong-version
refusal, and stale-source refusal after replacement. The existing whole-byte
cache still rejects that size. Cleanup used normal APIs, retaining charged file
versions in private Trash; temporary fixture admin env was removed and PM2
restarted. This verifies the API/source path; the executor publisher is a fixture.

Native iOS/Android/Mac writers, download controls and interrupted native staging
recovery are still unimplemented. The complete Drive/Photos/Resilio scope remains
open. See the full delivery ledger for background, Photos, peers and release work.

Validation for this checkpoint: 86 sync tests, 289 attachment-suite tests and
89 capability tests pass. Targeted lint and full web/Vercel build pass. Raw
TypeScript remains at 91 diagnostics / 47 normalized messages, with no new
diagnostics against the preceding checkpoint. Structural graph refresh is
included; semantic freshness is not claimed.


## Durable iOS private staging — 2026-10-17

The separate `fileStagingVersion` 1.0.0 receives cloud download bytes through the
existing scoped mobile bridge. Native records retain the exact shared operation,
root grant and scope. A file lock serializes effects; byte flush precedes atomic
progress, replayed ranges must match, and interrupted tails are discarded only
beyond the durable offset. Full canonical hashes gate completion. Finished stages
are reverified on reopen. Private transfer storage is protected, excluded from
backup and bounded; it is not another file history or native write permission.

The TypeScript adapter buffers at most 2 MiB of cloud data and sends 64 KiB native
chunks. Lost replies resume from acknowledged progress; source checks, capability
negotiation, response identity and stage verification remain mandatory. Shared
entry encoding explicitly retains null SHA fields across Swift/JavaScript.

Validation: 88 sync tests, targeted lint, full web/Vercel build and 24 selected
iOS simulator tests pass; TypeScript remains at 91 baseline diagnostics / 47
normalized messages. Native tests include 8 MiB + 17 bytes, reopen/replay,
interrupted checkpoints, corrupted bytes and symlinks. A real WebKit/native handler
test negotiates the feature and stages bytes through a native bookmark, with
synthetic owner verification; this is not authenticated cloud/picker acceptance.
Build 31 is installed and launched on iPhone 17 Pro / iOS 26.5, its executable
matches the rebuilt binary, and its local web screen renders.

Still open: native write approval, destination publication and retained versions,
publication receipts, staging retention/cleanup, process-kill acceptance,
Android/Mac receivers and download/two-way controls. The complete original goal
remains active, including background workers, Photos, peers and release evidence.


## Approved iOS download publication — 2026-10-17

The connection control now connects downloads to the actual iOS private receiver
and publisher, gated by `filePublicationVersion` 1.0.0 and deletion propagation
off. A separate native consent dialog and Keychain binding authorize the native
grant, owner/origin, device/connection and reviewed configuration revision/hash.
Reselect/remove clears consent. The unchanged shared operation/receipt format
extends the existing private transfer record and browser run/checkpoint.

Publication coordinates the target, checks its expected stamp/content and uses
same-volume exclusive rename or swap with beneath/no-follow flags. Displaced
files remain private; no destructive copy fallback or blind rollback exists.
A racing uncoordinated edit is retained as a pending conflict, because filesystem
swap is not strict inode CAS. Recovery proves candidate/original identity and
content before persisting receipt; a durable receipt survives later edits without
republishing. Interrupted-before-receipt edits remain pending for conflict review.

Validation: 31 native simulator tests and 91 shared sync tests pass; targeted lint,
full web/Vercel packaging and build 32 compile pass. Whole-project TypeScript
retains its existing diagnostics; no new normalized errors. The actual WK bridge
refuses a read grant then publishes under isolated synthetic consent. Native
filesystem tests use real disposable files; consent clicks, cloud-to-native UI,
process kill/reboot, provider/physical-device behavior and conflict/restore controls
remain acceptance work. This checkpoint does not finish the full goal or PR.

Build 32 is installed on the local iPhone 17 Pro / iOS 26.5 simulator from
`iOS/build/mobile-device-tests/Build/Products/Debug-iphonesimulator/Thingtime.app`.
The installed executable, debug library and Info.plist match the rebuilt bundle;
selected URL is `http://localhost:14900`. Launch rendering is checked separately
from authenticated folder-transfer acceptance.


### Installed iOS download and real process-exit acceptance (2026-10-17)

Normal login plus production Things/Files/native consent controls completed
nested cloud downloads in the installed simulator app. Independent hashes verify
17-byte and 8 MiB + 17-byte files, then replacement with 8 MiB + 31 bytes; the
original inode/bytes remain privately retained and unchanged files preserve
inode/mtime. The opt-in installed test passed after external verification.
Fresh-process native tests also pass deliberate exit-after-rename recovery for
create, replace and local edit before recovery. Fixtures, manual acceptance and
cleanup are documented in the root README and full sync ledger.

UI-discovered follow-ups serialize background and foreground pairing checks and
report cancelled native write approval separately from unavailable folders.
These are bounded adapters around the same editable connection/receipt contracts.
Physical/provider/reboot acceptance and the wider Drive/Photos/peer-sync scope
remain unfinished.

Build 33 follow-up: changing the saved connection required fresh native consent;
Cancel displayed the corrected message, and approved retry completed without a
polling collision. Installed executable, debug dylib and Info.plist hashes match
the build; codesign verification and the running app path were checked. The
updated process-exit runner passes all three scenarios, 31 selected native tests
pass, 91 shared sync tests plus four pairing/queue tests pass, targeted lint and
full web/Vercel build pass. TypeScript remains at 91 existing diagnostics / 47
normalized messages, with no additions.


### Android private staging and real process-exit recovery (2026-10-17)

`SyncStaging` implements the shared mobile request/progress/stage shapes with
owner/origin/device/connection/native-grant bindings. Each authenticated bridge
call resolves the current account's readable grant; staging never writes to its
provider. App-private no-backup storage uses bounded 64 KiB chunks, fsync before
atomic progress acknowledgement, exact replay checks and full SHA-256/canonical
multipart verification before returning a stage. Empty folders and multipart
files retain the required explicit null digest field. Symlinks, nonregular
payloads, changed operations and corrupted stages fail closed. A cancellable
in-process lock prevents a waiting caller from opening/closing another lock
descriptor; the kernel lock also excludes other processes.

Two opt-in Android 15 / API 35 scenarios kill the real instrumentation process:
after byte fsync before its checkpoint, and after a finished-stage checkpoint.
Fresh processes preserve the operation, resume only acknowledged bytes, verify
8 MiB + 17 bytes and pass the production TypeScript response codec. Proofs are
bound to a fresh runner ID so stale crash evidence cannot satisfy another run.
The normal JVM suite passes 24 tests. The normal emulator suite executes 23
tests, including live API pairing/installed bridge checks and 13 staging tests;
the opt-in process test is skipped there and runs separately. Debug build and
lint pass; 91 shared sync tests pass; TypeScript diagnostics are exactly the
previous 91 existing diagnostics, with none added.

The installed bridge advertises staging separately from publication and accepts
a full 64 KiB chunk envelope before rejecting a missing grant. This verifies
transport/authorization dispatch, not a successful system-picker staging run.
Android 8.0 runtime compatibility, real picker staging, low disk/reboot/physical
acceptance, native write consent, safe provider publication and retained conflicts
remain open. Android Download now stays disabled. No new secret, collection or
parallel history/settings format was introduced. Reproducible commands and
cleanup are in the Android and root READMEs. The full goal remains in progress.

### Android native write approval and actual picker acceptance (2026-10-17)

Android now implements the shared `write-approve` contract with a native dialog,
exact-tree OS write selection and fresh account verification. Keystore-encrypted
approvals bind account/origin, remote root/device, configuration revision/hash
and the native selection generation. Choosing the same URI again invalidates
old consent; another account's references remain intact. Failed saves cannot
leave a new persisted write grant or revoke an existing shared grant. Reacquiring revoked OS write access clears every older approval for that tree,
including other accounts and connections. Native checks reject malformed fields and unavailable/revoked OS access.

The installed Android 15 / API 35 app passed actual picker selection, native
Cancel, same-folder write Allow, encrypted reload, identical approval retry,
changed-configuration Cancel and native re-selection invalidation. The test
removed all its folder references and verified OS read/write grant release.
The suite reports `OK (28 tests)` with one opt-in process scenario skipped:
27 tests executed, including the live account/bridge test, seven registry tests,
three Keystore tests, three provider tests and thirteen staging tests. All 26
JVM tests, debug build and Android lint passed.

A separate read-only local-provider descriptor probe opened the directory but
relative child access returned `EACCES`. Generic SAF does not promise exclusive
atomic rename or conditional replacement, so Android still advertises private
staging only; Download now remains disabled. This checkpoint is consent, not
publication acceptance. Android/Mac receivers, retained conflict recovery,
background scheduling, Photos, peer sync, rename/delete convergence, scalable
roots, physical/reboot acceptance and release delivery remain open. The full
goal remains active. Fork-safe commands are in the Android and root READMEs.

### Android offline-folder publication backend (2026-10-17)

`ManagedFileStore` adds the native storage backend for Thingtime-owned offline
folders. It does not yet expose those folders in Android Files or enable the
Download now control. Existing arbitrary SAF selections remain read/staging
only; their providers are not assumed to support atomic replacement.

The backend copies a completed stage through a read-only descriptor while the
staging lock is held, verifies both the copied content and unchanged source,
fsyncs the immutable candidate and its directory, then atomically commits the
visible entry and immutable receipt in a synchronous SQLite transaction. It
uses the existing shared request/entry/receipt formats. Editable connection
Things and Timeline remain authoritative; this is a bounded native filesystem
adapter, not a new cloud data plane or settings/history model.

Conditional replacement checks the exact previous entry and its actual bytes,
retains the old blob/version, and changes ancestor stamps. A repeated operation
returns its historical receipt without rewriting a later edit. Owner/origin,
managed root, selected grant, connection/device scope and immutable request
remain bound. Case/Unicode aliases, missing parents, forged stages, changed
source/target bytes and symlinked blobs fail closed. Two concurrent creates
produce one visible file and one successful receipt. Uncertain commits never
trigger blob deletion; unreferenced candidates are retained pending a bounded
cleanup implementation.

Validation on Android 15 / API 35: seven native backend tests plus the new
stage-copy mutation test pass; the full fixture-backed run executes 35 tests
(`OK (37 tests)` includes two skipped opt-in process tests). All 26 JVM tests,
debug build and Android lint pass. Three actual process kills before commit,
after commit and after replacement verify rollback/replay in a fresh process,
all 8 MiB + 17 bytes, retained old content, and receipt replay after a later edit.
The actual native receipts pass the production TypeScript mobile codec. Helper
lint passes; full TypeScript still reports the same 91 baseline diagnostics,
with none added.

Remaining integration: Android DocumentsProvider exposure, explicit native root
creation/removal, per-folder publication capability, current native approval
checks and foreground download controls, followed by installed-app cloud-byte
acceptance. OS Files edits, restore/retention, background workers, large-root
partitioning, provider/physical-device/reboot tests and the rest of the full
Drive/Photos/Resilio goal remain open. The current backend has a 10,000-blob
safety bound and fully verifies reads; it is not the final large-file transport.


### Android offline folders in Files (2026-10-17)

Native **Choose folder → New offline folder** now creates a named local root
with explicit disclosure of Android Files visibility, sign-out behavior,
selected-document access by other apps, access removal and uninstall. Existing
SAF selections keep their own flow. The new root opens at its canonical path
in the system picker and is bound to its creating account/origin for Thingtime
selection. Selection does not start a transfer.

`OfflineDocumentsProvider` exposes only explicitly consented roots behind
Android's `MANAGE_DOCUMENTS` permission and URI grants. Indexed, opaque document
IDs remain stable across replacement; ancestry checks prevent cross-root or
sibling access. Read-only verified snapshots preserve old open readers. Write,
rename, delete and external editor operations remain unsupported. Catalog v2
adds native document/parent indexes and Files visibility in an atomic migration;
existing v1 roots stay private. Listings reject more than 10,000 children or
4 MiB of metadata. Native paths and owner identifiers are not projected.

Installed Android 15 / API 35 acceptance verified creation cancellation, native
creation, actual Files selection, complete 8 MiB + 17-byte nested content through
ContentResolver, bridge scan and **1 file checked**, visual Files navigation,
and non-destructive access removal. The first manual attempt timed out before
selection; the successful retry reused that empty root. Test cleanup now proves
the selected root is empty before taking ownership, and deletes only its
synthetic root/blob fixtures. An ungranted shell UID was denied root discovery.

The successful manual suite reported `OK (43 tests)` (41 executed, two opt-in
process tests skipped). Final production source, including the listing budget,
passed `OK (44 tests)` (42 executed, two skipped), with seven provider tests,
26 JVM tests, debug build and lint. All three actual process-exit publication
scenarios passed again after migration, with native receipts accepted by the
production TypeScript codec. No TypeScript source changed in this checkpoint.

Android Download now remains disabled until per-root publication negotiation,
current native approval checks and managed scan/read/publication dispatch are
connected. No cloud-download claim is made from synthetic native publication.
Root deletion/retention, writable Files edits, large-root performance, physical
and API 26 devices, reboot/power loss, background scheduling, Photos, peer sync,
Mac receivers and complete convergence/release acceptance remain open. The full
goal remains active. Fork-safe setup and manual confirmation steps are in both
READMEs; no new secret, service or broad storage permission is required.


## Android foreground offline-root download adapter — 2026-10-17

Download now now negotiates each native folder's publication capability and
requires exact-connection native approval. Android offline roots use verified
staging and atomic catalog/receipt publication; generic SAF roots stay read/upload
sources. Grant generation, account/device/configuration and OS read permission
are rechecked, including before commit. Android Files receives publication
notifications. The shared client preserves legacy iOS publication compatibility.

Installed cloud transfer passed independent text/nested 8 MiB byte hashes and
repeated download. Visual Files navigation and non-destructive grant removal also passed. Final
Android suite: 46 executed checks, two skipped opt-in process cases (`OK (48
tests)`), 26 JVM checks, debug build and lint. Full evidence is recorded in the
[full ledger](../docs/mobile-file-sync.md#android-foreground-offline-root-download-integration-2026-10-17).
The run exposed a media-worker interception boundary; pinned/actor-scoped reads
now pass directly to the API. Regression suites pass 93 sync and seven media
checks, plus four new native authorization adapter cases. Full TypeScript has
91 unrelated diagnostics. No production release or full-sync completion claim.


## Two-way foreground connections — 2026-10-17

Eligible mobile roots now expose Sync now. The existing shared runner executes
both directions in one recoverable run, with native folder approval and deletion
propagation disabled. Mixed lost replies recover without duplicate effects;
conflicting initial content stops before mutations and preserves both copies.
No parallel storage or new server API is introduced.


Installed Android 15 / API 35 acceptance passed the actual Sync now flow with
native approval cancellation/retry. Initial cloud text (17 bytes), nested cloud
content (8 MiB + 17 bytes) and a native upload (257 bytes) converged. Independent
edits then replaced the cloud content with 8 MiB + 31 bytes and the native upload
with 513 bytes. Full ContentResolver/download SHA-256 checks matched both sides;
the uploaded cloud file kept its identity and advanced its revision. Repeated
sync preserved cloud revision and canonical native entries. Android Files showed
the final root/nested entries; removing access preserved the four catalog entries.
Native edits used the production catalog fixture, not an external Files editor.

The suite reported `OK (48 tests)` (46 executed, two opt-in process cases skipped).
Debug build, Android lint and the 26-test JVM task passed (cached where unchanged).
Shared sync tests pass 96/96 and targeted ESLint passes. Full TypeScript has the
same 91 diagnostics as the preceding checkpoint, with byte-identical output and
no changed-file errors. Temporary local admin configuration was restored before
acceptance; cloud fixture cleanup retained accounted versions in private Trash.
Native fixture cleanup removes its active records/blobs; retained replacement
bytes and staging are not claimed to be fully erased. No production deployment,
iOS mixed-direction acceptance or full-goal completion is implied.


## Shared Apple native receiver — 2026-10-17

`apple/FileSync` now contains the single native folder grant/reader/publication
implementation. iOS imports the local package and retains its bridge and storage
identity. macOS uses security-scoped bookmarks and explicit private staging paths;
same-filesystem conditional publication and retained conflicts remain required.
The same real-filesystem tests and process fixture run on both platforms.

Mac native tests passed 22/22. Three actual post-rename/pre-receipt process-exit
scenarios passed on Mac and iOS: create, replacement and later local edit.
The iOS focused suite passed 50 checks plus one scope-compatibility check; the
Mac library release build passed. Full results are recorded
in the [delivery ledger](../docs/mobile-file-sync.md#shared-apple-receiver-and-mac-filesystem-recovery--2026-10-17).
No installed Mac transfer is claimed: desktop picker/consent/dispatch, Keychain,
TCC/sandbox, cloud UI and signed delivery remain open, alongside the full goal.


## Mac local folder adapter and device revocation — 2026-10-17

The signed Node now wraps the shared Apple folder core behind local-only XPC.
Native selection/consent, exact connection approval, bounded bytes and matched
cancellation are implemented. Fresh server identity selects the exact paired
credential; owner-only disconnect revokes that device's sessions while preserving
history/files. Both new routes are registered and versioned. No Electron preload
or product transfer control is enabled before active browser-account verification.

Validation passed 29 focused native checks, the Node release build, 94 device and
95 capability checks, targeted lint and real loopback signed-pairing/revocation
acceptance. TypeScript retains the exact previous 91 diagnostics. Broader controller
checks abort in XCTest due to its missing Bluetooth usage description. Actual
Mac dialogs/Keychain/TCC, host integration, streaming performance and signed release
remain open. Details and retained fixture history are in the
[delivery ledger](../docs/mobile-file-sync.md#mac-local-host-and-live-identity-boundary--2026-10-17).

## Desktop folder host and shared controls — 2026-10-17

The Mac folder adapter now connects to the existing folder/configuration editor
and foreground runner in Things and Settings. The Electron host verifies its own
current cookie-session account, exact bundled main frame and configured server
around native XPC; the node separately verifies its paired owner/device. Public
server capabilities are anonymously fetched and projected. Native results now
include the shared complete-scan/read identity and network/charging contract.

The renderer runtime keeps the server origin in sync scope and maps authenticated
API calls onto the bundled cookie session. Expected actor/home/API-origin guards
permit only the narrow desktop sync proxy route family; endpoint changes fail
before mutation bytes are forwarded. Response origins/redirects are checked;
signed upload URLs never receive account cookies. Generic Browser Actions remain
blocked from fallback. Queueing preserves original request/cancellation identity
across StrictMode remounts; no copied editor, cloud writer or alternate history
schema was introduced.

Verification: 109 shared-sync/proxy tests, one module-mock transport test, 111
Electron tests and 30 focused native tests passed (251 total). The native release
build passed. A real isolated Electron/Chromium profile passed session account,
anonymous capability, proxy destination, subframe and cookie-cancellation checks;
its native dispatch was synthetic. In-app browser exercised actual shared controls
with synthetic APIs/grants: scan, save, foreground completion, unsaved draft reload
and 390px bounds; mobile controls still passed. Targeted lint has zero errors and
five existing ThingsPage hook warnings. Full TypeScript is still the identical
91-diagnostic baseline. Full web/Vercel build and packaged-output verification
passed. The final Graphify refresh establishes structural coverage only.

Do not release this as completed Mac synchronization yet. Real signed installed
picker/consent/Keychain/TCC and cloud transfer acceptance, native streaming/rate
limits and durable desktop restart storage remain open. Desktop at this checkpoint used
an ephemeral loopback origin; a same-page reload does not prove its IndexedDB or
local drafts survive a complete app restart. Background workers, Photos, peers,
rename/delete convergence, conflict/restore UI, retention/selective availability
and physical-device coverage remain part of the active original goal.


## Desktop restart persistence — 2026-10-17

Closing Desktop previously changed its local origin and stranded its IndexedDB
sync journal and editor drafts. Desktop now owns a stable loopback socket per
profile, loads Nitro's `node_middleware` output, and atomically publishes a flushed,
private address record before opening the renderer. It refuses occupied ports
and invalid records; it never probes the other process or silently changes the
address. Only HTTP cache is cleared. The canonical shared journal, draft and
Timeline contracts remain unchanged.

Four separate isolated Electron launches against the actual staged Nitro bundle
verify pending run/draft persistence, original operation IDs, confirmed-operation
skipping, synthetic lost-reply receipt recovery, full completion baseline,
account/origin isolation and collision refusal/recovery. The fixture uses the
production shared modules and no native dispatch. Electron unit coverage includes
record corruption, symlink/non-file refusal, exclusive first publication, bundle
failure cleanup and readiness; all 127 Electron tests pass. Full Desktop web/AI build and resource verification
pass. No installed profile, native node or LaunchAgent is touched.

Older random-port data remains untouched and is not migrated. Signed installed
Mac transfer acceptance, native streaming/rate limits, power-loss/reboot and all
other remaining full-feature goals are still open. This checkpoint closes the
isolated restart-storage gap, not the complete sync delivery gate.


## Mac adapter/cloud acceptance and bounded cooldown — 2026-10-17

A new opt-in pipe fixture connects production MacFolderSync/AppleFileSync and
ThingtimeAPIClient to the real local APIs and shared foreground sync engine.
It verifies mixed creates, independent replacements, full hashes, stable IDs and
convergence, retained cloud versions, lost accepted cloud/native replies, original
operation recovery across a native process restart and disconnect refusal.
Picker/consent, conditions and credential storage are explicit test adapters;
Electron/XPC, installed Keychain/TCC and AppKit remain separate release gates.

Extended acceptance reproduced HTTP 429 from per-request native identity checks.
The client now waits for one valid integer Retry-After (1–60 seconds), then checks
cancellation and the original credential before retrying the live endpoint. It
never caches identity or retries auth failures, malformed/long delays or repeated
429s. The full rerun passed with 129 native calls, 259 verifier invocations and
one 47-second cooldown, exactly four PUTs and two native publications. All 23
focused Mac/API tests, targeted script lint and the production ThingtimeNode
release build pass. Native streaming and
sustained throughput remain open; these counts are not a performance pass.

The test signs out/disconnects its fixture, removes its private local directory
and ordinary config/folder Things, and retains accounted byte versions in private
Trash and protected device history. It needs no new secrets/admin environment
changes and never touches the installed app or service. Detailed commands and
coverage are in README, TESTING and the full sync ledger.


## Native authorization before network deadlines — 2026-10-17

Reproduced an unsent-request timeout: the JSON deadline began before foreground
native authorization, so the valid native cooldown could exceed its 30 seconds.
The shared runtime now exposes mutation authorization separately; JSON and signed
PUT writers await it before starting HTTP time, then recheck scope/cancellation
and source identity. Bodies remain captured before waiting, reads bypass mutation
authorization, and existing 30/120-second network limits remain unchanged.

The regression fails before the fix and passes after it. All 105 shared checks
pass; targeted lint passes and TypeScript is byte-identical to the existing 91
errors. Real Mac/API acceptance forced a cooldown immediately before upload:
61,971 ms of preflight including a 50-second server wait, followed by a successful
request with a fresh signal. Full mixed transfer/replacement/recovery/revocation
acceptance still passed with four PUTs and two native publications. The extra
fixture read traffic deliberately exhausts only its disposable device budget;
it is not a sustained-throughput claim. Installed acceptance, streaming and the
full-feature remainder stay open.

## Mac bounded range streaming — 2026-10-17

Mac file access 1.2 connects the shared upload source to `read-range`. One
coordinated native file descriptor supplies up to 32 MiB through acknowledged
64 KiB XPC frames. Source stamps are checked between frames and the current path
is checked again at completion. The native verifier runs before/after the range,
not for each frame; no identity cache, rate-limit increase or network authority
is introduced. The existing request timeout/cancellation and exact owner,
origin, device, root, path and version binding remain. A stalled consumer has a
15-second acknowledgement limit; its disconnected helper cannot keep reading.

The signed bridge writes framed stdout with backpressure. Electron's bounded
parser rejects missing/reordered/duplicate/oversized frames and invalid final
metadata, and holds provisional bytes until the final native and browser account
checks succeed. Renderer IPC carries binary bytes rather than a giant base64
JSON message. Ordinary XPC request/reply limits stay at 1 MiB. The generic and
remotely leased node dispatchers still cannot read folders. Older Mac/mobile
bridges keep the existing chunked path; the journal and canonical file/Timeline
contracts are unchanged.

Validation: 106 shared tests, 132 Electron tests, 23 AppleFileSync tests and 11
Mac/XPC tests pass. A real anonymous XPC connection transferred 129 frames and
stopped on a refused acknowledgement. Native tests verify two live checks for an
8 MiB-plus range, late revocation, changed/replaced files, consumer refusal and
midstream cancellation. Isolated real Electron verifies binary range IPC and
refusal after account change; native dispatch there is synthetic. Native release
and production web/Vercel builds pass; targeted lint passes. TypeScript output
is byte-identical to the existing 91 diagnostics.

Real native/API acceptance with `--large-upload` passed upload/download,
independent replacement, lost replies, process restart, original-ID recovery,
full byte hashes, retained versions and revocation. It used 141 native calls,
283 verifier invocations, three streamed ranges totaling 8,388,882 bytes, five
PUTs and two publications, with one 46-second cooldown. These totals include
seeding, scans and other checks; they are not a sustained-throughput benchmark.
The fixture uses synthetic picker/consent/conditions and private credential
storage, not installed XPC/Keychain/TCC. Download staging, mobile streaming,
background execution, Photos, peers and the remaining delivery ledger stay open.

## Mac download range staging — 2026-10-17

Mac file staging 1.1 adds `stage-range` to the shared download target. The runner
passes one 2 MiB cloud range as binary Electron IPC; the signed helper receives
bounded metadata followed by raw stdin bytes, and the native staging worker pulls
64 KiB XPC frames sequentially. Metadata is capped at 128 KiB, individual ranges
at 32 MiB, and source callbacks have a cancellable 15-second monotonic timeout.
The existing signed-parent/peer checks and before/after live device and browser
account checks remain. No identity cache, new network permission or endpoint.

`MobileSyncStaging.appendStream` holds the existing record lock for one range,
validates its immutable operation, writes bounded frames, flushes payload bytes,
then saves the received offset. Old 64 KiB append calls use that same primitive.
A partial or flush-before-checkpoint failure leaves only an uncheckpointed private
tail, truncated on resume. A replay must match retained bytes. Late authorization
refusal may leave durable private progress but cannot publish into the selected
folder. Final content hashing, destination-version checks and native publication
approval remain unchanged; the journal and Timeline formats are unchanged.

All 107 shared tests, 134 Electron tests, 25 AppleFileSync tests and 14 Mac/XPC
tests pass. Tests cover partial/oversized input, sequential pull offsets, aborted
ranges, flush-before-checkpoint recovery, byte-matching replay, two live checks
for a 33-frame range and late identity refusal. Real anonymous XPC verifies the
pull protocol; isolated real Electron verifies binary staging IPC with synthetic
native dispatch. Native release and production web/Vercel builds and targeted
lint pass. TypeScript is byte-identical to the existing 91 diagnostics.

Real API acceptance with `--large-upload --large-download` passed both directions,
independent replacements, lost cloud/staging/publication replies, native restart,
original operation IDs, no byte-range replay, full hashes, retained versions and
revocation. Three staged ranges totaled 2,097,432 bytes; three upload-source
ranges totaled 8,388,882 bytes, with five PUTs and two publications. The run made
150 native calls / 301 verifier invocations and honored one 44-second cooldown.
These totals include setup/recovery and are not a throughput benchmark. The
fixture uses synthetic picker/consent/conditions and private credential storage;
signed installed XPC/Keychain/TCC, mobile streaming, persistent workers, Photos,
peers and the rest of the requested product remain open.


## Installed iOS two-way acceptance and WebKit fetch binding — 2026-10-17

A real iPhone 17 Pro / iOS 26.5 simulator run exposed a mobile regression after
Mac host routing was added: the mobile fallback copied `fetch` into the transport
object, so WebKit rejected inventory reads with “Can only call Window.fetch on
instances of Window.” `MobileSyncConnections` now calls through `window.fetch`;
the desktop host's scoped fetch remains unchanged. The editor browser fixture
uses a receiver-sensitive function so an unrelated transport receiver fails.

Build 33 was rebuilt with the explicit loopback origin and installed. CUA used
the actual Things connection editor, native folder picker and Cancel/Allow
writes dialogs with a disposable account. Cancellation preserved the local
source and published no downloads. The two-way run then uploaded 257 bytes and
downloaded a 17-byte text file plus an 8 MiB + 17-byte nested binary. Independent
edits replaced the upload with 513 bytes and the cloud binary with 8 MiB + 31
bytes. Full local and authenticated cloud-download SHA-256 hashes matched each
expected version. Cloud file IDs stayed stable, the changed revisions advanced,
and the unchanged text file kept its inode/mtime. A completed repeat retained
all cloud revisions and local inodes/mtimes. Local edits were disposable
container-file writes, not an external Files editor acceptance.

The opt-in installed XCTest passed after external byte verification (one test,
zero failures). All 107 shared sync tests and targeted ESLint passed; full
TypeScript output is byte-identical to the existing 91 diagnostics. No native
permission or pairing response was injected. This verifies foreground two-way
transfers on the simulator's local provider; external Files editing, interrupted
two-way restart recovery, settings reapproval, physical devices, mobile streaming,
background workers, Photos, peers and the remaining product scope stay open.


## Android saved-settings reapproval acceptance — 2026-10-17

The installed two-way test now revises a saved connection's name and exclusion
list through the normal revision-guarded Things API after both sides converge.
It refreshes the actual connection controls and starts Sync now, requiring a new
native approval. Cancelling must leave the complete cloud inventory and native
entries unchanged, including full local byte hashes. Allowing the retry must
converge without changing cloud revisions or native identities. Inventory
comparison canonicalizes each node and sorts the signatures, retaining all
metadata while ignoring response order. Production operation serialization is
unchanged.

This covers settings saved elsewhere and consumed by the installed Android app.
It does not establish connection-form editing, iOS reapproval, concurrent edits,
interrupted two-way restarts, background execution, or physical-device coverage.
The test still uses synthetic local edits rather than an Android Files editor.

The Android 15 / API 35 emulator run passed all 46 executed native checks, with
both opt-in process-restart cases skipped (`OK (48 tests)`), plus the 26 JVM
checks, debug build and lint. The new consent check passed after independent
257-to-513-byte uploads and 8 MiB-plus cloud replacements, repeated convergence,
and real Files inspection. No consent or grant reply was fabricated. A first
attempt exposed a test-only array serialization mistake before the reapproval
step; node-wise canonical comparison fixed it, and the full sequence was rerun.
Fixtures use normal cleanup and retain accounted cloud versions in private Trash.

## Android binary download ranges — 2026-10-17

Android staging 1.1 negotiates WebView ArrayBuffer support, using the existing
origin/main-frame restricted bridge. A native range pulls at most 64 KiB per
nonce-bound frame; the shared downloader supplies 2 MiB ranges. Account identity
and native read grants are checked before/after a range, foreground/cancellation
checks run throughout, and the staging lock spans frames plus the single durable
checkpoint. Retained replay compares all bytes; an interrupted tail is truncated
back to the acknowledged offset on resume. Final hashing and native publication
approval remain separate. No shared storage/schema or permission is broadened.
Old Android WebViews retain staging 1.0, and iOS retains its existing chunk path.

The installed API 35 app downloaded 8,388,642 payload bytes using six ranges
and 130 bounded binary frames, with zero legacy append messages and independently
verified final hashes. JVM frame tests and real Android staging tests cover
stale/duplicate frames, incorrect lengths, cancellation, timeout, multi-frame
replay and interruption before durable acknowledgement.

The complete installed two-way sequence passed independent 257-to-513-byte local
uploads and an 8 MiB-plus cloud replacement, repeated convergence, changed-settings
consent cancellation/retry and real Android Files inspection. Across both cloud
versions it used 11 ranges, 259 frames and 16,777,281 payload bytes with no legacy
appends. Cloud identities/revisions, local identities and full hashes passed the
existing assertions. Native consent and grant replies were not fabricated.
The runner reported `OK (50 tests)` (48 executed, two opt-in process-restart cases
skipped), including 16 real-filesystem staging checks; all 29 JVM checks, debug
build and Android lint passed. Shared sync tests passed 110 checks; 13 focused
transport/staging checks were rerun after the deadline change. Targeted ESLint
passed. Full TypeScript retains the same 91 baseline diagnostics with no new ones.

This establishes bounded foreground download transport on the API 35 emulator,
not a throughput benchmark. Physical devices, older WebView runtime fallback,
Android upload ranges, iOS streaming, installed binary interruption/restart,
background workers and the remaining sync product scope stay open. Fixtures use
normal cleanup, retaining accounted cloud versions in private Trash.

Installed validation exposed that the former 30-second per-chunk request deadline
was too short for a multi-frame range: a diagnostic run transferred 124 binary
frames (8,060,945 payload bytes), checkpointed earlier ranges, then stopped a
later range while still receiving frames. Range requests now use the existing
five-minute long-transfer deadline on both sides; an individual stalled frame
still fails after 15 seconds, and foreground cancellation remains immediate
between frames (at most 100 ms while waiting). No timeout or identity check is
removed. The first run also caught an outdated test capability assertion,
which now follows actual WebView binary support.

## File conflict review and guarded choices — 2026-10-17

Foreground sync now pauses at an explicit paginated conflict review. File choices
copy the selected device/cloud version through the existing conditional writer;
one-way connections retain their configured direction. A surviving file can be
restored to an absent counterpart, but the review cannot authorize deletion,
replace folders or bypass excluded descendants. Those conflicts remain visible
for repair in the source folders. Existing native approval and cloud retained
versions remain in force; restoration browsing and keep-both renaming are separate
remaining work.

Before applying choices, the runner reauthorizes the current account, device,
settings and conditions, rescans both folders and requires every reviewed conflict
to retain its exact identities, versions, content and reason. A changed or missing
conflict refuses the entire selection before journal writes or effects. Accepted
choices become ordinary immutable copy operations in the existing durable run;
retry uses those same operations without asking for a different choice. No new
schema, permission, storage collection or parallel history is introduced.

All 116 shared checks pass, including stale-review races and durable choice
recovery. The real local API test verifies cancellation/stale review without
writes, an accepted choice with lost commit/reopen, no duplicate prompt/upload,
stable file identity, exact hashes of both retained versions and repeat convergence.
Its native adapter is synthetic. Browser checks exercise the production connection
control with synthetic APIs: 22-conflict pagination, incomplete-choice gating,
stale cloud revision refusal, Cancel review and Stop transfer. Measured 390px and
1280px layouts have no horizontal overflow; the long filename wraps on the phone.
Targeted TS/TSX ESLint passes; the existing ESLint parser does not support the
`.mts` integration script (it fails on its pre-existing typed fetch declaration).
Full TypeScript retains exactly the prior 91 diagnostics.

Installed Android 15 / API 35 acceptance passed cancellation with unchanged cloud
inventory and native entries, then separate cloud-winner and device-winner rounds
through the real review controls. Both rounds independently hash native and cloud
bytes and repeat sync without changing native entries. Settings reapproval,
initial/replacement downloads and Android Files inspection also pass. The runner
reports `OK (50 tests)` (48 executed, two opt-in restart cases skipped); 29 JVM
checks, debug build and lint pass. The complete sequence transferred 12 binary
ranges, 260 frames and 16,777,314 bytes with zero legacy appends. Edits are synthetic
fixture setup in a real selected native folder, not external Files editor coverage.
Fixture cleanup succeeded; accounted cloud versions remain in private Trash.
Signed Mac, iOS and physical-device review acceptance remain pending.

The review includes muted grey reassurance that ignoring the conflict preserves
existing data in its current folders. It deliberately does not promise retrieval
by a content ID before retained-version browsing exists. When one copy is missing,
it refers to existing data rather than claiming two copies exist. The final copy
was checked in the browser at 390px and 1280px, with no horizontal overflow.
