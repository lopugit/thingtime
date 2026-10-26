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
- Saved provider replacement: `connections/vaultTokenReplacement.test.mts`
  (included in `test:connections`) exercises the vault HTTP action, exact
  encrypted replacement, intentional blank retention, and no-write rejection.
  Credential-save clients require `api.lopu-vault` 1.4.0. Long names, keys,
  endpoints, model IDs and values round-trip without arbitrary field/envelope
  caps. `schemas/dataStrings.test.ts` covers the shared validator, and capability
  regressions cover the affected Things/copy/import/Action contracts.

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

### Third-party account library

`/connections` is the service/subservice catalog and account manager. The native
provider boundary is `api/utils/connections/{providers,oauth,connections}.ts`;
`tokenVault.ts` and `lopu/userVault.ts` use the shared account-key envelope. Public sources
retain shared accounts; authenticated grants are separate Things per owner.
OAuth resolves fixed per-provider-family encrypted admin-vault labels (for example
`connections-google-oauth` and `connections-facebook-oauth`) using
`environments[environmentId].origins[exactOrigin]` entries containing
`clientId`, `clientSecret` and the exact `redirectUri`. `oauthConfig.ts` selects
the explicit data environment, validates the origin and callback, and coalesces
reads only for the current request. Missing, malformed, duplicate or mismatched
configuration fails closed; provider-secret environment variables never supply
a fallback. The optional legacy callback-base setting is a same-origin pin.
Session-bound one-use state and encrypted grants bind client, origin, callback
and environment. Older unbound flows/grants must restart/reconnect. Refresh is
serialized with a home-database lease and revalidates concurrent reconnects on
lease/write loss or failed refresh; partial replies preserve grant metadata. `connections/request` exposes only
fixed, scope-checked operations and never returns credential material.
Catalog, Connections, OAuth begin/callback, feed and saved-account request
contracts deliberately require major `2.0.0`, including in the shared browser
API helper: removing env-only setup and rejecting unbound legacy grants changes
behavior. The request contract preserves complete API payloads and forwards opaque
`pageToken`/`data.nextPageToken` cursors for Google lists. The bounded logging
redactor is not an API serializer. Token redaction operates on string values
and property names, preserves typed scalars and JSON syntax, and removes
overlapping tokens in full without rewriting generated replacement markers. Fixed-target requests reject cross-origin
redirects and propagate cancellation; ordinary key/value fields are data.
OpenAI API/Claude Code OAuth cards reuse `lopu/vault`, keeping Lopu's selectable providers
and Secure Vault as the same records. Run `test:connections`,
`test:api-capabilities`, `test:admin-integrations` and `test:mail`; after the
canonical Vercel build, `smoke:built-connections`
(`scripts/smoke-built-connections.mjs`) checks both compiled manifests with
synthetic bootstrap and all network access denied on macOS. The existing
`TT_QA_SUITE=service-catalog node scripts/run-lopu-credentials-browser.mjs` harness
(with its installed `TT_QA_IMAGE` and Chromium `TT_QA_SECCOMP` profile)
exercises actual editable Connections components at desktop/mobile sizes using
a task-owned network-none Chromium container and synthetic responses. It also
checks all six shared Connections API operations against legacy/major-2
manifests and scrolls desktop/mobile pages from top to bottom. See README's third-party setup section
and TESTING's multi-account, callback, rotation and cache isolation checklist. The uncapped-data integration negotiates Things 1.42.0, Things update 1.13.0 and Actions run 1.39.0 to avoid collisions with independently shipped media/sync contracts; saved-service browser requests preserve opaque pagination tokens.
Connections layouts are intrinsic editable documents (`serviceCatalogBlocks`,
`aiServiceBlocks`, `connectionToolsBlocks`). `TransientBlockHost` exposes only
validated action names and public display projections; credentials are read
from the current fieldset during explicit submission. Enter/required-field
handling stays scoped to that fieldset, and origin/account/edit transitions
revoke pending adapter work. Credential submission bodies are omitted from
the DevKit log even when provider field names do not identify them as secrets.

ChatGPT hosted identity uses an approved client, verified OIDC ID tokens and
no inference grant. Facebook identity and posts are separate grants. Account
and link writes/disconnects commit in one home transaction; old source rows
remain inert without a live link. Owner IDs accompany private reads; an
optional `expectedOwnerId` rejects forms submitted after an account switch.

### Server-assisted vault keys

`auth/vaultEnvelope.ts` owns AES-GCM, scrypt password wrapping and HKDF session
wrapping. `auth/vaultKeys.ts` owns the stable per-user key, approved background
recovery, exact-password binding and live-session grants. The bounded registry
stays in the home user secure blob through `users.ts` CAS; wrappers are excluded
from public user projections. Session wrappers are binary on each session row,
removed by the shared revocation pipeline. `vaultRequest.ts` gives the Nitro API
dispatcher request-local token context without a global identity/key cache.
Login/registration/verified reveal bind passwords; reset writes hash+wrapper in
one CAS. Passkey/OTP/account-switch sessions obtain grants lazily after liveness
checks. Server recovery is intentional, not zero-knowledge encryption.

Run `test:connections` (envelopes, registry, concurrency, scope isolation),
`test:sensitive-reveal`, `test:collections`, and the local-only
`scripts/verify-vault-recovery.mjs` acceptance script. Existing legacy entries
migrate only under canonical revision guards; corrupt key records fail closed.


## Password manager

`PasswordGenerator.tsx`, `PasswordIcon.tsx` and `PasswordPasskeySetup.tsx` compose
editable settings blocks; secret output stays in the controlled entry draft.
`passwords/generator.ts` owns WebCrypto/preset validation. `passwords/icons.ts`,
`icons.client.ts` and `api/utils/passwords/icons.ts` own descriptors, anonymous
image loading and the separately sealed list projection. `test:passwords` covers
these boundaries; `scripts/password-tools.browser.html` is an isolated synthetic
UI fixture, not native-provider acceptance.

See [password-manager.md](../password-manager.md). `api.passwords` 1.3.0 is a
private, session-bound home-plane API over protected `password-manager-entry`
Things. `api/utils/passwords/passwords.ts` owns accounted mutations, revision
fences and secret-free native catalog projections; `auth/vaultEnvelope.ts` and
`vaultKeys.ts` own password/session/recovery key wrapping. `passwords/client.ts`
intentionally bypasses general request diagnostics and automatic origin fallback
so decrypted fields never enter shared client history/cache. The reusable
`Thingtime` fields mod renders the entry without global Thing persistence.
Native provider implementation lives in `apple/Passwords` and
`apple/PasswordProvider`. Signed packaging and real device registration/sign-in
remain separate acceptance checks; the web guide uses the existing native bridge.

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

OpenAI environment-to-vault import uses `credentialVault.ts::importConfiguredOpenAiCredential` through the existing admin credentials route and `PlatformCredentials.tsx`. It is same-origin, admin-only and create-only; `api.admin-ci-credentials` 3.1.1 is negotiated before use. The sole source is server `OPENAI_API_KEY`, and the destination is `OpenAI` / `OPENAI_THINGTIME_API_KEY`.


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

## Connections through an environment gateway

OAuth client selection remains exact to the restored frontend origin and
`getDeploymentDataEnvironment().id`. Gateway relay metadata does not grant a
session, change a callback or substitute its environment label. State is one-use
and session-bound; refresh retains the saved origin/environment/client binding
and independent account lease. Run `test:connections`, `test:environment-gateway`,
`test:admin-integrations` and `test:api-capabilities`. Connections major2 rollout
is backend-first; see [the runbook](../environment-api-gateway.md#connections-major2-rollout).


Production feature integration retains `api.passwords` 1.3.0 and the editable
password generator, icon editor and passkey guide while adding private structured
field templates. List icons use transient decoded blob URLs with an editable
fallback; icon URLs and decrypted property values never enter saved layouts.
`test:connections-browser` and `test:passwords-browser` share the hardened
`run-private-tools-browser.mjs` runner, with explicit synthetic fixture dispatch,
network-disabled containers and the Chromium sandbox retained.
