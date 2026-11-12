# Create empty objects without ListBucket

Production diagnostics attributed an upload-start failure to object verification returning upstream403. The empty-file path HEADs a not-yet-created key before its first PUT, while the documented runtime role deliberately has no ListBucket permission. AWS returns403 for missing keys under that policy. This source-proven failure reproduces with the real S3 command adapter; the live request's empty/nonempty branch remains unconfirmed.

Create an unpinned empty object with the existing conditional `If-None-Match: *` PUT first. Existing objects and lost replies reconcile only through verified attachment identity, immutable version, size and full empty checksum. A pinned version remains pinned. No overwrite, permission expansion, 403-as-absence classification or lease-policy change. Integrity conflicts retain409; failed read/write authorization never publishes ready metadata or tags.

Publish compatible PATCH contracts: upload-start1.6.2 and completion1.5.1. Existing installed client requirements remain compatible; no new Mac build is required.

## Verification

- Fresh object-only HEAD403 regression failed before the correction and passes afterward, including accepted reply loss, existing matching object, wrong identity/checksum/version, occupied mismatches and genuine read/write403.
- Existing empty finalization lease-loss and expired-lease replay tests pass; one immutable stored version survives ready-persistence failure.
- Attachment suites:321/321; capability/docs suites:110/110. Focused ESLint and diff checks pass. Incremental structural graph refresh accompanies publication; Markdown semantic freshness remains unverified.

## Acceptance

Server deployment and continued same-job installed upload progress remain required. Preserve the saved Home job, grants, receipts and versions; independently verify downloaded bytes. Captured diagnostic fields identify the verification stage and upstream status, not the specific file.
