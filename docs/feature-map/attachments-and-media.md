# Attachments and media

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
| Rendering a post's gallery, file rows, NSFW shield, download-all pill | `app/components/Attachments/PostAttachments.tsx` |
| Lightbox | `app/components/Attachments/MediaLightbox.tsx` |
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
