# PR 1425: Thing sizes and preserved LiDAR originals

Thing detail pages now show verified attachment bytes separately from canonical
JSON size. Details exposes exact byte counts and SHA-256. An owner refresh saves
one protected Metadata Thing reference; subsequent rebuilds retain its identity.
Source authorization, moderation, hidden links and current attachment versions
are checked independently. The panel consists of editable Builder blocks.

LiDAR recovery previously truncated the original at the first unreadable TAR
header and could publish an empty capture. It now validates the archive, retains
the original, seals a separate APFS recovery clone and refuses zero-frame saves.
First upload fingerprinting validates a sealed archive. Exact Retry cannot
return another scan's receipt, and pending status selects the newest usable scan.
Discard also removes abandoned recovery staging copies while retaining its
durable no-upload marker.

Verification completed before publication:

- Real API handlers with a disposable Mongo replica, synthetic accounts and
  checksum-verified attachment storage: stable/concurrent reference rebuilds,
  canonical ordering, changed arrays, unknown sizes, deletion and ACL revocation.
- Actual Thing pages in isolated desktop/mobile Chromium: sizes, metadata
  permalink, Details, unknown bytes, nested Builder edits and save/reload,
  transient failure/retry and horizontal overflow checks.
- 372 existing Things tests, focused metadata tests, capability coverage,
  TypeScript, targeted lint and canonical Vercel build/output verification.
  Compiled handlers expose the origin-scoped capability and executable routes.
- Native multi-gigabyte sparse and Core Video archive fixtures; final app/test
  compilation. Local simulator execution stalled before XCTest could run.

Read-only device inspection distinguished a large retained partial scan from
the small, older zero-frame File the retry UI had selected. Normal navigation
in the old build then triggered its destructive recovery on another unfinished
attempt; the large target remained unchanged. New build installation, cloud
transfer and fresh physical capture are separate acceptance gates.

The large legacy TESTING/changelog semantic Graphify pass was stopped after
13 of 115 chunks due to slow extraction. Structural coverage and portable
outputs were refreshed. See [metadata contract](../docs/thing-metadata.md) and
[native archive lifecycle](../docs/native-lidar-scans.md).
