# Multi-account third-party service library

Status: open, ready-for-review implementation checkpoint. Google identity and refresh are verified
locally; production delivery and other providers' positive acceptance remain pending.

## 18 October: provider token replacement fails without partial changes

A supplied invalid token was treated like an omitted token during provider
updates. The request could return 200, retain the old credential, and still save
new metadata. The regression reproduced this through the real HTTP action.
Updates now reject an invalid supplied token before any write. Omitted and empty
tokens retain their intentional "keep existing" behavior; a valid replacement
is preserved exactly. Both capability manifests publish `api.lopu-vault` 1.3.1,
and the provider-save clients require that correction.

Verification: 155 connection tests and 98 capability tests pass, including four
new token-replacement regressions; targeted lint and client/Nitro builds pass.
Twenty isolated browser/API check records pass against the built server and a
fresh MongoDB replica set. Fresh password confirmation verifies the actual
stored value after rejection, replacement, and intentional retention. The same
run covers four saved accounts, desktop/mobile forms and scrolling, independent
removal, logout, cross-owner denial, and fresh-login recovery. All credentials
are synthetic and provisioned/retrieved through local Thingtime Passwords.
The kernel boundary blocks browser/backend egress; the task container is removed.

Remaining size-limit work is explicit: form name/token limits, vault field and
byte validation, the JSON request limit, encryption's default value budget, and
the shared data-Thing string validator need a coordinated storage-path change.
This correction does not remove those limits or establish real-provider consent.
Hosted checks and deployment for the new commit must be verified separately.

## 18 October: authenticated browser acceptance and mobile account rows

A disposable Linux app and normally sandboxed Chromium share a kernel-enforced
loopback-only network. Browser and backend probes reject production hostnames,
direct public IPs, external redirects and unrelated local backends. Fresh test
accounts and synthetic provider credentials are provisioned and retrieved through
Thingtime Passwords; no production credentials or personal browser state are used.

At `8f0a9921c`, authenticated UI acceptance passes: two OpenAI and two Claude
accounts save and survive reload, removing one retains three, logout clears
private names, a second owner sees no accounts, a stale-owner write returns 409,
a foreign password read returns 404, and a fresh first-owner login retains its
three accounts. Rendered results agree with API metadata. Screenshots and a
metadata-only action trace are retained privately; task containers are removed.
Raw credential-bearing browser traffic is not traced.

The mobile screenshots exposed account names squeezed beside badges/actions.
Names now take the full row below the desktop breakpoint; controls wrap below
without shortening names. The isolated browser regression checks both row bounds
and the account lifecycle above. The authenticated fixture runner also scrolls
buttons into view and hit-tests them to avoid a success notice obscuring a click,
and logs out the second owner before exercising the final fresh login.

Meta saved the existing transparent Thingtime logo and retained it after reload.
Its validator accepts `https://thingtime.com/api/v1/connections/oauth/callback`;
client/web OAuth, HTTPS enforcement and strict redirect matching are enabled.
`public_profile` is ready for testing; `user_posts` has not been added. App-secret
verification, real two-account authorization and optional posts review remain
outstanding. The app remains unpublished. Shared preview configuration remains
separate from this isolated browser acceptance.

## 18 October: opaque-token response correction

Raw JSON replacement could turn a boolean, number or delimiter into invalid
JSON when an opaque credential matched it. Replacing shorter credentials first
could also leave the suffix of a longer credential. Redaction now works on
string values and escaped property names, matches longer tokens first in one
pass, and preserves numbers, booleans, null, arrays and complete payloads.
Generated replacement markers are not processed a second time.

Four failure modes were reproduced before the fix. All five new regression
cases pass, including quote/backslash handling. The complete connections suite
passes 151 tests and capability suite 97, with no failures/skips. Changed-file
lint and the Nitro node-server build pass. An isolated built-server smoke used
a fresh empty MongoDB replica set and an enforced outbound boundary: production
hosts, direct public IPs, external redirects and unrelated local backends were
blocked. Both live manifests publish `api.connections-request` 1.1.1; anonymous
connections/passwords requests return 401. Task processes/database were cleaned
up. This is backend acceptance; it does not establish rendered browser or
real-provider consent acceptance.

The preview at <https://pr-992.previews.dev.thingtime.com> was verified at
`7506dcb31` before this patch: shell, API health and both manifests returned 200,
with private endpoints returning 401 anonymously. That deployment reports
Google, Facebook and hosted ChatGPT OAuth unconfigured. Recheck its revision and
capability version after the patch is pushed; do not call the shared development
preview an isolated test environment or put personal credentials into it.

GitGuardian still reports three findings in PasswordManager.tsx and
passwords.test.ts. Both files were byte-identical at `7506dcb31`, cached
origin/develop and origin/main. The existing synthetic-fixture disposition is
recorded below; no alert was suppressed or closed in this checkpoint.

## Behavior

The Connections page groups services and subservices into titled cards. Every
configured service supports multiple account identities, with an independent
remove control. Reconnecting an identity updates that identity only. Fixed
50/100 connection caps and 200/500 AI-list truncation have been removed.

Google identity, Drive, Gmail, Calendar, Docs, Sheets and Contacts are separate
grants. Facebook basic identity and posts are separate grants. ChatGPT hosted
identity supports an approved OpenAI client and verified ID tokens only.
OpenAI API and Claude Code OAuth credentials reuse the existing Secure Vault.

Saved Google list operations support opaque continuation tokens across all
pages. API results preserve complete strings, arrays, objects and ordinary
key/value fields while redacting credential material. Logging summaries retain
their separate bounded representation. Both capability manifests advertise
`api.connections-request` 1.1.1, retaining the additive pagination contract
and correcting opaque-token redaction without changing typed JSON data.

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

### October 18 released-vault integration checkpoint

- Integrated production `main` at `0618f323e`, including the complete 1PUX
  importer and encrypted attachments. OAuth and password entries continue to
  share the canonical account-key envelope; the merge preserves the current
  password payload options, incoming-mail routes and OAuth request context.
- A fresh real Google identity authorization returned through the configured
  localhost callback, persisted across reload, and passed **Check connection**
  against Google's profile endpoint. A second, distinct account reached its
  device passkey challenge; that positive callback is still unverified.
- Connection tests: 140 pass; password tests: 47 pass; capability tests: 96
  pass. Live HTTP checks: 21 account-library and 18 recovery checks pass.
  The production build and Vercel output verification pass. Full TypeScript
  checking still reports 91 existing diagnostics, with none in the connection
  or password feature files; this is not a clean repository-wide typecheck.
- Selected the complete `main` graph snapshot while resolving the merge,
  then refreshed the structural graph for the integrated source. Semantic
  documentation extraction is not claimed refreshed.
- Meta app-secret retrieval remains behind password verification; the supplied
  saved credential was rejected. No credential was reset and no app secret was
  committed. The hosted OpenAI client remains dependent on partner approval;
  the open-source local enrollment flow is a separate integration.
- The broader feed verifier exposed missing WiredTiger files in the old
  disposable database under the OS temporary directory. A stopped copy was
  preserved; QA now uses a separate persistent private directory and fixtures
  created through the API. After the new replica and development worker became
  ready, all 103 existing feed/ACL/disconnect checks, 21 account-library checks
  and 18 recovery checks passed. README documents durable QA storage and the
  readiness gate. This was an environment failure, not a feed-code change.
- Hosted Web CI on `f429c97e7` passed its API suite, full unit job and build.

### October 18 complete-result and pagination checkpoint

- Reproduced three failures before the fix: missing/redacted continuation
  tokens, truncated/oversized document results, and ignored malformed cursors.
  Drive, Gmail, Calendar and Contacts now forward `pageToken` without changing
  their fixed target or other query parameters. Drive requests include
  `nextPageToken` in their field projection. There is no total-record limit;
  consumers request successive provider pages.
- Removed the result-size gate, request-body cursor cap and document-ID length
  cap. Complete responses are available only to fixed registered operations;
  their transport refuses cross-origin redirects before another fetch, keeps
  the existing private-network guard and timeout, and combines request
  cancellation with that timeout. Provider/deployment constraints still apply
  to each page or single document response; this is not infinite memory.
- Credential-specific field matching and exact saved-token scrubbing replace
  the bounded logging redactor for API payloads. Tests preserve >3 MB text,
  130-element arrays/objects, 30-level nesting, key/value fields and opaque
  query-delimiter cursors while checking credential redaction and ownership.
- Validation: 146 connection tests, 96 capability tests and 24 live local
  account-library checks pass. The Nitro production server build passes.
  Changed-file lint has no errors (four existing fixture warnings; `.mts`
  uses the TypeScript parser and Node/ES2021 globals explicitly). A fresh
  local login reused the real saved Google grant and returned HTTP 200 with
  only profile display-name/handle fields and private/no-store headers.
- Positive Google list pagination is tested with controlled provider responses,
  not new live Drive/Gmail/Contacts/Calendar grants. Real additional-scope
  consent and multiple-distinct-account acceptance remain separate gates.
- The previous head `ad89a736e` passed hosted build/unit/API and CodeQL jobs;
  this implementation revision requires its own hosted checks. No hosted
  preview deployment exists for the branch. Local web remains on port 18280;
  Tailscale/Funnel is unverified because the installed CLI wrapper points to a
  missing Tailscale application binary. No new public exposure was configured.

### Remaining provider and delivery gates

- Finish the remaining real-provider acceptance and final review.
- Google web client created on October 14 with production and localhost callbacks; secret stored only in ignored local configuration. A real Google OAuth callback, expired-token refresh and account.profile API request passed, with fresh callback/profile acceptance repeated on October 18. Second-account passkey verification and Facebook client-secret setup are pending.
- Finish two-distinct-Google-account and Facebook positive authorization testing. Mocked OAuth tests alone do not establish these.
- The OpenAI partner inquiry page confirms receipt. Hosted ChatGPT still requires an approved partner client. Local subscription-token enrollment is not implemented. Direct browser Claude enrollment is unavailable; the current adapter accepts a Claude Code setup token.
- Review preview behavior and required CI. Production promotion requires separate approval for the exact PR.
