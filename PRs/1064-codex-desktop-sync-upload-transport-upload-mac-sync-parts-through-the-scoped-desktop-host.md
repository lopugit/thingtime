# PR 1064 — Upload Mac sync parts through the scoped desktop host

Installed acceptance of PR 1063 established that indexing continued, while nonempty uploads failed S3 UploadPart CORS preflight for the bundled UI's dynamic loopback origin. The destination remained empty. This change reuses the mobile upload-part request/receipt contract through a versioned Mac host adapter, without changing browser security or bucket CORS/access.

## Transport and safety

Electron advertises fileUploadVersion 1.0.0 only with compatible native binary range reads. The existing owner/device/origin-bound ordinary lane reads one pinned native part (32 MiB maximum), computes SHA-256, negotiates api.attachment-upload-parts >=1.1.0 and obtains its checksum-locked URL through the existing authenticated API fallback. No renderer-selected URL or credentials cross the upload boundary. The host rechecks source and authority, sends an exact credential-free PUT without redirects/referrer, checks source again and returns the existing bound digest receipt. Shared fingerprint validation, server-issued-part checksum/ETag checks, finalization and immutable sync receipts remain unchanged. Empty files retain their zero-part path.

Transient Node network/deadline and HTTP 408/429/5xx failures use one fixed recoverable marker. The renderer recognizes only exact raw/IPC-wrapped marker text and retains automatic saved-job admission. Authority, TLS, redirect, explicit origin mismatch, source and checksum failures remain terminal. Arbitrary error descriptions and signed URLs are not emitted by new transport diagnostics.

## Verification — 2026-10-20

- 40 Electron folder-sync/upload tests passed, including real nonempty bytes delivered to a dynamic loopback receiver with no CORS allowance, using an S3-shaped UploadPart request and no Origin/cookies.
- Final shared suite passed 489 tests (488 TypeScript plus one mocked-module test), with zero failures or cancellations.
- The Mac adapter regression fails with the former platform guard (uploadPart undefined) and passes with negotiated Mac support.
- The real automatic coordinator/task/runtime/job journal regression preserves the same runnable job/operation after transient failure, resumes on the next discovery pass and publishes once. Auth/TLS/source failures become attention and are not automatically retried. Only the planner/byte pipeline is mocked in that regression; host byte/auth/path safety is covered separately.
- An actual aborted response-stream regression distinguishes the composed deadline's TimeoutError reason from the surfaced AbortError; explicit outer cancellation retains its identity.
- Graph hooks and union merge driver verified; incremental code graph checkpoint retains portable outputs. Changed Markdown semantic freshness remains unverified; no broad semantic rebuild was launched.

## Remaining acceptance

Canonical signed build results are recorded in the PR. Installation waits for the parent task's guarded main merge. The existing saved backup, priorities, exclusions, captures and receipts remain intact. A real nonempty automatic upload during indexing plus independent cloud download/byte/hash match is still required; fixture tests do not establish that live result. No manual upload substitutes for acceptance.
