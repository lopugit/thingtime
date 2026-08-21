# PR #321 — Legacy attachment detected-type backfill

## Included platform work

- admin-only, same-origin, bounded and cursor-paginated detection passes;
- dry-run reporting and idempotent real passes over ready opaque attachments;
- exact-version S3 prefix reads through the upload detector used at completion;
- transactional crystal-size accounting with object/name/size/version fences;
- inline upgrades for browser-playable containers and safe labels for opaque
  known containers.

## Integration reconciliation (2026-08-21)

- preserve #312 owner-authored attachment title/description while updating
  only the #319/#321 detection fields;
- fail closed on malformed annotation metadata instead of silently erasing it.

## Release gates

- dry-run counts reviewed before writes;
- bounded real passes follow `nextCursor` until `hasMore` is false;
- old videos render inline and opaque formats keep safe download behavior;
- annotations, names, object sizes, versions, ACLs, and storage totals remain
  unchanged except for the exact JSON metadata-byte delta;
- a final repeat pass performs no type upgrades.
