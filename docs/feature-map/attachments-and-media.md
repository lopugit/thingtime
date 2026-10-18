# Attachments and media

iOS publication 1.2 hosts now use the same app-owned runner and durable admissions
as Mac. `nativeSyncHost.client.ts` binds the device/session; `folderHostFetch.client.ts`
shares the strict account transport. `nativeSyncVisibility.ts` preserves runnable
jobs on background interruption, permits only an accepted current-file lease,
and fences new work at lease expiry. `test:files:ios-lifecycle` verifies the
production UI with isolated synthetic native/HTTP grants and a real Chromium
restart. Physical iOS background/relaunch and passive OS scheduling remain open.

Mac publication 1.2.0 adds `write-check`: exact saved approval can be read
without opening a dialog or saving consent. `mobileSyncTarget.client.ts` uses
it before staging/publication/Trash on capable hosts and offers an explicit
`existing` consent mode for resume. Legacy foreground behavior is unchanged;
legacy hosts cannot use non-interactive resume. `MacFolderSyncTests`,
`mobileSyncTarget.test.ts`, Electron folder-host checks and the disposable
`test:files:mac-paged` acceptance cover the boundary. The Mac connection now delegates explicit runs to `nativeSyncTasks.client.ts`
and `syncTaskRuntime.ts`; view detachment preserves execution and review. The
Electron `SyncWindowLease` keeps an active window hidden on Close. Durable explicit job admission and root-app resume now live in
`syncJobJournal.ts` and `NativeSyncBootstrap.tsx` (journal v11). Automatic
resume uses existing native consent only; Stop persists a pause. Explicit
recurring admission adds due times and fresh cycle IDs. `DesktopSyncAutomation`
and `syncAutomationBlocks` expose separate editable interval/Start/Stop blocks;
`syncWindowRetention` composes active and scheduled window holders. Root discovery
checks selected origin before retaining an idle schedule. Installed relaunch/reboot
and iOS workers remain open. Run
`test:files:desktop-lifecycle` for the isolated production-UI regression.

`fileSync/pagedReviewDraft.ts` adds bounded mutable conflict-review storage to
the version-10 journal. It binds complete plans/captures, persists revision-checked
choices, seals reviewed pages for fresh-plan run preparation and shares bounded
maintenance. Run `pagedReviewDraft.test.ts` and `test:file-sync`; the generated-data
`review-draft.browser.ts` fixture covers a real Chromium restart. `pagedForegroundSync.ts` now consumes sealed drafts through fresh-plan checks
and resumable run import. `pagedForegroundReview.ts` exposes bounded reads and
revisioned choices for the editable Builder adapter, plus a streaming
SHA-256 that preserves existing repeat-Ignore identities. The new `conflictReviewController.ts` retains one page, persists revisioned
choices and fences stale completion; the journal now supports byte-bounded
Previous/Next navigation without a cursor-history array. Mac/iOS popups now use
`PagedSyncConflictReview`, editable Builder blocks and the shared transient/settings
hosts. Isolated desktop/phone editing and restart checks pass; installed acceptance
remains open. Legacy clients retain the bounded array path.

Native folder captures now use `apple/FileSync/MobileFolderInventory.swift`
(under `Sources/AppleFileSync`), negotiated by `fileSync/nativeInventory.ts`:
Mac file-access 1.5.1 / iOS 1.3.1. A private SQLite capture supplies immutable
128-entry / 512-KiB pages; `pagedForegroundSync.ts` imports complete generations
before planning and checkpoints. Run `MobileFolderInventoryTests`,
`MacFolderSyncTests`, `nativeInventory.test.ts`, `pagedForegroundSync.test.ts`
and `test:file-sync`. Photos/older clients retain bounded legacy scans; cloud
paging is integrated; persistent workers and installed large-root acceptance remain open.
See [native paged captures](../mobile-file-sync.md#native-paged-folder-captures--2026-10-18).

Attachment-content 1.14.0 also serves bounded exact-version byte ranges through
`attachmentRanges.ts` and the existing content loader. `cloudDownloadSource.ts`
checks current file metadata and exact range/ETag framing. Download operations
reuse `CloudSyncRun` and the existing journal/executor; `LocalSyncTarget` requires
verified private staging, atomic destination checks and durable native receipts.
`MobileSyncStaging.swift` supplies verified iOS staging (`fileStagingVersion`
1.0.0) and coordinated publication (`filePublicationVersion` 1.0.0). Native
Keychain approvals bind the account, origin, device, connection, selected grant
and reviewed settings. `mobileSyncTarget.client.ts` connects stage/publish/lookup
to the shared runner. iOS Download now supports explicit deletion propagation with native Trash 1.2;
per-platform publication acceptance and background workers are tracked in the sync ledger.
Publication uses same-volume exclusive rename or swap with no-follow/beneath
resolution, retains displaced inodes in the existing transfer record, and
recovers durable receipts without touching later edits. This is not an inode-CAS
primitive: a racing uncoordinated writer is retained and leaves a pending conflict.
Unsupported providers/volumes refuse. Process-kill, provider and authenticated
installed-app acceptance remain tracked in the full sync ledger.


`apple/FileSync/MobileSyncTrash.swift` (under `Sources/AppleFileSync`) provides
recoverable same-volume Apple moves and explicit exclusive restore. It reuses
`NativeFileJournal` and `NativeFileDestination`; these are operation recovery,
not Timeline history. Mac/iOS bridge actions negotiate `fileTrashVersion` 1.2.0
and separately bind deletion consent (`allowTrash`). Run the Apple package tests,
`apple/FileSync/scripts/test-trash-process.sh`, the focused Mac adapter suite,
iOS `MobileSyncTrashTests`/`MobileSyncStagingTests`, and the real Mac/API fixture.
`localTrash.ts` derives bounded parent/child receipt links so the shared runner
can remove children before empty parents. `NativeFileRecovery.tsx` lists owned
retained records under the same surviving picker grant and requests native
confirmation for exclusive restoration. Android Trash, regrant recovery and
whole-account backup of native recovery bytes remain open; see the
[recovery checkpoint](../mobile-file-sync.md#recoverable-apple-native-trash-foundation--2026-10-17).


Persistent file sync work lives in `app/fileSync/`: `reconcile.ts` plans bounded
three-way inventory reconciliation, `execute.ts` persists stable operations and
resolves uncertain receipts, and `journal.client.ts` stores the browser queue.
Its inventory namespace in `inventoryJournal.ts` stores: immutable, scope/generation-bound
observation pages, exact retry receipts, cross-page path/ID uniqueness and
resumable ancestry validation. Reads stay unavailable until the terminal count
and every ancestor have been verified. This is a storage prerequisite for large
roots. The version-4 journal adds `pagedPlanJournal.ts`: four pinned sealed
captures, a resumable cross-capture validation/changed-ancestor pass, then bounded
decisions using the shared `decideSyncPath` policy. `journalScope.ts` fences both
namespaces. Plans stay unreadable until complete; pins prevent source replacement
and are released per plan. The complete paged native/cloud/review path has passed a real 10,003-path
Swift/API run; legacy or incomplete adapters retain the 10,000-path cap. Run `pagedPlanJournal.test.ts` for parity, late deletion conflicts,
exclusions, restart/concurrency, Unicode folded cursors, byte bounds and migration.
Run `test:file-sync` for the 100,000-path reopen/readback and partial-scan guards.
The content endpoint also serves exact-version `sha256-parts-v1` fingerprints
through `getAttachmentFingerprint`; `contentFingerprint.ts` shares part planning
and bounded local hashing, and `attachmentFingerprint.client.ts` reads the
authorized receipt. Run `test:file-sync` and `test:attachments`. The editable `file-sync` schema in `configuration.ts` persists bounded connection
preferences through ordinary Things (1.35.0, private by default).
`configuredPlan.ts` checks owned/private projections, separately supplied local
approval, conditions and symmetric exclusions, including excluded ancestor
deletion protection. Run `scripts/file-sync-configuration.integration.mts` for
real API storage/revision and editor lost-response recovery checks.
`components/Devices/MobileSyncConnections.tsx` connects selected roots to those
Things through shared `configurationEditor.ts` save/recovery logic. Drafts are
local, scoped and verified before writes; fixed IDs and revision guards survive
reloads. A saved connection is not native execution approval. Native write acceptance and persistent workers remain tracked in the sync ledger. `foregroundSync.ts` now
connects explicit mobile upload/backup and approved iOS download controls to complete scans, live native
policy signals, journal retries and durable common-baseline checkpoints;
see [mobile sync acceptance](../mobile-file-sync.md). File writes must continue
through the canonical attachment and Timeline paths described below.

`api/utils/files/inventory.ts` adds complete private cloud folder scans through
`GET /api/v1/files?rootId=...` (Files 1.1.0). Snapshot transactions and bounded
breadth queries produce exact file/folder observations; any inaccessible,
ambiguous or oversized tree fails without partial data. `cloudInventory.ts`
validates the shared response and `cloudInventory.client.ts` pins account,
origin and home storage while reading it. Run `test:files`, `test:file-sync`
and `scripts/file-versions.integration.mts`. Files 1.2.0 additionally supplies immutable folder-creation receipts through
`api/utils/files/folders.ts`, composing the ordinary Things writer and Timeline.
`prepareCloudInventoryRun` pins new parent IDs for nested uploads, and the cloud
port resumes them through the same journal. Mac/iOS local publication and directory Trash are integrated. Android is
deferred; background workers remain pending.

Stable file roots are protected `file` Things written by `api/utils/files/files.ts`
through `/api/v1/files`. The shared `fileSync/cloudFile.ts` contract maps a file
revision into a sync entry. Bound `file` attachments retain each byte version;
Timeline stores the guarded commit/receipt and prior metadata. Run `test:files`
and the opt-in `scripts/file-versions.integration.mts` acceptance. Retention,
sharing and full native sync acceptance remain tracked in the sync ledger.

`fileSync/cloudWrite.ts`, `cloudTransport.ts` and `cloudSyncPort.client.ts` connect
prepared upload/backup and remote Trash runs to the real file/attachment APIs.
Pinned destinations persist in the existing sync journal; multipart retries reuse
the operation ID, and exact receipts recover accepted writes without reading the
source again. `test:file-sync` and `scripts/file-sync-cloud.integration.mts` cover
this path. Background workers and cross-platform download acceptance remain separate work.

`iOS/Thingtime/Files/` now supplies account/origin-scoped native picker grants,
complete bounded scans and version-checked descriptor-relative reads.
`fileSync/mobileFolders.client.ts` validates bridge replies and adapts chunked
reads to the shared fingerprint/upload source contract. The paired-device card
uses `MobileFolderAccess.tsx` to choose/check/remove access; it does not launch
transfers. Bookmarks remain native. Android's equivalent adapters live in
`android/app/src/main/java/com/thingtime/mobile/FolderBridge.java`, `FolderStore.java`,
`FolderReader.java` and `SafFolderProvider.java`. The shared controls negotiate
both native platforms. Android keeps read-only tree URIs in encrypted native
storage and verifies content despite unreliable provider timestamps. Mac/iOS native
destination writes are integrated; persistent schedulers remain pending and
unfinished Android work is explicitly deferred.

Stored files are `attachment` Things (`thingtime: ['attachment']`) whose bytes
live in a private, versioned S3 bucket (or the local filesystem stand-in).
Every attachment is bound to exactly one target (post, comment, page, message,
profile slot, emoji, subspace branding) or is an owner-only draft/recording.
Canonical rules: [`FUNDAMENTALS.md`](../../FUNDAMENTALS.md) §3 (appended data
is relational; attachments target their parent via `targetId`).

## Where the code lives

| Layer | Path | Notes |
| --- | --- | --- |
| Service (upload lifecycle, download signing, copy, cascade, reap) | `app/api/utils/attachments/attachments.ts` | `createAttachmentService(deps)`; exports `startAttachmentUpload`, `signAttachmentUploadParts`, `completeAttachmentUpload`, `getAttachmentDownload`, `copySharedAttachment`, … |
| Storage documents | `app/api/utils/attachments/attachmentStore.ts` | `AttachmentDoc` shape, `MAX_ATTACHMENTS_PER_TARGET`, sort/bind helpers |
| Pure metadata helpers | `app/api/utils/attachments/attachmentCore.ts` | purposes, `toAttachmentPublicMetadata`, `orderAttachmentDocsByStoredSort`, name/type sanitizing |
| Object storage interface | `app/api/utils/attachments/privateS3.ts` | `AttachmentS3` interface + `getPrivateS3()`; presigned upload parts and downloads |
| Local stand-in | `app/api/utils/attachments/localAttachmentStorage.ts` | same interface on disk when `THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR` is set; serves `/api/v1/attachments/local-object` (signed-URL gated, so it carries no rate key — the only attachments route without one); `THINGTIME_LOCAL_ATTACHMENT_STORAGE_ORIGIN` makes the signed URLs absolute for native/script clients; `fetchStoredObject()` for server-side reads (honours abort signals) |
| Access rules | `app/api/utils/attachments/attachmentAccess.ts` | `canViewHomeAttachmentTarget` — purpose-specific target checks (post/page ACL, comment inheritance, chat membership, profile slot, emoji) |
| Shared compositions | `app/api/utils/actions/sharedComposition.ts`, `compositionMediaCore.ts` | media embedded by pages/components authorized through a `sharedRoot` |
| Image previews | `app/api/utils/attachments/imageVariants.ts` | bounded WebP variants (`width=`), in-memory cache |
| Download-all archives | `app/api/utils/attachments/attachmentArchive.ts`, `attachmentArchiveCore.ts`, `zipStream.ts` | plan → manifest → streamed stored ZIP |
| Moderation | `app/api/utils/moderation/analyzeAttachment.ts` | stamps `moderation.status` (`pending`/`clear`/`nsfw`/`blocked`) |
| Routes | `app/routes/api/v1/attachments/*` | `uploads`, `uploads/parts`, `uploads/complete`, `uploads/abort`, `content`, `archive`, `local-object`, `link`, `annotate`, `delete`, `cleanup` (cron), `backfill-detected-types` (admin) |

## Authorization helper (every read of bytes)

`getAttachmentDownload(viewer, id, forceDownload)` is the single gate for
bytes: ready state, moderation, draft expiry, exact object version, custom
data-plane refusal, and the purpose-specific target check via
`canViewHomeAttachmentTarget`. Never sign or stream an object without it. The
content route builds the viewer as
`withFriendIds(withLinkKeys(withFoundPostBrowser(viewerOf(user), request, anonymous), [key]))`
and adds `isAdmin` / `sharedRoot`; copy that shape for any new byte-reading route.
Uniform 404 for missing and unauthorized.

Uploads are gated by `createAttachmentMutationAction({ requireUploadPermission })`
in `attachmentResponses.ts`: new accounts start with `meta.publicUploads: false`
until an admin enables them (`POST /api/v1/admin/users/public-uploads`).

## Client entry points

| Surface | Path |
| --- | --- |
| Composer uploads (XHR PUT to signed part URLs, retries, drafts) | `app/components/Attachments/useAttachmentUploads.ts`, `AttachmentComposer.tsx` |
| Editable Component draft uploads and media | `app/components/Builder/ComponentAttachments.tsx`: `tt-attachments` reuses the composer; the saved Action commits. `tt-media` reuses `PostAttachments` with authorized source metadata. |
| Rendering a post's gallery, file rows, NSFW shield, download-all pill | `app/components/Attachments/PostAttachments.tsx` |
| Lightbox and bounded image pinch/pan | `app/components/Attachments/MediaLightbox.tsx`, `ZoomableImage.tsx`, `imageZoomCore.ts` |
| Media Thing page `/media/:id` | `app/routes/media.tsx` (annotate, download, gallery download-all) |
| URL helpers (`attachmentContentUrl`, `attachmentArchiveUrl`, labels) | `app/components/Attachments/attachmentUiCore.ts` |
| Download-all menu section + browser download | `app/components/Attachments/attachmentArchiveActions.ts`, `useAttachmentArchive.ts` |
| Shared-link context (`key`, `sharedRoot` propagation) | `app/components/Sharing/SharedMedia.tsx`, `sharedMediaCore.ts` |
| API client | `app/hooks/useApi.tsx` → `api.v1.attachments.*` (negotiates `api.attachment-*` capabilities first) |

## Registration when you add an attachment endpoint

1. Route file `app/routes/api/v1/attachments/<name>/_<name>.tsx` (wrap in
   `withAttachmentPrivateResponse`).
2. Import map in `remix/server/routes/api/[...].ts`.
3. `endpoint({ id, contractVersion, featureVersion, … })` in
   `app/docs/apiDocs.ts` — this also feeds both capability manifests and the
   Nitro route table. Bump `featureVersion` deliberately on contract changes.
4. Rate key in `app/api/utils/rateLimit/config.ts` (`attachments.<verb>`).
5. Client requirement (`requireThingtimeCapability('api.<id>', '<min>')`) in
   `useApi.tsx` / the UI hook before calling.
6. Docs: README "Private S3 media and attachments" for env/setup, `TESTING.md`
   "Post and comment attachments" or "Media thing pages".

## Tests

- `npm --prefix remix run test:attachments` — service, store, access, archive,
  ZIP stream, local stand-in, UI cores, routes (`attachmentsRoutes.test.ts`).
- `test:api-capabilities` after any docs/route change.
- Live checks need object storage: locally set
  `THINGTIME_LOCAL_ATTACHMENT_STORAGE_DIR` and seed with
  `node remix/scripts/seed-fixture.mjs create` (see
  [local-development-and-worktrees.md](local-development-and-worktrees.md));
  on Vercel previews the real bucket is available.
- `TESTING.md`: "Post and comment attachments", "Media thing pages", "Persistent
  media and progressive image regression".

## Gotchas

- Linked (external URL) attachments have no bytes: renderers use `url`
  directly; the content endpoint never redirects to them.
- `attachmentSortIndex` on child docs is the display order; the parent never
  stores an id list.
- Blocked media vanishes for everyone except admins reviewing evidence;
  pending media is visible only to its owner.
- Mongo projections must not name both `crystal` and a `crystal.<field>`
  (path collision → 500).

## Standalone file Things

Purpose `file` uses the existing private upload, quota, moderation and exact-owner
content gates. Completion makes it durable in the owner library; `file-import`
remains an expiring draft until the protected transfer writer commits it.
`useAttachmentUploads` supplies the filesystem browser's upload path, preserving
original bytes; portable exports/imports retain the immutable file purpose.
`test:attachments` covers file lifecycle and access alongside recordings.
The minimum origin contracts are listed in [remote-files.md](../remote-files.md).

## Account drafts and templates

See [account-drafts-and-templates.md](account-drafts-and-templates.md) for the
private draft API, editor recovery, account isolation and independent media copies.

## Builder uploads and Lopu file saves

`ComponentUpload.tsx` commits selected bytes through `componentUploadCommit.ts`: a valid private text Post and a non-reserved retry ID hold the upload. `copyStoredAttachment.ts` also supports owner-private `file` copies for Lopu's `save_attachment` in `chatTools.ts`. It reads an authorized pinned source version, reserves quota, copies bytes and uses normal moderation/finalization. The returned file ID and content URL can be used as Thing properties; `managedPlacement.ts` files it in an owned folder. Request replay returns the existing file. Rollback only claims unfinished private uploads, so concurrent retries cannot delete a committed file. Shared/public copy revocation still removes its draft.

Run `test:attachments`, `test:components`, `test:lopu` and the isolated real-byte `scripts/verify-schema-files.ts` acceptance flow. See the public-schema/upload/Lopu checklist in `TESTING.md`.


## Mac native/cloud acceptance and throttling

`remix/scripts/mac-file-sync.integration.mts` runs the shared foreground engine
against the real loopback APIs and `MacFolderSync` through the test-only Swift
`MacFolderSyncFixture` executable. It exercises actual native bytes, explicit
synthetic picker/consent, live credential verification, both directions, independent
replacements, lost replies, process restart and revoked-device refusal. It does
not cover signed Electron/XPC, installed Keychain/TCC or AppKit. See the command
and fixture prerequisites in README's Mac sync acceptance section.
`ThingtimeAPIClient.verifyFileSyncIdentity` honors one integer `Retry-After`
(1–60 seconds) for a 429, then rechecks cancellation and the exact local credential
before repeating the live request. Identity remains uncached; auth errors,
invalid/long delays and repeated 429s fail. Streaming/throughput remains open.


`CloudTransportRuntime.authorizeMutation` supplies the foreground configuration,
device and policy recheck before each POST/PUT. `cloudRequests` and the signed
part writer await it before creating their HTTP deadline, then recheck scope,
cancellation and (for parts) source identity. Request bodies are captured before
the wait. Read requests still bypass mutation authorization. This prevents a
native consent/cooldown wait from expiring an unsent request; caller cancellation
and 30-second JSON / 120-second upload deadlines remain enforced. Regression
coverage lives in `foregroundSync.test.ts`, `cloudTransport.test.ts` and the
`--cooldown-before-upload` Mac integration option.

## Mac range stream

Mac file access 1.2 uses `mobileFolderSource` → `read-range` →
`electron/lib/folder-sync.cjs` → `thingtime-node-bridge.cjs` / `folder-stream.cjs`
→ the signed XPC byte sink → `MacFolderSync` → `MobileFolderReader.stream`.
One coordinated range (32 MiB maximum) carries acknowledged 64 KiB frames,
with source checks between frames, live identity before/after and browser-account
verification before returning binary bytes. A 15-second missing-ack limit,
cancellation and exact range/binding validation reject unfinished transfers.
Ordinary XPC frames remain capped; no new HTTP endpoint or device permission.
Tests: `folder-stream.test.cjs`, `folder-sync.test.cjs`, isolated Electron
`test/fixtures/folder-sync-host.cjs`, `FolderStreamXPCTests`, `MacFolderSyncTests`,
`MobileFolderTests`, and `mobileFolders.client.test.ts`. Real API acceptance is
`mac-file-sync.integration.mts --large-upload`. Installed Mac acceptance,
mobile streaming and sustained large-folder throughput remain open.

Mac staging 1.1 negotiates `stage-range` in `stageMobileCopy`. Binary bytes cross
Electron IPC and a length-prefixed helper pipe; `NodeFolderStreamInput` serves
sequential 64 KiB XPC pulls to `MobileSyncStaging.appendStream`. A range flushes
before its checkpoint, and unfinished tails/replayed ranges retain the existing
recovery semantics. `append` uses the same primitive for older/mobile bridges.
Tests extend `mobileStaging.test.ts`, `folder-stream.test.cjs`, native staging and
XPC tests; `mac-file-sync.integration.mts --large-upload --large-download` verifies
real transfers and a native restart after a lost accepted staging reply.

## iOS transport receiver

`MobileSyncConnections` wraps the mobile `window.fetch` call before passing it
to inventory and cloud transports. WebKit rejects invoking a copied native fetch
with a transport object as its receiver. `mobile-sync-editor.browser.tsx` now
models that receiver constraint; installed iOS two-way acceptance exercises the
real WebKit call through canonical inventory, upload and download APIs.

## Android saved-settings consent acceptance

`DeviceLiveTest.verifySettingsReapproval` extends the opt-in two-way installed
test after independent edits converge. It updates the saved Thing through the
revision-guarded API, refreshes the real connection controls, and requires fresh
native consent. Cancellation and an approved retry must preserve the complete
cloud inventory, native identities and full byte hashes. The Android README
documents the two consent prompts; this covers settings saved elsewhere, not
the connection edit form or background execution.

## Retained file history

`components/Timeline/TimelineFileVersions.tsx` renders canonical `file-content`
Timeline snapshots and uses `fileSync/fileVersions.ts` for content identity and
restore validation. `useApi().v1.files` reads/commits through the existing files
API with account/origin/home fences. Downloads use `attachmentContentUrl` and the
existing `getAttachmentDownload` permission gate. Restore commands persist only
retry metadata; bytes/history remain in accounted attachments and Timeline.
`fileVersions.test.ts`, `storageScope.test.ts`, `scripts/file-history.browser.html`
and `scripts/file-versions.integration.mts` cover this path. Installed native
History/download acceptance and native retained-version browsing remain open.

`android/app/src/androidTest/java/com/thingtime/mobile/FileHistoryAcceptance.java` is the opt-in installed History check
(`THINGTIME_FILE_HISTORY_TEST=1` on `android/scripts/test-mobile-devices.sh`). It
uses real private file uploads, History filters, guarded restore and exact byte
readback. It does not claim a native exported file. `timeline/browserModel.ts`
uses `timelineFileVersion` for canonical file card names and Files filtering.

Android History exports negotiate `fileExportVersion` 1.0.0 through
`fileSync/fileExport.client.ts` and the bounded native `FileExportBridge` /
`AttachmentExport` adapters. Exact authorized attachment ranges are verified
before Save As; the provider document is read back before success. No general
WebView download listener or arbitrary-URL fetch is installed. Tests:
`fileExport.client.test.ts`, `AttachmentExportTest.java`, and the opt-in installed
`THINGTIME_FILE_EXPORT_TEST=1` History check documented in `android/README.md`.

`SessionCookie` pins the exact native export authentication credential from the
canonical `tt_auth` cookie; unrelated cookie refreshes do not invalidate it.
Missing, duplicate or changed credentials remain refused. `SessionCookieTest`
and `fileExport.client.test.ts` cover the session and native-error regressions.


## iOS History exports

`iOS/Thingtime/Files/FileExportBridge.swift` negotiates the shared
`fileExportVersion` 1.0.0 contract. `apple/FileSync/.../FileVersionExport.swift`
validates immutable attachment metadata, reads bounded ranges into private cache,
verifies fingerprints and publishes an exclusive copy into a one-use Files folder
selection. WebView main-frame/origin checks, exact-auth-cookie pinning and fresh
owner checks surround the picker/save. No persistent grant or new API is added.
Tests: `FileVersionExportTests`, `FileExportBridgeTests`, and opt-in
`FileExportInstalledTests` via `THINGTIME_FILE_EXPORT_TEST=1` on the existing iOS
installed acceptance script. See README for the disposable fixture and manual
steps. Installed simulator export and restore pass; physical providers, Mac
exports and cross-folder content-ID retrieval remain in the sync ledger.


## Android binary upload ranges

Access 1.4 selects `read-range` in `fileSync/mobileFolders.client.ts`.
`mobileRangeFrames.receiveMobileReadFrame` assembles strictly ordered, correlated
binary frames and acknowledges each native nonce. Android `FolderRangeSink`
bounds backpressure; `FolderReader.readRange` and `ManagedFileStore.readRange`
return verified bounded bytes through the existing `FolderBridge` grant and
owner checks. `MainActivity` advertises 1.4 only with WebView ArrayBuffer support.
Tests extend mobile folder/frame tests, `FolderRangeSinkTest`, `FolderReaderTest`,
`ManagedFileStoreTest`, and `DeviceLiveTest`'s opt-in real SAF upload acceptance.

`api.files` 1.3.0 accepts `kind=retained-version` via the existing files route and
`api/utils/files/files.ts`. This binds a verified alternate upload and records a
canonical Timeline effect without advancing the live file or Published head.
Receipt lookup requires the same kind, file and operation. `fileVersions.ts`
recognizes only server retention effects with the reserved receipt identity;
existing History download/restore cards and Files filtering apply. The real
`file-versions.integration.mts` check covers concurrent publication, exact replay,
restore and byte readback. Shared conflict capture now reuses these APIs and native source adapters;
installed capture acceptance and independent backups remain unfinished; see `docs/mobile-file-sync.md`.


`foregroundSync.ts` plans explicit conflict retention through
`conflictResolution.ts`; `executeRetentionRun` and the version-2 journal intent
separate capture from sync/checkpoint publication. `createCloudRetentionTransport`
uses the ordinary verified multipart source and immutable retention receipts.
`conflictRetention.test.ts` covers reopen/source-loss, unchanged live/baseline,
repeat capture and account/configuration/cancellation fences.

## Portable backup vault

`app/backups/manifest.ts` defines bounded portable metadata/range pages and the
small canonical Timeline snapshot descriptor. `api/utils/backups/portableBackup.ts`
freezes a supplied inventory, captures independent chunk bytes, validates source
fingerprints, seals and resumes copies without re-fetching existing chunks.
`localBackupStore.ts` supplies private immutable filesystem storage, not a public
HTTP route or a new database. Providers must supply access/quota and source
boundary guarantees. Run `test:backups`, the `backup:vault` offline CLI and the
foreground API fixture's `--portable-backup` mode. [Format, limits and unfinished
product integration](../portable-backups.md).

`api/utils/backups/cloudFolderBackup.ts` now freezes an explicitly selected Files
inventory into that vault and resumes exact retained attachment ranges after live
edits/Trash. `backup:cloud` runs the worker with a private caller-supplied session
configuration. Creation now uses the shared `cloudInventoryStream.ts` decoder
(Files 1.5.0) and `cloudBackupTree.ts` private SQLite scratch index for bounded
ordering, physical ancestry and identity/path uniqueness. Resume retains its
Files 1.2.0 requirement and unchanged sealed format. Run `test:backups`,
`test-cloud-inventory-pages.mjs`, and the foreground fixture's `--portable-backup
--large-download` for their distinct storage, handler and API/CLI boundaries.
Scratch/snapshot limits and the older whole-tree restore bound remain explicit. See the [cloud capture coverage](../portable-backups.md#cloud-folder-capture);
this does not enumerate all account Things or add server Timeline backup events.

`backups/treeRestorePlan.ts` preflights selected filesystem trees; the shared
`openSealedBackup` lazy reader avoids per-file inventory rescans.
`backups/localTreeRestore.ts` restores reviewed trees into an exclusively created
private local recovery directory, with durable range checkpoints and exclusive
file publication. `backup:vault plan-tree/restore-tree/resume-tree` and
`test:backups` cover real process-exit recovery, output preservation and local
process exclusion. See [restore boundaries](../portable-backups.md#reviewed-tree-restore).

Mac historical Save As uses `electron/lib/file-export.cjs` and the negotiated
preload `fileExportVersion` bridge consumed by `fileSync/fileExport.client.ts`.
It shares retained attachment identity and canonical multipart fingerprints,
uses session-bound ranges, native destination selection and exclusive verified
publication. See the Mac acceptance section in `docs/mobile-file-sync.md`.


Fresh sync path observations (`api.files` 1.4.0) use
`api/utils/files/inventory.ts` through the existing Files route. Client parsing
and identity/capability checks live in `fileSync/cloudPath.ts` and
`cloudPath.client.ts`; `cloudSyncPort.client.ts` checks the pinned root/path
before native download publication. Keep path absence distinct from HTTP 404
or incomplete inventories. Regressions: `inventory.test.ts`, `cloudPath.test.ts`,
`cloudDownloadPort.test.ts`, and `scripts/mac-file-sync.integration.mts`.


`fileSync/pagedRunJournal.ts` prepares bounded durable operation rows from sealed
paged plans, pins plan identity, and excludes legacy writers on the same root.
`pagedExecute.ts` uses the existing Web Lock and shared per-operation execution,
ordering and receipt policy in `execute.ts`. Journal version 5 preserves prior
captures/plans/runs/checkpoints. Started runs remain retained until a future
paged checkpoint handoff. `pagedRunJournal.test.ts` covers recovery, ordering,
conflicts, concurrency, migration and baseline preservation. The isolated
Chromium 10,001-operation proof uses generated metadata and independent receipts;
native/cloud integration and the live 10,000-path limit remain open.


### Paged baseline publication (2026-10-18)

`fileSync/pagedCheckpointJournal.ts` advances version-6 journal baselines after
complete runs and fresh sealed scans. A bounded five-stream merge overlays
confirmed receipts on the previous baseline before applying the shared agreement
rule, preserving later edits. Exact internal capture instances, distinct pins,
paired-page retries, sealed outputs and atomic publication protect recovery.
Old retries cannot release a newer run or replace its head; legacy writers cannot
downgrade a published paged baseline. `pagedCheckpointJournal.test.ts` and the
400-operation isolated browser proof cover these boundaries. Native/cloud adapter
integration and installed Mac/iOS acceptance are still open; Android is deferred.


### Paged cloud bindings (2026-10-18)

Version-7 inventory pages retain canonical cloud metadata and verify physical
ancestry. `fileSync/cloudBinding.ts` and `pagedRunJournal.ts` prepare bounded
immutable destinations and native Trash receipt links before effects; interrupted
pages and binding configuration changes fail closed. `createPagedCloudSyncPort`
uses the same transport as legacy foreground sync, with indexed binding lookup.
`cloudInventoryJournal.test.ts`, `pagedCloudBindings.test.ts` and a 270-download,
two-browser-restart proof cover storage/transport recovery with generated data.
Stable scan producers, live foreground/worker integration and installed Mac/iOS
acceptance remain open. Android is deferred.


### Mac/iOS foreground paged recovery (2026-10-18)

`MobileSyncConnections.tsx` selects `fileSync/pagedForegroundSync.ts` for Mac/iOS;
Android remains on the legacy runner and deferred. `foregroundSyncContext.ts`
shares live authorization with both runners. Version-8 durable review pages use
`pagedRunReview.ts` and the canonical conflict policy before operation preparation.
Retention releases the active root without changing the baseline, and exact
repeated Ignore reuses receipts. Fresh post-run observation generations prevent
mixing scans across interruption; checkpoint publication remains atomic. Legacy
uncertain work completes before migration. `pagedForegroundSync.test.ts`,
`pagedRunReview.test.ts` and desktop/iOS browser fixtures cover these paths.
Native/cloud producers still supply complete bounded scans; the 10,000-path cap,
installed-device acceptance, worker integration and journal cleanup remain open.


### Bounded foreground metadata lifecycle (2026-10-18)

`fileSync/journalRetention.ts` registers foreground-owned metadata in journal
version 9. `journalMaintenance.ts` retires and deletes it in bounded transactions
under the root lock; tombstones prevent ID reuse until child removal completes.
Active roots/inputs, current baselines, retained receipts and other reader pins
remain protected. `pagedForegroundSync.ts` runs maintenance before new work;
`pagedCheckpointJournal.ts` queues replaced observations for the same cleanup.
Unmanaged/legacy observations are preserved. Eight `journalMaintenance.test.ts`
regressions and `scripts/journal-maintenance.browser.ts` cover interruption,
transaction rollback, scope, stable storage counts and browser-process recovery.


### Native single-path observation (2026-10-18)

`MobileFolderReader.inspect` observes one exact path with bounded retained
metadata, descriptor-relative access and before/after identity checks. Mac folder
access 1.4.0 and iOS 1.2.0 expose it behind final owner/grant revalidation.
`supportsNativePathInspection` negotiates those independent minimums;
`foregroundSyncContext.readLocal` shares the observation between both runners.
`MobileSyncConnections` enables it only for supported non-Photos roots. Missing
entries are explicit; errors never become absence or trigger a scan fallback.
The existing complete scans/10,000-path cap remain until paged producers ship.
Native reader/adapter tests, shared runner tests and the `?capture&inspect`
browser fixture cover the path. Installed acceptance remains open; Android is
deferred. See the dated section in `docs/mobile-file-sync.md` for evidence.


### Cloud inventory stream

`api.files` 1.5.0 routes `rootId&pages=1` to `files/inventoryPages.ts` and
`inventoryStream.ts`, using the shared root authorization and a request-owned
`inventoryQueue.ts`. `fileSync/cloudInventoryPages.client.ts` decodes bounded
NDJSON; `pagedForegroundSync.ts` seals cloud metadata before planning or
checkpoint stamp import. The registry supplies both manifest generators.
Tests: `inventoryPages.test.ts`, `cloudInventoryPages.test.ts`, paged foreground
and Files route tests; `test:files:inventory-pages` uses actual API handlers and
an isolated replica. See the dated sync ledger for acceptance boundaries.

### Bounded cloud path checks

`files/inventory.ts` reads only the matching ancestor chain and streams each
parent's siblings; `inventoryUniqueness.ts` proves cross-row ID/path uniqueness
in bounded anonymous scratch storage. `readCloudInventoryNode` is shared by all
three inventory readers. `api.files` 1.6.0 and `fileSync/cloudPath.ts` negotiate
this wider path-observation contract. Tests: `inventory.test.ts`,
`inventoryUniqueness.test.ts`, `cloudPath.test.ts` and
`test:files:inventory-pages`. See the dated mobile sync ledger for bounds and
installed/large-production acceptance gaps.


### Mac paged transfer acceptance

`test:files:mac-paged` uses `scripts/test-mac-paged-sync.mjs` to own an isolated
HTTP server, replica and synthetic identity. `mac-file-sync.integration.mts
--paged` connects the real Swift folder adapter to `pagedForegroundSync`,
`nativeInventory`, `cloudInventoryPages.client` and durable conflict choices.
The README documents signing and network isolation. Installed-app/provider
acceptance and the combined foreground path limit remain separate gates.


Wide destination compatibility: `NativeFileDestination.swift` streams sibling
alias checks; Mac access 1.5.1/publication 1.1.1 and iOS access 1.3.1/publication
1.0.1 advertise the correction (Trash 1.2.1). `supportsNativeInventoryPages`
requires the patched contract, so older clients retain bounded scans. The shared
runner lifts the combined path ceiling only with all paged/path/review adapters.
Run `test:files:mac-paged -- --wide` for the API-provisioned 10,003-path Mac proof,
plus Apple staging/Trash tests and `nativeInventory.test.ts` for version gates.
See [wide native destinations](../mobile-file-sync.md#wide-native-destination-checks--2026-10-19).


### iOS saved-consent resume prerequisite (2026-10-19)

Native publication 1.2.0 adds non-interactive exact approval checks and per-folder
publication capability. The bridge verifies paired-device authority, bookmark
access and final owner/grant/approval state; Photos remains read-only. Shared target
checks now cover Mac and iOS. The iOS runner is still view-owned, so durable
app/background execution and installed-device acceptance remain unfinished.
