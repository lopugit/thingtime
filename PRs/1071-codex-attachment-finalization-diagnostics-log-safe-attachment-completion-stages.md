# Log safe attachment completion stages

The production completion logger identified only `Unknown`, so repeated upload-start recovery could not distinguish storage, verification and persistence failures. This change adds server-only fixed stage diagnostics to the existing `[attachments] complete failed` log. It does not change HTTP responses, retry eligibility, authorization, finalization lease timing, multipart operations or object-version fencing.

Logs contain only fixed stage/thrown-kind values, closed error class/code names and bounded upstream HTTP status, attempt count and client/server fault fields. Own-data-property reads avoid getters and coercion; proxy reflection and log-sink failures are guarded. Messages, stacks, paths, owner/upload/object/version IDs and provider request IDs are excluded. Unknown values remain unknown rather than being sanitized into arbitrary log text.

## Validation

- Before the change, the focused regression failed because the completion log had no diagnostic payload. After the change, all72 attachment-service/diagnostic tests pass.
- Twelve representative AWS-like Error/plain-object stage scenarios preserve the exact503 service result. Hostile-object and no-secret assertions pass.
- Focused ESLint and `git diff --check` pass. Existing request/lease/version reconciliation regressions remain covered by the service suite.
- Graph refresh is structural/AST only; Markdown semantic freshness is unverified. No Mac app build or installation is needed for this server-only diagnostic.

## Acceptance still open

Deploy the server through the normal reviewed path and inspect one natural installed-client retry through the already authorized runtime-log surface. The actual live503 cause and continued backup progress are not established by these synthetic tests. No lease-policy change or generic409 retry is included.
