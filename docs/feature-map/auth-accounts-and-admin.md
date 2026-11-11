# Auth, accounts and admin

## Connector confirmation preferences

`settings/connector-protections` exposes private current-account preferences.
GET permits a full account or active Things PAT; POST requires a full owning
account, matching `X-Thingtime-Expected-Actor`, JSON and the canonical public
origin. Scoped connector credentials cannot change their own confirmation
policy. Private account metadata stores partial boolean patches; absent fields
are enabled. The connector rereads effective rules when applying, while all
normal authentication, authorization and revision checks remain in force.

MongoDB connection inventory: `/admin/mongodb-connections` and Settings → Admin
share `Admin/MongoConnectionInventory.tsx` and individually editable
`mongoConnectionInventoryBlocks.ts` through `SettingsDocumentHost`.
`GET /api/v1/admin/mongodb/connections` requires the current administrator,
returns a private allowlisted projection, and negotiates
`api.admin-mongodb-connections` 1.1.0. `mongodb/connectionTracker.ts` instruments
the canonical cached clients; `mongodb/connectionInventory.ts` owns request-bound
snapshot publication, pagination and optional aggregate diagnostics. Deployment
cards distinguish recent application sockets from modeled monitoring overhead,
and show allowlisted request-feature use without per-user or command data. See
[the contract](../mongodb-connections.md) and TESTING.md's inventory checklist.

Auth is an httpOnly cookie carrying a signed JWT (`jti`/`sub`/`exp`) plus a
revocable Mongo `sessions` document; Bearer tokens (PATs, service accounts,
app tokens) serve API clients (`FUNDAMENTALS.md` §5). Identity and control-plane
data stay on the home data plane. Replacing or removing a browser account
cleans its unbound browser drafts. Durable file-sync reservations remain
subject to their own live browser, device and run checks and expiry.

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

Native mobile background authority is watched by `mobileDeviceIdentity.ts`,
mounted outside the optional polling activity in `MobileDevicePresenceBootstrap`.
Identity/unmount withdrawal cancels scoped in-flight native authorizations while
retaining opt-in; one read-only status can resume the same verified identity.
Ordinary visibility hiding does not withdraw an authorized location session.
Run the Devices identity/presence/location bridge tests and the native location
scope regressions; see `TESTING.md` for activity-disabled logout/relogin checks.

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

The same Thingtime MCP uses per-tool OAuth scope challenges for independent
permissions. `chatgpt/plugin.ts` validates the exact same-origin browser
principal, records a one-use scoped consent, and mints a reporting PAT only
after matching code and PKCE exchange. Refresh preserves the consented scope
and checks that the backing PAT is still live. See [reporting](../agent-reporting.md).

`components/Account/AutoLoginPopup.tsx` starts browser-native FedCM on signed-out
foreign origins. `ssoHub.ts` selects the explicit data authority before deployment
metadata; its built-in origins in `ssoHubOrigins.mjs` are shared with the application
`scripts/csp.mjs` policy. `test:vercel-config` verifies those exact origins in the
emitted Vercel header. Custom client hub overrides do not grant CSP permission.
The password extension forwards non-WebAuthn identity requests unchanged; its
`test/fedcm-pass-through.test.mjs` covers success, refusal and disabled opt-in.

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

Native authenticator link intake: shared Swift `AuthenticatorSetup.swift` and
`Host/AuthenticatorSetupBridge.swift`; macOS `PasswordSetupEditor.swift`; iOS
`WebView.swift`. The narrow native bridge 1.0.0 requires compatible `api.passwords`
1.2+ and verifies current home-plane owner, origin and document before transient
one-use delivery. `PasswordAuthenticatorSetup.tsx` composes editable
`PasswordWorkspaceControls` setup blocks into the existing controlled draft;
Save remains the canonical encrypted-vault operation. No new API route or scope.
See `password-manager.md` for packaging, separate sign-in and acceptance, Swift
`AuthenticatorSetupTests`, web `authenticatorSetup*.test.ts` and the isolated
`test-authenticator-setup-ui.mjs` browser regression.

The controlled `ThingFields.tsx` password rows opt into `CopyPasswordButton.tsx`
only for non-passkey manager entries. Copy uses an already-authorized draft and
browser Clipboard API with secret-free inline status; it never reads clipboard
contents or logs/notifies the value. `scripts/password-copy.browser.html` checks
exact synthetic writes, rejection/unavailability, masking and stale completions.

`PasswordGenerator.tsx`, `PasswordIcon.tsx` and `PasswordPasskeySetup.tsx` compose
editable settings blocks; secret output stays in the controlled entry draft.
`passwords/generator.ts` owns WebCrypto/preset validation. `passwords/icons.ts`,
`icons.client.ts` and `api/utils/passwords/icons.ts` own descriptors, anonymous
image loading and the separately sealed list projection. `test:passwords` covers
these boundaries; `scripts/password-tools.browser.html` is an isolated synthetic
UI fixture, not native-provider acceptance.

See [password-manager.md](../password-manager.md). `api.passwords` 1.8.0 is a
private, session-bound home-plane API over protected `password-manager-entry`
Things. `api/utils/passwords/passwords.ts` owns accounted mutations, revision
fences and secret-free native catalog projections; `auth/vaultEnvelope.ts` and
`vaultKeys.ts` own password/session/recovery key wrapping. `passwords/client.ts`
intentionally bypasses general request diagnostics and automatic origin fallback
so decrypted fields never enter shared client history/cache. The reusable
`Thingtime` fields mod renders the entry without global Thing persistence.
`passwords/model.ts` resolves explicit login identifiers for previews, the catalog
and protected fill while excluding imported hidden values and descriptions.
`passwords/browserPasskey.ts` validates RP/origin/options and implements ES256;
`browserProviderCeremony.ts` owns policy-checked `verify-passkey`, catalog selection,
retry identity and durable readback. Once a sign-in choice is selected, approval
reads only that exact credential before and after signing. Registration still
checks the current catalog for site exclusions before saving. `BrowserPasswordProvider.tsx` serves
`/passwords/provider` with editable `browserProviderBlocks.ts`. Chromium transport
and trusted tab/document checks live in `browser-extension/`. The shared
captured target in `content-vault.js` covers form-owned inputs and standalone
sign-in steps, with field identity and action checks before preparation and
delivery. Package with
`build:password-extension`, test with `test:password-extension` and
`test:passwords`. Browser acceptance must use the real local API/vault and an
independent relying party; unit signatures and synthetic UI alone are insufficient.
`Settings/passwordManagerSettingsBlocks.ts` and `PasswordManagerSettings.tsx`
share `/settings/passwords`; Thingtime login passkeys remain in Security.
The browser adapter workspace's bounded per-document diagnostic handshake reports
installed/current hooks, observed opt-in and closed fallback reasons. `content.js`
projects page events before runtime transport; the background fences the active
document and accepts diagnostic reads only from its own popup. These are untrusted
status hints, not authority or ceremony evidence; no request or identity fields
are retained. Browser tests cover missing/replaced hooks, redaction and navigation.

`passwords/websites.ts` supplies shared bare-host-to-HTTPS normalization for
catalog hints and exact-origin fill verification. The `api.passwords` 1.8.0
AWS sign-in allowlist adds one exact login destination for the three known
first-party AWS website origins; catalog and protected fill use the same rule.
The browser fill client
requires `api.passwords` 1.6.1; URL normalization is not an authorization grant.
Extension 0.4.1 keeps the chooser inside active modal focus/accessibility scope
and gives explicit website-reload recovery after extension replacement.
`password-autofill-modal.browser.html` is a synthetic modal/runtime fixture;
real signed-in fill and extension reload remain distinct acceptance checks.

`NativePasswordConnection.tsx` and `nativePasswordConnectionBlocks.ts` supply the
single editable device connection control shared by Password manager and Passwords
settings. `nativeConnection.ts` owns ephemeral status, refresh and identity fences;
`native.client.ts` requires desktop `passwordsVersion` 1.1.0. Electron's
`password-provider.cjs` calls the read-only host `--status` path, backed by
`PasswordConnectionStatus.swift` owner/origin linkage. Status does not probe the
network or assert OS AutoFill enablement. Bridge 1.2.0 reports local-origin
incompatibility explicitly. `HostConnection.swift` gates automatic initial linking
on OS provider enablement and an account/origin opt-out; matching links renew while
foreign or independently linked companion connections stay untouched. The native
host verifies the live catalog before saving and fences concurrent link changes.
The canonical Electron installer updates the standalone and nested provider together. Older bridges require an app update;
this checkout's iOS web-only path has no native-password bridge.
Native provider implementation lives in `apple/Passwords` and
`apple/PasswordProvider`. `ProviderFeedback.swift` owns closed progress/error text,
request fencing and immutable registration retry identity; `PasswordClient.swift`
classifies HTTP failures and walks complete cursor-based catalogs. The provider
controller starts registration once after OS selection when its view is visible,
preserving device authentication, cancellation, retry and session fences. The macOS host
and provider display Thingtime while retaining installed bundle/Keychain identities.
Packaged metadata verification rejects old branding and mismatched host/provider
versions. The passkey guide puts the native macOS provider before the optional
browser adapter, and exact-default migration preserves authored guide blocks.
`IdentityIndexTests.swift` verifies passkey discovery without password URL fields
and prevents treating ordinary password entries as passkeys. `CatalogSelection.swift`
owns the real chooser filter; assertion requests require an exact RP and allowed
credential ID and cannot fall through to password/OTP website matching.
Empty assertion results expose an ephemeral **Request details** disclosure with
the actual requested site and count-only selection summary, never credential or
account/session values. Its counts use the same decoder and matching rules.
Run `swift test --package-path apple/Passwords` and
`bash apple/PasswordProvider/tests/render-preview.sh`; the latter renders the
actual SwiftUI view with synthetic status only. Signed packaging and real device registration/sign-in
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

OpenAI environment-to-vault import uses `credentialVault.ts::importConfiguredOpenAiCredential` through the existing admin credentials route and `PlatformCredentials.tsx`. It is same-origin, admin-only and create-only; `api.admin-ci-credentials` 3.1.0 is negotiated before use. The sole source is server `OPENAI_API_KEY`, and the destination is `OpenAI` / `OPENAI_THINGTIME_API_KEY`.


## Local ChatGPT plan connections

Desktop remote mode verifies the active Electron account session against its
exact HTTPS account API, then uses the same loopback OAuth runtime with Electron
Safe Storage. `desktopAccountAuthority.ts` fences owner and origin; device plan
IDs cannot resolve to a hosted credential. The normal production account and
managed local API modes remain separate. See README for the device text path.

`ai/chatgptPlanProtocol.ts` validates dynamic registration, JWT identity, scopes, rotation and Responses restrictions. `chatgptPlanRuntime.ts` owns protected local credentials, loopback callbacks, one-use attempts, account/session/origin fences and per-account cancellation. The authenticated `ai/chatgpt-plan` route publishes redacted state only; `Settings/ChatGPTPlanSettings.tsx` negotiates its capability. Model discovery and Lopu use the existing provider path with strict saved plan pins and no billing fallback. See README ChatGPT plan usage, TESTING and `test:chatgpt-plan`. `chatgptPlanStorage.ts` encrypts owner/origin-scoped records in the account MongoDB and fences its single refresh authority. `chatgptPlanTransfer.ts` seals explicit moves to a destination-owned key. Electron `local-runtime.cjs` manages optional authenticated local Mongo and generated OS-protected secrets; API switching uses separate sessions and restart.
## Characters

Private MCP task delegation uses `api/utils/agents/reporting.ts`, the independent
`agents.report` PAT scope, and `/api/v1/agents/reporting`. It revalidates the owner,
Character, exact private workspace references and subspace membership. Protected
binding/operation Things fence duplicate and ambiguous writes; the executor's
server-only operation policy constrains saved Actions. See
[setup, recovery and acceptance](../agent-reporting.md).

See [Characters](../characters.md) for the settings, login modes, private ownership,
admin lookup, session selection, agent coordination and acceptance runbook.
`characterCore.ts`, `characterSession.ts`, `characters.ts` and
`characterEntitlements.ts` extend the existing home-plane user/session/ledger paths.
`resolveSessionUser` defaults to the authenticated principal for roster and
credential callers; request authentication passes an explicit selection (or null
for the session default). Never re-mint a principal session with an acting user ID.

## Account storage recovery

`storage/userStorage.ts` owns transactional admission and exact recovery;
`storagePending.ts` validates the requested 100 MiB gross positive queue budget.
`userStorageRecovery.ts` owns protected durable jobs, leases and bounded retries.
The dispatcher triggers recovery after mutations; the existing protected
`lopu/recordings/run` scheduler resumes it independently of provider jobs.
`userStorageReadiness.ts` verifies ledger and source readiness. Run `test:storage`,
`test:storage-recovery`, `test:error-logs`, `test:api-capabilities` and the
replica integration. See [storage recovery](../storage-recovery.md).

## Preview retention and PR liveliness

`Admin → Preview retention` (`/admin/preview-retention`) and Settings → Admin
share `Admin/PreviewRetentionSettings.tsx` and `previewRetentionSettingsBlocks.ts`.
`SettingsDocumentHost`/`accountSettingsDocumentAdapter` save the private block
layout through the existing Things API; `WebpageBlocksRenderer` supplies nested
Builder selection and `TransientBlockHost` binds ordinary controls to scoped
policy handlers. No opaque form slot or saved credential is used. Layout edits
pause live operations and use the existing revision fence.
`GET/POST /api/v1/admin/ci/preview-retention` requires the current admin and
negotiated `api.admin-ci-preview-retention` 1.0.0. `ciControl/previewRetention.ts`
reads the home settings singleton afresh and saves with a revision comparison;
concurrent edits return 409. The signed, read-only controller endpoint is
`POST /api/v1/integrations/ci/preview-retention`, capability
`api.integration-ci-preview-retention` 1.0.0. `previewRetentionCore.ts` owns
validation and safe defaults. Both manifests derive these explicit versions
from `apiDocs.ts`; Nitro imports register both executable routes.

The protected `github-actions` controller consumes the saved policy. It preserves
deployments if policy discovery, authentication, reads or validation fail.
The product API must roll out to the selected gateway origin before enabling the
new policy reader; a UI-only preview forwarding to the old gateway cannot prove
the new backend. See README “Preview cleanup policy” for defaults and rollout.
Run `test:ci-control` (including the retention block-tree regression), `test:api-capabilities`, and Admin route tests. Manual
coverage: TESTING.md “Preview retention and PR liveliness”.

## Gift invites

`Invites/InvitePanel.tsx` uses the shared `InviteProfileFields` with optional
creator suggestions. `inviteCore.ts::inviteProfile` validates supplied suggestions;
`invites.ts::createInvite` accepts omitted or blank names/usernames. The recipient
chooses their final profile in `InviteSignup.tsx`; `prepareInviteSignup` still
requires a valid final name and username, supports legacy suggested defaults, and
never lets suggestions override explicit recipient input. `api.auth-invites` 2.2.0
advertises optional creator fields and the client negotiates that minimum.
`test:invites` covers empty suggestions, recipient choice and escrow/replay safety.

Browser workspace window ownership and captured website targeting live in
`browser-extension/workspace.js`; `popup.html`/`popup.js`/`popup.css` provide the
local extension capability UI. Toolbar clicks open/focus a single resizable
window; Config persists appearance independently of credential routing. Diagnostics
return an atomic origin/status pair, recheck the captured tuple and ignore older
UI generations. `workspace.test.mjs` covers ownership/settings/races;
`workspace-browser.mjs` exercises actual isolated Chrome windows and rendered tabs
without real credentials. Package with `build:password-extension`.

Registration policy and count-only diagnostics live in
`PasskeyRegistrationPolicy.swift`; native excluded matches are terminal and
return `matchedExcludedCredential` after explicit Return to website. Browser
`BrowserPasskeyExcludedError` is the only terminal exclusion category;
`browserProviderFailure` fences older operations while network errors retain
retry. Cached registration attempts recheck exclusions before each write.
`test:passwords:record-storage` reuses the disposable replica runner's
`--password-records` mode and production API handlers to verify independent
same-account vault records and owner/readback/retry boundaries; it makes no
same-authenticator discoverable-credential claim.

Password branding: `passwordBrandingBlocks.ts` supplies individually editable
decorative tree blocks and heading-preserving migrations; `PasswordBrandMark.tsx`
serves framework headers. Extension manifest/action icons and native host/appex
ICNS/PNG resources derive from the canonical branding assets. Coverage:
`passwordBranding.test.ts`, extension `branding.test.mjs`, native metadata tests,
renderer gallery and optional actual-provider Chrome fixture in
`workspace-browser.mjs` (synthetic API boundary, real component/action routing).

Password confirmation preferences: `passwords/verificationPolicy.ts` owns the
closed duration/context policy; `api/utils/passwords/verification.ts` owns
protected device proof and request/session/entry fences. `api.passwords`1.5 and
account-registration1.2 are negotiated by the new clients. Shared editable
`PasswordVerificationSettings.tsx` appears in the manager, Password manager
settings, Security, and explicit fill approval. `PasswordPreviewList.tsx` provides
editable safe username cards. See [the contract](../password-verification-preferences.md),
`test:passwords:verification`, `test:passwords:verification-ui` and TESTING.md.


## Social OAuth connections

Linux/Windows native password delivery: `electron/lib/native-passwords` owns
OS-encrypted connection/retry state, task scope and private IPC; the shipped
`password-agent.mjs` negotiates `native.passwords` 1.0.0. Browser delivery uses
the shared isolated Chromium driver and exact-document checks. The existing
editable fill approval returns only a per-request proof to a sender-bound native
window; vault `fill` remains protected by the entry verification policy.
`api.passwords` 1.7.0 adds exact catalog `origins` for metadata-only discovery.
macOS Apple provider behavior remains separate. See
[contract and runtime checks](../native-password-agent.md).

`connections/oauthConfig.ts` resolves fixed encrypted platform-secret labels by
exact origin and data environment. `oauth.ts` binds single-use state to the live
session/client/callback; `connections.ts` transactionally stores owner-scoped
accounts and `tokenVault.ts` encrypts their grants through the existing account
vault. Shared legacy credentials require reconnect, preserving the caller's link
ID. `namedConnections.ts` stores independent owner/link-bound envelopes in
`external-auth-connection` rows beneath the canonical account identity. Named
rows never confer legacy feed or cached source access. `oauth.ts` keeps the
private label in the server-side intent and signs the request identity. The
`connections/named` operation dispatcher gates the exact selected grant and
returns allowlisted results. `NamedConnectionPanel.tsx` and
`namedConnectionBlocks.ts` provide editable profile controls and selection.
Public-source sharing remains intact. Google identity/service cards and
Facebook identity/posts cards select separate grants. `ConnectionsPage.tsx` opens
sign-in in a user-initiated tab and `oauthTab.client.ts` removes the opener
before provider navigation. The existing callback route verifies the live
session and saves the grant. A tab-local random channel sends a same-origin
refresh hint, and the initiating page reloads its authorized list. Connections
and filter caches are scoped to owner, API origin and data plane. An identity
change retires in-flight reads and their visible state. `oauthPendingBlocks.ts`
defines the independently editable status and Stop waiting control through the
shared settings document host. Native hosts retain their original external
navigation handoff. Run
`test:connections`, `test:connections:oauth-tab`, and `test:api-capabilities`;
see README social OAuth setup and TESTING acceptance.

Browser extension accounts: `BrowserExtensionAccountBridge.tsx` projects the
canonical `api.auth-accounts` roster into the selected first-party document;
`BrowserExtensionAccounts.tsx` reuses Login and AccountSwitcher in an owned popup.
`browser-extension/accounts.js` binds discovery to origin, document and identity
generation, clears stale catalog/requests, and preserves explicit local Lock.
No session cookie or token crosses the bridge. See
[extension accounts](../browser-extension-accounts.md), extension account/content
regressions and `password-extension-accounts.integration.ts` for real API and
isolated browser acceptance.

Password website icons: `api.passwords` 1.6 adds `website-icon` for an exact
owner, entry and revision. `api/utils/passwords/websiteIcons.ts` discovers ordered
public Website origins using anonymous, DNS-pinned fetches and PNG sanitization;
`passwords/icons.client.ts` limits concurrent requests and scopes blob caches to
origin/owner/revision. Explicit custom icons take precedence. The metadata list
exposes an availability hint, not saved URLs. Cover route authorization, revoked
sessions, redirects, malformed images, fallback order and editable-card rendering
with the password icon tests and TESTING.md checklist.

Connection provider marks: `connections/providerIcons.ts` maps built-in IDs to
public provider sites; private account values and instance URLs never enter the
lookup. The public `api.connections-provider-icon` route reuses the anonymous
DNS-pinned website-icon resolver, serves sanitized PNGs, and coalesces and caches
lookups by brand. Workspace products select their own official marks from page
metadata. Connections renders a local link mark while pending or unavailable.
The provider catalog uses a separate Settings Builder document with one editable
repeated card template. Its logo has normal upload and optional URL controls;
its Connect block calls the same scoped, synchronous OAuth gesture handler.

## Agent provider credential import

`api.credentials-import` 1.1.0 supplies a write-only admin-vault file import and
account/origin/destination-bound CLI handoff. `credentials/importContract.ts` is
the shared contract; `api/utils/credentials/{importCore,importService}.ts` own
validation and transactional one-use approval/receipt state. Browser operations
require a live root administrator cookie and exact expected actor; CLI operations
use a short-lived S256 proof. `components/CredentialImport` composes editable
settings blocks with a transient secret adapter. The existing admin integrations
view embeds direct import; `/credentials/import` is the approval page.
Version 1.1 adds a single-origin/environment OAuth client update for registered
confidential Connections labels, including Facebook. The CLI preflight checks
the selected format against the exact origin before acquiring the input file.

Run `test:credentials-import`, `test:credentials-import:browser` and the built
replica-set `test:credentials-import:acceptance`, plus capability/gateway tests.
Read [the agent credential runbook](../agent-credential-workflows.md) and the
provider-import checklist in `TESTING.md` for live account acceptance.

## Transaction-bound full-account mutation fence

`auth/fenceAccountSession.ts` is an internal home-plane composition helper. It
reuses canonical JWT/current-user resolution, requires the actual principal's
own supported full session and performs a fresh random session write inside
the content transaction. Revocation or selection changes therefore conflict;
no-op updates and caller-supplied actor IDs are not authority. The selected
ordinary-restore primitive currently refuses Character delegation and scoped
credentials; this is an explicit initial capability scope, not impersonation.
The real replica check covers wrong-account and revoked accepted-receipt retries.

## Anthropic Console connections

Secure Vault exposes the explicit `anthropic-api-key` kind alongside unchanged
`anthropic` Claude Code OAuth records. `ai/anthropicApiKey.ts` creates the native
Messages SDK with only the selected owner credential; `lopu/vaultProviderClient.ts`
applies the existing host/DNS/redirect fences and `lopu/chat.ts` reuses native tool
streaming. Console keys use separate provider billing. Save rejects setup tokens
and mode changes without a new key. No platform/admin credential is migrated.
Run `anthropicApiKey.test.ts`, `userVaultCore.test.ts`, `vaultProviders.test.ts`,
`voice.test.ts`, `chat.streaming.test.mts`, `completion.test.ts` and capability
coverage. Live Console inference and installed-native acceptance remain separate.


## Named Google service reads

`connections/googleServiceActions.ts` extends the shared named-operation catalog;
`api/utils/connections/googleServiceRequests.ts` validates fixed service/resource
requests and redacts exact credentials from complete results. The existing
`useNamedConnection` path retains owner/origin/environment, exact-grant refresh,
scope and post-read revocation fences. `NamedConnectionPanel` and its editable
block template expose resource IDs and opaque next-page actions. Existing grants
do not acquire operations automatically. See [service actions](../google-service-actions.md),
`namedServiceActions.test.mts`, `googleServiceRequests.test.ts`, and the existing
isolated OAuth-tab UI fixture. Provider consent/data acceptance is separate.
Connections access inspection: `GET /api/v1/connections/diagnostics` negotiates
`api.connections-diagnostics` 1.0.0, requires an exact connection and expected
owner, and uses registered provider `diagnose` adapters only. The service checks
owner, saved OAuth binding, selected origin/environment and unchanged encrypted
grant before and after probes. It never refreshes or persists. Facebook returns
actual grant names or unknown and separates minimal posts from engagement fields.
Connections 2.2 exposes requested/confirmed grant evidence; callbacks 2.1.1 verify
both default and named Facebook grants. Run `test:connections`, capability tests
and compiled Connections smoke; live provider acceptance is separate.
Personal-provider Lopu chat normalizes effort against the resolved saved model's
`providerModelFor` catalog in `userVaultCore.ts`, before metadata and SDK request
construction in `chat.ts`. Reply contract 1.23.1 preserves the selected credential
and BYO billing; Haiku 4.5's empty effort list omits `output_config.effort` rather
than mapping it to an invented thinking mode. Console SDK streaming regression:
`api/utils/lopu/chat.streaming.test.mts`; both manifest generators and personal
provider client requirements advertise the compatible reply PATCH. Voice retains
its existing strict tuning guard.

Browser passkey AppID compatibility: `passwords/browserPasskey.ts` validates the
empty/default or HTTPS same-site boundary documented by WebAuthn (PSL including private suffixes) and emits
`appid:false` for ordinary RP-bound assertions. `browserProviderCeremony.ts`
requires both frontend and active `api.passwords` 1.9.1 before AppID vault reads;
full request hashing retains AppID in the verification/session binding.
`browser-extension/page-hook.js` adapter 0.5.1 preserves input/output serialization
and delegates unsupported AppIDs/extensions unchanged. Run browserPasskey,
browserProviderAppId client, extension tests and `browser-extension/test/appid-browser.mjs`.
