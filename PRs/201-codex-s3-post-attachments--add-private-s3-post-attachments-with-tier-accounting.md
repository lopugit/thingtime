# PR #201 — Add private S3 post/profile attachments with tier accounting

- **Branch:** `codex/s3-post-attachments` → `develop`
- **PR:** https://github.com/lopugit/thingtime/pull/201

## Scope

This PR gives top-level posts a private attachment primitive for images,
videos, audio, and arbitrary files, and uses the same protected primitive for
profile avatar/banner images. It intentionally does not enable the same
primitive for comments, Messenger messages, or threads. Existing URL-based
photo and profile fields remain compatible, while uploaded files use stable
attachment Things and same-origin content URLs rather than persisted presigned
S3 URLs.

## User experience

- The post composer accepts up to 25 files with immediate local previews,
  per-file progress, retry, cancel, and remove controls.
- Photos use responsive linked-image preview tiles with a newline-friendly URL
  adder, stable ordering, deduplication, parsed credential-free http(s)
  validation, and no-referrer previews. A real `🏞️ Add Media` thumbnail tile
  opens private uploads; linked images remain the quota-saving alternative.
- Posting stays disabled until every selected file is ready. Failed files must
  be retried or removed instead of being silently omitted.
- Safe server-detected raster images and MP4/WebM video render inline. Audio
  and generic files use download cards; active or ambiguous content is always
  forced to download.
- Attachment-only text posts and visual-only photo posts are valid. The full
  comment composer remains attachment-free in this scope.
- Profile and Settings editors expose the same Add Media interaction for one
  avatar and one banner, accept safe raster images up to 64 MiB, and retain a
  separate public URL choice. Save blocks until selected uploads are ready.
- Account storage availability refreshes after upload, cancellation, removal,
  post creation, and post deletion. Deferred multipart settlement is surfaced
  with fixed client-authored Lopu copy rather than raw AWS/server errors.

## Storage and accounting model

Attachments are protected relational Things linked to their post with
`targetId`. Their public crystal contains only canonical `name`, `size`,
`contentType`, and `mediaKind` metadata. The private root envelope carries the
object key, lifecycle state, exact object byte count, upload/version identity,
expiry data, and concurrency fences.

The ordinary account storage ledger charges both the attachment Thing's JSON
bytes and its exact S3 object bytes. Reservation and attachment insertion share
one home-plane Mongo transaction. A post insert and ready-attachment binding
also share one transaction. Deletion permanently removes the exact S3
`VersionId` before the attachment row is removed and its quota refunded.
Malformed or incomplete attachment envelopes fail closed and remain billable
instead of permitting an accounting bypass.

## Multipart and race safety

- Uploads go directly from the browser to S3 through short-lived multipart
  URLs. Every part URL signs the server-derived exact `Content-Length` and the
  browser-supplied SHA-256 checksum.
- Owner-scoped stable request IDs make an ambiguous upload start idempotent
  without exposing or allowing cross-account request-ID collisions.
- S3 list/head results, not client claims, determine completed parts and final
  object size. File magic is detected server-side before publication.
- A durable, renewable finalization lease fences duplicate and stale complete
  requests across each Mongo/S3 boundary. A caller that loses its lease cannot
  publish, revert, or delete the newer holder's object version.
- Post creation uses a stable share ID plus an immutable canonical snapshot so
  an unknown response can be reconciled only against the exact committed post.

## Cleanup and deletion

Unbound drafts expire and are handled by an authenticated hourly cleanup job.
The job is expiry-first, bounded by row count, concurrency, and wall-clock
budget, and pushes failed tombstones out of the oldest-first window so one bad
object cannot starve newer work.

An MPU for which no part URL escaped can be aborted, verified empty, and
refunded promptly. Once part URLs have been issued, the allocation remains
billed through an eight-day lifecycle-backed settlement window. Cleanup then
requires repeated empty Abort/ListParts observations separated in time before
HEAD/exact-version deletion and refund. Post cascades claim only the exact
owner/target relation, delete each exact version first, and leave durable
retryable tombstones on remote failure. Generic cascade paths refuse protected
attachment children unless the S3 preparation hook is present.

## Authorization boundaries

- Attachment content is resolved through an authenticated, private,
  same-origin endpoint that performs a narrow home-pinned target ACL check.
- Service credentials are treated as anonymous for content reads.
- Custom Mongo request overrides fail closed, preventing a custom-plane Thing
  from authorizing a home-bucket object with a colliding ID.
- Public projections expose canonical metadata and stable attachment IDs only;
  S3 keys, upload IDs, object versions, and signed URLs remain server-only.
- Profile uploads carry a protected server purpose and exact avatar/banner slot.
  Binding and the user-root reference update share one home-Mongo transaction;
  public content authorization rechecks the exact owner, current user slot, and
  attachment id. A public user record alone cannot authorize an arbitrary file.
- Current-user projections keep the managed attachment id and external linked
  fallback distinct while ordinary avatarUrl/bannerUrl consumers receive only
  the effective stable display URL. The managed content path is never persisted
  as caller-authored profile URL data.
- Content-Disposition filenames are normalized and RFC 5987 encoded; HTML,
  SVG, XML, JavaScript, and unknown formats are never rendered inline.

## Deployment contract

The application uses the Vercel OIDC AWS provider and dedicated per-environment
roles instead of long-lived AWS access keys. Each role is scoped to its own
private object prefix and version-aware actions. They deliberately omit generic
`s3:DeleteObject`, making accidental delete-marker-only regressions fail at
IAM. Server-only configuration uses:

- `THINGTIME_PRIVATE_S3_ROLE_ARN`
- `THINGTIME_PRIVATE_S3_BUCKET`
- `THINGTIME_PRIVATE_S3_REGION`
- `CRON_SECRET`

The setup runbook in `README.md` covers account- and bucket-level Block Public
Access, Bucket Owner Enforced ownership, versioning, SSE-S3, TLS-only bucket
policy, restricted CORS, noncurrent-version cleanup, incomplete multipart
cleanup, the exact OIDC subject, and least-privilege role policy.

## Develop attachment environment (2026-08-09)

- `dev.thingtime.com` is verified and attached to a Vercel Custom Environment
  named `develop` with an exact `develop` branch matcher. It remains a familiar
  pre-production deployment without sharing generic Preview identity.
- The develop role trusts only
  `owner:lopugits-projects:project:thingtime:environment:develop`. Ordinary PR
  deployments remain `environment:preview`, and local CLI tokens are
  `environment:development`; neither identity can assume the role.
- The three private S3 values and a distinct cleanup secret are Sensitive and
  scoped only to the `develop` Custom Environment. Production bucket values and
  objects were not changed; the production role received the same required
  `s3:PutObjectTagging` correction described below.
- The dedicated bucket was verified with account- and bucket-level Block Public
  Access, Bucket Owner Enforced ownership, versioning, SSE-S3, HTTP/TLS < 1.2
  denies, `objects/` lifecycle cleanup, and CORS restricted to
  `https://dev.thingtime.com` checksum-locked PUTs.
- The role policy is limited to the documented object-prefix multipart,
  version-aware read/tag, and exact-version delete actions. It has no generic
  DeleteObject, bucket listing, ACL, public-read, or administration grant.
- AWS's operation mapping requires `s3:PutObjectTagging` when
  CreateMultipartUpload supplies Thingtime's pending tag; that distinct action
  is included alongside exact-version `s3:PutObjectVersionTagging`.
- Vercel Cron schedules only Production deployments. Develop therefore uses a
  one-purpose AWS EventBridge API Destination at minute 17 each hour, with a
  distinct encrypted connection secret and an invocation role limited to that
  destination.

## Verification

- Full repository unit suite passed.
- Attachment/profile-media focused suites are rerun after every profile binding
  or gallery change; final counts are recorded in the publishing handoff.
- Storage/schema focused suites passed.
- Production client + Nitro server build passed, including the generated
  Vercel output verifier.
- Attachment-owned TypeScript diagnostics are clean.
- Attachment-owned ESLint has 0 errors and 0 warnings through a non-mutating
  resolver compatibility shim. The canonical lint command is still blocked
  before linting by the repository's existing `eslint-scope/lib/definition`
  package-export mismatch.
- Chrome desktop and 390px mobile checks covered the post composer, comment
  scoping, opened dynamic composer state, long-feed scrolling, and horizontal
  overflow. Layout remained aligned at both sizes.
- Independent adversarial reviews found no remaining P0/P1 security,
  accounting, cross-account, deletion/refund, or lifecycle race issue.

## Develop conflict refresh (2026-08-09)

Merged current `develop` at `454d6ce4` while retaining both feature sets: S3
attachments and the newly landed social graph, notification email, and post-view
work. The source conflicts were additive (attachment metadata alongside view
stats, both Vercel crons, both README runbooks, and attachment rendering beside
the expanded engagement UI).

The merge audit also closed cross-feature boundaries that became visible only
when the two branches met:

- follow identity now uses one canonical, home-pinned `crystal.followKey`
  writer for Messenger, profiles, notifications, and ACL reads;
- custom Mongo content cannot trigger home bell/email side effects or read/write
  home post-view telemetry through a colliding public ID;
- protected follow, friend, and notification Things are explicit non-billable
  platform plumbing, so strict storage reconciliation cannot mistake unstamped
  server state for user content;
- duplicate follow API documentation, schema projection, and rate-limit entries
  were consolidated, retaining the intended 30 requests/minute policy; and
- the hourly attachment cleanup and weekly notification digest schedules coexist
  in `remix/vercel.json`.

Post-merge verification passed the complete unit suite, attachment **63/63**,
schema **40/40**, storage **7/7**, the custom-plane regression, the production
Vercel build/output verifier, and merge-owned ESLint with 0 errors or warnings.
The TypeScript ratchet improved to 140 errors against the inherited 143-error
ceiling.

## Remaining live verification

The Vercel Custom Environment, exact develop branch matcher/domain, Sensitive
variable scoping, distinct OIDC subject, bucket controls, IAM policies, and AWS
EventBridge cleanup resources were verified live. A non-develop Vercel OIDC
identity was denied by the develop role.

The positive develop upload/delete smoke and the first successful EventBridge
cleanup invocation remain unverified because the live `develop` deployment does
not yet contain this PR's attachment routes; the stable cleanup URL therefore
returns 404 until this PR's code is deployed to `develop`. The EventBridge rule
is enabled and correctly targeted, but a successful invocation cannot be
claimed before that deployment. Afterward, repeat the `TESTING.md` develop flow:
upload a tiny attachment, render or download it, delete it, confirm the exact S3
version disappears, confirm the storage meter returns to its prior value, and
check that EventBridge records a successful cleanup invocation.

The production upload path remains deliberately unverified. The production
bucket configuration, Production-scoped Vercel S3 variables, and existing
objects were unchanged, and no production object was created or deleted. The
only production-side change was adding the required `s3:PutObjectTagging`
permission to the existing attachment role. An earlier local Chrome
file-selection attempt was also blocked because the ChatGPT Chrome extension
did not have file-URL access; it created no post or S3 object.

## Gallery and profile-media extension (2026-08-09)

The 31.6 MiB JPEG failure reported from the PR alias was traced to the upload
start request returning 503 before quota reservation or S3 MPU creation. That
alias is an ordinary `environment:preview` deployment and deliberately receives
no develop bucket variables; the image was within the normal multipart limit.
The client now explains this fixed deployment boundary and points image users to
the public-URL fallback without echoing provider text. The positive S3 path must
be tested on `dev.thingtime.com` after this PR is deployed to the exact
`environment:develop` Custom Environment.

The extension also replaces raw post URL rows with responsive gallery tiles and
adds owner/slot-bound profile attachments. Replacing profile media releases the
old attachment reference in the same transaction as the new user reference,
but never refunds first: the old protected row remains billable until the
existing exact-VersionId cleanup deletes S3 and removes the row. Both profile
edit surfaces share the same upload lifecycle, abandoned-draft cleanup, fixed
client-authored errors, and external URL fallback.
