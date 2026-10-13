# Multi-account third-party service library

Status: draft implementation checkpoint. Do not treat this as production or positive provider OAuth acceptance.

## Behavior

The Connections page groups services and subservices into titled cards. Every
configured service supports multiple account identities, with an independent
remove control. Reconnecting an identity updates that identity only. Fixed
50/100 connection caps and 200/500 AI-list truncation have been removed.

Google identity, Drive, Gmail, Calendar, Docs, Sheets and Contacts are separate
grants. Facebook basic identity and posts are separate grants. ChatGPT hosted
identity supports an approved OpenAI client and verified ID tokens only.
OpenAI API and Claude Code OAuth credentials reuse the existing Secure Vault.

## Current security boundary

OAuth tokens use owner/record-bound AES-256-GCM with a server vault key.
Callback state is session-bound and single-use; Google uses PKCE and offline
access. Rotating refresh uses a compare-and-set lease. Account/link mutations
and final disconnect commit atomically in the home database. Requests accept
only fixed provider operations, with owner and scope checks and redacted output.

**Requested encryption revision remains open:** the user additionally requested
password and session-based protection. The current server-key implementation
does not meet that requirement. Decide between server-assisted background
access/recovery and session-only unlocking before wiring a stable per-user data
key through password change/reset, passkeys, account switching and session
revocation. Passwords and rotating session JWTs must not directly encrypt each
credential or overwrite the only key capable of decrypting existing values.

`auth/vaultEnvelope.ts` adds the shared cryptographic primitives for that
revision, without changing runtime storage. A random per-user data key uses
owner/record/purpose-bound AES-GCM envelopes. Password wrappers use fixed
scrypt N=32768/r=8/p=3 with a random salt; session wrappers use HKDF-SHA256 and
bind the owner, session ID and expiry. Rewrapping preserves the data key and
saved ciphertext. Callers must independently validate live authentication and
revocation. No key registry, login/reset/passkey integration, migration,
background access or recovery policy is implemented by this helper. This is
not end-to-end encryption or a claim that the server cannot access plaintext.

## Verified locally

- Client and Nitro server builds passed. Changed-file lint passed.
- Connection tests: 128 passed, including 55 independently removable connections, the 605-entry vault-count regression, and 12 password/session envelope tests.
- API capability tests: 94 passed, including both manifests for owner-fenced account writes and the fixed credential-reuse endpoint. Manual credential forms, like OAuth and AI forms, negotiate owner-fence support before transmitting secrets and abandon submission after an account switch.
- Existing real API connections verifier: 103 passed; new account-library API verifier: 21 passed on a disposable local replica set.
- Browser: desktop and 390px layout, two saved AI accounts surviving reload, logout clears private account metadata, sign-in restores the correct library, demo add/feed/disconnect, and independent removal of one synthetic AI credential.
- Typecheck ratchet reports 91 diagnostics against an 89 baseline; no diagnostics in changed feature files. This is a warning, not a clean typecheck.

## Remaining acceptance

- Implement the confirmed password/session encryption and migration design.
- Google client creation and Facebook callback saves are prepared in the user's browser and await action-time confirmation; no provider client secrets have been installed locally yet.
- Complete positive Google and Facebook authorization/refresh/reconnect/decline testing with real provider accounts. Current mocked OAuth tests and public/demo API checks do not establish this.
- Hosted ChatGPT requires an approved partner client. Local subscription-token enrollment is not implemented. Direct browser Claude enrollment is unavailable; the current adapter accepts a Claude Code setup token.
- Review preview behavior and required CI. Production promotion requires separate approval for the exact PR.
