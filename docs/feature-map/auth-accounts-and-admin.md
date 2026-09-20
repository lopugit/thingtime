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
