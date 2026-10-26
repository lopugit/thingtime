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

`GET/POST /api/v1/settings/lopu-prompt` exposes the shared public base prompt, the authenticated account's private instruction checklist, and admin-only base edits. `settings/lopuPromptSettings.ts` stores the shared revision in home settings and personal revisions in protected account metadata through `users.ts`; public user projections omit that text. `promptSettingsCore.ts` validates canonical entries and composes enabled preferences. Revision comparisons reject stale writes. `api.settings-lopu-prompt` 2.0.0 adds owner-fenced, resumable instruction generations with a compact private account reference. Immutable parts preserve complete content beyond the unchanged 96 KiB per-request boundary; base-only reads avoid loading personal content. Committed generations are retained for backup/recovery, and abandoned staging is cleaned in accounted batches. Ordinary inference remains functional; large enabled inference requires verified provider capacity and currently fails explicitly without truncation.

`LopuPromptSettings.tsx` uses `local-workspace/lopuInstructions.ts` for anonymous and offline device saves, with root-bound account/origin isolation and home-pinned account preferences. `lopuInstructions.client.tsx` runs an independent confirmed-account sync worker with immutable attempts, lost-reply reconciliation and explicit conflict review. Anonymous work never uses account transport or becomes an account queue. The existing workspace database and canonical instruction shape are reused. Admin base edits keep their authenticated API path. Prompt text never grants tool authority. See [local workspace coverage](../local-workspaces.md) for browser evidence and remaining account-UI acceptance. Regressions: `lopuInstructions*.test.ts`, `test:lopu`, `test:settings`, `test:api-capabilities`; the opt-in browser fixture requires a claimed isolated full-app runtime.

## Password manager

See [password-manager.md](../password-manager.md). `api.passwords` 1.2.0 is a
private, session-bound home-plane API over protected `password-manager-entry`
Things. `api/utils/passwords/passwords.ts` owns accounted mutations, revision
fences and secret-free native catalog projections; `auth/vaultEnvelope.ts` and
`vaultKeys.ts` own password/session/recovery key wrapping. `passwords/client.ts`
intentionally bypasses general request diagnostics and automatic origin fallback
so decrypted fields never enter shared client history/cache. The reusable
`Thingtime` fields mod renders the entry without global Thing persistence.
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

Local account workers are bound to the confirmed root identity generation,
origin, owner ID and data plane (`app/local-workspace/runtime.client.ts`).
Expected-actor mismatch now also returns `code: ACTOR_CHANGED`; the existing
409 refusal remains. A mismatched queue stops before another request and root
identity refreshes. Temporary/anonymous users do not start account workers, and
logging in does not adopt anonymous content. See the incomplete
[local workspace acceptance matrix](../local-workspaces.md).

Offline account roots contain only a local workspace pointer and `user: null`
(`local-workspace/rootFallback.ts`), never a cached authenticated profile. Local
and remote leases are separate. `createRootDataLoader` installs workspace binding
only after its latest-request fence; a stale success/failure cannot change a
newer pointer. `useWorkspaceUser` is content identity only. Legacy anonymous tree
hydration does not silently claim data for an account. Test `test:root-data`,
`test:local-workspace` and `test:autosave` for these boundaries.

Delegated composer APIs and explicit Character submissions capture their local
workspace lease when the callback is created (`characterRequest.client.ts`,
`useApi.tsx`, `useAsyncFetcher.tsx`). A retained callback cannot acquire a later
root account or database; remote confirmation is checked again for each request.
`characterCallbacks.test.ts` exercises the real submission hook, while
`characterDelegation.test.ts` covers the API facade, confirmation loss and
same-account/new-generation retirement. This does not grant delegated offline
workspace access or queue Character writes as the owner.


The opt-in `drafts/workspaceSwitch.browser.test.ts` uses the actual account switcher
and identity BroadcastChannel across three clean browser tabs. Held device reads
and a delayed successful private-comment response cannot enter the next account;
the original account retains edits, recovery sources and exactly one acknowledged
comment. This is local account-switch acceptance, not coverage of every origin,
data-plane or editor transition. Setup: [local workspaces](../local-workspaces.md#native-cross-tab-draft-isolation--2026-10-17).

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

### Anonymous device passwords

`components/Passwords/DevicePasswordManager.tsx` gates the existing password UI
with an independent local passphrase. `local-workspace/passwordVault.ts` owns
scoped encrypted storage, transactional revisions, leases and idle locking;
`passwords/vaultCrypto.ts` implements WebCrypto with the shared
`passwords/vaultEnvelopeContract.ts` used by server `vaultEnvelope.ts`.
No anonymous network/session adapter or native AutoFill grant is available.
`local-workspace/deviceVaultSession.ts` owns shared key lifetime, independent
password/provider key domains and legacy password-envelope compatibility.
`deviceVaultSession.test.ts` uses the fixed synthetic legacy fixture and checks
domain/scope separation, retirement and missing-key preservation.

Account device UI/sync now uses `components/Passwords/AccountPasswordWorkspace.tsx`,
`local-workspace/passwordVault.ts` and the direct fenced
`local-workspace/passwordTransport.client.ts`. Local encrypted writes finish before
network sync, and conflict choices preserve independent copies.
`passwordSync.test.ts`, `passwordTransport.test.ts` and the opt-in
`accountPasswords.browser.test.ts` cover the new boundary. Settings provider
credentials and signed native offline integration are still outstanding.

`passwordReconcile.test.ts` covers traversal past 200 pages, partial retry,
cancel/lock/account retirement, malformed pages and cross-connection stale-pull
fencing, including a newer pull that fails or races final cleanup. One scoped
token in `password-vault-pulls` prevents stale retention/pruning; no secret data
or remote authority is added. `storage.ts` discovers retained account partitions
through an identity-checked key cursor; `accountHomeStorage.test.ts` verifies 257
partitions, interruption, unchanged data and exact account/origin boundaries.

File sync groundwork: `local-workspace/passwordFileSync.ts`,
`passwordFileReconcile.ts` and `passwordFileTransport.client.ts` expose separate
account queue/retention methods with whole-transfer authority fences. The normal account UI now uses the encrypted device backend and activates
independent entry/file push/pull pumps. Encrypted remote-only metadata keeps failed
downloads visible; complete file-list/byte availability gates 1PUX backup and
conflict copies. Per-parent traversal tokens fence older-tab pruning. Explicit
file retry preserves operation identity; availability 409s keep Export open.
The opt-in `accountPasswordFiles.browser.test.ts` covers native offline save,
transfer, reconnect and fresh-device retention through disposable normal APIs.
See the [native file checkpoint](../local-workspaces.md#native-account-password-files--2026-10-18)
for local evidence and remaining acceptance. `passwordFileSync.test.ts` and
`passwordFileTransport.test.ts` are included in `test:local-workspace`.
`passwords/vaultCrypto.test.ts` verifies server interoperability;
`local-workspace/passwordVault.test.ts` and the opt-in browser fixture cover
storage isolation, cancellation, conflicts and real offline editor/transfer use.


### Local provider and environment vault

Anonymous Settings → Security → Secure Vault reuses `SecureVault.tsx` through
`DeviceProviderVault.tsx` and the shared `DeviceVaultGate`. `userVaultModel.ts`
is the browser-safe canonical metadata/value validator; `userVaultCore.ts`
retains server-only outbound-host restrictions. `local-workspace/providerVault.ts`
encrypts metadata and values with the independent provider key domain and
commits revisions/tombstones with quota and lease checks. Anonymous operations
never create account commands. The account variant now uses the same encrypted device forms with independent
sync and reviewed conflicts through `AccountProviderWorkspace.tsx`. Account
values arrive only through explicit fresh selected-value retention.

`providerVault.test.ts` covers atomic group membership, replay, quota, lock and
corruption. `providerVault.browser.test.ts` is the opt-in actual offline Settings
fixture. `userVaultModel.test.ts` and `userVaultEnvironment.test.ts` cover shared
validation and rejection of malformed replacement tokens (`api.lopu-vault`
1.2.1). See [local provider setup and verification](../local-workspaces.md#anonymous-provider-vault).

Account provider groundwork adds `userVaultMetadata.ts` and `userVaultVersion.ts`
for complete bounded, value-free snapshots of actual stored Things. The existing
Vault POST delegates `sync-metadata` to `routes/api/v1/lopu/vault/metadata.ts`
(`api.lopu-vault` 1.3.0); selected personal reveals optionally return the same
record's version after fresh proof (`api.vault-reveal` 1.2.0). The device adapter
retains explicit remote-only metadata and exact-version selected values through
`providerTransport.client.ts`. `providerMetadata.api.test.ts` is an opt-in
loopback API fixture; `test:lopu`, `test:sensitive-reveal`, `test:api-capabilities`
and `test:local-workspace` include the corresponding unit contracts. Account Settings and conditional synchronization are described in the latest
provider workspace checkpoint below.

## Incoming mail

See [incoming-mail.md](incoming-mail.md) for Email settings, IMAP/POP3, private cloud storage, the paired local connector, offline reading and proxy inbox views.

## iOS release automation

`api/utils/releases/iosRelease.ts` uses the existing admin integration secret,
claim and audit stores. `iosReleaseCore.ts` validates the fixed release policy and
Apple bundle. GitHub OIDC grants only `integrations/ios-release` access after
immutable repository/owner, main workflow, event and source checks; it grants no
admin session or general vault access. See [setup and acceptance](../ios-automatic-testflight.md).

`userVaultIntegrity.ts` runs from the shared ordinary Thing mutation recorder,
inside its content transaction, so generic and dedicated account Vault writes
share environment validation and the owner Timeline-folder concurrency fence.
`userVaultIntegrity.test.ts` covers the invariant; the opt-in
`local-workspace/providerIntegrity.api.test.ts` reproduces the former generic
delete bypass and verifies real API rollback and concurrent membership changes.
Versions: `api.things` 1.34.1, `api.lopu-vault` 1.3.1. No account sync sender is
enabled by this correction.


`userVaultWrites.ts` now uses canonical create/update/delete utilities and protected
Timeline effects for exact-write acknowledgments (`api.lopu-vault` 1.4.0).
`routes/api/v1/lopu/vault/write.ts` admits only current full sessions with the
expected owner, exact same origin and selected plane. `providerVault.ts` freezes
an encrypted request before transmission; `providerTransport.client.ts` negotiates
the write contract and independently fences each request. `providerSync.test.ts`,
`userVaultWriteReceipt.test.ts`, the route tests and the opt-in
`providerWrites.api.test.ts` cover these boundaries. Account Settings now binds the retained account scope even when offline root
identity has `user:null`. `AccountProviderWorkspace.tsx` owns independent pull/
push workers and exact-snapshot review; `VaultReveal.tsx` offers explicit retention
after scoped fresh proof (`api.vault-reveal` 1.3.0).
See [the write checkpoint](../local-workspaces.md#conditional-account-provider-writes--2026-10-17).

Provider conflict review and account Settings acceptance: `providerReview.test.ts`
checks atomic dependent copies/discards, quota, stale reviews, cross-tab winners
and unknown outcomes. `providerReview.api.test.ts` and
`accountProviders.browser.test.ts` are opt-in loopback fixtures with normal API
registration and entry cleanup. They do not grant broader native, multi-account
race, CI or deployed acceptance.

Password migration coverage and encrypted file lifecycle: `passwords/onePassword.ts`,
`transfer.ts`, `fileCrypto.ts`, `files.client.ts`, `backup.client.ts`, and
`api/utils/passwords/files.ts`. Every original 1PUX member is retained as an
encrypted attachment to a source archive entry; item editors preserve structured
values, source context and password history. See [the password contract](../password-manager.md).

### Anonymous password files and shared archive storage

`passwords/storage.ts` is the explicit backend contract for the existing
attachment UI and 1PUX writer. `local-workspace/passwordFiles.ts` supplies the
anonymous device adapter, using canonical encrypted frames, encrypted metadata,
scoped IDB chunks, atomic completion and parent-delete cleanup. Incomplete
staging expires after 24 hours on a subsequent upload; completed files do not
expire. The normal anonymous importer/exporter has no HTTP fallback. Test
`passwordFiles.test.ts` and the opt-in `passwordVault.browser.test.ts` through
`test:local-workspace`. Account file retention/synchronization and larger entry
codec coverage remain outstanding; see the local workspace acceptance matrix.


Account password file deletion replay/conflict preservation: `api.passwords`
1.2.0 retains protected parent-bound cancellation receipts through canonical
attachment cleanup. `passwords/fileLifecycle.test.ts`, attachment tests and
opt-in `local-workspace/passwordFileLifecycle.api.test.ts` cover replay and owner
isolation. `passwordSync.test.ts` verifies atomic file/source-archive copies and
pending-file review after remote parent removal. Account UI activation and native
file acceptance remain open; see the [checkpoint](../local-workspaces.md#password-file-deletion-replay-and-conflict-preservation--2026-10-18).


Password entry/file-metadata device codecs use `passwords/passwordValueCrypto.ts`
and the account writer's shared `passwords/capacity.ts` ceiling. Generic provider
credential defaults remain separate. `vaultCrypto.test.ts`, `passwordVault.test.ts`,
`passwordSync.test.ts` and `passwordFileSync.test.ts` cover large-value parity,
exact export/replay and conflict copies. Aggregate workspace capacity policy and
native large-value acceptance remain open; this is not an unlimited-storage claim.


`local-workspace/storage.ts` uses browser storage capacity for IndexedDB
admission while preserving scoped atomic accounting and identity leases.
`storageTestFixture.ts` injects quota-class errors only in tests;
`storageCapacity.test.ts` verifies data beyond the removed application budgets.
`accountReadRevocation.ts` frees clean display snapshots before refusal markers
without deleting authored work. Settings shows accounted usage, not a fixed
quota. Remaining buffered adapters and native acceptance are tracked in
[local workspaces](../local-workspaces.md).

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

### Delegated editor draft storage

`local-workspace/characterDrafts.client.ts` reuses the account draft/catalog/file
services in a principal-and-actor partition. `drafts/draftClient.ts` routes a
composer’s selected Character there without changing the root account binding.
`characterRoster.client.ts` retains only selector labels; `useCharacters` keeps
remote loading fenced and uses these labels offline. Neither retained labels nor
local draft access grants remote Character authority. See `characterDrafts.test.ts`,
`characterRoster.test.ts` and the opt-in `characterDrafts.browser.test.ts`.

Character History cache separation uses optional device-only `TimelineScope.delegatedBy`
and `accountTimelineScope`, with lease-checked assembly in `timeline/localBackend.client.ts`.
`local-workspace/characterTimeline.test.ts` proves principal/actor isolation,
legacy authored-version preservation and separate branch/note/name queues.
The canonical Timeline event/receipt schema and server authority are unchanged.


Delegated content now shares `accountWorkspaceWorker` through `useApi` and
`characterDraftWorkspace`; `CharacterContentScope` owns reloadable post/History
context. `characterWorkspace.test.ts` covers actual-hook offline files/posts,
canonical History export and stale-principal refusal. The opt-in browser test
uses disposable accounts and the normal upload approval API. Remote-operation
connectivity is checked by `assertAccountSyncAllowed`; the profile transport
regression covers a disconnect during capability discovery.

### Character content navigation and selectors

`CharacterContentRoute` gates content routes against the current principal's
retained roster; `CharacterWorkspacePicker` exposes that selection in Things.
`characterContentPath` retains it only on internal content navigation.
`useApi` accepts an explicit editor actor for quick comments, preserving local
completion and the existing remote delegation checks. Anonymous display users
stay anonymous. Regressions: `characterWorkspace.test.ts`,
`thingsLocation.test.ts` and opt-in `characterWorkspace.browser.test.ts`.
