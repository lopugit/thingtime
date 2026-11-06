# PR 1065 — Preserve the trusted desktop Origin when signing sync upload parts

Installed PR1064 at source 31a229e8e resumed the existing automatic home backup,
then reached attention at 176,768 indexed observations with 1 folder and 0 file bytes
confirmed. The generic renderer error did not identify its failing host fence.
No Retry/Stop/Start, account change, cursor reset or local file deletion was used.

The host signer omitted Origin on its authenticated POST. The desktop Nitro
expected-actor mutation dispatcher requires Origin to equal the loopback
request origin before proxying. This change supplies only the origin captured
from the trusted main frame; renderer/body origin values cannot override it.
The server guard, authority/source validation and credential-free S3 PUT remain.

Signer diagnostics contain timestamp, fixed phase/category and HTTP status
only. The private log is bounded to 128 KiB plus one rotated file. Request and
response bodies, errors, identities, source paths and signed URLs are excluded.

## Verification — 2026-10-20

- 43 focused Electron upload/sync/diagnostic tests pass, including redaction,
private permissions and rotation. See /tmp/thingtime-signer-origin-tests.log.
- A real Node HTTP transport with the production signer helper and copied
dispatcher guard rejects missing/wrong Origin and accepts the trusted origin.
The regression fails without the header; /tmp/thingtime-signer-origin-guard-before.log.
- The real Electron session.fetch fixture remains unverified: Chromium sandbox
initialization fails beneath the required OS loopback-only boundary. No security
flag or permissive fallback was used; /tmp/thingtime-signer-origin-before.log.
- Incremental structural graph refreshed; changed Markdown semantic freshness is
unverified. No broad semantic rebuild was launched.

## Acceptance still required

The source contract mismatch is established, but only the signed installed app
can establish whether this resolves the actual live failure. Preserve the saved
job, settings and receipts; verify nonempty automatic upload, independent cloud
download with matching source hash, then continued streaming progress. Build,
CI and installed evidence will be reported in the PR and parent task.
