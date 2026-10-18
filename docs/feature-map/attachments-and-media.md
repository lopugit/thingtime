# Attachments and media

`localThingProjection` derives standalone file edit eligibility from scoped
storage; `thingAttachmentDetailCore.canEditLocalFileDetails` applies current
viewer/link checks. Never infer edit rights from an ID prefix. The normal
anonymous import/edit/export browser regression lives in
`accountRecordingImport.browser.test.ts`; see the [metadata checkpoint](../local-workspaces.md#anonymous-imported-file-metadata--2026-10-17).

Normal account ZIP import uses `local-workspace/accountImport.ts` for shared
UI/facade routing, and `AccountThingSync` plus `AccountFileSync.contentHooks`
for atomic local admission and receipt-dependent media remapping. Regressions:
`accountFileImport.test.ts` and opt-in production-client
`accountFileImport.browser.test.ts`. Standalone files, recordings, post/comment files and ordinary content use this path;
linked and managed imports remain separate acceptance work. Recording
regression: `accountRecordingImport.browser.test.ts`; retention negotiates content
1.14.0 and deletion 1.5.0. Offline rename/delete compares complete known metadata
snapshots so deletion does not wait for annotation sync; unknown account changes
still require review. Native device audio skips the legacy audio cache.
See [local workspaces](../local-workspaces.md#account-file-transfer-imports--2026-10-17).

Conditional file sync prerequisites reuse `attachmentStore.annotateOwnedAttachment`
and `managedPlacement.moveManagedContent`. Annotation 1.2.0 accepts optional
`expectedUpdatedAt` and returns the committed timestamp; bulk 1.6.0 accepts it
only for single-item moves and reports stale per-item status 409. Both manifests
must carry these versions. `accountTransport.client.ts` negotiates them;
`accountFiles.browser.test.ts` covers real concurrent edits, moves, private bytes
and canonical attachment cleanup. Durable metadata reconciliation now lives in `accountFileMetadata.ts`;
completed-file deletion now uses the durable queue described below; ordinary standalone file UI now uses the adapter below; existing owned-file byte retention now uses the checkpoint below; see [local workspaces](../local-workspaces.md#conditional-account-file-metadata--2026-10-16).

Conditional deletion uses the same cleanup claims: delete 1.2.0 accepts
`expectedUpdatedAt` and fences both ordinary and objectless initial claims.
Retries of already-deleting rows retain owner/target/expiry checks but omit the
pre-claim timestamp. `attachments.test.ts` covers racing/skipped claims and
multipart deferral; the real account file browser test races annotation/deletion.
Legacy missing-row success is not a durable late-start cancellation receipt;
the request-id mode in delete 1.3.0 and the local queue below supply that fence.

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

## Anonymous workspace bytes and transfer

`app/local-workspace/attachments.ts` is the dedicated local metadata adapter;
`storage.ts` stores bounded byte arrays and JSON atomically under the same scope
and quota ledger. `things.ts` imports/exports/copies/deletes canonical ZIP content
using the existing transfer validators and composition-media rewriter. The normal
`ThingImportDialog` bypasses uploading only for local-only workspaces, while
`thingTransfer/browser.ts` accepts an identity-scoped in-process byte reader.
No server storage key, approval, ownership or moderation verdict is synthesized.

Bounds: 16 MiB per file, 1 MiB per JSON record, 64 MiB total and 10,000 records.
Missing bytes or checksum failures reject the operation. Account file import is
not enabled by this adapter; account access gates above remain authoritative.
Linked galleries, annotation and account sync remain separate work. Run `test:local-workspace` and `test:things`; see
[the coverage matrix](../local-workspaces.md) for local browser evidence.


## Anonymous normal file UI and media URLs

`FilesystemThingsBrowser` uses the existing workspace API for anonymous file-picker
saves, downloads, folders and copy/move. `LocalThings.saveFile/readFile` atomically
store canonical metadata with bytes and validate checksums. `media.ts` owns bounded,
reference-counted object URLs; `media.client.tsx` connects them to `SharedMedia` and
root diagnostics. Local media routes reuse `ThingPage` and its native attachment
renderer. Pending src/href values are omitted. Server media access is unchanged; account device previews use the scoped adapter below.
`apiIdentity.ts` keeps workspace API callbacks stable without retargeting retired
account closures. Run `test:local-workspace`, `test:attachments`, `test:things` and
`test:webpages`; see the local-workspace manual checklist for offline browser and
identity-retirement checks. The normal composer queue now supports local post/comment files; restored edit
previews use `SharedMedia` as well. `LocalDrafts` owns atomic independent media
copies and draft binding; unbound post/comment files expire after 24 hours and
are reaped on later file/draft writes. Annotation, linked galleries, audio/video
acceptance and account byte synchronization still need their adapters/checks.


## Durable account upload foundation

`app/local-workspace/accountFiles.ts` supplies scoped atomic file/byte/intent
admission and durable multipart recovery. `accountTransport.client.ts` negotiates
the existing upload capabilities and fences account/data-plane requests and
credentialless signed PUTs. `accountApi.client.ts` drains it alongside content and
interaction queues; `AccountSyncStatus.tsx` renders its retry panel. The ordinary standalone account picker/list/media now uses this adapter; see the checkpoint below. Run `test:local-workspace`
and the opt-in `accountFiles.browser.test.ts` (README local workspace setup),
plus the attachment suite. Preserve start identity and completion phase on lost
responses; never restart uncertain completion as a fresh upload.


## Account file metadata queue

`accountFileMetadata.ts` retains independent annotation/placement intent inside
the local file write transaction, negotiates the existing conditional APIs via
`accountTransport.client.ts`, and uses upload receipts plus ordinary folder-sync
state as dependencies. `AccountSyncStatus.tsx` provides comparison and reviewed
choices. Run `accountFileMetadata.test.ts`, the local workspace suite and the
file browser fixture. Preserve immutable pending operations on lost replies;
newer device edits and unrelated account edits must survive reconciliation.
The ordinary standalone account picker/list/media path now uses this queue (checkpoint below).

## Durable completed-file deletion

Delete 1.3.0 accepts a canonical id, its original requestId and expectedUpdatedAt
for full-user standalone-file deletion. It reuses retained cancellation receipts
and version-fenced cleanup; legacy deletion behavior remains compatible.
`AccountFileSync.remove` moves the local snapshot into recovery with queued intent;
`inspectDeletion`/`resolveDeletion` drive the native review and protect both sides.
Metadata sync skips deleting files. Only a durable `deleted:true` acknowledgement
releases bytes. The worker coalesces wake-ups arriving during a drain, and the
moderation stamper only updates ready files. Run workspace, attachment, capability
and moderation suites plus the real file browser fixture, including full quota,
lost replies, stale reviews and the concurrent edit/delete race. Existing owned-file retention is implemented in the checkpoint below.


## Normal account file browser and scoped media

`FilesystemThingsBrowser` now uses `saveLocalFile`, local folder writers and the
file metadata move adapter for account files. `AccountFileSync.library/views`
project standalone device files and their owned server aliases; `readFile`
excludes cancellation/deletion recovery data. `accountApi.client.ts` exposes them
through normal get/list, and the Files browser combines bounded device pages
with authorized account discovery without blocking local completion.
`media.client.tsx` scopes URL registries to `workspaceIdentityKey`; shared media
contexts remain on their server authorization path. Tests: workspace, Things,
attachments, `accountFileUi.browser.test.ts` and `accountFiles.browser.test.ts`.
Existing owned-file retention is implemented below; managed imports/exports remain completion gates.


## Existing account file deletion receipts

Delete 1.4.0 adds `retainReceipt:true` with an existing owned standalone file's
canonical ID and observed version, without its original upload request ID. The
service reuses exact-version cleanup and private accounted cancellation receipts.
`attachmentDeleteClaimFence` keeps standalone eligibility atomic. Unlike the
request-ID mode, missing IDs return 404 and are never reserved. Full-user and
same-origin gates remain; uncertain legacy cleanup never acknowledges a fence.
Run the attachment/capability suites and `accountExistingFile.browser.test.ts`
with the same disposable loopback/admin setup as `accountFiles.browser.test.ts`.
Existing-account byte retention is now covered by the later retention checkpoint; see the
[local workspace checkpoint](../local-workspaces.md#existing-saved-file-deletion-receipts--2026-10-16).


## Retaining existing owned originals

Content 1.13.0 adds `cache=retain&download=1`: the same-origin full-user route
returns an opaque version key and canonical owned-file metadata without storage
URLs. `attachments.download(..., true)` additionally restricts retention to
standalone, non-expiring, unblocked originals owned by the caller.
`AccountFileSync.retain` double-checks the descriptor and atomically stores
versioned bytes, metadata and a device alias; no upload request ID is invented.
The normal Thing/media page reads the alias, edits through `AccountFileMetadata`
and deletes through receipt mode 1.4.0. Retention failure preserves the online
view with a warning. Keyed/shared media stays on the existing authorization path.

Run `accountFileRetention.test.ts`, attachment/capability/workspace/Things suites
and `accountFileRetention.browser.test.ts` with explicit local fixture settings.
Set `TT_LOCAL_FILE_RETENTION_COLD=1` against a production client build to prove
true offline reload, edit/download and reconnect. See the
[dated scope and evidence](../local-workspaces.md#retained-account-files--2026-10-17);
parent-folder discovery, managed transfers and bound media are still open.


`local-workspace/accountExport.ts` now feeds live standalone account file records
into the shared `exportLocalThingSnapshot` collector and supplies a scoped
in-process byte reader to the normal Download dialog. Canonical account aliases
and retained portable byte bindings are rewritten with `rewriteTransferMedia`;
old snapshots do not grant file access. Run `accountFileExport.test.ts`, the
opt-in `accountFileExport.browser.test.ts` and the extended cold-retention browser
fixture. Account file import and complete remote-folder/managed transfer coverage
remain pending; see [the transfer checkpoint](../local-workspaces.md#account-file-transfer-exports--2026-10-17).


## Account post file binding

`AccountFileSync` stages unsubmitted post/comment files without network work;
`AccountThingSync` and `contentHooks.prepare` bind local content to confirmed upload
receipts. `accountThingTransport` pairs PublicThing with the same-ID post companion
for authoritative attachment receipts. `accountExport` includes live bound bytes.
`attachments.remove` discards only unsubmitted device selections. The native
composer saves locally even when the account upload scope has not been approved;
remote upload still requires approval.

PATCH `/things` passes validated attachment IDs to `updateThing`, which inspects
purpose and applies `syncBoundTargetAttachments` inside the content transaction.
Negotiate `api.things-update` 1.11.0 for this atomic behavior; the two manifests use
the same docs entry. Tests: `accountBoundMedia.test.ts`, opt-in
`accountBoundMedia.browser.test.ts`, workspace/attachments/Things/capability suites.
See the [binding checkpoint](../local-workspaces.md#account-post-file-admission-and-binding--2026-10-17)
for explicit remaining coverage.


## Offline removal of authored post/comment files

`AccountFileSync.removeBound` atomically hides device media and preserves deletion
intent/recovery bytes. `accountApi.client.ts` routes the normal editor removal and
idempotent retries directly to that operation; it never waits for draft saving.
`contentHooks.prepare` and the file worker order deletion against immutable parent
writes. Delete 1.6.0 negotiates request-ID + target + version cleanup through the
existing attachment service/store, retaining a private cancellation receipt.
Run workspace, attachment, Things and capability suites plus the enabled
`accountBoundMedia.browser.test.ts`. Cover lost upload/delete responses, wrong
target/purpose, concurrent edits, full quota and cold offline reload; existing
remote bound-file retention/import remain separate gates. See the
[checkpoint](../local-workspaces.md#account-post-and-comment-file-removal--2026-10-17).


Existing owned post/comment originals use `AccountFileSync.retainPost` and the
parent's conditional `AccountThingSync.remember` transaction. Content 1.15.0
returns a whitelisted target/purpose descriptor; delete 1.7.0 supports an observed
bound ID/version/target with `retainReceipt:true`. No upload identity is invented.
`accountBoundRetention.test.ts` covers atomic admission, stale/read-refusal and
quota races; `accountBoundRetention.browser.test.ts` uses a second clean context
for native offline edits/removals and actual private reconnect. Comment update
transport omits the inherited audience snapshot while preserving server policy.
See the [fresh-device checkpoint](../local-workspaces.md#existing-account-post-and-comment-originals--2026-10-17)
and README for the opt-in loopback fixture.


## Offline account post/comment ZIP import

`accountImportSupported` and `LocalThings.import` admit validated bound post/comment
files through the existing `AccountFileSync.contentHooks` transaction. All content,
bytes and queue intents commit locally; upload approval and exact account/plane
verification remain remote requirements. The normal Import dialog does not wait
for uploads. Regressions: `accountBoundImport.test.ts` and the expanded
`accountFileImport.browser.test.ts` using README's existing loopback fixture.
Complete exports of previously remote bound content still require the separate
complete-snapshot acceptance work; partial read caches never prove completeness.


Complete owned post/comment retention now records the original account file IDs
inside the existing `thing-sync` record, atomically with content and bytes.
`accountExport.ts` recognizes this proof for native offline Downloads without a
prior online export. Missing file records still fail; intentional device removals
and pending edits are included. The proof is internal and never portable.
`accountBoundRetention.test.ts` and its opt-in browser fixture cover exact-byte
round trips, retained order, conflict recovery and fresh anonymous import.


`AccountFileSync` checks canonical read-refusal watermarks before exposing retained
account bytes. Only definitive owned-descriptor refusals write those watermarks;
transient failures keep offline access. Reauthorization rechecks descriptors and
atomically fences older responses. `accountApi.client.ts` announces affected
local aliases so active blob previews recheck access; unsynced metadata/recovery
bytes remain in their original scope. `accountExport.ts` also fences dedicated
and keyed remote plans through the existing in-process `assertCurrent` hook.
Run file-retention/export, account read-refusal and workspace suites, plus
`accountFileRetention.browser.test.ts` with the existing cold production-client
fixture. See the [lifetime checkpoint](../local-workspaces.md#retained-file-access-and-remote-export-lifetimes--2026-10-17).


`AccountThingSync.remove` now delegates selected post/comment file children to
`AccountFileSync.contentHooks.removeBound` in its own transaction. Generic protected
children still refuse and roll back; dedicated upload/deletion records retain
recovery bytes and immutable operations. `prepareRemove` holds remote parent
deletion until file cleanup completes, after any uncertain parent write settles.
Tests: `accountBoundMedia.test.ts` and enabled `offlinePostTemplate.browser.test.ts`;
see the [deletion checkpoint](../local-workspaces.md#offline-post-templates-and-bound-parent-deletion--2026-10-17).

## Password-vault attachments

`api/utils/passwords/files.ts` uses an internal `passwordVault` adapter to the
canonical multipart service. The immutable password purpose is refused by normal
attachment routes. Content is browser-encrypted; the per-file key and real name
are wrapped by the account vault on the protected attachment root. Only a saved,
owned password entry may bind the file; deletion and expiry keep existing
exact-version cleanup and accounting. Ciphertext skips external moderation.

Anonymous password attachments use the device password vault rather than the
ordinary attachment store. Their shared UI/archive backend and scoped encrypted
chunk lifecycle are documented in [auth and accounts](auth-accounts-and-admin.md#anonymous-password-files-and-shared-archive-storage).
