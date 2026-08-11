# PR #237 — Add media attachments across conversations

Branch: `codex/conversation-media-attachments`

Base: `codex/media-gallery-profile-attachments` (PR #232)

## Context

Private, quota-accounted S3 uploads originally shipped for posts and were then
extended to avatar/banner editing. Comments still exposed the post composer
without its media picker, Messenger messages and thread replies were text-only,
and custom reaction emoji embedded new image payloads in Mongo. That split made
the product feel inconsistent and bypassed the attachment lifecycle for a
high-growth class of user media.

## Resolution

- Reuse the post media gallery, progress, retry, remove, and safe-download UI
  for comments, direct/group messages, message requests, community channels,
  inline replies, and Slack-style threads.
- Support attachment-only comments/messages while retaining linked image URLs
  on post/comment composers as the zero-quota fallback.
- Add closed server-owned attachment purposes for `comment`, `message`, and
  `emoji`, with exact owner/purpose/target projection fences.
- Bind attachments inside the same home-Mongo transaction that creates the
  comment, message, or custom emoji. Stable owner-scoped request IDs and exact
  immutable snapshots reconcile ambiguous responses without duplicating
  content or abandoning billed drafts.
- Render images and videos inline through the authorized same-origin content
  route; keep audio and generic files as explicit safe downloads.
- Move new personal/community custom emoji GIF/JPEG/PNG/WebP uploads onto S3
  with a 512 KiB cap. Existing binary/data-URI emoji remain read-compatible,
  but the API no longer accepts new base64 image payloads.

## Authorization and lifecycle

- Comment attachment access walks the bounded, cycle-safe reply chain to its
  exact root Thing and applies that root ACL. The first comment owner must also
  match the attachment owner.
- Message attachment access requires the exact live target message plus an
  active or pending membership in that exact chat.
- Personal emoji media is available only to authenticated viewers; community
  emoji additionally requires membership in that exact community.
- Active custom-Mongo planes cannot authorize home S3 objects.
- Message, emoji, and nested comment deletion permanently remove the exact S3
  object version before deleting/refunding the attachment Thing. Post cascades
  repeatedly discover nested comment/reply attachments and prepare their S3
  cleanup before the generic Mongo cascade can proceed.
- Uploaded object bytes remain ordinary account-tier usage. Messenger control
  Things remain explicitly non-billable so the same bytes cannot be counted
  twice.

## Product behavior

- Conversation previews, notifications, request rows, quoted replies, and
  thread rows use an attachment-aware fallback when text is empty.
- Optimistic message and reply rows include the local attachment metadata, and
  successful creates mark the exact attachment set committed before composer
  cleanup can run.
- Unknown outcomes retain and retry the same immutable submission. Known
  failures show fixed Thingtime-authored recovery text and never echo provider,
  proxy, or database detail.
- Upload preparation preserves bounded storage failure codes end-to-end. A
  full account tier offers delete-media or upgrade-tier recovery, accounting
  reconciliation asks the user to wait, missing S3 configuration alone uses
  the environment guidance, and temporary storage failures remain retryable.
  The trusted account-allowance snapshot provides a quota fallback if an
  intermediary strips structured metadata.
- Root storage usage refreshes after attachment creation, cancellation,
  deletion, and billable conversation cascades.

## Regression coverage

- purpose-bound comment/message/emoji preflight and idempotent exact-target
  retries;
- comment root authorization, cycles, ownership mismatch, and custom-plane
  collision rejection;
- message membership authorization and exact live-message matching;
- custom emoji owner/scope/name/attachment reconciliation;
- deterministic owner-scoped conversation IDs and exact attachment-set
  equality;
- nested attachment cascade reduction and exact-version deletion/refund;
- attachment-only rich comment validation and protected schema fields;
- safe quota/configuration/accounting failure-code propagation and fixed
  client-authored upload recovery messages;
- unchanged post/profile attachment lifecycle, quota, and multipart security.

## Validation

- `corepack pnpm --dir remix run test:attachments` — 103/103
- `corepack pnpm --dir remix run test:client-errors` — 47/47
- `corepack pnpm --dir remix run test:schemas` — 51/51
- `corepack pnpm --dir remix run test:storage` — 7/7
- `corepack pnpm --dir remix run test:messenger` — 3/3
- `corepack pnpm --dir remix run typecheck:ratchet` — 139 errors, down from the
  checked-in baseline of 143
- canonical changed-file ESLint — zero errors and zero warnings
- `git diff --check`
- Graphify semantic refresh, clustering, report, and portable graph export

## Live UI validation

- The READY Vercel deployment rendered a nonblank Thingtime shell with Nitro
  and Mongo health available and no framework error overlay.
- An authenticated local stack was checked in Chrome on desktop and at
  390×844. The full comment composer rendered the shared S3 media gallery,
  progress-ready Add Media tile, and linked-image URL fallback without
  horizontal overflow or clipping; the feed was inspected from top to footer.
- Messenger's desktop/mobile Spaces and Chats empty states remained aligned
  and overflow-free. This QA account has no chats or communities, so sending a
  message/reply and opening the custom-emoji editor were not mutated merely to
  manufacture test data; those interaction paths are covered by the focused
  component/API suites above rather than claimed as live-clicked.
- Chrome reported zero warning/error entries from the local app origin. Browser
  extension warnings were excluded from the app result.

## Stack and rollout

This is a stacked PR. Merge #201 first, then #232, then #237. Its Vercel preview
uses the standard Preview environment, which intentionally mirrors the develop
runtime and develop S3 bucket while production remains isolated.
