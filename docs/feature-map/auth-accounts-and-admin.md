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

### Third-party account library

`/connections` is the service/subservice catalog and account manager. The native
provider boundary is `api/utils/connections/{providers,oauth,connections}.ts`;
`tokenVault.ts` and `lopu/userVault.ts` use the shared account-key envelope. Public sources
retain shared accounts; authenticated grants are separate Things per owner.
OAuth uses a deployment env callback, session binding and one-use nonce; refresh
is serialized with a home-database lease. `connections/request` exposes only
fixed, scope-checked operations and never returns credential material.
Its 1.1.1 contract preserves complete API payloads and forwards opaque
`pageToken`/`data.nextPageToken` cursors for Google lists. The bounded logging
redactor is not an API serializer. Token redaction operates on string values
and property names, preserves typed scalars and JSON syntax, and removes
overlapping tokens in full without rewriting generated replacement markers. Fixed-target requests reject cross-origin
redirects and propagate cancellation; ordinary key/value fields are data.
OpenAI API/Claude Code OAuth cards reuse `lopu/vault`, keeping Lopu's selectable providers
and Secure Vault as the same records. See README's third-party setup section
and TESTING's multi-account, callback, rotation and cache isolation checklist.

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

See [password-manager.md](../password-manager.md). `api.passwords` 1.1.0 is a
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
