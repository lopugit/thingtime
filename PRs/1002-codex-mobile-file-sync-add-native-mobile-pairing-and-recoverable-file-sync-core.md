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
