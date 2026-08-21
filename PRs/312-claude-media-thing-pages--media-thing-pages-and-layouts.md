# PR #312 — Media Thing pages and gallery layouts

## Included platform work

- owner-bounded attachment title/description annotation with transactional
  storage-delta accounting;
- post-shaped media Thing projection at `/media/:id`, using the existing
  relational reaction/comment/view runtime and inherited ACL chain;
- masonry, rows, and grid presentation over the existing ordered attachment
  children, including the lightbox and bounded span/canvas editor;
- owner annotation controls in create/edit/media-page surfaces.

## Integration reconciliation (2026-08-21)

- preserve `detectedContentType` when annotation rewrites an attachment
  crystal, so #319 inline/container detection and #321 legacy backfill remain
  stable;
- store Auto layout by omitting the optional `mediaLayout` field;
- route media-card timestamp/copy/share permalinks to `/media/:id` and suppress
  internal repost/quote until attachment-target shares have a real projection.
- reject coercible booleans/strings and unsafe map keys in bounded gallery
  layouts, and keep annotation requests to the exact `id`/`title`/`description`
  shape used by the other attachment mutations;
- label a media card's audience as inherited instead of falling back from the
  raw `tt:inherit` marker to the misleading Public badge.

## Validation gates

- attachment-core, schema, Things/API, and full build/unit suites;
- desktop and 375/390px browser checks for masonry/rows/grid, lightbox,
  annotation, media page, comments/reactions, and overflow;
- live accounting proof for annotation growth/shrink and delete refund;
- blocked/private moderation and inherited-ACL checks after #308 is present.
