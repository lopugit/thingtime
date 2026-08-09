# PR #201 — Add private S3 post attachments with tier accounting

- **Branch:** `codex/s3-post-attachments` → `develop`
- **PR:** https://github.com/lopugit/thingtime/pull/201

## Scope

This PR gives top-level posts a private attachment primitive for images,
videos, audio, and arbitrary files. It intentionally does not enable the same
primitive for comments, Messenger messages, or threads. Existing URL-based
photo fields remain compatible, while uploaded files use stable attachment
Things and same-origin content URLs rather than persisted presigned S3 URLs.

## User experience

- The post composer accepts up to 25 files with immediate local previews,
  per-file progress, retry, cancel, and remove controls.
- Posting stays disabled until every selected file is ready. Failed files must
  be retried or removed instead of being silently omitted.
- Safe server-detected raster images and MP4/WebM video render inline. Audio
  and generic files use download cards; active or ambiguous content is always
  forced to download.
- Attachment-only text posts and visual-only photo posts are valid. The full
  comment composer remains attachment-free in this scope.
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
- Content-Disposition filenames are normalized and RFC 5987 encoded; HTML,
  SVG, XML, JavaScript, and unknown formats are never rendered inline.

## Deployment contract

The application uses the Vercel OIDC AWS provider and a dedicated production
role instead of long-lived AWS access keys. The role is scoped to the private
object prefix and version-aware actions. It deliberately omits generic
`s3:DeleteObject`, making accidental delete-marker-only regressions fail at
IAM. Server-only production configuration uses:

- `THINGTIME_PRIVATE_S3_ROLE_ARN`
- `THINGTIME_PRIVATE_S3_BUCKET`
- `THINGTIME_PRIVATE_S3_REGION`
- `CRON_SECRET`

The setup runbook in `README.md` covers account- and bucket-level Block Public
Access, Bucket Owner Enforced ownership, versioning, SSE-S3, TLS-only bucket
policy, restricted CORS, noncurrent-version cleanup, incomplete multipart
cleanup, the exact OIDC subject, and least-privilege role policy.

## Verification

- Full repository unit suite passed.
- Attachment suite: **63 passed, 0 failed**.
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

## Remaining live verification

The production upload path remains deliberately unverified until a deployment
of this branch can receive the production-scoped OIDC environment. Local
Chrome file selection was also blocked because the ChatGPT Chrome extension
did not have file-URL access. No post or S3 object was created during that
blocked test. A production smoke test should upload, render, download, delete,
and confirm the storage meter returns to its prior value after deployment.
