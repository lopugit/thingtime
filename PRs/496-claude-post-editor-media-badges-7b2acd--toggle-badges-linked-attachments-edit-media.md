# PR #496 — Composer toggle badges, linked (URL) attachments, edit-mode media

Branch `claude/post-editor-media-badges-7b2acd` → `develop`.
https://github.com/lopugit/thingtime/pull/496

Two rounds of owner requests.

## Round 1 — toggles, edit-add, rename, URL adder placement

- Post-type badges became additive TOGGLES (Text always on; Photos /
  Marketplace / 📦 Things switch their field groups on top; the stored crystal
  `type` is DERIVED: things > marketplace > photos-with-visual-media > text).
  🌀 Thingtime renamed 📦 Things in `POST_TYPE_META`.
- `PATCH /api/v1/things { id, attachmentIds }` upgraded from pure-permutation
  reorder to a **sync**: full desired display order; must cover the bound set;
  may append newly minted/uploaded READY drafts, bound with the create-time
  fences plus an owner-fenced post-family target check (an edit can never bind
  media onto someone else's thread). Edit composer mounts the live media panel
  again.

## Round 2 — URL media as first-class linked attachments + moderation fixes

Owner QA found: URL images looked like a separate system, duplicate URLs were
swallowed, an uploaded image vanished from a saved post, and an edit-save
failed ("Post did not go through").

**Root cause of the last two**: `markReady`/analyzer stamp
`moderation: pending`; `toAttachmentPublicMetadata` hid pending from EVERYONE
including the owner, while the PATCH sync's bound-set cover check counted them
— a guaranteed 409 plus "my picture disappeared".

### Linked attachments (new)

- New attachment flavor: `attachmentLinked: true`, `objectKey: linked/<id>`,
  `objectSizeBytes: 0`, crystal carries a validated external `url` and a
  DECLARED render hint (`mediaKind`), state `ready` at mint, moderation
  stamped `skipped` (no bytes to analyze; also guards the analyzer + sweep).
  Accounting treats it as a closed variant (any partial/forged combination
  fails closed); only the metadata doc bytes hit quota.
- `POST /api/v1/attachments/link` (route + import map + apiDocs entry — docs
  registry IS the Nitro registration — + `attachments.link` rate-limit row).
  Purpose post|comment; server derives contentType/kind from the URL
  extension; the client may DEMOTE to `file` after a failed image probe but
  can never promote a file extension to a visual kind. Duplicates
  deliberately allowed; unbound mints expire on the 24h draft TTL. The server
  never fetches the URL (no SSRF surface). No upload-approval gate (parity
  with the legacy crystal.images flow it replaces).
- Lifecycle: `cleanupClaimedDoc` resolves S3 lazily — BEFORE the destructive
  deleting claim for uploaded docs (unconfigured S3 fails atomically), never
  for linked docs, which short-circuit straight to the transactional
  remove+refund — so delete, cancel, reap, session-replacement sweep, and
  post-delete cascade all work without S3. The content endpoint returns 404
  for linked ids (a 302 to the external URL would be a first-party open
  redirect — caught by the adversarial review); renderers always use
  `crystal.url` directly (`attachmentMediaSrc`).
- Client: `useAttachmentUploads.addLinkedUrl` appends a linked entry to the
  SAME uploads list (reorder/snapshot/markCommitted/remove all apply);
  `AttachmentComposer` grew the in-panel URL input + Add button (clears per
  add), linked-aware tile bucketing/labels ("Linked"), and stays useful while
  uploads await beta approval. `LinkedImageGallery` usage removed from the
  composer (component remains for kind renderers).
- Legacy `crystal.images`: edit seeds them as LOCAL linked tiles
  (`legacyurl-` ids, pre-committed so cleanup never fires); Save mints real
  linked attachments in panel order and clears `images`. New posts never
  write `crystal.images`.

### Moderation visibility fixes

- `toAttachmentPublicMetadata(..., { ownerView })`: pending stays visible to
  the OWNER with `pending: true` (rendered as a "Checking…" badge);
  blocked stays hidden for everyone. `resolvePostAttachments` threads
  viewerId. Mirrors `visibleRelatedModerationClause` and the download route's
  owner carve-out.
- `planAttachmentSync(requested, bound, hiddenBound, max)`: moderation-hidden
  bound ids are exempt from the cover requirement (clients can't send ids
  they never saw) and re-stamp AFTER the requested list preserving relative
  order — inside the same transaction as the bind.

### Verified

- Full `test:unit` green (attachmentCore grew linked-crystal, accounting
  closed-union, ownerView, hidden-sync, extension-table pin suites; 133 in
  test:attachments), `build:client` green, targeted ESLint green.
- Live on the worktree stack (13510): duplicate URL → two tiles; `.pdf` URL →
  linked file row with working download; extensionless URL → probe → image;
  post → card renders linked media identically to uploads; edit → add URL →
  Save binds via PATCH sync ("Post updated"); legacy 4-image post migrated on
  save (`images: []`, 4 linked attachments); linked mint/delete round-trip
  with NO S3 configured; validation rejects `javascript:`/credentialed URLs
  and kind promotion. Desktop + 375px mobile, no overflow.
- Not covered locally (no S3): real-byte upload E2E — unit-covered; TESTING.md
  checklist items added for the preview pass, including the
  moderation-pending owner-visibility window.

### Adversarial review round (12-agent workflow, 9 findings → 8 confirmed)

Fixed in the follow-up commit:
- **Open redirect (medium)**: removed the content-endpoint 302 fallback for
  linked ids (renderers never needed it).
- **Mint 503/409 on exotic basenames (medium)**: `linkedAttachmentNameForUrl`
  now re-validates after the 255-char slice (trim, control chars, well-formed
  unicode) and degrades to hostname → 'linked-media'.
- **Lazy-S3-after-claim regression (medium)**: S3 resolves before the
  deleting claim for uploaded docs again — a no-S3 deployment fails
  atomically instead of half-deleting a mixed cascade and stranding docs in
  a 'deleting' retry loop.
- **Mid-mint removal orphan (low)**: a successful mint whose tile was removed
  in flight now fires a compensating delete instead of waiting out the TTL.
- **Seed cap bypass (low)**: legacy image seeds are capped to the remaining
  attachment slots so a >25-media legacy post can't 400-loop on save.

Accepted (documented, owner can revisit):
- Linked mints intentionally skip the beta upload-approval gate and byte
  moderation — exact parity with the legacy crystal.images flow they replace
  (the server never has the bytes to scan; external images were always
  unmoderated). Flag to owner: adding `requireUploadPermission: true` to the
  link route is a one-line change if desired.
- Pre-hygiene legacy URLs (stored before the strict URL sanitizer) that fail
  today's canonicalizer are dropped on edit-save — identical to the old
  composer, whose client-side filter silently dropped them on any edit-save
  as well.

## Round 3 — visual Rows, unified edit media, and searchable attachments

- Auto and Rows now have labelled final-view previews; Rows replaces the text
  pattern with visual row cards, add/remove controls, and bounded image-count
  steppers. Grid preview tiles expose the clickable 1×1 span badge alongside
  the existing drag-resize handle.
- Edit mode now embeds existing attachments inside the one Media & files panel.
  New and bound attachments share reorder/annotation controls and explicit
  trash buttons; bound deletion is fenced by the exact post target and rolls
  the optimistic tile back on failure.
- Attachment schema v2 adds `filenamePreview`, title, and description search
  fields. The display override is used across composer/gallery/card/lightbox
  surfaces without changing the immutable original download filename.
- Attachments remain protected from generic mutation but are intentionally
  included in generic/Commander search as level-one Things. Inherited Reaction
  results are admitted to the ACL superset, checked through their parent, and
  projected back to the matching post card. Human emoji-name filters such as
  `heart` expand to the stored native tokens.
- Focused attachment/schema/Thing/Commander suites and live local API probes
  cover exact-target deletion, metadata canonicalization, Attachment filename
  search, and Reaction `heart` → ❤️ parent-post results.
