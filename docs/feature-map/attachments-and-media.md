# Attachments and media

Conditional file sync prerequisites reuse `attachmentStore.annotateOwnedAttachment`
and `managedPlacement.moveManagedContent`. Annotation 1.2.0 accepts optional
`expectedUpdatedAt` and returns the committed timestamp; bulk 1.6.0 accepts it
only for single-item moves and reports stale per-item status 409. Both manifests
must carry these versions. `accountTransport.client.ts` negotiates them;
`accountFiles.browser.test.ts` covers real concurrent edits, moves, private bytes
and canonical attachment cleanup. Durable metadata reconciliation now lives in `accountFileMetadata.ts`;
delete reconciliation and ordinary account file UI wiring remain pending; see [local workspaces](../local-workspaces.md#conditional-account-file-metadata--2026-10-16).

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
renderer. Pending src/href values are omitted. Account media access is unchanged.
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
interaction queues; `AccountSyncStatus.tsx` renders its retry panel. This is not
yet the ordinary account picker/list/media adapter. Run `test:local-workspace`
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
The ordinary account picker/list/media/delete path is still pending.
