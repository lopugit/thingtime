# Download all attachments — ZIP archives, gallery buttons and share links

Branch `claude/download-all-attachments-93a5f3` → `main` (owner-authorized promotion and merge).
Delivered 20 September 2026 by Claude (AI).

## What shipped

1. **`GET /api/v1/attachments/archive?id=<thing>`** — one streamed ZIP of every
   stored file the caller may already read on a post, comment, page, folder or
   single media Thing. `manifest=1` returns JSON (`fileCount`, `totalBytes`,
   `skipped`, `linkCount`, `files[]`) instead of bytes; `HEAD` returns headers only.
2. **Download all buttons** — a `Download all · N files · size` pill under any
   post/comment gallery with two or more stored files, a folder-down button in
   the lightbox for multi-file galleries, a gallery button on `/media/:id`, and
   a current-folder pill on `/things`.
3. **Files menu section** — `Download all files` + `Share download link` in the
   post/media ⋯ menu (`PostThingMenu`) and the `/things` item/right-click menu
   (`thingsMenuModel`) for folders, posts, pages and media Things.
4. **Share download link** — copies (or natively shares on mobile) the canonical
   archive URL. Opening it in a browser, `wget` or `curl -OJ` downloads the ZIP;
   the Thing's own audience decides who succeeds.

## Design decisions

- **Discovery is not authorization.** The root resolves through
  `findViewableThing` (hidden Things open by exact id, private ones need a
  real audience — the same canonical-URL rule PR #860 established). Folder
  children are re-judged individually with `canViewInherited`; the folder's
  audience never leaks into its contents. Every file is then signed through
  `getAttachmentDownload`, i.e. the exact purpose/target, moderation,
  ready-state, object-version and home-storage gates the content endpoint
  uses. Files failing a gate are counted as `skipped`; a root with nothing
  left returns 404 uniformly with missing/unauthorized roots.
- **No new secret.** The share link is the plain endpoint URL, so a private
  post's link only works for people who can already see it (or for the owner's
  own browser session). Owners who want anyone to use the link switch the post
  to public or "anyone with the link", exactly as for the post URL itself.
  A signed bearer-token variant was deliberately left out to keep one sharing
  model; it can be added later as `?token=` without changing the URL shape.
- **Streaming, stored ZIP.** `fflate`'s `Zip` + `ZipPassThrough` write members
  uncompressed with data descriptors, so memory stays at one upstream chunk plus
  a 4 MiB queue (`ByteLengthQueuingStrategy` backpressure) regardless of size.
  Media is already compressed; deflating again would only burn function time.
  Signed S3 URLs are fetched server-side (`redirect: 'error'`) and never leave
  the server. Upstream byte counts are verified against the signed size.
- **Bounds.** 500 files, 2 GiB (fflate has no ZIP64), 1000 traversed Things,
  64 folder levels, 280 s wall clock (Vercel `maxDuration` is 300 s). Exceeding
  a bound returns 413 with "download the folders inside separately".
- **Naming.** Archive name = folder name / media filename / page title / the
  post's opening words (bounded, path-safe, id fallback). Entry paths are
  allocated case-insensitively unique (`photo.jpg`, `photo (2).jpg`); post
  galleries inside folders get their own sub-directory; linked media is listed
  in `links.txt` (path re-allocated if a real `links.txt` exists).
- **Client flow.** Download buttons fetch the manifest first so an empty,
  unauthorized, oversized or stale-server case becomes a Lopu toast instead of
  a navigation into JSON, then trigger a same-origin anchor download. All
  surfaces share `useAttachmentArchive` and `buildArchiveMenuSection`.
- **Contracts.** Docs entry `attachment-archive` (contract + feature 1.0.0)
  drives both capability manifests and the Nitro route table; import map and
  `attachments.archive` rate key (30/min) added. Clients negotiate
  `api.attachment-archive ≥ 1.0.0` before probing or sharing.
- **Settings.** No user-facing setting was added: the feature has no meaningful
  per-user choice (audience is already the Thing's audience, naming is
  content-derived). Revisit if an "always deflate" or "flat folder layout"
  preference is requested.

## Files

- Server: `remix/app/api/utils/attachments/attachmentArchiveCore.ts`,
  `attachmentArchive.ts`, `zipStream.ts`,
  `remix/app/routes/api/v1/attachments/archive/_archive.tsx`,
  `remix/server/routes/api/[...].ts`, `remix/app/docs/apiDocs.ts`,
  `remix/app/api/utils/rateLimit/config.ts`.
- Client: `remix/app/components/Attachments/attachmentArchiveActions.ts`,
  `useAttachmentArchive.ts`, `attachmentUiCore.ts`, `PostAttachments.tsx`,
  `MediaLightbox.tsx`, `remix/app/components/Feed/PostThingMenu.tsx`,
  `PostCard.tsx`, `remix/app/routes/media.tsx`,
  `remix/app/components/Things/thingsMenuModel.ts`, `ThingsViews.tsx`,
  `ThingsPage.tsx`, `remix/app/hooks/useApi.tsx`, `remix/app/theme/icons.tsx`.
- Tests: `attachmentArchiveCore.test.ts`, `zipStream.test.ts`,
  `attachmentArchive.test.ts`, `attachmentArchiveActions.test.ts`, additions to
  `attachmentsRoutes.test.ts` and `apiCapabilities.test.ts`.
- Docs: `TESTING.md` (three checklist items), `remix/CHANGELOG.md`.

## Validation

- `node --import tsx --test` on the six test files above: all pass (ZIP bytes
  are round-tripped through `unzipSync`; folder walk, skipped files, links,
  budgets, viewer context, HEAD/manifest/400/404/503 routes covered).
- `corepack pnpm --dir remix run lint:files` on every changed file: clean.
- `typecheck:ratchet`: see the PR body for the exact count; the baseline
  already carries pre-existing `app/schemas/registry.ts` / `app/smarts` errors
  that this branch does not touch.
- Browser checks (worktree dev stack, desktop + 375 px): see PR body.

## Follow-ups (not in this PR)

- Optional signed `?token=` share links for private Things.
- Multi-selection archives on `/things` (several ids in one ZIP).
- Live S3 end-to-end acceptance on a preview deployment with real objects.
