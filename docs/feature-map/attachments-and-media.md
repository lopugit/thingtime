# Attachments and media

Attachment-content 1.14.0 also serves bounded exact-version byte ranges through
`attachmentRanges.ts` and the existing content loader. `cloudDownloadSource.ts`
checks current file metadata and exact range/ETag framing. Download operations
reuse `CloudSyncRun` and the existing journal/executor; `LocalSyncTarget` requires
verified private staging, atomic destination checks and durable native receipts.
`MobileSyncStaging.swift` supplies verified iOS staging (`fileStagingVersion`
1.0.0) and coordinated publication (`filePublicationVersion` 1.0.0). Native
Keychain approvals bind the account, origin, device, connection, selected grant
and reviewed settings. `mobileSyncTarget.client.ts` connects stage/publish/lookup
to the shared runner. iOS Download now is available with deletion propagation
disabled; Android/Mac publication and background workers remain pending.
Publication uses same-volume exclusive rename or swap with no-follow/beneath
resolution, retains displaced inodes in the existing transfer record, and
recovers durable receipts without touching later edits. This is not an inode-CAS
primitive: a racing uncoordinated writer is retained and leaves a pending conflict.
Unsupported providers/volumes refuse. Process-kill, provider and authenticated
installed-app acceptance remain tracked in the full sync ledger.


Persistent file sync work lives in `app/fileSync/`: `reconcile.ts` plans bounded
three-way inventory reconciliation, `execute.ts` persists stable operations and
resolves uncertain receipts, and `journal.client.ts` stores the browser queue.
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
reloads. A saved connection is not native execution approval. Android/Mac native file
write adapters and persistent workers remain pending. `foregroundSync.ts` now
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
port resumes them through the same journal. Directory deletion, Android/Mac local writes and
background workers remain pending.

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
storage and verifies content despite unreliable provider timestamps. Native
destination writes and persistent schedulers remain pending.

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
