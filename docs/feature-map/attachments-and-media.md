# Attachments and media

Cloud sync HTTP 403 diagnostics retain only the operation and a closed policy
reason (upload approval, origin, account or credential-purpose refusal).
`cloudTransport.test.ts` verifies redaction and terminal refusal behavior; a
refusal never bypasses the ordinary attachment upload-approval gate.

Cloud JSON sync requests classify HTTP 408/429/5xx as temporary transport waits.
`syncJobJournal.ts` persists an optional, revision-guarded `retryAt`; automatic
discovery respects it across restart and repeated wake events. Retry-After is
bounded to 30 seconds through five minutes. The next attempt retains its
operation ID and checks receipts before publishing; explicit Retry can clear
the delay, while Stop, authority and integrity failures retain their safeguards.

Local post/comment linked galleries and normal Attach-by-URL selections now use
`local-workspace/attachments.ts` metadata markers and the ordinary importer,
composer and draft pipeline. URL rows never claim stored bytes. Mixed transfer
preserves annotations/order; copies get fresh identities. Account registration
reuses `AccountFileSync` claims and stable request IDs, verifies canonical receipts,
and waits before parent binding; conditional metadata edits and durable deletion
retain owner/target/content identity. Bound byte annotations use the same checks.
Known registered URL drafts/posts refresh without fetching external bytes;
unfamiliar server-only links and other managed targets retain their dedicated
online boundaries. Local API/draft/receipt tests pass; final-package native
acceptance is tracked in [linked-media evidence](../../artifacts/anonymous-local-first-2026-10-23/linked-media/README.md).

Durable cancellation now uses abort 1.2.0 `{requestId}` and the existing unique
attachment identity. `reserveCancellation`, the retained deleting claim and
`cancelledAttachmentReceipt` keep a private accounted zero-object tombstone after
cleanup. The closed envelope is validated in `attachmentCore.ts`; never expire or
purge it through ordinary cleanup. Legacy abort stays separate; full-user auth
is required for this new mode. `accountFiles.ts` persists start/cancel intent,
fences tab claims and retains bytes until confirmation. `AccountSyncStatus`
provides offline Cancel upload and completed-file deletion review.

Stored files are `attachment` Things (`thingtime: ['attachment']`) whose bytes
live in a private, versioned S3 bucket (or the local filesystem stand-in).
Every attachment is bound to exactly one target (post, comment, page, message,
profile slot, emoji, subspace branding) or is an owner-only draft/recording.
Canonical rules: [`FUNDAMENTALS.md`](../../FUNDAMENTALS.md) §3 (appended data
is relational; attachments target their parent via `targetId`).

Parent deletion uses the canonical version check before bound-file cleanup.
`AccountThingSync` and `AccountFileSync.contentHooks` retain recovery while the
parent is refused/conflicting and restore files with the reviewed account version.
Same-origin owner DELETE opts into durable cascade receipts through `api.things`
1.34.0; `attachments.beforeCascade` reuses cancellation claims. See the
[parent conflict checkpoint](../local-workspaces.md#parent-deletion-conflicts-preserve-media--2026-10-17).
`offlinePostTemplate.browser.test.ts` now covers both accepted and refused deletes.

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
`AccountFileSync` now supplies the filesystem browser's local save and upload queue, preserving
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
Scratch/snapshot limits remain explicit. See the [cloud capture coverage](../portable-backups.md#cloud-folder-capture);
this does not enumerate all account Things or add server Timeline backup events.

`backups/treeRestorePlan.ts` preflights selected filesystem trees using a bounded
private disk index, including ancestry, paths and final verification records.
Review output streams with backpressure and retains the v1 digest; the former
10,001-item/32-MiB planner bound is removed. The shared
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

`attachmentRetention.ts` owns exact-version backup holds (content 1.15.0;
abort/delete/reap 1.2.0). The existing content route accepts bounded owner POST
batches and owner-only `retained=1` ranges. `attachments.ts` fences purge through
that service; the normal retry sweep and storage refund remain canonical. Run
`test:attachments:retention` for real isolated Mongo concurrency/accounting plus
`test:attachments`, `test:backups` and `test:api-capabilities`. See
[the retention rollout boundary](../portable-backups.md#source-version-retention--2026-10-19).
## Password-vault attachments

`api/utils/passwords/files.ts` uses an internal `passwordVault` adapter to the
canonical multipart service. The immutable password purpose is refused by normal
attachment routes. Content is browser-encrypted; the per-file key and real name
are wrapped by the account vault on the protected attachment root. Only a saved,
owned password entry may bind the file; deletion and expiry keep existing
exact-version cleanup and accounting. Ciphertext skips external moderation.

## Local media processing in reusable Components

`app/webPlatform/mediaPipeline.ts` validates the saved `program.media` contract.
`liveMediaPipeline.ts` binds declarative controls inside the opaque frame;
`hostMediaPipeline.ts` fences requests and owns a terminable secure-context
`mediaWorker.ts`. Mediabunny/WebCodecs decode, scale, encode and mux a selected
local Blob. `mediaOutput.ts` handles random-access mux writes; `mediaExport.ts`
validates the host download. No attachment upload or remote fetch is involved.
`schemas/appSuites/mediaTools.ts` composes ordinary saved Page/Component/Action
Things, with the existing save-draft Action preserving settings as data.
Canonical docs and Lopu discovery guidance live in `docs/builderGuide.ts`.
Run `test:web-platform`, `test:api-capabilities`, `test:vercel-config` and the
isolated real-browser flow in README; see TESTING's local video checklist.

### Sync upload provenance (2026-10-22)

`fileSync/uploadOrigin.ts` defines closed private original-source metadata.
Attachment upload-start 1.7.0 persists the approved client-supplied relative path,
device/root IDs and intended file/folder identity before multipart authority,
including exact queued retries of older reservations. It never grants native
access. Private batch preparation 1.2.1 supplies the same metadata from its
authorized immutable descriptor, including ready/finalizing recovery.
`api.files` 1.8.1 checks initial publication against that destination. Current
moves/restores never rewrite the original source. `api.things` 1.40.0 exposes
provenance only on full owner-session individual detail reads; public, PAT, app
and list projections omit it. Legacy unbound uploads without an explicit saved
retry cannot acquire an inferred path. Standalone upload semantics stay intact.

### General local compressor (2026-10-22)

`webPlatform/LocalMediaPipeline.tsx` binds the same media worker to ordinary
editable child elements through `tt-media-pipeline`. Author the controls directly
as saved Things; `templateToBlocks` preserves individual Builder identity.
No new compressor Page/Component definition ships in the application.
Legacy Web Platform media surfaces mount automatically and read current settings
on Start. `imageFiles.ts` classifies images without loading codec code into the
main bundle; `imageAssets.ts` fetches pinned same-origin WASM only;
`imagePipeline.ts` decodes, auto-orients, resizes, encodes and verifies output
frames, alpha and timing inside the network-disabled worker. See README for
format/animation/SVG limits. Run the media/image tests, template-block tests,
capability coverage and the isolated Chrome acceptance runner.

### Maximum local output bytes (2026-10-23)

Optional authored `maxOutputSize` / `maxOutputUnit` normalize to worker
`maxOutputBytes`. `mediaSizeBudget.ts` reserves audio/overhead and adjusts video
retries from actual bytes. `imagePipeline.ts` retries whole-frame quality and
dimensions. `hostMediaPipeline.ts` independently fences oversized completions
before preview/download. Things 1.42.0, update 1.13.0 and webpage resolve 1.9.0
cover the saved contract. Run the media/image and size-budget tests through
`test:web-platform`; see the maximum-size checklist in TESTING.md.
