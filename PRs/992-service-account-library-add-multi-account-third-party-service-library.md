# Multi-account third-party service library

Status: draft implementation checkpoint. Google identity and refresh are verified
locally; production delivery and other providers' positive acceptance remain pending.

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

OAuth tokens use owner/record-bound AES-256-GCM with per-user data keys.
Callback state is session-bound and single-use; Google uses PKCE and offline
access. Rotating refresh uses a compare-and-set lease. Account/link mutations
and final disconnect commit atomically in the home database. Requests accept
only fixed provider operations, with owner and scope checks and redacted output.

The approved encryption revision is now integrated: per-user stable random data
keys, scrypt password wrappers, exact-JWT HKDF session wrappers and a server-key
recovery wrapper. Password reset changes the hash and password wrapper in one
secure CAS, preserving credentials. Session liveness/owner/purpose are checked
before decrypting; revocation removes session wrappers. Passkey/OTP/account
switching create a grant lazily on first credential access. Background use
intentionally retains server-assisted access; this is not zero knowledge.

Legacy owner-private OAuth grants migrate under an exact credential CAS;
Secure Vault values migrate through canonical revision-guarded updates. Damaged
key metadata cannot be replaced with a new key. Public projections omit keys
and wrappers. Existing users gain password wrapping at their next successful
password login/verification. No raw password or session JWT is stored in the
key registry or session wrapper.

## Verified locally

October 14: 18 live password recovery checks passed, including two credentials
surviving reset, old session/password rejection, reset replay, independent
removal and logout. The 21 live service-account checks passed. One real Google
identity was saved through the browser callback and its account.profile API
request returned 200. A second authorization of the same identity retained one account entry. Cancelling another Google authorization returned without removing the existing grant; a fresh Thingtime login then successfully used the saved token again. The legacy synthetic QA work credential migrated and
remained readable on a second reveal after migration.


- Full local unit command passed: 4,445 tests passed, zero failed, eight skipped. Existing ChatGPT session-pipeline assertions now accommodate removal of the vault grant while still checking TTL and consumed-token metadata.
- Hosted API suite passed on retry after its first MongoDB container exited before app startup. The first hosted unit run caught the obsolete pipeline assertions; those are corrected and covered by the full local run.
- After merging current develop, both client and Nitro server builds passed; connection/capability suites and both live API verifiers passed again.
- Graphify refresh was attempted after both merge reconciliations. It refused to publish because saved semantic nodes disappeared during extraction; the coherent snapshot from the remote branch is preserved and freshness remains unverified.
- Client and Nitro server builds passed. Changed-file lint passed without errors.
- Connection tests: 137 passed, including 55 independently removable connections, the 605-entry vault-count regression, and 12 password/session envelope tests.
- Password confirmation/reveal: 19 passed; collection contracts: 60 passed; auth introspection: 10 passed.
- API capability tests: 94 passed, including both manifests for owner-fenced account writes and the fixed credential-reuse endpoint. Manual credential forms, like OAuth and AI forms, negotiate owner-fence support before transmitting secrets and abandon submission after an account switch.
- Existing real API connections verifier: 103 passed; new account-library API verifier: 21 passed on a disposable local replica set.
- Browser: desktop and 390px layout, two saved AI accounts surviving reload, logout clears private account metadata, sign-in restores the correct library, demo add/feed/disconnect, and independent removal of one synthetic AI credential.
- Typecheck ratchet reports 91 diagnostics against an 89 baseline; no diagnostics in changed feature files. This is a warning, not a clean typecheck.

## Remaining acceptance

### October 16 integration and refresh checkpoint

- Integrated current `develop`, including the released password manager. Both
  features retain the same account-key envelope implementation; request context
  and the password route's private-origin protections are preserved together.
- The real saved Google access token had expired on October 14. Selecting
  **Check connection** refreshed it without sign-in and persisted a new expiry
  on October 15. A subsequent `account.profile` request returned HTTP 200 with
  only display-name/handle fields. No provider token was exposed to the browser.
- Connection tests: 137 pass; password tests: 36 pass; capabilities: 95 pass.
  The live HTTP verifiers pass 21 account-library and 18 recovery checks against
  the local stack. Test credentials and links are removed through their APIs.
- Client and Nitro builds and changed dispatcher lint pass. The typecheck
  ratchet remains at 91 diagnostics versus the stored 89 baseline, with no
  OAuth feature diagnostics. The code graph refresh succeeds after selecting
  develop's complete graph snapshot during merge reconciliation; semantic
  documentation extraction is not claimed refreshed.
- Meta's saved production callback is visible in its Facebook Login settings.
  App-secret access now reaches a normal password-verification prompt. 1Password
  is locked and the Thingtime password library has no supplied credentials, so
  that verification is pending. No provider account password was reset.
- The local PM2 stack uses the new worktree-specific identity with explicit
  `TT_WEB_PORT=18280 TT_HMR_PORT=18281 TT_API_PORT=18282` overrides to retain its
  already-registered Google callback. Other worktree processes are preserved.

### October 16 provider-response review

- Reproduced HTTP 200 with malformed JSON being returned as `{ ok: true,
  data: null }` by the shared authenticated provider transport. It now fails
  with a bounded 502 message. Non-JSON 401/403 responses still request reconnect,
  and valid empty JSON responses remain usable. Focused regressions cover these
  cases without sending credentials or calling a real provider.
- Validation: the malformed-success regression fails before the fix; all 140
  connection tests pass after it. The 21 live account-library checks, changed
  file lint (zero errors; existing test warnings), and Nitro build pass. The
  browser's saved real Google account again completes **Check connection**.
- GitGuardian's three findings on `39a2c4a2d` point to the password format
  selector (`PasswordManager.tsx:28`) and synthetic TOTP import fixtures
  (`passwords.test.ts:7,49`). These files are identical to `develop`; the
  reported values are code/test data, not deployed credentials. An independent
  Gitleaks scan of `origin/develop..HEAD` reported no leaks (five non-merge
  commits scanned). The GitGuardian check remains failed pending its own
  false-positive disposition; no scanner rule or finding was suppressed.

### Remaining provider and delivery gates

- Finish the remaining real-provider acceptance and final review.
- Google web client created on October 14 with production and localhost callbacks; secret stored only in ignored local configuration. A real Google OAuth callback, expired-token refresh and account.profile API request passed. Second-account passkey verification and Facebook client-secret setup are pending.
- Finish two-distinct-Google-account and Facebook positive authorization testing. Mocked OAuth tests alone do not establish these.
- The OpenAI partner inquiry page confirms receipt. Hosted ChatGPT still requires an approved partner client. Local subscription-token enrollment is not implemented. Direct browser Claude enrollment is unavailable; the current adapter accepts a Claude Code setup token.
- Review preview behavior and required CI. Production promotion requires separate approval for the exact PR.
