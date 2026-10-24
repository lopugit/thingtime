# Account file canonical MIME repair

Native Duplicate on package `2f0710ac` exposed a real metadata reconciliation bug: the server's byte detector safely normalized imported `text/plain` to `application/octet-stream`, while the new immutable-content guard compared later account reads against the original local MIME. Upload completed, but annotation and folder movement stopped before sending their requests. The native failure and matching screenshot remain under `../account-file-copy/earlier-attempts/copied-file-placement/`.

`AccountFileMetadata.assertIdentity` now obtains the stored-byte account MIME only from the already verified same-ID completion/retention receipt. The receipt must also match the local name and size and must not contain a URL. The owner, target, local name/size/URL and linked-media checks remain unchanged. A later GET changing MIME, including changing it back to the original local MIME, is refused. The local/request MIME and byte identity remain intact for exact retry and portable export.

`regression-before.log` reproduces the original failure with the server's real MIME presentation helper. After the fix, `focused-tests.log` records 61 passing tests, zero skips, across metadata, retention and account files. The new regression verifies annotation and folder placement after reopen, retention, exact original save retry, bytes and deletion comparison. Negative cases cover owner/target/name/size/URL/MIME substitutions, absent receipts and unrelated receipt IDs. A malformed URL snapshot on nonempty stored bytes remains a retryable invalid-metadata response and sends no mutation; the initial expanded fixture expectation was corrected to that existing classification.

`reviewer-overlap.log` records the independent reviewer's 55 passing linked/bound/retention checks, zero skips. These overlap the 61 tests and must not be added together. Independent source review found no actionable issue. `lint.log` has no rule errors or warnings, only the repository config deprecation notice.

Final native Duplicate acceptance passes on repaired immutable package
`15e93be01ba2478f19fbdd20201bb18d72ab6c87f794e5a7c4800854b4ab85a7`:
one scenario, zero skips, 60.04 seconds. Normal offline Duplicate retained
distinct IDs and exact bytes through cold reload. On reconnect, the copy's
upload, annotation and folder placement finished while the original upload
deliberately failed; the original's normal Retry control then completed its
independent queue. Real server reads checked both folder placements, exact
18,504-byte content and guest refusal. The saved final report confirms local
`text/plain` and receipt `application/octet-stream` remain distinct, while the
canonical annotation and move requests both succeed. Strict offline barriers,
zero offline requests/successful API responses, zero page errors and visually
reviewed 1440/390/320px screenshots also pass. See
`../account-file-copy/README.md` and its final proof, build manifest and hashes.
The earlier `2f0710ac` failures remain classified separately.
