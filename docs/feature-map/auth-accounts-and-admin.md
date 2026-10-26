# Auth, accounts and admin

Auth is an httpOnly cookie carrying a signed JWT (`jti`/`sub`/`exp`) plus a
revocable Mongo `sessions` document; Bearer tokens (PATs, service accounts,
app tokens) serve API clients (`FUNDAMENTALS.md` §5). Identity and control-plane
data stay on the home data plane.

## Where the code lives

| Concern | Path |
| --- | --- |
| Resolve the caller (`getCurrentUser(request)`) | `app/api/utils/auth/getCurrentUser.ts` |
| Users (`toPublicUser`, `PublicUser`, upload/Lopu flags) | `app/api/utils/auth/users.ts` |
| Admin allowlist (`isAdminDoc`, `isEnvAdmin`, `ADMIN_USERNAMES`) | `app/api/utils/auth/admin.ts` |
| Sessions, cookies, roster (account switcher) | `app/api/utils/auth/accounts.ts` (`mergeAccountSession`, `removeAccounts`), `sessions` helpers |
| PAT scopes / actors for Things routes | `app/api/utils/auth/patScopes.ts`, `resolveThingsActor` |
| Routes | `app/routes/api/v1/auth/*` (`register`, `me`, `logout`, `accounts/{assume,owned,remove,switch}`, `passkeys`, `password-reset`, `two-factor`, `verify-email`, `invites`, `sso-*`, `service-account`, `introspect`, `jwks`, `account-hints`), `app/routes/api/v1/login/_login.tsx`, `app/routes/api/v1/oauth/*` |
| Admin routes | `app/routes/api/v1/admin/*` (users/public-uploads, ci, integrations, error-logs, moderation, migrations) |
| Client hooks | `app/hooks/useCurrentUser.tsx`, account switcher components in `app/components/Account/*` |

## Authorization helper

- Every API route: `const user = await getCurrentUser(request)`; treat
  `accountKind === 'service'` as anonymous for first-party data unless the route
  is explicitly for service accounts.
- Admin routes gate with the admin helpers (`isAdminDoc(user)` /
  `user.isAdmin`); `ADMIN_USERNAMES` lists env admins. A username listed there
  is reserved and cannot register; make an existing account admin by adding it
  to the env and restarting.
- Upload approval: new accounts start with `meta.publicUploads: false` and
  `meta.privateUploads: false`; `POST /api/v1/admin/users/public-uploads`
  `{ userId, enabled, scope: 'public' | 'private' | 'all' }` toggles them.
  Admins are always enabled.
- Lopu verified access (`meta.lopuVerified`) is a separate plain opt-in.

## Flows and their exact endpoints

| Flow | Request | Notes |
| --- | --- | --- |
| Register | `POST /api/v1/auth/register` `{ username, password, email, displayName? }` | sets the auth cookie + roster cookies; `emailVerified` starts false |
| Login | `POST /api/v1/login` `{ username, password }` or `{ challenge, code }` | second form finishes email 2FA |
| Current user | `GET /api/v1/auth/me` | |
| Sign one roster account out | `POST /api/v1/auth/accounts/remove` `{ userId }` | revokes its session; no account deletion API exists |
| Logout | `POST /api/v1/auth/logout` | |

Preserve exact redirect/origin checks, PKCE, one-use challenges and session
revocation in every OAuth/SSO change; a browser "success" text alone never
proves the host connected.

## Tests

- `npm --prefix remix run test:auth-origin`, `test:auth-introspection`,
  `test:passkeys`, `test:pat-scopes`, `test:account-hints`, `test:invites`,
  `test:temporary-user`, `test:admin-integrations`.
- Local admin bootstrap recipe: register a throwaway user, add its username to
  `ADMIN_USERNAMES` in `remix/.env`, restart the dev stack.
- `TESTING.md`: the auth, passkey, account switcher and admin sections.

Lopu browser Actions bind a revalidated first-party user resolver to the exact
synthetic Request through `internalRequestActor.ts`. `getCurrentUser` and
`resolveThingsActor` accept this server-only identity without credentials.
Only `actions/internalActionRequest.ts` installs it, for canonical data routes;
control-plane and reveal APIs are excluded. `test:lopu` includes host isolation,
revocation and first-party-only permission-route tests. See
[Lopu chat access](../lopu-action-access.md).

## Account drafts and templates

See [account-drafts-and-templates.md](account-drafts-and-templates.md) for the
private draft API, editor recovery, account isolation and independent media copies.

## Lopu prompt settings

`GET/POST /api/v1/settings/lopu-prompt` exposes the shared public base prompt, the authenticated account's private instruction checklist, and admin-only base edits. `settings/lopuPromptSettings.ts` stores the shared revision in home settings and personal revisions in protected account metadata through `users.ts`; public user projections omit that text. `promptSettingsCore.ts` bounds inputs and composes enabled preferences. Revision comparisons reject stale writes. `LopuPromptSettings.tsx` serves Settings → Lopu and Settings → Admin; account-keyed mounting and private in-memory caching prevent cross-account drafts. Prompt text never grants server tool authority. Routes, concurrent save conflicts, disabled entries and private response handling are covered by `test:lopu` and `test:settings`.


## Password manager

See [password-manager.md](../password-manager.md). `api.passwords` 1.2.1 is a
private, session-bound home-plane API over protected `password-manager-entry`
Things. `api/utils/passwords/passwords.ts` owns accounted mutations, revision
fences and secret-free native catalog projections; `auth/vaultEnvelope.ts` and
`vaultKeys.ts` own password/session/recovery key wrapping. `passwords/client.ts`
intentionally bypasses general request diagnostics and automatic origin fallback
so decrypted fields never enter shared client history/cache. The reusable
`Thingtime` fields mod renders the entry without global Thing persistence.
`components/Passwords/passwordManagerBlocks.ts` defines individually editable
Copy buttons/status blocks; `PasswordManager.tsx` resolves `field.copy` by field
ID in a transient closure. `passwordEntryDisplay.ts` exposes labels and fixed
feedback only. Concealed values stay masked, TOTP Copy yields a code rather than
its seed, and passkey entries cannot copy signing fields. Scope changes suppress
stale work/feedback. See the Copy regression in `TESTING.md` and the synthetic
browser harness in `scripts/check-password-manager-browser.cjs`.
Native integrations live in `apple/Passwords`, `apple/PasswordProvider`,
`iOS/Thingtime/Web/PasswordBridge.swift` and `electron/lib/password-provider.cjs`.
`npm --prefix remix run test:passwords` and the native `build:passwords`
preflight run `remix/scripts/verify-native-password-passkey.mjs` on macOS. It
exports one public Swift ceremony fixture and runs the independent WebAuthn
verifier under a network-denying sandbox, with private temporary cleanup.
Unsupported platforms explicitly skip; macOS failures fail the gate. Run
`node --test remix/scripts/native-password-passkey.test.mjs` for entrypoint,
failure/cleanup and real challenge/origin/signature/UV tampering regressions.
Protocol interoperability does not establish signed OS or real-account acceptance.
Native provider implementation and signed release are tracked separately in
[PR #996](https://github.com/lopugit/thingtime/pull/996); this release exposes the
private catalog and negotiates an optional supported native bridge.

## Account content snapshots

The internal owner inventory uses `backups/accountSnapshots.ts` and the shared
`timeline/accountContent.ts` v1 contract for approved profile content and private
preferences. It decodes bounded user BinData without exporting email, passwords,
vault keys, credentials, permissions or security settings. Managed profile images
must match the owner, exact slot and durable binding at the same database
snapshot. The offline reader has no authority to write an account or sign in.
`test:backups` covers independent recovery, exact preferences and malformed or
foreign data refusal. `test:backups:account-profile` runs actual registration/profile/settings Request
handlers against its own disposable replica and compares the internal snapshot
with independent API readback. Its macOS OS network policy and preflight refuse
connections outside its disposable loopback database, including redirects and
direct IPs. It exercises explicit current-writer restoration,
concurrent edits, source-vault removal and revoked authentication. HTTP/browser,
managed profile-media restore and product restore orchestration remain separate gates.
See [portable backups](../portable-backups.md#account-profile-content-and-private-preferences).

## AI provider model availability

`api/utils/ai/modelDiscovery.ts` reads complete credential-scoped provider lists;
`modelSync.ts` publishes them atomically into protected home-plane `ai-model`
Things with a durable settings lease/cooldown. `models.ts` projects availability
and preserves admin choices. Daily authenticated cron and admin manual sync use
this same service; shared inference model-not-found errors trigger a bounded
refresh without replay. `LopuModelsEditor.tsx` owns per-provider allow-all and
future auto-admission controls. Public model selectors consume the live catalogue;
unknown model capabilities and pricing are conservative. See README automatic AI
model catalogue sync and TESTING daily provider model availability.

`settings/prConflictResolverModelWaterfallCore.ts` owns known reasoning tiers and
native Responses requirements (including GPT-6 Astra); `lopu/chat.ts` consumes
that transport policy. `chat.streaming.test.mts` exercises Astra default/High/Max
reasoning and tool-result replay through the real SDK against an HTTP fixture.

## Incoming mail

See [incoming-mail.md](incoming-mail.md) for Email settings, IMAP/POP3, private cloud storage, the paired local connector, offline reading and proxy inbox views.

## iOS release automation

`api/utils/releases/iosRelease.ts` uses the existing admin integration secret,
claim and audit stores. `iosReleaseCore.ts` validates the fixed release policy and
Apple bundle. GitHub OIDC grants only `integrations/ios-release` access after
immutable repository/owner, main workflow, event and source checks; it grants no
admin session or general vault access. See [setup and acceptance](../ios-automatic-testflight.md).

Password migration coverage and encrypted file lifecycle: `passwords/onePassword.ts`,
`transfer.ts`, `fileCrypto.ts`, `files.client.ts`, `backup.client.ts`, and
`api/utils/passwords/files.ts`. Every original 1PUX member is retained as an
encrypted attachment to a source archive entry; item editors preserve structured
values, source context and password history. See [the password contract](../password-manager.md).

Claude keyless discovery reads the official public lifecycle table through
`modelDiscovery.ts`. `modelSync.ts` stores public provenance separately from
credential availability, preserving admission and absent rows. The workflow
editor opts into live server model lists through `waterfallCatalog.ts` and awaits
its settings write through `AiWaterfallSelector.onSaveApply`. Regression coverage:
`modelSync.test.ts`, `waterfallCatalog.test.ts`, and the Claude public catalogue /
workflow save checklist in TESTING.

## Incident cleanup

`api/utils/migrations/accidentalCatalogAccount.ts` registers the destructive,
incident-specific catalog fixture cleanup. The existing admin migration API
requires dry-run/confirmation, checks exact identity and idle account state, and
deletes account/bootstrap/auth records atomically in the home DB. It cannot
accept arbitrary target accounts. Delivery and migration audit records remain.

OpenAI environment-to-vault import uses `credentialVault.ts::importConfiguredOpenAiCredential` through the existing admin credentials route and `PlatformCredentials.tsx`. It is same-origin, admin-only and create-only; `api.admin-ci-credentials` 3.1.0 is negotiated before use. The sole source is server `OPENAI_API_KEY`, and the destination is `OpenAI` / `OPENAI_THINGTIME_API_KEY`.


## Local ChatGPT plan connections

`ai/chatgptPlanProtocol.ts` validates dynamic registration, JWT identity, scopes, rotation and Responses restrictions. `chatgptPlanRuntime.ts` owns protected local credentials, loopback callbacks, one-use attempts, account/session/origin fences and per-account cancellation. The authenticated `ai/chatgpt-plan` route publishes redacted state only; `Settings/ChatGPTPlanSettings.tsx` negotiates its capability. Model discovery and Lopu use the existing provider path with strict saved plan pins and no billing fallback. See README ChatGPT plan usage, TESTING and `test:chatgpt-plan`. `chatgptPlanStorage.ts` encrypts owner/origin-scoped records in the account MongoDB and fences its single refresh authority. `chatgptPlanTransfer.ts` seals explicit moves to a destination-owned key. Electron `local-runtime.cjs` manages optional authenticated local Mongo and generated OS-protected secrets; API switching uses separate sessions and restart.
## Characters

See [Characters](../characters.md) for the settings, login modes, private ownership,
admin lookup, session selection, agent coordination and acceptance runbook.
`characterCore.ts`, `characterSession.ts`, `characters.ts` and
`characterEntitlements.ts` extend the existing home-plane user/session/ledger paths.
`resolveSessionUser` defaults to the authenticated principal for roster and
credential callers; request authentication passes an explicit selection (or null
for the session default). Never re-mint a principal session with an acting user ID.
