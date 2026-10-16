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
