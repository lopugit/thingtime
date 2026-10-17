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

See [password-manager.md](../password-manager.md). `api.passwords` 1.0.0 is a
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
never create account commands. The account queue format is prepared but its
transport and account UI remain unfinished; existing account Vault still uses
its authenticated API and fresh selected-value reveal.

`providerVault.test.ts` covers atomic group membership, replay, quota, lock and
corruption. `providerVault.browser.test.ts` is the opt-in actual offline Settings
fixture. `userVaultModel.test.ts` and `userVaultEnvironment.test.ts` cover shared
validation and rejection of malformed replacement tokens (`api.lopu-vault`
1.2.1). See [local provider setup and verification](../local-workspaces.md#anonymous-provider-vault).
