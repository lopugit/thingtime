# Once-over review fixes: download-all archives and the local attachment stand-in

Branch `claude/dx-once-over-fixes` → `develop`.
Requested by the owner on 21 September 2026 ("do another once over to check for
anything you missed or anything you want to improve") after PR #861
(download-all ZIP archives, merged to `main`) and PR #863 (developer-experience
follow-ups, merged to `develop`). Delivered by Claude (AI).

## How the review ran

A structured pass over both deliveries: sixteen independent finder angles
(line-by-line, removed behaviour, cross-file tracing, language pitfalls,
wrapper correctness, authorization and abuse, reuse, simplification,
efficiency, altitude, repository conventions) produced 99 candidates, which
were deduplicated into mechanism clusters and verified against the source
before anything was changed. The verified findings and their outcomes are the
sections below; candidates that turned out to be by design are listed last.

## Download-all archives (`/api/v1/attachments/archive`)

- **Deadline that never fired.** `zipStream.ts` only polled the 280 s deadline
  between chunk reads, so a stalled upstream object read or a consumer that
  stopped pulling held the function, its 4 MiB queue and the upstream
  connection until the platform killed it. The deadline is now also a timer
  that aborts the upstream signal and errors the stream.
- **Planning outside the budget.** The wall clock started at `stream()`, after
  a plan that could itself take tens of seconds. The route now anchors one
  `deadlineAt` at request start and hands it to both `plan()` (checked while
  walking folders and between authorization batches; overrun → 504) and
  `stream()`.
- **Probes paid for a full build.** `manifest=1` and HEAD requests presigned
  every file and shared the 30/min `attachments.archive` window with real
  downloads, so browsing folders on `/things` could starve a real click. Probes
  now authorize through the new `inspectAttachmentDownload` (no presign), draw
  on their own `attachments.archiveManifest` window (120/min), and per-file
  authorization runs eight at a time in stored order.
- **Silently shorter archives.** `listBound` capped bound rows at 2000 per
  folder level and dropped the rest without a `skipped` count or a 413. The
  query reads one row past the bound and the planner answers 413.
- **Budget counted invisible siblings.** The 1000-Thing traversal budget was
  charged before the per-child ACL check, so a folder with many private
  children both leaked their volume through 413 and blocked the archive of the
  few visible ones. Only visible Things take a slot; a separate 10 000-Thing
  scan bound keeps the walk finite.
- **Blocked linked media reached `links.txt`.** The linked-media branch never
  consulted moderation. The attachment projection now carries `moderation`;
  blocked links are withheld for everyone and pending links for everyone but
  their owner — the same rule the post projection applies.
- **The skipped count was an oracle.** The public manifest's `skipped` and two
  different 404 messages revealed that quarantined or private files existed.
  One 404 message for empty and fully-withheld roots; `skipped` is reported
  only to the root's owner or an administrator.
- **`sharedRoot` stopped at the root.** Page-composition media bound to a
  private post was authorized per file through the composition but the root
  lookup never saw `sharedRoot`, so its one-file archive and share link 404ed.
  An attachment root now also resolves through
  `canViewSharedCompositionAttachment`, exactly like the content endpoint.
- **Names lost their extension.** `safeArchiveSegment` cut at 100 characters
  after the extension, so a long upload name extracted as an extension-less
  file; the stem is cut instead. Duplicate detection folds case through upper
  case so dotless ı / long ſ collide with i / s the way NTFS and APFS do.
- **Client.** `download()` maps a capability rejection to the same plain toast
  `shareLink()` uses instead of the checker's internal message; the capability
  manifest is warmed when the controls mount so Safari keeps the tap's user
  activation for the share sheet / clipboard; comment galleries say "comment"
  instead of "post"; the lightbox offers "Download all" whenever the gallery
  has an archive (not only when two files are visual) with matching label and
  tooltip; the ⋯ menu says "Download the file as a ZIP" for one known file;
  the folder pill probe is cached per folder and per listed contents (no
  re-probe when walking back into an unchanged folder, a re-probe when its
  contents change) and waits for the folder listing; only galleries that can
  offer an archive mount `useAttachmentArchive` (and the API client behind
  it), so every other card, comment row and message row no longer pays for it;
  the archive path and requirement constants live once, in the server core.
- Feature `api.attachment-archive` → 1.0.1 (contract and feature version):
  compatible corrections, documented in the endpoint entry.

## Local attachment stand-in (`localAttachmentStorage.ts`)

- **Poisoned signing secret.** A single failed read/create of
  `.signing-secret` was memoised forever; every later signature failed until
  restart. The rejected attempt is dropped and retried.
- **Configuration failure read as an outage.** The Vercel guard threw a plain
  `Error`, which the attachment service reported as retryable
  `storage_unavailable`. It now throws a `PrivateS3ConfigError` subclass
  (non-retryable `storage_unconfigured`) and also fails on
  `VERCEL_TARGET_ENV`.
- **Foreign version ids.** Rows minted by the real bucket made `deleteObject`
  throw (stranding rows in `deleting`) and `signDownload` fail at sign time
  (503 instead of the bucket's presign-then-404). Deleting an unknown version
  is a no-op; presigning never touches storage; the GET answers 404.
- **Ignored abort signals.** `fetchStoredObject` attached the caller's signal
  to a `Request` nobody read, so every server-side timeout (image variants,
  `cache=bytes`, recordings, social cards, cancelled Lopu turns) was inert on
  local reads. An aborted signal now rejects before serving, and a later abort
  destroys the file stream.
- **Listener leak and double copy on completion.** `pipeline(part, sink,
  { end: false })` per part left its listeners on the shared sink
  (`MaxListenersExceededWarning` from six parts up); completion now runs one
  pipeline over all parts, a single-part object is renamed rather than copied,
  and a concurrent second completion surfaces as `NoSuchUpload` (the settled
  path) instead of `ENOENT`.
- **Cancelled uploads as 500s.** A client that aborted a part PUT mid-body
  produced an unhandled error and an error-log record; it is a 400.
- **Relative signed URLs.** Native uploaders (the Watch inbox does
  `URL(string:)` + `URLSession`) and scripts cannot follow root-relative URLs.
  Optional `THINGTIME_LOCAL_ATTACHMENT_STORAGE_ORIGIN` mints absolute URLs;
  `isLocalAttachmentStorageUrl`/`fetchStoredObject` accept both forms; the
  Watch uploader resolves part URLs against the page URL; the recording
  delivery smoke accepts the stand-in path.
- **Cache headers.** The route no longer wraps the adapter in
  `withAttachmentPrivateResponse` (which forced `no-store` onto immutable
  exact versions); the adapter answers with `ETag`, `Last-Modified`,
  `Referrer-Policy` and 304 on `If-None-Match`.
- `~` expands in the directory variable and the resolution rule (relative to
  the dev server's working directory) is documented.
- Feature `api.attachment-local-object` → 1.0.1.

## Scripts, hooks and repository hygiene

- `seed-fixture.mjs`: `--admin-user` flags are validated before the first
  request (no half-created fixture); `cleanup` keeps the state file when a
  delete fails and exits non-zero (404 counts as done); response ids come from
  the one true shape per endpoint and a shape change throws instead of
  becoming a `null` that defeats `resume`; the entry-point guard compares real
  paths so a symlinked checkout runs the script.
- `ensure-dependencies.js`: a directory lock serialises concurrent installers
  (the background `post-checkout` bootstrap and a developer's
  `npm run worktree-setup` were racing into one `node_modules`); stale locks
  are discarded. Test: `test:dependencies`.
- `worktree-bootstrap.cjs`: env files come from the `.env*` entries of
  `.worktreeinclude` (one list, not two); `.claude/launch.json` gets an attach
  entry for the PM2 stack plus a `-foreground` entry (the old single entry
  collided with the PM2 ports); one `git ls-files` instead of one per file;
  unused summary removed. New `worktree-bootstrap.test.cjs`.
- `typecheck-ratchet.mjs` fails (exit 1, `::error` annotation) on TS1117 /
  TS2300 / TS2451 regardless of the baseline — the duplicate
  `serverAssets` key that silently dropped the shell mount was exactly such a
  diagnostic. The current baseline has none.
- `graphify-cas.mjs`: `markSnapshotReadOnly` iterates the canonical
  `SNAPSHOT_FILES` set.
- Docs: TESTING items moved into the "Worktree dependency bootstrap" and
  "Content-addressed Graphify snapshots" sections (they had landed under the
  Things page); the unlisted-children claim corrected (an unlisted child opens
  by exact id and is never enumerated through a folder); the PR #863 note
  renamed to the numbered convention; README, feature maps and API docs updated
  for the origin variable, the manifest rate window and the 504.

## Reviewed and left as is

- Hidden (unlisted) folder children are excluded from a folder archive: by
  design — unlisted Things open by exact id and are never listed through a
  parent, for the ZIP as for `/things`.
- The read-only snapshot guard (0444 + `copyWritable`) stays: turning root
  aliases into plain copies would duplicate ~70 MB per checkout for a defence
  the hooksPath fix already makes rare.
- The local-object route carries no rate key: every request is gated by a
  server-minted HMAC URL with a ten-minute life; the feature map records the
  exception.
- A server-side "dev accounts start with uploads approved" default would
  remove the `ADMIN_USERNAMES` + `resume` dance, but it changes an auth
  policy the owner set deliberately; left for an explicit decision.
- Feature maps restate a handful of rules that bite; they are pointers with
  context, not a second policy source, and each names its canonical home.
- `readObject` without a version still reads every version's JSON; objects
  rarely have more than a few versions locally.

## Validation

- `npm --prefix remix run test:attachments` (9 + 269 pass, including the new
  stand-in, archive, ZIP-deadline and core tests), `test:api-capabilities`
  (43), `test:typecheck-ratchet` (4), `test:dependencies` (7, new lock and
  bootstrap tests), `test:vercel-config` (2), root `npm run test:graphify-cas`
  (23).
- Lint clean on every changed Remix file except a pre-existing parser error
  in `personal-recording-delivery-smoke.mts` (`import { …, type X }` on an
  untouched line) and pre-existing hook-dependency warnings in
  `ThingsPage.tsx` outside the changed block.
- `typecheck`: 89 errors, at baseline; none in changed lines (the
  `Uint8Array` → `BodyInit` error in the storage test helper predates this
  branch).
- Graphify snapshot refreshed with the code-only path; Markdown changes were
  not semantically indexed.
