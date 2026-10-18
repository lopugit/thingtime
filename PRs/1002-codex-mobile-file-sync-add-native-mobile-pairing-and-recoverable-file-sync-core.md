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

## Retained cloud file History — 2026-10-17

The shared Timeline now renders before/after retained file versions. It exposes
canonical multipart content IDs and the existing authorized attachment download
route. File Things open home history. Restore reviews the current file, keeps its
current name and folder, takes it out of Trash if needed, and uses the existing
revision-guarded file commit API. A small account/origin/file-version-scoped local
command is persisted before POST; reopening that version retries the same operation.
Canonical file history and bytes remain in Timeline and accounted attachments.
Completion validates the owner/file/operation-derived receipt ID, exact attachment,
size, fingerprint and reviewed placement before retiring the pending command.

Browser fixture acceptance covers Cancel, a concurrent edit refusal, fresh review,
an accepted-write/lost-reply/reopen retry with one write, and an account change
during a delayed read. Layout was measured at 390px and 1280px without overflow.
The fixture is `remix/scripts/file-history.browser.html`; it uses the actual shared
version card and API client with synthetic responses. This does not establish
installed native downloads or restore, cross-folder content-ID lookup, or durable
retention of ignored native conflict copies. Those remain in the full goal.

Real HTTP acceptance passed after the managed worktree stack was restarted and
Nitro finished warming: same stable file ID, current name/folder preserved on
restore, exact serialized retry, both retained byte hashes, independent content
IDs, Timeline projections, stale/concurrent writer refusal, and anonymous denial.
The synthetic file was moved to private Trash with accounted versions retained.
The direct API-port diagnostic correctly refused a signed upload URL belonging
to the configured web origin; no origin guard was relaxed. Early runs hit Nitro
runner readiness errors, so only the final successful run establishes acceptance.
121 shared file-sync tests and nine focused file-history/scope tests pass;
targeted lint passes. Full TypeScript matches the same 91 baseline diagnostics.
The conflict review now links each cloud file to its home History, with measured
390px layout and cancellation preserving both folders. Installed native restore
and downloads are still unverified.

## Installed file History follow-up — 2026-10-17

The real app uses React StrictMode; its effect replay exposed a dormant restore
control because cleanup marked the card inactive without setup restoring it.
The card now reinstalls its current enabled state and identity subscription
together. Abort and account fences remain in place. The browser fixture now
uses StrictMode too, with verified Cancel, lost-reply/reopen/exact-retry and
delayed-read/account-change checks.

Shared History cards also recognize validated canonical file snapshots, retain
the historical filename and participate in Files and filename filters. A
regression failed with the generic “Thing” title before the fix. The 239 Timeline
tests and 19 focused history/scope tests pass; targeted lint passes. The full
TypeScript output matches the same 91 baseline diagnostics.

Android's opt-in `THINGTIME_FILE_HISTORY_TEST=1` seeds two private file versions
and exercises the real History screen through the existing installed-app
runner. It distinguishes full authorized byte reads from native export; the
WebView has no download handler yet. At that checkpoint, native export and universal
content-ID retrieval remained unfinished work.

Installed API 35 Android acceptance passed against the real local API: two
retained versions appeared in Files/filename History filters, Review and Cancel
left the revision unchanged, Restore committed the earlier attachment, and both
complete byte hashes still matched. The debug runner finished `OK (50 tests)`
(48 executed, two opt-in process-restart checks skipped), with build, JVM tests
and lint passing. Both APKs were reinstalled and the app relaunched. One earlier
login attempt returned a transient 503; the successful run followed without a
server restart or weaker authorization. Native export was outside that checkpoint; the subsequent Android export acceptance is below.

## Android historical file exports — 2026-10-17

`fileExportVersion` 1.0.0 connects the shared History **Save this version**
action to Android's system Save As picker. `AttachmentExport` reuses the native
sync-entry validator, checks the exact attachment identity and fingerprint, and
streams authenticated 2 MiB ranges into private cache. HTTP redirects and
unexpected range framing are rejected. `FileExportBridge` rechecks identity
before provider writes and verifies the saved document's complete multipart
fingerprint before replying. No sync connection, broad storage access, raw URL
or persistent folder grant is introduced. Picker responses have distinct request
codes; cancellations remain accepted while the picker pauses the activity.

The user chooses the destination and filename. Cancel, navigation, account or
session changes abort the request. A provider interruption can leave a partial
new document; the UI says to check Files and never silently retries a save.
Private staging is removed after completion/cancellation and stale staging is
cleared on activity recreation. This is foreground export; resumable background
export, iOS/Mac native export, physical-device/provider coverage, and universal
content-ID retrieval remain open.

Focused client tests cover support negotiation, account/origin/request matching,
exact version receipts, cancellation and late callbacks. Native JVM checks cover
multi-range/multipart streaming, saved-byte readback, truncation, corruption,
extra bytes, cancellation, unsafe names, changed identity, redirects and headers.
Installed acceptance uses the existing History fixture with the additional
`THINGTIME_FILE_EXPORT_TEST=1` flag; instructions are in `android/README.md`.

Installed API 35 acceptance passes Cancel, sequential Save As of both versions
under the same suggested name, provider readback, reviewed restore, and retained
cloud-byte verification. Independent ADB pulls confirm 128 bytes of value 11
(SHA256 `b7b51001618538e6d5f1737784b97e278b90e56bcfae909b92c631d930fb0552`)
and 257 bytes of value 22 (`48b5c09d2ff719f6df7e93734e1beda6ef2fc119b238a0950bdeb38a9b5b8af1`).
The system picker preserved the first file and added `(1)` to the second name.
The installed runner reports `OK (50 tests)` (48 executed; two opt-in restart
cases skipped). Native JVM coverage is now 35 passing checks; targeted lint
passes and TypeScript still matches the same 91 pre-existing diagnostics.

The first installed runs exposed an overbroad session fence: comparing the full
Cookie header could stop export when unrelated browser cookies changed. The
adapter now pins only the exact `tt_auth` credential used by the server, rejects
missing/duplicate credentials, and still checks the live owner after the picker.
Unit coverage distinguishes cookie reordering/preferences from changed auth.
Native error guidance now reaches the shared History error display. Earlier
readiness failures during web rebuilds and the failed zero-byte exports were
not accepted as success; the successful run used a stable managed server.

## iOS historical file exports — 2026-10-17

The iOS shell now negotiates `fileExportVersion` 1.0.0 for the shared History
**Save this version** control. `FileExportBridge` accepts only main-frame,
current-origin requests, pins the exact authentication cookie, negotiates
`api.auth-me` and `api.attachment-content` 1.14.0, and rechecks the live owner
before and after the Files destination picker and after the save. Unrelated
cookie changes do not cancel work; account/session, navigation, background,
explicit cancel and deadline boundaries cancel pending work.

`FileVersionExport` in the shared Apple package validates the existing sync
fingerprint contract, reads bounded 2 MiB exact-version ranges into request-owned
private cache, and verifies bytes before exposing the destination picker. The
picker grants access to one chosen folder for this save, with no bookmark or
persistent sync grant. A coordinated 64 KiB copy is flushed and verified before
exclusive publication; existing names and symlinks receive a collision suffix
instead of replacement. The saved file is read back before success. Failure
after publication preserves the file and tells the user to check Files before
retrying. Normal completion/cancellation removes private staging; process-crash
cache reclamation and resumable background export remain separate work.

Validation: 30 AppleFileSync tests and 29 selected iOS bridge/device/destination
regressions pass. A rebuilt, installed iOS 26.5 simulator app passes real API and
manual/CUA History acceptance: cancel without writes; save both versions into
the same selected folder; preserve the first filename and create `(1)` for the
second; cancel restore without changing the current revision; restore the
earlier version and independently read back both retained cloud versions.
Independent destination reads confirm 128 bytes of value 11 and 257 bytes of
value 22. Initial fixture setup used uppercase Swift UUIDs, which the existing
file-commit contract correctly rejected; the fixture now generates canonical
lowercase IDs. The successful test uses normal APIs throughout and moves its
synthetic cloud file to private Trash; local exports remain available for inspection.

This proves the installed simulator's local Files provider, not physical iCloud
or third-party provider behavior. Installed account-switch/revocation while
saving, low-storage/process-kill scenarios, Mac native History export/restore,
native retained-version browsing, cross-folder content-ID lookup and durable
ignored-conflict retention remain open with the broader sync ledger.

## Android binary upload ranges — 2026-10-17

Android now advertises `fileAccessVersion` 1.4.0 when its installed WebView
supports binary messages; older WebViews keep 1.3.0. The shared upload source
negotiates `read-range` and keeps the existing base64 path for older hosts.
A range is bounded to 32 MiB (the upload executor normally reads smaller
ranges), verified natively, then delivered as at most 64 KiB binary frames.
Frames bind a request UUID, a fresh acknowledgement nonce and relative byte
offset. Only one frame is outstanding; stale acknowledgements are ignored,
malformed acknowledgements fail, and a missing acknowledgement times out.
JavaScript returns bytes only after every frame and the exact final metadata
match. Cancellation removes the listener and suspends the exact native request.

SAF range reads reuse the account/root/version-scoped chunk proofs from a full
scan and read one provider stream per range; cache misses revalidate the whole
file. Managed offline ranges verify their immutable blob and current catalog
entry before returning bytes. Both paths retain the full source verification
before cloud publication. The native owner is rechecked before disclosure;
every frame checks the selected grant, foreground generation and pinned auth
cookie. No provider URI, filesystem path or credential enters a frame.

This is foreground bounded-range transport. It does not establish background
sync, iOS binary transfer, restart-resumable native upload sessions, generic
provider publication or physical-device performance. The managed adapter still
hashes the full blob for each range, and one verified range is buffered natively.


Installed Android 15 / API 35 acceptance passed the real SAF picker and shared
Upload now control for an 8,388,625-byte file. It used two binary ranges and
129 frames with zero legacy multi-byte reads. An independent cloud download
matched the original full SHA-256. The complete runner passed 49 executed checks
with two opt-in process-restart cases skipped (`OK (51 tests)`). Both installed
APKs match the final build hashes and the development app was relaunched.
The first run timed out on an obsolete “Last upload finished” test predicate;
the corrected assertion uses the current shared “Last transfer finished” status
and the uniquely named new connection, so another completed card cannot pass it.
Process-scoped counters now identify transfer-stage progress without logging bytes
or credentials. The synthetic cloud file is retained in private Trash after cleanup.

Final verification: 127 shared file-sync checks and 39 JVM tests pass, with Android
build/lint and targeted ESLint passing. TypeScript remains at exactly the same
91 normalized baseline diagnostics. The screenshot captures the installed control
showing completion; this run is functional emulator acceptance, not a sustained
throughput benchmark or a physical-provider test.


### iOS native cloud download transport — 2026-10-17

iOS `fileStagingVersion` 1.2.0 now downloads pinned cloud ranges natively through
the same request-owned transport as History export. This removes base64 byte
messages from cloud downloads on the iOS 17+ deployment target while preserving
the shared planner/journal, exact source checks, fingerprint, native consent and
publication receipt. Responses are bounded to 2 MiB; native staging uses 64 KiB
slices. Each request reauthorizes the owner and pinned file at the selected
origin and checks the exact folder grant. The ordinary native request deadline
is five minutes, with a separate 30-second timeout for each HTTP request.

WebKit did not reliably emit observer notifications for native auth-cookie
changes in the transport test. An active 250 ms identity check supplements the
observer and immediate request-boundary checks, cancelling network/picker waits
without treating unrelated cookie changes as account changes. The new tests
cover binary bytes, bounds, expected-actor/home headers, wrong origin, cookie
changes and exact cloud descriptor matching. The shared staging test covers
lost acknowledgements with offset resume and no JavaScript byte reads.

Installed iOS 26.5 simulator acceptance passed the actual folder/consent controls,
initial download, replacement and no-change repeat. Independent cloud/native
SHA-256 checks matched 8,388,639 replacement bytes plus a 17-byte sibling; the
repeat retained both inodes and modification times. The test observed 11 native
ranges, 16,777,281 bytes and zero legacy appends. The initial full native file
also matched the original 8,388,625-byte fixture hash. Shared checks pass 128,
Apple package checks 30 and focused native checks 30. Targeted lint passes;
TypeScript remains at the same 91 normalized baseline diagnostics.

This does not complete iOS uploads, background transfer, Photos backup, physical
device performance or retained conflict lookup. See the current scope matrix in
`docs/mobile-file-sync.md`; the overall cross-platform sync goal remains open.


The user expanded the goal on 2026-10-17 to include whole-backup snapshots,
Timeline version recovery, resumable 100 GB–100 TB exports and a future physical
media delivery path. The explicit requirements and current archive-size limits
are recorded in `docs/mobile-file-sync.md` under “Whole-backup snapshots and
Timeline recovery”. This remains implementation work; existing retained file
versions must not be described as an independently recoverable total backup.

### iOS History regression verification — 2026-10-17

The shared native transport passed installed History acceptance on the dedicated
`Thingtime file sync acceptance` iOS 26.5 simulator: explicit picker cancellation
left no local files or cloud revision change; both 128-byte and 257-byte versions
saved with collision-safe names and matched independent byte assertions; restore
cancellation preserved the current revision; restoring the earlier bytes created
a new revision and both original cloud attachments remained readable. The real
API fixture was moved to private Trash afterwards. `FileExportInstalledTests`
now observes genuine native replies at document start through a native test
handler, so a development-page reload cannot erase its acceptance counter.

Earlier runs were interrupted by another simulator installation, local API
outages, and lost page-local observation; they are not passing evidence. The
successful run ended with `IOS_HISTORY_PASS` and zero test failures. A stalled
shared PM2 daemon required a task-local daemon: run the same `npm run web-pms`
with `PM2_HOME=/tmp/thingtime-mobile-file-sync-pm2`, and use that identical variable
with `npm run web-pms-stop` when retiring this test stack. Ports remain the
worktree's 14900/14901/14902 trio; no unrelated daemon was stopped.

The new whole-backup scope above remains unimplemented. Per-file History and
small acceptance fixtures do not establish a complete snapshot or 100 TB export.

## Alternate-version retention — 2026-10-17

The files API now retains an alternate verified upload without publishing it as
the live file (`kind=retained-version`, `api.files` 1.3.0). The existing attachment
binding/accounting transaction appends an owner-private Timeline effect containing
both versions. A bounded root token fences concurrent publication while leaving
visible bytes, revision, placement and modification time unchanged. Retention
cannot advance the Published branch head. Immutable receipts use a separate
identity and exact request hash; replay after later edits remains safe.

Real local HTTP/object-storage acceptance passed no-live-change retention,
concurrent retention/publication, exact replay after later edits, guarded restore,
all retained byte hashes, anonymous denial and protected attachment deletion.
History's shared file projection includes server retention effects and refuses
ordinary/forged effects. This is an API foundation: the conflict popup still needs
explicit native capture and durable retry wiring. It does not promise source-loss
recovery for uncaptured device files or independent whole-data backups.

Validation: 29 files API tests, 239 Timeline tests and 129 shared file-sync checks
pass; targeted ESLint passes. Full TypeScript exactly matches the preceding
91 normalized baseline diagnostics. No native source or layout changed in this
increment; installed conflict-capture acceptance remains outstanding.


## Durable conflict capture — 2026-10-17

The shared popup now offers **Save versions and ignore** for two-existing-file
conflicts. It captures the device version into the existing private Timeline
without replacing live bytes. Muted text explains content IDs and later restore;
a saved confirmation and Files History link appear only after all operations are
acknowledged. Cancel and unsupported folder/missing-file cases do not capture.

An explicit version-2 retention intent in the existing durable journal prevents
old clients or normal executors from interpreting capture as sync overwrite.
Capture never checkpoints agreement. Exact receipt recovery survives a lost
accepted response and missing source; repeating the same capture avoids another
upload. A later normal sync still reviews the unresolved pair.

Validation: 134 shared sync checks pass (including five new capture regressions).
Real API/object-storage acceptance confirms both byte hashes, unchanged live
revision/baseline, lost-response recovery after source removal and repeat receipt
reuse. Targeted ESLint passes; the integration .mts file is executed through tsx
because the existing ESLint configuration does not parse it. Full TypeScript
matches the 91 normalized pre-existing diagnostics after fixing fixture typing.
The production popup renders at 390px/1280px without overflow. Browser input
commands did not reach existing Edit/Upload controls during this run; a static
review fixture verifies layout, not interactive capture. Installed capture,
stale uncaptured-run re-review, content-ID lookup and whole backups remain open.

## Portable backup foundation — 2026-10-17

Added `thingtime-backup-v1`, a bounded portable manifest with canonical Timeline
snapshots, exact cumulative decimal counters, independent 8 MiB chunks, durable
range receipts and a verified completion seal. The internal native/worker engine
resumes capture and independent export without refetching captured source chunks.
The private POSIX filesystem provider publishes immutable files durably. Offline
CLI commands verify/copy sealed vaults and restore one file without overwriting
an existing destination; metadata names are never used as filesystem paths.

Seven tests pass, including real disk source deletion, interrupted capture and
export, loss of the first vault, exact recovery from the second, child-process
CLI restore, corruption/manifest tampering, account/cancellation fences and
concurrent immutable writes. 100 TB/10 PB metadata checks prove counters and
bounded pages, not throughput. The opt-in real API fixture passed capture via
existing authorized ranges, lost receipt/reopen after source Trash, independent
copy and original-vault removal with full restored-byte hash comparison. Targeted
lint passes; TypeScript retains the same 91 normalized pre-existing diagnostics.

This increment is a storage/export foundation. The complete account/device
inventory boundary, protected manifest/job Things, cloud copies, quota/retention,
scheduling, server Timeline lifecycle, native product UI and encrypted media
remain unfinished. The engine is for long-running native/workers, not one
serverless request. Verification restarts after interruption; retained chunks
survive. The new [format/runbook](../docs/portable-backups.md) records these limits.

## Cloud folder backup worker — 2026-10-17

The portable engine now has an authenticated real cloud source and explicit
`backup:cloud create/resume` entry point. It freezes the complete selected Files
tree, including empty folders, and captures exact retained versions after live
edits/Trash without re-enumerating on resume. Session/account/origin checks and
full byte verification precede the completion marker; credentials stay out of
snapshot data. Scope is clearly one filesystem tree, with the existing inventory
bounds, not all account Things or an account-wide point-in-time promise.

Eleven backup tests, targeted lint, focused CLI TypeScript and real API/CLI acceptance
pass. The 17,825,809-byte fixture first captures saved bytes after live Trash,
compares their full hash and repeats CLI resume with zero new captured bytes.
The full TypeScript check matches the 91 existing normalized diagnostics. An
initial real-API run exposed `/auth/me`'s `{ user }` envelope; the worker and its
regression fixture now follow that actual contract.

Whole-account inventory, protected cloud jobs/quotas, independent cloud replicas,
scheduling/retention, Timeline backup lifecycle, native consent/UI, multi-item
restore and physical-media preparation remain unfinished. Session configuration
is an explicit worker setup, not a completed user login or native backup flow.
See [setup and recovery](../docs/portable-backups.md#cloud-folder-capture).

## Reviewed backup tree restore — 2026-10-17

The portable vault now restores a reviewed selected filesystem tree, including
empty folders, into a fresh private recovery container. Its CLI exposes
`plan-tree`, `restore-tree` and `resume-tree`; the review binds snapshot metadata
and the destination. Bounded lazy manifest/range iteration avoids rescanning the
entire backup for each file. Durable 8 MiB staging receipts survive process exit;
resume validates saved ranges and completed output without rereading source
chunks. Exclusive file publication preserves user edits and existing paths.
Completion checks require every planned folder/file and unchanged verified bytes.

Seventeen backup tests, targeted lint and focused CLI TypeScript pass. Real
API/CLI acceptance restores the 17,825,809-byte retained file and empty folder
after live Trash, verifies full output hashes and repeats resume without a
rewrite. A real child process exits after a synced range and the next process
recovers its dead candidate. The full TypeScript check remains at the same 91
normalized baseline diagnostics. The first new test run exposed only a fixture's
wrong empty-directory cleanup call; the corrected test passes.

This uses an explicit private single-host POSIX recovery directory with per-file
publication; a partial tree can exist before overall success. It is not a
cross-host/shared-filesystem lock, native restore UI, whole-account snapshot,
generic Thing restore, permission/timestamp restore or demonstrated 100 TB
transfer. All broader sync/Photos/background/peer and cloud backup requirements
remain active. [Restore contract and setup](../docs/portable-backups.md#reviewed-tree-restore).

## Mac History export and renderer assets — 2026-10-17

Mac now implements the negotiated History Save As bridge through the production
Electron preload and host. A native Save panel selects a fresh destination;
owner/origin-bound session requests read the exact retained attachment version
in 2 MiB ranges. Full disk fingerprint readback precedes exclusive publication;
existing names/symlinks and concurrent destination creation refuse without
overwrite. Account, endpoint and lifecycle changes cancel. Later failures keep
the published file and give bounded recovery guidance. No paths, credentials or
bytes enter the renderer. This is foreground single-file export, not resumable
whole-backup delivery; unsupported hardlink/fsync destinations refuse, and process
termination can leave a hidden partial file. Adversarial ancestor renames are not
a promised filesystem boundary.

The isolated native-panel acceptance saved 17,825,809 generated bytes over nine
ranges with 23 account checks, verified exact bytes and removed its temporary
profile/output on close. 141 Electron tests and six shared export-client checks
pass. Targeted lint passes; TypeScript remains at the same 91 normalized baseline
diagnostics. Authenticated signed installed-app History export/restore remains
a separate acceptance item, as do physical devices and whole-data backups.

The rebuilt dev app exposed a separate blank-renderer bug: Nitro's middleware
preset did not serve packaged public assets. Static serving is now enabled only
for that preset. The restart fixture compares startup JavaScript/CSS responses
to packaged bytes; the rebuilt isolated app visually renders the normal home UI.

Installed validation exposed and reproduced a second runtime issue: cloning
Nitro/srvx requests with Node's `Request` constructor failed the private Undici
state check on the account-bound proxy path. Sync and Desktop password proxying
now strip forwarded-origin headers in the forwarding helper without cloning
the framework request. Nine proxy regression tests pass, including GET/POST
wrappers, byte preservation and unchanged account/origin admission checks.
The native export fixture now traverses the actual bundled Nitro proxy; its
headless run saved and verified 17,825,809 bytes over nine ranges and 23 account
checks (destination selection is synthetic in this mode). A separate disposable
account diagnostic completed normal login and the host account check through
the bundled proxy against the real local API. Full TypeScript diagnostics remain
at the same 91 baseline entries. The actual Save panel was verified separately
with the unchanged production export host. Authenticated signed History
export/restore remains an explicit acceptance item.

## Installed Mac server compatibility — 2026-10-17

The installed helper targets production, whose public manifest omits the new
node-identity and Files contracts (attachment-content is 1.12.0). The PR preview
advertises identity 1.0.0, Files 1.3.0 and content 1.14.0. The folder-context
refusal therefore does not establish a pairing or consent failure. The desktop
host now checks identity capability before native dispatch and reports a server
version requirement; account/endpoint checks still run before dispatch and native
identity verification remains mandatory. Renderer errors hide arbitrary native
paths/IPC details. Production promotion and installed authenticated transfer
acceptance remain pending; existing pairing, consent and endpoint are unchanged.

## Account snapshot inventory foundation — 2026-10-17

Add a read-only MongoDB snapshot session and bounded owner inventory producer.
All pages retain the server-selected timestamp; ordinary Things and file content
references use canonical Timeline snapshots. Unsupported protected kinds, expired
snapshots, missing content, account changes and oversized metadata refuse a final
plan. Credentials/private envelopes are never selected by the census or approved
payload projections. An interrupted metadata freeze needs a new snapshot ID.

The owner/ID index is registered only for the modern schema. The default plan
uses 52/64 slots; full legacy compatibility still fits at 64. A missing index
causes explicit refusal, and index audit reports the selected plan rather than
combining mutually exclusive modern/legacy definitions. The disposable replica
test examined 128 instead of 2,560 index keys for one 128-result owner page.

Validation: 94 backup/Mongo tests, targeted lint, unchanged 91 TypeScript baseline
diagnostics. The real loopback replica test froze 300 records over three pages
during majority-committed edits/inserts/deletes, then verified retained metadata
after source database removal. Empty inventory and missing-index cases passed.
This proves the storage boundary for synthetic ordinary metadata, not complete
account export, auth, protected family adapters, independent file copying or
100 TB throughput. Those integrations, background cloud jobs, UI and Timeline
backup lifecycle remain open. Setup and full scope: [portable backups](../docs/portable-backups.md#account-inventory-producer).

## Recoverable Apple native Trash foundation — 2026-10-17

`MobileSyncTrash.swift` shares the existing Apple descriptor access and durable
operation-journal helpers with publication. Mac/iOS advertise `fileTrashVersion`
1.0.0. `trash`, `trash-lookup`, `trash-inspect` and `trash-restore` bind the original
operation to account, origin, device, connection, native grant/bookmark and root
inode. Deletion requires a separate native consent dialog and exact saved
`allowTrash: true` approval; download permission alone is insufficient. The
shared client rejects missing/downgraded approval flags. Restore remains possible
with ordinary download approval after deletion propagation has been disabled.

Files and initially empty directories move by exclusive same-volume rename into
private native storage. No unlink, cross-volume copy fallback or automatic purge
exists. Durable intent precedes the move; process recovery confirms the original
null-entry receipt without removing a later recreated/restored file. A racing
replacement remains retained and pending. If another writer populates an empty
folder during the move, explicit restoration moves that retained directory intact
without traversing its children; this is not a recursive content snapshot.
Restore is restricted to the same grant and an absent destination, validates the
reviewed retained entry, and cannot move the adapter's own journal/lock/data.

Verified: 41 shared Apple tests, 42 focused Mac adapter/identity/XPC tests,
27 iOS simulator staging/trash/bridge tests, 139 shared client tests and 17
Electron folder/stream tests. Four fresh-process Trash scenarios plus three
existing publication recovery scenarios pass. The real loopback Mac/API fixture
also covers native consent, receipt recovery after restart, exclusive alternate
restore, full-byte hashes and revoked device refusal; its picker/consent and
credential store are synthetic and isolated from the installed app. Full Mac
suite execution aborts in an unrelated DesktopChatRuntime test because its test
host lacks NSBluetoothAlwaysUsageDescription. TypeScript remains at the prior
91 diagnostics (ratchet baseline 89), with none added by this change.

This is native recovery support, not enabled automatic deletion propagation or
Timeline history. The foreground runner still refuses local delete propagation:
fresh remote-path absence checks, child-removal parent revisions, Android parity,
retained-item browsing/restore UI and signed installed permission acceptance
remain required. Native journals are private local recovery state, excluded from
OS backup and not yet included by the whole-account snapshot producer. No claim
of device-loss recovery, continuous background sync or complete account backup
follows from these checks.


## Fresh cloud paths — 2026-10-17

Files 1.4.0 exposes a fresh snapshot path observation through the existing
private Files route. Explicit absence is distinct from missing roots, failed
reads, aliases and invalid ancestry. The shared inventory implementation scans
siblings only along the requested path; all observed siblings share the existing
10,000-entry / 8 MiB / 64-level / 20-second bounds. It creates no new storage,
cache, history format or credentials.

New durable download runs pin their cloud root and recheck the full source path
before staging and before publication. This fixes a moved-ancestor race where
the previous file-id read could still succeed. Old receipts remain recoverable;
old configured runs use their original durable configuration root without
rewriting operations. Unconfigured runs with no root fail safely.
The path observation is not an atomic cross-device lock, and wide-folder
performance still needs further work.

Validation: 174 combined sync/Files tests; canonical sync 141 plus one transport
mock, Files 33, capabilities 95. The opt-in real Mac/API fixture passed native
upload/download, receipt recovery, retained bytes, and nested path absent/
create/delete/recreate and case-alias checks. Its picker and consent are test
adapters, not installed-app UI acceptance. Typecheck remains at 91 existing
diagnostics against the 89 ratchet baseline. No native binaries changed.

The full acceptance ledger remains open: automatic local Trash propagation
(including folder stamps after child removals), recovery UI, Android parity,
background/Photos sync, independent account backup export at large scale and
physical-drive delivery are unfinished. No main/production promotion occurred.


## Foreground Apple deletion and recovery browser — 2026-10-17

Connect the shared runner to approved native Trash after a fresh root/path
absence check, including deleted cloud ancestors. Immutable native child
receipts carry bounded parent-stamp transitions for children-before-parent
removal. No refreshed scan silently replaces the original operation precondition.

Native Trash 1.2 adds owned paged recovery and separate native confirmation for
restoring a reviewed retained file/folder into an absent destination. Existing
restore intents survive restart and lost replies. The UI includes prior
connections and pairing IDs under the same surviving native grant; removing or
rechoosing that grant still blocks UI recovery and is disclosed. Android remains
gated. No cross-device atomicity, background worker, device-loss recovery or
whole-account backup completion is claimed.

Validation: Apple package 47; focused Mac identity/adapter/XPC 43; iOS simulator
27; shared sync 146 plus one mocked fingerprint test; four fresh-process Trash
recovery cases. Raw TypeScript remains at 91 existing diagnostics, none in changed
files. Full Mac suite retains the previously documented Bluetooth test-host
limitation. Browser fixture at 1280/390px has no horizontal overflow and 40px
controls; invalid paths disable restoration and reviewed completion is visible.

Real Mac/API fixture: planner-driven child/parent deletion, lost Trash reply,
native and IndexedDB restart with original IDs, recovery enumeration, reviewed
restore with lost reply/restart, exact bytes, occupied-target preservation and
revocation all passed (280 native calls, 562 fresh identity checks). Picker,
consent and credentials are isolated fixture adapters, not installed-app evidence.

## Android transactional recovery — 2026-10-17

Extend the existing offline folder catalog to schema 3 with indexed recoverable
Trash receipts. Android native Trash 1.2 connects the shared foreground deletion
planner and recovery UI to owned offline folders. Generic SAF roots remain
read-only and are omitted from the recovery picker. Deletion requires separate
configuration-bound native consent; reviewed restoration asks for its own native
confirmation. Both permission and grant generation are checked again at commit.

Immutable bytes remain in place. Visible entry removal, direct-parent revision,
retained blob reference and receipt commit together. Restored destination and
receipt also commit together; retries after a lost response cannot overwrite
subsequent edits. Exact child/sibling receipt links support nested empty-folder
removal while refusing outside edits. Recovery lists 20 records per page across
previous pairing/configuration IDs under the same owned grant. Reselecting that
same saved Android grant invalidates old approval but allows fresh reviewed
recovery. Removing it does not transfer authority to a new grant.

Canonical Timeline history stays unchanged. Native recovery is not an independent
backup and remains excluded from OS backup. Background workers, arbitrary SAF
writes, restored-tree automation, physical-device acceptance, independent account
snapshot copies, 100 GB/100 TB export throughput and physical-media delivery remain
open. The preview still needs to be checked against the eventual pushed commit.

Installed emulator screenshots showed stale search/toolbar layers after the
recovery panel expanded or scrolled. Direct DOM bounds showed non-overlapping
sections; a speculative flex-shrink change was removed. The native acceptance
harness now checks page section bounds as well as horizontal overflow. Emulator
paint artifacts and physical-device visual acceptance remain open. A fresh
installed check with the original styling passes (28.591 seconds): the setup
card ends at 570.31 CSS px, the heading begins at 586.31 px and search begins
at 653.31 px, identical to the speculative style change.

Storage validation: 39 JVM tests, a passing 61-test instrumentation suite (opt-in
live/process tests run separately), seven new storage recovery cases and two new
grant/consent cases. Four actual process-death scenarios pass: before/after delete
and restore commits. Shared sync 146 plus one transport mock and targeted lint
pass. TypeScript remains at 91 diagnostics versus the recorded 89 baseline; none
are in changed components. A first installed UI attempt timed out in manual folder
selection before recovery, and a retry hit an emulator startup ANR before JUnit
started. After rebooting without clearing data, installed authenticated acceptance
passed native delete cancel/allow, shared recovery review, restore cancel/allow,
exact replay, original bytes, Android Files visibility and non-destructive grant
removal (one test, 452.983 seconds). No real user files were used.


## Installed Android planner deletion acceptance — 2026-10-18

Add an opt-in installed acceptance mode for the real shared two-way planner,
cloud APIs, selected offline folder, native consent, SQLite and IndexedDB. The
fixture removes a cloud child and its empty parent, suppresses one actual
committed native reply, stops through the production control and reloads the
WebView. It compares saved operation identities before retrying, checks repeat
convergence and restores the retained parent before its child with separate
native confirmation and independent byte hashes. No success receipt is invented.

The test runner rejects mixing deletion and concurrent-edit scenarios. Fixture
cleanup tolerates folders already removed by the scenario. WebView reload
cleanup only restores instrumentation wrappers when they still exist. The
harness waits for a genuinely new document before reading persisted IndexedDB.
It allows 30 seconds for a WebView evaluation while retaining bounded stage
timeouts, and reports the original failure before attempting cleanup. External
cleanup also recovers owner-verified named connections for the exact fixture
root if the WebView cannot finish its cleanup.

Two software-graphics attempts timed out in WebView evaluation (startup and
initial transfer, before download bytes). A data-preserving cold start with host
graphics removed the observed stale layers and reached full binary transfer.
Initial harness failures found an object-only serializer used on arrays and a
reload race; both were corrected without changing production sync behavior.
Physical-device rendering and sustained large-volume performance remain open.

Validation remains partial. The installed run reached full binary transfer
(8,388,642 bytes over six ranges and 130 frames), deletion-consent cancellation
without file changes, approved baseline convergence, real cloud child/parent
removal and one committed native child deletion whose reply was deliberately
suppressed. SQLite retained the child; IndexedDB still held both original
unconfirmed operations. A subsequent run hit WebView timeouts around reload and
cleanup; the final diagnostic retry failed the paired-page startup assertion
before folder selection. Reload/resume, parent deletion and full restored-tree
acceptance are **not passed**. The checklist stays unchecked.

The updated test APK compiles, fixture TypeScript lint with its explicit parser,
shell syntax and diff checks pass. The normal file-lint command uses the wrong
parser for this `.mts` fixture, so that command is not reported clean. Temporary
cloud fixtures were cleaned through canonical APIs; file versions remain in
private Trash. No production code, deployment or installed Mac build changed.


## Installed Android recovery verified and live prompts — 2026-10-18

The complete planner deletion/reload/restore scenario now passes on the installed
API 35 emulator. A focused run passed in 236.765 seconds; the canonical rebuilt
and reinstalled runner then passed all 61 instrumentation tests in 331.348
seconds, with the live deletion scenario enabled. Build, JVM unit tests and
Android lint also passed.

Both runs transferred 8,388,642 bytes over six ranges and 130 frames, cancelled
then approved native deletion consent, removed the real cloud child and parent,
and suppressed one committed native child-deletion response. A genuinely new
WebView document recovered the original IndexedDB operation IDs, retried those
operations, completed parent deletion and converged repeatedly. Reviewed native
parent-before-child restoration reproduced independently hashed original bytes.
Android Files visibly showed the restored nested/sample.bin (8.39 MB); removing
the grant preserved the restored files. Disposable cloud fixtures were cleaned
through the canonical API, retaining their file versions in private Trash.

Manual test prompts previously appeared only in logcat or after the runner
finished. The harness now sends instrumentation stream status and the runner
tees that stream live. This makes the readiness point visible before folder
selection and Files inspection. An early operator selection in a diagnostic run
collided with initial bridge checks; waiting for the prompt avoids that test
sequencing error. A focused shell check of the actual runner block verifies that
JUnit failures and adb failures remain unsuccessful even after passed-substep
messages. Earlier intermittent WebView timeouts remain unexplained; these prompt
changes do not claim to fix them. Physical devices, background operation and
sustained large-volume performance still need separate acceptance.

This update changes acceptance tooling and evidence only. No production sync
behavior, production deployment or installed Mac build changed.


## Android retained replacement versions — 2026-10-18

Android advertises `fileVersionsVersion` 1.0.0. The existing offline-folder
catalog now exposes publication-retained versions through bounded 20-item pages,
verified review, separate native restore consent and exact operation receipts.
Schema 4 preserves existing blobs/IDs and derives the original grant from the
publication receipt; unknown historical capture times remain unknown. Restoring
creates an independent file at an unused path, preserving the current file and
retained version. Account/origin/root/grant checks apply before reads and commit.

The shared Recover device files screen can show replaced versions. Its scoped
pending request and Web Lock preserve the same operation and destination through
cancellation/reload; changing an uncertain destination first queries the native
receipt. No response or invalid receipt can claim successful restoration.

The installed API 35 emulator run passed all 67 instrumentation tests in 174.246
seconds, plus build, JVM tests and lint. It exercised real replacement, review,
cancel, reload, native restore confirmation, independent full restored-byte hash,
current-file preservation, exact replay and Android Files inspection of both
8.39 MB copies. Six native cases cover migration, pagination, corruption,
permission revocation, rollback/lost reply and destination/identity conflicts.
The shared suite passed 148 tests; targeted lint passed. Raw TypeScript retains
91 diagnostics outside changed files. Live synthetic layout checks passed at
390px and 1280px without horizontal overflow. An initial run lost a folder reply
during source editing; a second exposed a test click before refreshed controls
were enabled. The final harness waits for enabled controls after reload.

This is local recovery from existing immutable blobs. It does not capture a new
canonical Timeline event for native restore or create an independent backup.
Apple retained-version browsing, recovery after replacing a grant, native history
in device-loss snapshots, background workers and whole-account large-volume
backup/export remain open. Existing cloud history still uses canonical Timeline.


## Android foreground photo backup — 2026-10-18

Android 11+ can select a read-only photo library through native permission and
Files dialogs. Original photos/videos enter the existing file-sync pipeline and
canonical cloud file history. Editable connection Things carry optional source
intent; fresh native access remains authoritative. Photo connections require
backup mode with deletion propagation disabled, so deleting a device original
keeps its saved cloud copy. Full, selected-only and unavailable access are shown
explicitly. No upload starts from granting access alone.

The canonical runner rebuilt and installed both APKs, passed JVM tests and lint,
and passed 71 instrumentation tests in 158.118 seconds. The live API 35 emulator
scenario checked real permission/tree selection, the backup-only editor, an
independent original PNG SHA-256 after download, discovery of another photo,
retention after deleting the first device original and repeat convergence without
another publication. Four native cases cover read-only enforcement, distinct
identities, generation changes, pending/trashed/missing media, cancellation and
permission loss. The focused shared suite passed 53 tests. Raw TypeScript retains
91 diagnostics outside changed files. Live synthetic editor checks at 390px and
1280px showed selected-only messaging and no horizontal overflow. The first live
harness incorrectly waited for an Upload again label; the corrected runner uses
the actual Upload now control.

Actual limited-selection changes, video/EXIF format coverage and physical devices
still need acceptance. Scans remain bounded to 10,000 entries and run while the
app is open; large-library paging, background workers and Apple Photos adapters
remain open. This does not complete independent whole-account snapshots, native
history inclusion in device-loss backups, 100 GB–100 TB export acceptance or
physical-drive delivery. Setup and permission details are in android/README.md.

## iOS foreground original photo backup — 2026-10-18

An explicit iOS Photos source now feeds the existing backup-only connection and
canonical cloud file/Timeline history. The shared Apple reader exports original
PhotoKit resources to one private temporary file, with owner/grant isolation,
stable identity, content-derived versions and bounded range reads. Live access
and resource checks reject changed, unavailable or cloud-only originals. Native
and shared UI checks reject photo writes and exclude photo roots from recovery
destinations, including legacy iOS publication capabilities.

Installed iOS 26.5 simulator acceptance passed (427.359 seconds): original PNG
SHA-256 after independent download, incremental new-photo discovery and retention
of the saved cloud revision after device deletion. The initial pass exercised real
native source/explanation/full-access dialogs; the final repeat resumed the exact
disposable grant. Owned originals were moved to Recently Deleted, cloud fixtures
were cleaned up and the grant removed. The successful completion view was visually
inspected. The shell wrapper reported EOF after XCTest succeeded because its file
was edited while executing; final shell syntax validation passed. Earlier harness
attempts were stopped while diagnosing waits, and its polling now uses wall-clock
deadlines and concise status diagnostics.

Validation: 52 shared Apple tests; 16 selected iOS simulator unit tests; 14 focused
shared policy tests; targeted lint. Raw TypeScript retains 91 diagnostics outside
changed files. No physical-device, actual limited-selection-change, Live Photo or
video-format claim is made. PhotoKit reads local originals only; foreground scans
are bounded to 10,000 resources/4 MiB, and temporary space must fit the largest
original. Mac picker integration, paging/performance, background workers, iCloud
policy, Photos-library metadata reconstruction, independent snapshots and massive
exports remain open. Fork-safe setup is in README.md and iOS/README.md.

## iOS native multipart uploads — 2026-10-18

`fileUploadVersion` 1.0.0 routes folder and PhotoKit upload parts through protected
native temporary files and URLSession. Original bytes stay out of the WebView;
only verified part hashes return to the existing cloud transport. Native code
replays the original reservation, checks canonical boundaries and obtains its own
signed destination from the selected authenticated server. Storage PUTs receive
no account credentials, follow no redirects and bound response bytes. Cookie,
foreground, grant/source-version and cancellation checks preserve unfinished runs;
shared composite/server fingerprint checks still precede final publication.

Final installed iOS 26.5 multipart acceptance passed in 353.120 seconds (first
run: 336.368 seconds) with four native
parts, 18,897,576 bytes and zero legacy bulk bridge reads. Independent download
hashes, discovery of the second original and retention after local deletion pass.
The completion screen was visually checked and disposable fixtures cleaned up.
Wall time includes manual dialogs and does not establish throughput. Shared Apple
57 tests, focused shared transport 27 tests and final installed-host units 17 tests
pass; the raw TypeScript baseline
remains 91 errors outside changed files. Native tests cover response/cancellation
fences and signed-target/header refusal; a 33 MiB captured part demonstrates
bounded copying beyond the previous browser-part ceiling.

The OS photo dialog exposed silent native identity cancellation holding the web
queue until its 120-second timeout. iOS now settles that request once and refuses
to send old account context after a destination change. A lifecycle fixture checks
those boundaries. Earlier test-only issues were native integer fixture bridging
(now decoded through the same JSON contract), an async XCTest autoclosure and URL
slash normalization; all were corrected without bypassing authorization.

Temporary space must fit one canonical part plus the PhotoKit original when used.
Foreground transfer, server quota limits and existing attachment size contracts
remain. Physical hardware, actual interrupted PUT process recovery, long-running
throughput, large-library/background work and full-account snapshots/exports
remain open. No production promotion or complete large-backup claim is made.

## Mac photo backup adapter — 2026-10-18

Mac folder access 1.3.0 adds native source selection and a separate photo
explanation/permission step. Photo grants use the shared Apple reader, remain
account/origin scoped and read-only, and expose live permission status without
prompting during status/list/scan. Existing binary XPC ranges carry original
bytes; shared backup configuration and cloud/Timeline writers retain versions.
Both helper and outer Electron app declare the Photos usage string.

Focused native tests pass 21/21, including four new photo cases for source
selection cancellation/identity change, binary originals, mutation/revocation
and rejected write/Trash operations. Shared photo policy passes 4/4 including
Mac publication refusal; 17 Electron folder/stream tests pass. Targeted lint passes with the TypeScript parser (the
default script parser does not understand pre-existing TypeScript syntax).
The native executable and fixture compile; helper Info.plist validates.

The real loopback API fixture passes six binary ranges / 25,165,877 bytes,
148 native calls and 297 identity checks. Independently downloaded original and
replacement hashes match; the previous original remains readable, source deletion
retains the cloud revision, a new photo is discovered after native-process restart,
and a repeated run performs no additional upload. No native publication/staging
occurred. The photo provider, picker and credential store are synthetic; this is
not real PhotoKit or installed signed-app acceptance. Test data was cleaned up.

Actual Mac source/permission UI, protected library reads, photo/video/metadata
formats and revocation in the installed signed app remain to be verified in an
explicit live session. Large-library paging, iCloud policy, background sync,
independent whole-account/device snapshots and massive exports remain unfinished.

## Durable iOS upload-part recovery — 2026-10-18

The iOS upload capability 1.1.0 keeps interrupted canonical parts in private
Application Support, bound to the original account/origin, native grant hash,
source version, upload/request IDs and part bounds. Native journal writes reserve
identity before capture and commit the digest after payload fsync. A fresh process
rehashes completed bytes before reuse; an incomplete capture is rebuilt. The host
checks live source permission/version and replays the API reservation before
obtaining a fresh signed URL. Successful verification releases the exact part;
removing a native grant removes only that scope's retained parts. No cookies,
signed URLs or credentials are stored with payloads.

The cache is capped at 32 reservations and 5 GiB across accounts, with explicit
capacity feedback instead of evicting unfinished parts. iOS file protection and
OS-backup exclusion are configured. Photos needs additional disk for its materialized
original. The current bridge serializes the complete prepare/upload/release
lifecycle; independently scheduled OS tasks still need durable associations and
leases. This operational cache does not replace canonical Timeline history.

Fresh-process tests exit the disposable child after payload fsync before digest
commit and after completed capture. A distinct process respectively recaptures or
reuses exact bytes without source recapture, checks the digest, rejects a changed
live source and explicitly releases the part. Cache tests also cover conflicting
source/grant identities, owner/origin/root isolation, corruption, truncation,
symlinks/hardlinks, cancellation, orphan reservations and storage limits.

Transfers still require the foreground app. Accepted-upload receipt persistence,
actual process death during PUT, reboot/power-loss behavior, disk exhaustion,
physical-device throughput, native background scheduling, whole-account/device
snapshots and 100 GB–100 TB acceptance remain open. This checkpoint does not
complete Drive/Photos/Resilio-style sync or physical-drive fulfillment.

Installed iOS 26.5 acceptance passed in 192.846 seconds with four native parts,
18,897,576 bytes, zero legacy bulk bridge reads, independent original download
hashes, unchanged retained cloud revision after local deletion and no new cache
entries after success. The completion screen was inspected; fixture originals
moved to Recently Deleted and cloud/grant cleanup completed. An earlier interrupted
run reached all upload assertions but stopped at cleanup; it is not counted as a
complete suite pass. The repeat used only the exact identified disposable grant.
All 63 shared Apple tests passed; the six cache tests were rerun after adding the
explicit storage-capacity error and pass. Both fresh-process scenarios pass.

File protection is configured in iOS capture attributes but is not verified by
this simulator: it returns no protection attribute. The separate
`testDeviceFileProtectionAfterCapture` skips Simulator and requires physical iOS
hardware; device lock/reboot enforcement remains an open acceptance check. Read
protection values as strings, as specified by
[Apple's protectionKey API](https://developer.apple.com/documentation/foundation/fileattributekey/protectionkey).

Final iOS simulator checks: 17 tests selected, 16 passed and the one physical-device
protection test explicitly skipped; no failures. Shell syntax and diff checks pass.

## Native iOS whole-file jobs — 2026-10-18

- Upload capability 1.2.0 sends a pinned file and reviewed configuration through
  one native request. The native loop uses retained parts, original reservation
  IDs, redirect-refusing PUTs and composite checks before attachment completion.
  The shared runner verifies stored bytes and publishes the canonical Timeline
  file operation. Ready reservation replay avoids reuploading; accepted file
  replay skips the native job.
- Every part and completion checks live pairing, exact private configuration
  identity/revision/fields, native grant/source, network and charging policy.
  Unknown custom mutation policies retain their shared per-part path. Progress
  messages must match the request and increase at canonical boundaries.
- No background-task authority or OS scheduler is enabled. The next step is
  explicit native task lifecycle/cancellation and background acceptance, without
  weakening the existing redirect protection or persisting the web cookie.

Verification: 160 shared file-sync tests and ten selected iOS upload/session tests
pass. Installed iOS 26.5 photo acceptance passes in 184.429 seconds: two whole-file
jobs, four native parts, 18,897,576 bytes, zero legacy bulk reads, matching original
download hashes, new-photo discovery, cloud retention and successful cache cleanup.
Native unit tests cover changed configuration/account/audience/network/power,
revoked authorization, changed reservation and wrong multipart digest. Targeted
lint passes. Raw TypeScript still reports 91 diagnostics outside changed files;
this is not a clean whole-project typecheck. Background execution and hardware
lock/reboot/large-volume acceptance remain open.

## iOS continued uploads — 2026-10-18

Upload capability 1.3.0 requests `BGContinuedProcessingTask` on iOS 26+ for the
current user-started whole-file job. One static identifier is registered once;
submission uses the fail strategy. The native job retains its redirect-refusing
file-backed transport, live owner/configuration/pairing/grant checks and bounded
part cache. This does not persist cookies or create another history store.
Older systems, refused submissions and launch timeouts retain foreground behavior.
A timed-out request keeps its identifier slot until a late system launch is
rejected, preventing that launch from acquiring another job's authorization.

Only an exact, capability-negotiated native start acknowledgement allows the web
runner to survive visibility changes. Its inactivity deadline pauses while the
accepted job is hidden; navigation, account changes and explicit cancellation
still abort. System progress reports verified part bytes and reserves one unit
for attachment completion. System/user expiry cancels the job. Successful native
completion waits for the app to become active, rechecks the owner, then hands
back to the shared stored-fingerprint check and canonical Timeline publication.

The simulator declined continued processing in the opt-in installed background
acceptance; the subsequent diagnostic run reported `BGTaskSchedulerErrorDomain`
code 1 (`unavailable`). That run failed its explicit background assertion and is not counted
as background proof. Physical-iPhone acceptance remains required. This is not
passive folder discovery, a new-file scheduler, background downloads, OS relaunch,
force-quit/reboot recovery, whole-account snapshots or 100 GB–100 TB acceptance.

Fork setup: regenerate the Xcode project from `iOS/project.yml`; preserve
`UIBackgroundModes`'s `processing` entry and the static
`$(PRODUCT_BUNDLE_IDENTIFIER).file-upload` permitted identifier. There are no new
secrets or dashboard services. `THINGTIME_PHOTO_BACKGROUND_TEST=1` alongside the
existing disposable photo acceptance explicitly requires real scheduler acceptance;
use Simulator Home after its readiness marker, verify the attachment changes from
pending to ready using the local fixture account while the app is backgrounded,
then return to Thingtime and verify Timeline publication. Never infer background
completion from an upload that was already finished before leaving the app.

Verification: all 163 shared file-sync tests and 15 selected native lifecycle,
whole-file, upload and session tests pass. Targeted lint and shell/diff checks
pass. Raw TypeScript retains 91 diagnostics outside the changed files.
Installed iOS 26.5 foreground fallback acceptance passes in 205.359 seconds:
two whole-file requests, four parts, 18,897,576 bytes, no legacy bulk reads,
matching original download hashes, new-photo discovery, unchanged retained cloud
revision after local deletion and successful private-cache cleanup. The completion
screen was inspected. Generated originals were moved to Recently Deleted and
cloud/configuration/grant cleanup completed. Both jobs reported the scheduler
unavailable; this is foreground fallback evidence only. The earlier opt-in
background assertion failed, and its Xcode harness was terminated after stalling
in result finalization; that run is not a successful acceptance result.


## Timeline records retained in account snapshots — 2026-10-18

The account inventory now captures canonical events, links, branches, heads,
snapshot parts, notes and version names. Large records use existing verified
chunk/range storage while the database snapshot is open; bounded eight-record
queries avoid an unbounded history payload. Cleared names retain their revision
tombstones. The offline reader verifies canonical content and identity without
replaying server receipts.

Validation: 42 backup tests and 239 Timeline tests pass; the 25 inventory tests
were rerun after compatibility fixes. Targeted lint and diff checks pass. Raw
TypeScript reports the identical 91 existing diagnostics outside changed files;
the project-wide typecheck is not clean. The disposable real
replica retained 334 records, including 34 Timeline records / 3,208,814 history
bytes, despite concurrent edits and deletions. All history read identically from
a second vault after the database and first vault were deleted. Failures in
writes, scope, access, payload integrity or later family coverage leave no
complete partial snapshot. [Contract and setup](../docs/portable-backups.md#canonical-timeline-history-in-the-vault).

Remaining protected families, historical attachment bytes, complete graph
coverage, account restore, scheduled independent cloud copies and the native
backup/export UI remain open. This checkpoint does not demonstrate 100 GB–100 TB
transfer, physical-media fulfillment or a production deployment.


## Historical attachment bytes in account snapshots — 2026-10-18

Ready owned attachments now enter the frozen account inventory with canonical
content/placement and exact immutable storage fingerprints. Current files and
both sides of file-content Timeline events must resolve to owned attachment
records at the same Mongo timestamp. Checks use bounded batches, eight concurrent immutable HEAD requests and a
bounded cache; a failed batch is drained before returning. Missing, foreign, blocked, unfinished or changed data refuses the
plan. No storage keys, provider versions, upload IDs or credentials enter it.
Linked media preserves its external reference without fetching third-party bytes.

Account file descriptors reference separately captured attachment ranges, so the
current file and historical references do not download the same attachment again.
`resumeAccountBackup` uses existing authenticated exact-version APIs;
`openAccountBackupFile` and `openAccountBackupFileVersion` recover verified offline
current/before/after bytes without replaying server receipts. Selected-folder
capture and restore retain their existing format.

Validation: 57 backup and 18 attachment-core tests pass; targeted lint and diff
checks pass. Raw TypeScript retains the identical 91 baseline diagnostics outside
changed files. The disposable replica preserved 351 records / 47 Timeline records
and 11,603,089 payload bytes despite concurrent source changes, including deletion
of a referenced attachment. Current, earlier and retained-conflict versions were
read from a second vault after deleting the database, original files and first
vault. The authenticated foreground fixture also captured current/conflict bytes
after live Trash and verified both hashes after independent copy/first-vault loss.
That API test uses explicit fixture descriptors, not full-account admission or
permanent cloud-object deletion. [Contract/setup](../docs/portable-backups.md#attachment-bytes-and-offline-file-version-recovery).

Remaining managed families, non-file relationship closure, retention/pinning,
account restore/jobs/UI, independent cloud replication, encryption, physical-media
preparation and measured 100 GB–100 TB transfers remain open. No production
promotion or new public endpoint is included.


### Draft and large-content snapshot coverage — 2026-10-18

Saved working drafts, reusable templates and deletion tombstones now have a
dedicated account-backup exporter. It preserves the existing AccountDraft/editor
format, revisions, dates and provenance, without exporting private roots. Media
references are checked in bounded owner-indexed batches at the same database
timestamp and must remain bound to the exact draft and purpose. A tombstone is
never returned as active content.

Large ordinary Thing snapshots retain their canonical `thing-content` shape in
verified 8 MiB chunks (128 MiB record bound); small snapshots remain inline. The
producer processes large ordinary rows individually and drafts in batches of
eight. Retained payloads own their input buffers and check access/readback between
chunks. Offline readers verify canonical content; they do not import server state.

Validation: 69 backup tests and 26 existing draft tests pass. The real disposable
replica preserved 357 records, 47 Timeline records and 22,064,370 payload bytes,
including a 10,080,000-byte ordinary text value. Concurrent draft/media deletion
and a large-content edit did not change the frozen result. Exact drafts, templates,
tombstones, media, historical files and large content recovered from an independent
vault after removing the source database/files and first vault. Targeted lint and
diff checks pass; raw TypeScript retains the same 91 baseline diagnostics outside
changed files. [Contract and worker bounds](../docs/portable-backups.md#drafts-templates-and-large-ordinary-things).

This extends the internal inventory, not a complete account-backup feature.
Remaining managed data/settings/device coverage, retention leases, restore
writers, backup jobs/UI, independent cloud replication, encryption, physical-media
preparation and measured 100 GB–100 TB transfers remain open. No production
promotion is included.

## Android native whole-file uploads — 2026-10-18

Android upload capability 1.2 supports both the shared whole-file job and bounded
per-part fallback. It preserves the original journal/upload identities and
canonical Timeline handoff. Native source proof, 64 KiB reads, private single-part
staging and isolated signed HTTP PUTs remove bulk bytes from the WebView. Fresh
owner/pairing/grant/connection, network and charging checks remain required. The
canonical JSON comparator now handles arrays in reviewed connection policies.

Replay tests preserve exact identities after lost part/completion replies.
Changed bytes, replaced paths/metadata, foreign policies, cancellation, cookie
changes, ambient authentication, redirects, oversized replies and unbounded
rate-limit delays refuse. Native file locks guard orphan cleanup. Temporary
parts are not a durable resume cache: retries recapture them, while already-ready
reservations skip the source entirely. Normal jobs read the source three times.

Validation passes 48 JVM and 164 shared sync tests, debug/release builds, Android
lint and targeted web lint. TypeScript matches the existing 91 diagnostics.
Installed API 35 selected-SAF acceptance and the 72-test runner pass: 8,388,625
bytes, two native parts, one whole-file bridge request, zero bulk WebView frames
or reads, and matching independent cloud download SHA-256. A real managed-store
tail capture also preserves exact bytes and refuses replaced source revisions.
The installed regression exposed Android's `Files.getFileStore` rejection; the
space check now uses the supported File API. One emulator stall required a restart,
and the picker harness now waits on native grants instead of paused WebView callbacks.

This is foreground transport. Durable Android part caching, WorkManager/service
scheduling, actual process death during PUT, physical devices, large-root paging
and 100 GB–100 TB sustained transfer acceptance remain open.

Installed Android photo acceptance also passes: two native whole-file jobs, zero
bulk WebView reads, exact downloaded original-image hashes, newly added photo
discovery, unchanged cloud revision after device deletion and repeat convergence.
These small synthetic originals do not establish large-library/media throughput.


## Android durable native upload parts — 2026-10-18

Lost PUT replies now retain verified private parts under the original upload and
operation IDs. The bounded cache commits reservation identity before capture,
flushes bytes before its ready record, verifies cached hashes on retry, and fences
owner/origin, root/grant generation and source identity. Current source, account,
device and editable connection policy are still rechecked. Confirmed parts use
atomic discard; exact folder removal clears only its scoped cache. No credentials
or URLs persist, and the existing shared journal owns Timeline publication.

Validation: 55 JVM tests; debug/androidTest/minified release builds and lint pass.
Installed API 35 capture/recover phases pass across force-stop with different
process IDs: the 8 MiB retained part is reused, all 8 MiB + 17 bytes match, original
IDs remain unchanged, and the fixture is removed. Transport is synthetic in this
process test. The app remains foreground-only with capability 1.2; actual network
interruption, OS scheduling/relaunch, physical background devices and large-data
throughput are still open. See the requirement audit in docs/mobile-file-sync.md.

The real SAF picker/API acceptance also passed with the cache enabled (73-test
runner): an 8,388,625-byte upload uses one native job and zero bulk WebView reads,
then an independent download matches SHA-256 and synthetic state is cleaned.
Other opt-in process tests in this runner remain skipped; only the separately
invoked capture/recover phases establish fresh-process cache recovery here.


## Android continuation deferred by request — 2026-10-18

The unfinished Android current-file OS continuation remains in this PR, but
further Android implementation and acceptance are postponed until requested.
Non-Android sync, Timeline and backup work continues. The HTML tracker groups
remaining Android work under “TODO at a later date”.

Preserved work includes API 34+ user-initiated jobs, older foreground-service
admission, notification progress/Pause, exact operation leases, and separate
notification preparation before upload authority. The previous checkpoint had
59 JVM and 165 shared checks passing plus Android build/lint evidence. An
installed run observed hidden pending-to-ready completion and three OS-control
tests passed, but the final combined run is **not verified**: the latest attempt
stopped at SAF picker readiness. Its earlier full-byte check exceeded the old
16 MiB endpoint bound; the retained test now uses pinned ranges.

Resume gates: one clean installed full-hash run, disabled-notification fallback,
Android 8–13 installed service admission, physical devices, interruption/reboot,
and review of the native preparation deadline versus the shared timeout. This
is a preserved unfinished checkpoint, not an Android completion claim.


## Saved-theme snapshot coverage — 2026-10-18

The account inventory now captures saved themes using their existing canonical
Timeline format. Partial themes keep their exact approved values without current
defaults; larger values use the existing verified chunk store. Dedicated fields
exclude private storage roots. Owner-indexed batches process each theme before
reading the next, and the offline reader checks scope, canonical shape and hashes.
This is internal capture/recovery support, not a new endpoint or live restore UI.

Validation: 72 backup tests pass, including source mutation, private-field
exclusion, mixed kinds, invalid/oversized values, wrong owners, cancellation and
corrupt chunks. The disposable replica proof retains 359 records and 22,217,760
payload bytes with 22 queries; partial and large themes recover exactly after
concurrent edit/deletion and removal of the database, source files and first
vault. Targeted ESLint passes (the `.mts` harness uses the TypeScript parser).
Remaining account families, relationship closure, retention, independent cloud
replication, reviewed restore/jobs/UI and measured large-volume transfer remain
open. Android follow-up stays deferred as requested.

## Account profile/preferences checkpoint — 2026-10-18

The internal producer now retains approved account profile content and private
preferences using one shared `account-content` v1 Timeline shape. Exact absent,
false/null and disabled states survive independent copy and source loss. The
owner-only BinData decoder excludes credentials, security/permission flags and
unknown fields; malformed input fails without echoing private values. Profile
image dependencies must match the owner, purpose, slot and durable binding at
the same database snapshot. The offline reader is bounded and digest/scope
checked; it cannot mutate or authenticate a live account.

Validation: 76 backup tests pass; focused lint passes. New coverage uses the
production secure-envelope builder and injected snapshot cursor, not a live
account API. Real signup/profile/settings capture and restore remain unchecked
in TESTING.md. No endpoint or API capability contract changed. Android remains
deferred; no Android code or acceptance work changed in this checkpoint.

Account security/credential backup, other managed families, relationship closure,
retention/pinning, independent cloud storage, jobs, UI and large-scale throughput
remain required. The HTML tracker keeps whole-account coverage in progress.


### Real account profile snapshot path — 2026-10-18

The account inventory now shares `readBackupAccountContent` with its integration
proof. It checks current owner/home scope and authorization around a bounded
read-only snapshot query and exposes only approved canonical content. The exact
account lookup uses the existing unique share-ID index; the full owner census
still requires its dedicated owner/ID index. A first real-handler run exposed
that a fresh database uses the legacy-compatible index plan. The fix avoids
requiring a census index for a single exact identity, without permitting a full
inventory scan or ignoring the migration prerequisite.

The new opt-in runner owns a disposable Mongo replica on 28142, a private
scratch directory and child process. It does not load app env, uses console-only
email and tears down its own database/files. Fixtures register and change data
through unmodified production Request handlers with live cookie/session auth;
there are no direct Mongo data inserts, injected users or synthetic cursors.
The proof passes concurrent API edits under one server timestamp, independent
copy/source-vault removal, exact profile/private preferences, credential exclusion,
explicit current-writer restoration, revoked live reads and offline recovery.
A real fresh account still cannot publish a full inventory before the owner-index
migration; this expected refusal is checked separately from profile recovery.

Scope: Request handlers plus database, not a Nitro HTTP/browser test. Managed
profile image restore, full-account family/relationship coverage, backup jobs/UI,
reviewed restore orchestration and large-volume delivery remain unfinished.
Android remains deferred and unchanged. The older direct-Mongo fixture remains
only synthetic storage/index consistency evidence; it does not prove real signup.

Validation: 77 backup tests pass with no skips, and focused source/script lint
passes. The real-handler integration proof passed; HTTP/browser acceptance and
whole-account restore remain open.
Full TypeScript checking reports the same 91 diagnostics as the prior source
baseline, with no new normalized diagnostics. The final integration run also
checks stale archived revisions return 409 before an explicit current-revision
restore. Its first repeat exposed a fixture startup race; the canonical runner
now waits for readiness from its own mongod log before bootstrapping the replica.

The final runner also passed with OS-enforced network isolation. A preflight
proves permitted loopback access and denied hostname, direct-IP and redirect
connections before startup; the database, bootstrap shell and application worker
all run under that policy. The fixture requires macOS `sandbox-exec` and fails
closed on unavailable or failed isolation. Ports 28142 and 28144 must be free.

Graph refresh: the local semantic proxy health endpoint timed out on both bounded
checks (10 and 15 seconds). Use the required structural refresh fallback; changed
documentation is not claimed to be newly semantically indexed in this increment.


## Resumable paged inventory journal — 2026-10-18

The existing browser sync journal upgrades from version 2 to 3 without replacing
runs or checkpoints. Its inventory namespace stores observations under the same
account/origin/data-plane/connection/device scope, plus immutable capture, source
and generation identities. Pages contain at most 128 entries / 1 MiB; exact page
receipts make uncertain retries idempotent. Cross-page duplicate identities and
case/Unicode aliases abort the entire incoming page.

A terminal entry count marks a capture ready for validation, not ready for sync.
Ancestry validation commits at most 128 entries per transaction and saves its
cursor, so cancellation/reopening resumes without exposing a valid prefix.
Missing, differently cased or non-folder parents refuse completion. Only a sealed
capture can be read in bounded sorted pages. New or failed captures do not replace
the last complete observations. This is operation storage, not Timeline history
or permission to write; canonical histories and live mutation guards are unchanged.

Validation: the 100,000-path fake-IndexedDB regression passed ingestion, mid-scan
reopen, seal, full ordered readback and exact-scope discard. Other regressions
cover altered retries, missing pages, scope/generation changes, cross-page
collisions, cancellation/reopen during validation, late invalid ancestors and
version-2 migration. Focused lint passes. Full TypeScript reports 91 diagnostics,
none in the changed files. This is synthetic storage evidence, not browser/native
acceptance or a measured production throughput claim.

Remaining: connect consistent native/cloud paged sources, bounded reconciliation,
operation runs and baseline checkpoints; then test real browser/installed Mac/iOS
and million-path workloads. Foreground sync still uses the 10,000 combined-path
limit. No API contract or Android code changed; Android remains deferred.


## Resumable paged reconciliation — 2026-10-18

The sync journal now upgrades to version 4, preserving existing runs, checkpoints
and version-3 captures. `plans(access)` takes four sealed capture identities
(current local/remote and confirmed baseline local/remote), a fixed policy and
bounded exclusions. It pins those captures atomically so they cannot be discarded
and recreated while an incomplete plan is reading them.

The first bounded pass validates case/Unicode aliases and matching baseline
content across the entire union, including excluded paths. It records changed
ancestors in relational journal rows. The second pass uses the same per-path
policy as the existing foreground planner; late descendant edits still protect
an earlier folder deletion. Exclusions protect parent deletion without allowing
invalid observations to disappear. Each pass saves its positions and results in
one transaction and resumes after cancellation or a process restart. Concurrent
attempts compare durable progress before committing. Reads expose decisions only
after the complete second pass; completing/discarding a plan releases only its
own capture pins. Decisions are paged by canonical path key, at most 128 entries
or 1 MiB; working memory holds at most four input pages plus one bounded batch.

This is operation planning, not a parallel file-history store, native permission,
mutation receipt or baseline advancement. Timeline and guarded canonical file
writers remain the source of history and publication. The live 10,000-path limit
remains until consistent native/cloud sources, paged execution and checkpoint
advancement are connected and accepted together. Android remains deferred.

Validation covers parity with the existing planner in all four modes with both
deletion policies, restart in both passes, late aliases/baseline failures,
excluded descendants, concurrent attempts, input pins, scope/settings changes,
long-path byte bounds and version-3 migration. A reproduced Unicode cursor bug
is fixed: lowercasing a valid filesystem segment can expand its index key, so
cursor validation must not apply filesystem-segment limits to that folded key.

The real Chrome for Testing proof planned and independently checked 20,000
copy decisions across two browser-process restarts (indexing at 128, planning at
128), rejected partial reads, proved input pinning, then released and discarded
its generated data. OS-level network isolation restricted both the static
fixture server and browser to loopback port 28162; hostname, direct-IP and
redirect denials were checked before running. No account credentials or real
user files were used. Screenshots, three traces and the exact fixture source are
retained with the HTML tracker. This is browser storage/planner acceptance,
not native transfer or production throughput evidence.


## Durable paged operation recovery — 2026-10-18

Journal version 5 adds `pagedRuns(access)` beside existing inventories, plans,
runs and checkpoints. It prepares bounded pages from a complete plan and stores
immutable operation IDs before effects. A late conflict keeps the entire queue
non-executable. Operations use the same ordering key and execution/receipt
validators as the foreground runner: every copy before deletion, copied parents
before children, deleted children before parents. Pending reads are bounded to
128 operations or 1 MiB; preparation retains one bounded decision page.

Preparation progress, operation rows and the active-root guard commit atomically.
Competing preparations compare revisions and instance IDs; unique operation/path
indexes reject duplicate identities. Complete plans stay pinned while a run owns
them. `active()` discovers the original specification after restart, and indexed
path lookup supplies stable parent operation IDs without a whole-run array.
`executePagedSyncRun` holds the existing root Web Lock, records running state
before the first effect, and recovers uncertain writes through their original
receipt IDs. Confirmations advance only the next ordered operation and store a
bounded, allowlisted receipt. Scope changes, pending receipts, changed source or
destination stamps and altered receipt retries refuse continuation.

Legacy run writes and checkpoint advancement are atomically excluded while a
paged run owns the root. Preparation can be discarded before execution; a
started run cannot be discarded even when zero receipts are confirmed. Completed
runs retain the root/plan until the forthcoming paged checkpoint handoff. The
previous baseline remains unchanged. This is recovery metadata, not a parallel
Timeline history store or native authorization.

Regression coverage includes migration from version 4, interrupted preparation,
global ordering across pages, late conflicts, duplicate IDs, concurrent builders
and executors, lost replies, failed confirmation storage, cancellation, changed
scope/settings, empty plans and preservation of the prior checkpoint.

Real Chrome for Testing verified 10,001 operations across two complete browser
process restarts. Preparation stopped at 128; execution then stopped after 257
independently stored destination receipts but only 256 journal confirmations.
Resume recovered the uncertain receipt and applied exactly the remaining 9,744
operations. Every destination path, ID and digest was compared with generated
source metadata. The fixture and browser both ran under an OS network boundary
allowing only loopback 28166; hostname, direct-IP and redirect refusal was
preflighted. Screenshot, three traces and fixture source are retained beside the
HTML tracker. The temporary profile/downloads and server were removed.

Remaining before live rollout: consistent paged native/cloud scans, indexed
cloud destination preparation and native trash receipt chains, paged baseline
publication, and installed Mac/iOS transfer acceptance. The foreground path
continues to enforce its 10,000-path bound. This proof transfers no real file
bytes and makes no production throughput claim. Android remains deferred with
its unfinished implementation preserved in PR #1002.


## Resumable paged checkpoint handoff — 2026-10-18

The version-6 sync journal now includes `pagedCheckpointJournal.ts`. A completed
run pins the exact internal instances of all four original inventories; callers
cannot discard and recreate the same public ID/generation to change its recovery
inputs. Older plans remain readable, but a new run requires rebuilding a plan
that predates internal capture identities. Existing run recovery is retained.

Checkpoint capture identities are created atomically only after every operation
is confirmed. After fresh local and remote scans are sealed, a five-stream merge
reads their observations, the old baseline pair and path-ordered confirmed
receipts in bounded pages. It applies confirmed copies/deletions before the
shared baseline agreement rule, preserving edits made after a successful copy.
Each step consumes at most 128 union paths and stays within its byte budget.
Paired output pages use exact ordinal/digest retries; their cursor advances only
after both copies are durable. Interrupted validation and publication resume.

Both complete outputs must seal before one transaction publishes the new head,
releases only that run's root/plan/input pins and retains the new baseline pins.
Old publication retries neither overwrite a later head nor release a newer run.
New runs must use the current paged baseline. Legacy journal writes and legacy
checkpoint reads refuse to replace or return stale state after paged publication.
The output is reconciliation metadata, not another Timeline history store.

Validation: seven new checkpoint regressions cover pre-run capture refusal,
post-copy edits, bounded merge/reopen/deletions, interruption between output
replicas, old publication retries, path aliases and account changes. Four input
binding regressions and the migration check cover retained original generations.
The shared suite passes 207 TypeScript tests; its separate module-mock test passes
with the package script's experimental mock flag. Focused lint passes. Whole-project
TypeScript retains the identical 91-diagnostic baseline, with no new diagnostics.

Chrome for Testing also used the actual current journal/executor in an isolated
fixture with 400 generated operations and three full browser process restarts.
An independent receipt store had 257 effects at interruption and 256 confirmations;
resume applied exactly 143 more. Checkpoint building stopped after 128 paths with
no published head, then resumed and verified all 400 baseline pairs against the
independent receipt store. A post-copy local edit remained a single-sided update;
an old retry preserved the next active run. Browser and fixture server were
OS-restricted to loopback 28174; hostname, direct-IP and redirect denials were
checked. Screenshot, four traces and the fixture script are retained with the
HTML tracker. Temporary browser profile/downloads and listeners were removed.

Still open: connect this lifecycle to consistent native/cloud paged scans,
indexed destination preparation and native Trash receipt chains, then verify
real file transfers in installed Mac/iOS apps. The foreground 10,000-path limit
remains. This is a storage/recovery proof using generated metadata, not native
transfer or 100 GB–100 TB throughput acceptance. Android stays deferred.


## Paged cloud operation bindings — 2026-10-18

Journal version 7 retains canonical cloud nodes alongside reconciliation entries
in the existing inventory pages. Both payloads share the 128-entry/1 MiB bound
and exact retry digest. Sealing checks physical parent IDs across pages before
exposing metadata. A generic capture cannot later acquire cloud metadata, and
original capture instances stay pinned by the plan and run.

The paged operation journal now prepares cloud bindings before execution. Each
binding retains the original attachment, destination revision and parent ID;
new folder parents use already allocated operation IDs. The exact parsed
configuration and cloud root are immutable across retries. Local Trash keeps at
most two receipt links per operation, with durable per-parent progress across
pages. Binding rows, receipt links and their cursor commit together. Partial,
invalid or quota-refused preparation cannot start any operation. A started run
cannot acquire fresh bindings from a later scan.

`createPagedCloudSyncPort` joins those indexed rows to the same cloud upload,
range-download, native staged-publication, recoverable Trash and capability
checks used by the existing foreground adapter. Preparation metadata does not
authorize effects. The whole-run compatibility adapter delegates to this shared
transport; Timeline history and remote API contracts remain unchanged.

Fourteen new regressions cover retained cloud metadata, ancestry, migration,
immutable settings, deep/wide native Trash receipt chains, page byte bounds,
transaction rollback and recovery after an accepted download loses its reply.
An OS-isolated Chrome for Testing proof prepared 270 bindings, restarted after
128, then restarted after 129 accepted downloads and 128 confirmations. Resume
performed exactly 141 new downloads. All 270 independent target receipts and
original attachment bindings matched; no accepted effect repeated. The fixture
used generated three-byte content and simulated cloud/native adapters around
the real shared transport and IndexedDB, not an account or installed device.
Browser and fixture server were restricted to loopback 28174; hostname,
direct-IP and redirect refusal were verified. Screenshot, three traces and
fixture source are retained beside the HTML plan. The installed Thingtime
agent-browser CLI was absent, so the explicitly isolated runner was used.
Temporary profile/downloads and listeners were removed after the proof.

Still open: stable paged native/cloud scan producers, foreground/worker lifecycle
integration including conflict review and checkpoint publication, and installed
Mac/iOS acceptance. The live 10,000-path bound remains. This increment does not
establish large-volume throughput, persistent background sync or independent
backups. Android remains deferred with its unfinished code preserved in PR #1002.

Validation for this increment: 221 shared `.test.ts` checks plus the separate
module-mock `.test.mts` check pass (222 total). The unchanged 100,000-entry
inventory and 20,000-path planner benchmarks were not repeated. Focused lint
passes. Whole-project TypeScript output is byte-identical to the prior
91-diagnostic baseline.


## Mac/iOS foreground paged recovery — 2026-10-18

Mac and iOS connection controls now use the paged inventory, plan, operation,
cloud binding and checkpoint journals for foreground sync. The existing complete
native/cloud scans are imported in bounded pages; this does not remove their
10,000-path limit or establish stable paged producers. Android keeps its existing
runner while its unfinished work remains deferred in this PR.

Journal version 8 persists conflict choices before preparing any operation. The
same conflict policy validates exact reviewed versions, rejects missing/extra
choices and prevents effects until every review page has committed. Fully saved
reviews resume without reopening the popup; interrupted review import requires
fresh choices. Settings are pinned before cloud preparation. Live account,
device, root, network and native write approvals still run through the shared
`foregroundSyncContext.ts` policy before effects.

“Save versions and ignore” retains only conflicting versions, releases the
active root after confirmation and never advances the common baseline. Repeating
the same reviewed versions/configuration reuses the retained receipts without
another upload. A later selected winner still synchronizes normally. Legacy
uncertain operations and lost checkpoints finish with their original IDs before
the connection migrates to a paged baseline.

An interrupted post-run observation import restarts with two fresh generations
atomically; it cannot mix a new scan with old partial rows or replace observations
held by another active reader. Once checkpoint building starts, it resumes the
sealed observations. Changing approved roots clears only the old baseline head,
and refuses while a transfer is active. The executor uses the foreground root
lock without recursively acquiring it.

Validation: all 238 shared checks pass (237 TypeScript tests and the separate
module-mock transport test), including the inventory/planner scale cases.
Focused lint passes; whole-project TypeScript diagnostics are identical to the
existing 91-diagnostic baseline. New regressions exercise
135-file transfer recovery across a page boundary, interrupted checkpoint import,
legacy migration, review import/restart, pinned settings, retention without a
remaining source and a later winner after Ignore. The pin regression keeps a
second plan active; completed plans correctly release their input pins.

The actual connection component ran in isolated Chromium at 1440×1000 (Mac
adapter) and 390×844 (iOS adapter), with real IndexedDB and generated three-byte
content. Opening two conflicts, choosing/resetting a winner, saving both versions,
reloading and repeating Ignore produced two retained receipts with zero repeat
upload parts, no live-file revision change and no remaining active run. Rendered
completion text was compared with the fixture's independent cloud counters and
journal readback. Top-to-bottom scrolling and opened-popup inspection passed;
phone status text now occupies the full row above the controls. Evidence lives
in `paged-foreground-evidence-2026-10-18` beside the HTML tracker.

Browser and fixture backend were OS-restricted to loopback 28174; hostname,
direct-IP, alternate-port and redirect denial checks passed. The installed
agent-browser CLI is now present, but native app-control timeouts prevented
verifying/registering its task policy; the explicitly isolated fallback runner
was used. Trace/screenshots/source are retained; temporary browser resources and
listeners were removed. No installed app or real-account acceptance is claimed.

Still open: installed Mac/iOS transfers and provider/permission acceptance,
stable paged native/cloud producers, persistent workers, scoped journal retention
and orphan cleanup, full cross-device convergence, and measured large-volume
sync/backups. Existing source captures and journals remain retained. Independent
snapshot coverage and whole-account restore have their separate open gates.


## Bounded foreground journal cleanup — 2026-10-18

Repeated foreground runs previously retained their old inventory pages, plans,
operation rows and checkpoint drafts indefinitely. Version 9 registers owned
metadata at creation and performs bounded cleanup under the foreground root lock
before planning the next run. Each transaction removes at most 128 child rows
and 1 MiB of keys, with fixed header/catalogue/pin changes. Retirement and the
first deletion page commit together. The retired header remains until every
child is gone, preventing a stale cleanup job from deleting a recreated ID.

Eligibility preserves active runs and their original/post-run inputs, any other
reader's pins, the current published baseline, and the last retained-conflict
receipts. Root ownership also protects active inputs if their pin indexes are
damaged. A completed ordinary run requires published checkpoint proof; once
retired, its remaining cleanup can resume even if that old checkpoint has been
collected. Replacing interrupted post-run captures queues the obsolete generation
instead of doing an unbounded range deletion. Unregistered/legacy captures are
preserved because absence of a pin alone does not prove abandonment.

Eight new regressions pass, and the full shared suite passes 246 checks including
the scale cases. Focused lint passes. Whole-project TypeScript remains identical
to the previous 91-diagnostic baseline. No remote API or Timeline format changed.

Isolated Chromium exercised the production Mac/iOS connection controls at
1440×1000 and 390×844. Five repeated Ignore actions on each layout held all store
counts steady, reused the two retained receipts, uploaded no extra parts and
preserved the current cloud revision. Independent IndexedDB readback observed a
270-entry cleanup stop after 128 metadata rows, with ID reuse refused and an
unmanaged capture preserved. A full browser-process restart retained that exact
state; cleanup removed the remaining 145 original entries, then safely recreated
the cleaned ID with one new entry. Trace, screenshots, source hashes and runner
are retained in `journal-maintenance-evidence-2026-10-18` beside the HTML tracker.

The fixture/backend and private browser were OS-restricted to loopback 28174.
Hostname, direct-IP, alternate-port and redirect denial checks passed; the
profile/download directories and listener were removed. The same explicitly
isolated fallback was used while the installed browser manager's task controls
remained unverified after native control timeouts. This is generated-adapter
and IndexedDB evidence, not native or production acceptance. Android stays
explicitly deferred; stable paged producers and worker/relaunch work remain open.


## Native single-path verification — 2026-10-18

Mac folder access 1.4.0 and iOS folder access 1.2.0 add `inspect`, an exact
relative-path observation returning either a canonical entry or explicit absence.
The shared foreground context uses it for per-operation checks; both runners
retain complete scans for planning and checkpoint publication. Older clients and
Photos keep their existing scan path. Android implementation remains deferred.

The Apple reader hashes only the selected file and retains O(path depth)
metadata. It enumerates ancestor directory names to reject case/Unicode aliases,
opens relative to authorized descriptors without following links, and rechecks
ancestor/object identity after reading. Missing paths are distinct from provider,
permission, cancellation and changed-file failures. Native bridges verify account,
device/origin and the selected grant again before replying. A failed inspection
never falls back to a scan or becomes a deletion. Inspection gets the same
five-minute native read deadline as a complete scan.

Verification: all 249 shared checks, 66 Apple library tests, 16 Mac adapter tests
and 13 Electron folder bridge tests passed. Twenty-operation tests use exactly
two full scans in each runner. A real 10,001-file directory supports targeted
inspection while the existing full scan correctly refuses its size. Native tests
reject revocation during final identity verification, including grant removal.
Focused lint passes; TypeScript retains the exact same 91 diagnostics.

Desktop (1440px) and iOS-sized (390px) isolated Chromium checks exercised the
production controls, conflict choices, Save versions and ignore, and reload/retry.
Each two-file retention run used two required review scans and two targeted
inspections; retry reused retained versions without another upload. Full-page
scroll checks found no horizontal overflow. Native/cloud adapters here are
synthetic; actual filesystem semantics are covered separately by Swift tests.
The fixture now implements the binary reads implied by Mac's negotiated version.
Evidence: `native-path-inspection-evidence-2026-10-18` beside the HTML tracker.

The unsigned iOS simulator build passed after removing a command-line iPhone SDK
override that incorrectly compiled the Watch dependency for iOS. This is compile
evidence only. Signed installed Mac and iOS action-path acceptance remain open.
Stable paged native/cloud inventories are still unfinished; live synchronization
retains its 10,000-path cap. This change does not establish large-root, background,
physical-device or 100 GB–100 TB acceptance.

## Mac session checks and test isolation — 2026-10-18

Signed-app preparation exposed a reproducible XCTest abort: the leased desktop
chat route read the full device snapshot just to check the session lock. That
snapshot enumerated Bluetooth in an XCTest host without a Bluetooth usage
purpose. Leased desktop/machine commands and lock confirmation now use the same
conservative session-state calculation directly. Full inventory remains available
for explicit telemetry and pairing; no privacy permission or usage purpose was
changed to make tests pass.

A small telemetry provider boundary lets routing, journal and pairing-recovery
unit tests supply deterministic device observations. The real collector is still
the default application dependency. Regressions cover the native narrow session
read, no hardware inventory during locked/approval refusal, desktop delivery once
across replay, lock refusal, and one explicit inventory read across telemetry
replay. The older rejection test relied on the collector's implicit locked launch
state; it now names and explicitly checks both locked/approved and
unlocked/unapproved cases.

The original desktop route reproduced signal 6 before the change. The complete
Mac suite now passes: 161 tests, one deliberately skipped display-hardware test,
zero failures. This is native unit/filesystem evidence, not signed installed-app,
Bluetooth-consent or live account/device acceptance. Those gates remain open.

## Native paged folder captures — 2026-10-18

Mac file-access **1.5.0** and iOS file-access **1.3.0** add `scan-capture`,
`scan-page` and `scan-discard`. The shared foreground controls negotiate these
versions for folder roots and import one sealed native generation for planning,
conflict rechecks and checkpoint publication. Older clients and Photos keep the
existing bounded scan path. Android implementation and acceptance remain deferred.

`MobileFolderInventory` streams descriptor-relative traversal into a private
SQLite metadata cache, validates path/identity uniqueness and rechecks every
observed entry before sealing. Replies contain at most 128 entries and 512 KiB;
clients pin capture identity, generation, offsets and the terminal count. The
source is reauthorized on each call and the bridge checks device/grant identity
again before replying. These immutable observations are not retained file bytes
or Timeline history. Source edits after capture are checked before each effect.
Eight captures per owner/origin/device/grant are retained at most; each database
has a 1 GiB page quota. Cancellation, eviction, corruption or omitted rows refuse
instead of appearing as an empty complete scan. A reused evicted ID gets a new
generation. Explicit discard removes metadata only.

The shared checkpoint importer preserves its existing plain observation contract;
planning captures alone hold canonical cloud destination metadata. Partial native
imports cannot launch effects or replace the prior published checkpoint.

Verification: 255 shared file-sync checks; targeted lint; 73 Apple filesystem tests; full Mac suite 162 passed plus one
opt-in display-hardware skip; 146 Electron checks; iOS simulator compilation.
Native tests use 10,001 real files and verify all 79 pages against independently
constructed names/digests, reopen, later edits, scope/generation refusal, cache
eviction, truncated/corrupt metadata and cancellation. Shared tests cover page
protocol validation, 135-entry execution/checkpoint publication without a legacy
root scan, and malformed/missing pages preserving the last good checkpoint.
Isolated Chromium at 1440px/390px exercised the real controls, two native capture
generations, four pages, cleanup and retained conflict receipts after reload;
layout was checked through the page bottom and open review controls. Raw TypeScript retains 91 diagnostics outside the changed files. Native/cloud
adapters in that browser check were generated fixtures, not installed-device
acceptance. Both browser and fixture backend were OS restricted to loopback.

Remaining: stable paged cloud producers, conflict-review scaling, capture workers
and installed Mac/iOS/provider acceptance. The live combined 10,000-path cap is
still enforced. Capture hashes file contents in the foreground and retains the
existing request deadline; this is not a sustained large-data benchmark or a
persistent background scanner. The installed Mac app is another task's branch
and sign-in environment; it has not been overwritten for this check.


### Cloud inventory pages (2026-10-19)

`api.files` 1.5.0 adds `GET rootId&pages=1`: bounded NDJSON pages from one
read-only Mongo snapshot. The private disk queue holds wide folder frontiers;
backpressure limits retained rows to one page and one parent batch. Pages carry
one generation, root revision, ordinal and an exact terminal count. The client
withholds completion until clean EOF, then the existing journal verifies unique
identities, paths and physical ancestry. Checkpoint observations undergo the same
cloud-tree validation before copying content stamps into their plain captures.

Mac/iOS foreground controls use this transport. Legacy JSON inventory/path
reads and deferred Android remain unchanged. Limits are 128 entries / 384 KiB
per page, 128 MiB scratch per capture, two concurrent captures per server process,
64 levels and 240 seconds. Snapshot expiry, cancellation and process loss require
a fresh scan. The scratch queue is request-owned, not a persistent recovery job.

Validation: 261 shared sync checks (260 TS + one module-mock check), 40 Files
checks and 35 capability checks pass. The 10,001-file producer test returns
79 pages; 4,096 folders use 33 bounded parent queries. The disposable production
handler test creates 135 folders through real signup/Things writers, preserves
one snapshot during a concurrent rename, seals two pages and rejects reads after
logout. Its OS network boundary denies other ports, hostnames, redirects and
external direct IPs. It does not inject authentication or seed database documents.
The built Nitro manifest advertises 1.5.0 and anonymous Files access returns 401.
Desktop and 390px iOS Chromium fixtures pass conflict retention, reload recovery,
full-page scrolling and overflow checks with generated native/cloud adapters.
Full TypeScript still reports 91 diagnostics outside this increment's files.

Installed Mac/iOS acceptance and deployed streaming remain open. The combined
foreground planner/review cap is still 10,000 paths; this increment does not
claim unrestricted root sizes, durable workers, byte backups or 100 GB–100 TB
throughput. Android stays deferred. Next: exercise installed/HTTP proxy streaming,
then remove the remaining bounded review/path-observation bottlenecks.

### 2026-10-19 — bounded wide-folder path observations

Cloud path checks now stream sibling rows through one shared metadata validator
and an anonymous bounded disk uniqueness index. They no longer accumulate all
sibling metadata or inherit the 10,000-entry / 8 MiB whole-tree response cap.
Late aliases, duplicate IDs, permission failures, interrupted reads and scratch
failures still refuse the observation. The index is unlinked before writing,
which lets process exit reclaim its disk space. Transaction retries recreate it
without extending the original 20-second deadline. `api.files` and its client
requirement are deliberately advanced to 1.6.0.

The focused suite covers a 10,001-file, >8 MiB directory and process-death cleanup;
the existing isolated real-handler fixture now verifies found/absent/alias paths
and post-logout refusal against canonical Things writes. This is a scaling
prerequisite, not installed-device, production throughput or full-backup acceptance.
The combined foreground cap, bounded conflict review and durable workers remain
open. Android is deferred. No installed app or primary branch is changed.

Validation: 49 Files tests, 262 shared-sync tests (261 TypeScript plus the module
mock check), and 95 API-capability tests pass. The isolated authenticated handler
fixture and built Nitro HTTP manifest/auth smoke pass. Desktop/mobile production
controls were exercised with generated native/cloud adapters; this does not
establish installed-device acceptance. Focused lint passes. Full TypeScript still
reports 91 diagnostics outside the changed files; whole-project typecheck is not
green.


### Durable bounded conflict-review drafts (2026-10-19)

The version-10 sync journal adds `pagedReviewDraft.ts`. It indexes conflict rows
from a complete immutable plan in bounded pages, saves each selection with a
row revision, and exposes 20-row review pages (at most 128 rows / 512 KiB for
import). Draft settings, scope, plan instance and capture instances are bound
before indexing. An active draft pins the reviewed plan and inputs; the root
head independently protects them during maintenance if pin indexes are damaged.
Released drafts are collected in bounded transactions. Legacy journal mutations
refuse an active review instead of replacing its recovery state.

Sealing checks the complete count and current revision. Unsupported folder
conflicts stay visible and prevent Apply/retention; a selected winner cannot
authorize deletion or another sync direction. Sealed rows feed the existing
`pagedRunJournal.appendReview` contract. Complete preparation against a fresh plan
rejects changed versions before any operation can start. Review data is not a
native grant, transfer receipt, Timeline event or common baseline.

Validation covers 12 focused regressions: process-style reopen, partial indexing,
stale concurrent choices, clearing selections, fresh-plan mismatch, folder
conflicts, byte limits, cancellation/account changes, quota rollback, v9 migration,
recreated capture IDs and cleanup with missing pins. A real OS-isolated Chromium
process was closed and relaunched with 270 generated conflicts; the saved choice
survived, review reads held 20 rows, imports held at most 128, and all 270 operations
prepared with zero executed effects. Evidence is in the HTML plan's
`review-draft-evidence-2026-10-19/` directory.

**Still open:** connect these draft pages to the foreground runner and individually
editable Builder conflict controls; preserve the existing repeat-Ignore content
identity without whole-list hashing; complete installed Mac/iOS acceptance. The
current popup still uses its existing arrays. The combined 10,000-path cap remains.
No Android work or native installation is included in this checkpoint.

Checkpoint checks: all 274 file-sync tests and focused lint pass. The full
TypeScript check still reports 91 diagnostics, all outside changed files; this
is not a clean whole-project typecheck.


## Paged review handoff and recovery — 2026-10-19

The Mac/iOS paged foreground runner now uses the version-10 conflict draft
through review, fresh capture and run import. A sealed approval survives a
failed fresh scan or interrupted import; retry reuses the same run identity
and page receipts. A bounded merge compares every reviewed conflict against
the fresh complete plan before any operation is created, including conflicts
added, removed or edited on its last page. Explicit cancellation releases only
the draft; interrupted editing preserves choices. Closed UI handles, stale
approval revisions and changed account/settings cannot authorize execution.

`pagedForegroundReview.ts` supplies a paged local adapter (`read` / revisioned
`choose`) for the editable Builder surface. Its streaming SHA-256 reproduces
the previous JSON retention identity exactly, using the pinned `@noble/hashes`
dependency. This preserves repeat Ignore receipt lookup without retaining the
whole choice list. The existing popup still uses the explicit legacy array
adapter; individually editable Builder controls and their installed acceptance
are the next required integration. The combined 10,000-path cap remains.

All 281 shared file-sync checks pass. Validation covers interrupted drafts and imports, old draftless migration,
settings/cancellation fences, final-page changes, exact hash parity through
10,001 rows, and bounded 128-row imports. Real isolated Chromium restart checks
recover the saved choice across 270 conflicts, verify the hash independently
with Web Crypto, and prepare 270 operations with zero file effects. These prove
engine/storage behavior, not installed-device transfers or editable UI delivery.
Full-project TypeScript still reports 91 diagnostics outside changed files.
Android remains deferred and its code is preserved.

## Bounded conflict review controls — 2026-10-19

`conflictReviewController.ts` is the shared data/action adapter for the upcoming
editable Builder review. It retains one 20-row journal page, persists each choice
with its row revision, serializes interactions, fences disposed sessions and
rechecks the reviewed header revision before resolving the foreground callback.
Failed reads preserve the current page; an error requires a fresh read before
Apply. Explicit cancellation differs from interruption, which retains choices.

`pagedReviewDraft.ts` provides ascending, bidirectional keyset pages without a
growing cursor-history array. Previous-page reads obey the same byte bound and
account/plan/generation checks; run import only accepts forward cursors. The
Chromium restart fixture uses this controller to reopen 270 conflicts, recover
the selected version, navigate backward and forward, then prepare the existing
run without executing file effects. This is engine/controller evidence, not
installed or visible Builder acceptance. The existing native popup still uses
the legacy callback, and the combined 10,000-path cap remains in place.

Next integration reuses Finch's merged editable block framework (PR 1042;
`api.things` 1.35.0 and `api.webpages-resolve` 1.6.0) and Aster's transient
action host. This branch predates those dependencies; do not introduce a
parallel opaque Component or persist runtime session handles in saved Things.

Validation: 288 shared file-sync checks pass, including 19 focused draft/controller
tests. Focused lint passes. Full TypeScript has 91 diagnostics outside changed
files. The isolated Chromium process-restart proof retains a 20-row view and
imports at most 128 rows per page; all 270 operations remain unexecuted.

## Editable paged conflict review — 2026-10-19

Mac and iOS now supply `reviewPagedConflicts` directly from `MobileSyncConnections`.
The active view holds one journal page; every choice is revisioned immediately.
Explicit Cancel returns the draft-release decision. Stopping the transfer or
changing account/origin disposes the view and preserves the draft for retry.
The legacy array review remains for the deferred Android compatibility path.

The view reuses the merged element/collection/condition Builder framework,
`TransientBlockHost`, and `SettingsDocumentHost`. Heading, muted retention copy,
repeated path/details, select/options, history and action buttons are individual
editable blocks. The account stores only a private authored layout, never live
file metadata, cursors or choices. Desktop uses its selected authenticated API
transport rather than the renderer origin. Layout editing suspends live actions.

The combined API advertises Things 1.36.0 (file-sync preferences plus editable
blocks) and webpage resolve/install 1.6.0. File-sync and editable-write clients
require the combined minor: the earlier 1.35.0 was independently used by these
two branches and cannot prove both features. Existing endpoint route coverage
and the isolated built-server manifest smoke pass.

The production review/Builder over a real IndexedDB journal passed isolated
Chromium checks: 22 conflicts across 20-row pages, immediate choices, Previous/
Next, failed reads preserving rows, process-restart recovery, separate retention
text/repeated-path/select-option/button edits saved and reloaded, desktop/mobile
full-page scrolling, and explicit Cancel, Resolve and Retain results. The fixture
layout API uses synthetic private Things; this is not installed native transfer,
real account layout or Timeline restore acceptance. A numeric revision binding
was corrected and regression-tested. Broader schema checks also updated the
existing photo `sourceKind` projection expectation.

Reproduce on macOS with `node remix/scripts/check-editable-sync-review.mjs`.
Set `TT_PLAYWRIGHT_MODULE` to an installed Playwright package path when it is
outside this checkout, and `TT_REVIEW_EVIDENCE` for saved screenshots/results.
The harness verifies OS network isolation, owns port 28188 and temporary browser
profiles, and refuses a permissive fallback. The built API smoke separately uses
28247 with no live database. Neither test server is a user-facing dev server.

The combined 10,000-path cap, installed Mac/iOS acceptance, background workers,
complete account backups and large exports remain open. Android stays deferred.


## Real Mac paged-runner acceptance — 2026-10-19

`test:files:mac-paged` now owns a disposable loopback Nitro server, Mongo replica,
local attachment store and synthetic API-created account. Its temporary Swift
fixture uses a stable Apple Development signature with the app-scope bookmark
entitlement; OS network isolation is enforced for the runner and descendants.
The installed app, user Keychain and personal files are untouched.

The production paged foreground runner passed 15 native and 15 cloud inventory
pages, 365 native calls and 732 live identity checks. Three real identity
cooldowns totalled 159 seconds. Transfers included an 8 MiB + 17-byte upload
and 2 MiB + 17-byte download; independent complete local/cloud hashes matched.
Accepted cloud, native staging and publication replies were deliberately lost,
then native processes and the journal were reopened. Original confirmed operation
IDs and the published baseline matched, with no accepted byte work replayed.
A conflicting local choice survived interruption and native/journal reopen, then
resolved through the real Files API. Child-before-parent Trash, native restore,
lost restore replies, occupied destinations and revoked-device refusal passed.

The harness now verifies completed runs through their published checkpoint and
confirmed receipt IDs, because successful publication releases the active root.
It also bounds shutdown of its own built server and signs only its temporary
fixture copy. The normal private-upload approval and API authorization paths
remain active; no direct document writes or production credentials are used.

Coverage boundaries: native picker/consent/credential storage are fixture adapters;
IndexedDB uses the existing in-process test implementation. Separate Chromium
proofs cover browser-process persistence and editable review UI. This does not
prove installed Mac/iOS UI, physical providers, million-path throughput or full
account backups. The 10,000 combined-path cap remains; Android stays deferred.


## Wide native destination checks — 2026-10-19

A combined native/API run above 10,000 paths reached the download publication
step and exposed an older limit in `NativeFileDestination`: alias validation
materialized every sibling name through the legacy reader. The shared Mac/iOS
destination now streams names, rejects alternate case or Unicode spellings,
and verifies the parent directory stamp before and after enumeration. It keeps
coordinated access, descriptor-relative no-follow traversal, exact destination
preconditions, retained displaced bytes and original publication receipts.

Mac access 1.5.1 / publication 1.1.1 and iOS access 1.3.1 / publication 1.0.1
advertise this correction; recoverable Trash is 1.2.1. Clients require the patched
access versions before using paged native inventories. Older builds keep the
bounded path. Fully paged native/cloud observations, individual path checks and
paged conflict review are required to cross the shared 10,000-path ceiling.
Missing any adapter preserves the limit and the previous complete checkpoint.

`pnpm --dir remix run test:files:mac-paged -- --wide` creates 10,001 cloud
folders through the normal Things import API and matching real Mac directories.
The acceptance exercises two real byte transfers, lost accepted replies, native
restart, complete 10,003-path baselines and unchanged reruns. It owns the same
OS-isolated disposable HTTP/Mongo environment as the smaller fixture. Its
20-minute deadline and cleanup are bounded; it never seeds database documents
directly. The regular command retains the broader conflict/Trash/revocation
matrix. See the HTML tracker's evidence for the current result of each run.

Regression coverage includes publication/lookup beneath wide ancestors, alias
refusal, and Trash/restore preserving 10,001 siblings. Shared runner coverage
checks a complete 10,001-path checkpoint and refusal of whole-array review.
The iOS simulator build and rendered desktop/phone controls are checked separately.
These are not installed-app, physical-provider, million-file or 100 GB–100 TB
acceptance. Persistent native workers, transfer-receipt retention and complete
backup/restore delivery remain open. Android remains deferred.

Large-root reruns also exercise retired journal cleanup. Cleanup now collects
at most 128 keys within the existing scoped cursor and deletes one contiguous
range per store/page in the same transaction. It retains the byte bound, pin
checks, active-run and current-baseline protection, and atomic rollback after
a queued range deletion. This avoids a separate delete request per obsolete
row; it does not prune native recovery bytes or account versions.

Cleanup now seeks the first remaining key before opening each page cursor.
This keeps deleted prefixes outside subsequent cursor ranges and avoids repeated
tombstone traversal during large reruns. Nine cleanup regressions pass, including
advancing range starts, restart, pin protection and atomic rollback. The slow
pre-seek wide runs were stopped after this diagnosed correction; only final-source
reruns count as acceptance.

Final-source acceptance (code `be360940b`, 19 October 2026) passed the wide
command: 10,001 real folders plus two files, 316 native pages and 316 cloud
pages, complete local/remote checkpoints, original operation IDs after lost
cloud/staging/publication replies and native restart, and an unchanged repeat
without replayed transfers. Independent local/remote hashes covered an
8,388,625-byte upload and a 2,097,169-byte download. The fixture used an
OS-enforced disposable API/Mongo environment and synthetic picker/credential
stores; it did not test an installed app or a real external provider.

The full shared suite passed 291 checks, including the 10,001-path checkpoint
and legacy-limit refusal; all nine cleanup regressions passed. Apple library
75 tests, Mac adapter 18 tests and the iOS simulator build passed. Desktop and
390px phone controls passed isolated Chromium review/Ignore/reload checks with
generated adapters. Project TypeScript still reports 91 diagnostics outside
changed files. The earlier HTTP timeout remains recorded as a failed attempt;
the diagnostic rerun passed without increasing the request timeout, reducing
the path count or changing the workload.


## Non-interactive native consent checkpoint — 2026-10-19

Mac publication 1.2.0 adds `write-check` through the existing local-only signed
host adapter. It validates the exact stored write approval and folder access,
rechecks account/device identity, grant and approval before returning, and never
opens a native dialog or persists consent. The final check also closes an
existing `write-approve` race when its saved approval is replaced during the
last identity verification.

The shared native target accepts explicit `existing` consent mode. Unsupported
versions fail before dispatch; there is no fallback to prompting. Capable
foreground targets also recheck saved approval immediately before staging,
publication and Trash. Read-only receipt lookup remains available through the
existing account/root gates. No history, operation IDs, grant format or remote
HTTP endpoint changed. iOS/Android native contracts are unchanged.

This checkpoint is a worker prerequisite, not persistent sync delivery. The
runner still belongs to the connection screen. Next work is an app-owned
executor with durable explicit job admission, exact configuration reauthorization,
serialized native access, conflict handoff and relaunch recovery. Installed
acceptance remains coordinated separately; Android remains deferred.
