# PR #232 — Add media galleries and managed profile attachments

- **Branch:** `codex/media-gallery-profile-attachments` →
  `codex/s3-post-attachments`
- **PR:** https://github.com/lopugit/thingtime/pull/232
- **Depends on:** [PR #201](https://github.com/lopugit/thingtime/pull/201)

## Scope

This stacked PR turns post photos and profile images into one coherent media
experience while retaining public image URLs as the quota-free fallback. It
extends PR #201's private, checksummed S3 attachment primitive to one managed
avatar and one managed banner per user. Comments, Messenger messages, and
threads remain intentionally outside this attachment scope.

## User experience

- Post Photos use responsive preview tiles instead of a column of raw URL
  fields. The URL panel accepts one or many newline-separated URLs, preserves
  stable order, skips duplicates, leaves invalid rows editable, and caps the
  post at eight linked images.
- A real `🏞️ Add Media` thumbnail opens the existing private image, video, and
  arbitrary-file picker. Upload progress, retry, remove, attachment-only posts,
  and storage availability continue to use PR #201's lifecycle.
- Linked images are validated as credential-free absolute http(s) URLs, render
  with `referrerPolicy=no-referrer`, and never consume Thingtime storage quota.
- Edit Profile and Settings → Profile share the same avatar/banner media field.
  Each slot can select a private raster image or a separate public URL; Save
  remains disabled while a managed image is incomplete or a URL is invalid.
- Desktop and narrow mobile layouts retain 44 px controls, full scrolling, and
  no horizontal overflow. Invalid URL state is wired to assistive technology.

## Managed profile-media contract

Profile uploads reuse the attachment envelope while adding protected,
server-owned `attachmentPurpose: 'profile'` and exact `avatar`/`banner` slot
metadata. The public attachment crystal remains canonical metadata only.

Binding requires a ready, unexpired, owner-matched, server-detected safe raster
image for the requested slot. The user root reference and attachment target bind
share the same home-Mongo transaction. The managed attachment id stays separate
from the external URL fallback, so a stable content path can never be persisted
as caller-authored profile URL data.

Replacing or removing a managed image marks the old attachment for exact-version
cleanup. Its bytes remain charged until S3 deletion succeeds and the protected
attachment row is removed; a profile update cannot refund bytes early. Binding
is idempotent for the exact owner/slot and fails closed for cross-account,
wrong-slot, expired, duplicate-slot, or racing updates.

## Read and authorization boundaries

- Public profile media resolves through the stable same-origin attachment
  content endpoint, never through a persisted presigned URL.
- Content authorization rechecks the home-pinned user owner and the exact
  current avatar/banner attachment reference. A public user alone cannot make
  an arbitrary attachment public.
- Custom Mongo collisions cannot authorize home-bucket profile objects.
- User, feed-author, social, notification, account-roster, OAuth, app-data, and
  sandbox projections all derive the same effective managed-or-linked URL.
- Legacy user-to-Thing migration preserves nonempty managed references; generic
  Thing writes cannot forge the protected purpose, slot, or user-root fields.

## Reported upload failure

The reported 31.6 MiB JPEG failed during upload preparation because it was tried
on an ordinary Vercel Preview, which deliberately has no private develop-bucket
configuration. It was not rejected for its size. Ordinary previews now return a
fixed client-authored unavailable message and direct image users to the linked
URL fallback without exposing proxy, Vercel, AWS, role, or bucket details.

During local QA, Vite forwarded browser mutations to Nitro on a different
internal port. Comparing `Origin` directly with that internal request URL made
valid attachment and profile writes fail with 403. Mutation checks now compare
against the proxy-owned public host/protocol while still rejecting mismatched
origins and explicit `Sec-Fetch-Site: cross-site` requests, including spoofed
forwarded headers.

## Verification

- Full Remix unit suite passed after the final proxy and accessibility fixes.
- Attachment/profile/media suite: **96 passed, 0 failed**.
- Schema suite: **51 passed, 0 failed**; storage suite: **7 passed, 0 failed**;
  migration suite: **19 passed, 0 failed**.
- Typecheck ratchet passed at **141** diagnostics against the inherited **143**
  baseline.
- Targeted ESLint passed with zero findings for the final changed media,
  profile, proxy, and regression-test files.
- Graphify semantic extraction, clustering, report generation, merge-driver
  checks, and high-limit HTML export completed successfully.

## Browser verification

The worktree ran against an isolated local replica-set database with all private
S3 variables explicitly empty, so no production or develop object/data was
touched.

Desktop 1440 × 1000 and mobile 390 × 844 checks covered multi-line linked URLs,
deduplication, editable invalid rows, no-referrer previews, the Add Media tile,
private-file local previews, authored unavailable-state recovery, avatar/banner
selection, invalid URL accessibility, a successful public avatar URL save,
modal and full-page top-to-bottom scrolling, minimum touch sizes, and horizontal
overflow. The final browser log contained no new application error.

## Remaining live verification

The local run deliberately did not perform a real S3 request. After this stack
is deployed to the configured `develop` Custom Environment, run the permanent
`TESTING.md` smoke: upload a tiny managed avatar and banner, reload all listed
projections, replace/remove each slot, verify the exact S3 versions disappear,
and confirm the account storage meter returns to its prior value. Repeat one
post containing linked photos plus uploaded media. Production remains untouched.
