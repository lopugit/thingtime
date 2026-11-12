# Canonical SQLite vault persistence — 12 November 2026

The same user secure-payload mutation and vault cryptography now use explicit
native secure-CAS snapshots and session-envelope persistence. Hosted Mongo query
and update shapes remain unchanged. Exact inputs/commands are in verification.json.

The focused wrapper verifies eight actual SQLite/crypto/JWT cases in a sanitized
child process plus a controlled Mongo contract fixture. Six existing hosted-vault
regressions pass. Scope/provider/owner/liveness checks, real password binding and
reset, reopen, revocation, typed legacy versions and concurrent email-flag writes
are exercised. A regression exposed BSON Binary aliasing; the private comparison
preimage now owns an independent byte copy.

The aggregate 83-test result belongs to the source at the worker checkpoint;
other account adapters continued changing afterward. Final combined verification
must be read separately. No full HTTP signup, entitlement projection, protected
persistent profile-key provisioning, installed/native UI or production delivery
is implied. Tests use fresh random process-only credentials, not a real account.

Exact-provider binding was subsequently strengthened; see ../provider-scope/verification.json and the final combined build. Original source hashes above remain historical.
