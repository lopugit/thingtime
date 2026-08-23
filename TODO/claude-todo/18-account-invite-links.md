# 18 — Account invite links with optional profile prefill 🔗

**Status:** 🔴 Not started · requested 2026-08-22.

## Goal

Let a signed-in Thingtime user generate a unique URL that invites another
person to create an account. The inviter may optionally suggest the new
account's username and public profile, while the recipient always reviews and
can change or remove every suggested value before registering.

The optional prefill maps to the existing account/profile contract:

- username → `username`
- profile name → `displayName`
- description → `bio`
- profile image → `avatarUrl` or a managed profile attachment
- banner image → `bannerUrl` or a managed profile attachment

Email, password/passkey, consent, and verification remain the recipient's own
inputs. An invitation must never create an account in the background or let an
inviter control the resulting account.

## Product flow

1. A signed-in user opens **Invite someone** and chooses **Generate unique
   link**.
2. They can leave every profile field blank or add any combination of the five
   supported suggestions.
3. Thingtime returns one copyable, opaque invite URL and shows its status,
   expiry, and a revoke action to the inviter.
4. Opening the URL shows who sent it and a registration form populated with
   the still-editable suggestions. No account or profile data is encoded in
   the URL itself.
5. The recipient supplies their own email and authentication credentials,
   accepts the current terms, reviews the profile, and submits through the
   normal registration path.
6. Successful registration consumes the invite exactly once and lands the new
   user in the ordinary signed-in onboarding flow. An expired, revoked, or
   already-used URL gives a friendly Lopu message and a path to regular signup.

Nice-to-have follow-up: let the inviter see `pending`, `redeemed`, `expired`,
and `revoked` invitations without exposing the recipient's private signup data.

## Architecture and data rules

- Add a protected `account-invite` Thing written only through dedicated invite
  API utilities. It should carry bounded lifecycle metadata and the inviter's
  `ownerId`; prefill values and token material must not become searchable
  generic Thing fields.
- Generate a cryptographically random, high-entropy token server-side. Put only
  that opaque token in the URL fragment (for example `/invite#<token>`, so it
  is not sent in the initial HTTP request), store only its hash, compare it in
  constant time, and support explicit expiry, revocation, and single-use
  consumption.
- Whitelist and validate the five prefill fields with the same length, URL, and
  profile-media rules used by `auth/users.ts` and
  `users/profile/_profile.tsx`. Treat every suggestion as untrusted input and
  never render supplied HTML.
- Use the existing profile attachment contract for managed avatar/banner
  media. A redeem must not bypass upload permissions, moderation, storage
  accounting, attachment ownership, or exact `profile` + `avatar`/`banner`
  binding. Linked HTTPS image URLs remain bounded metadata and are never fetched
  by Thingtime just because an invite contains them.
- Extend the canonical `registerUser` / `createUserAccount` path rather than
  creating a parallel account writer. Invite consumption and account creation
  must be transaction-safe and idempotent so concurrent redeems cannot create
  two accounts or burn a valid invite without creating one.
- A suggested username is not silently guaranteed. Re-check uniqueness at
  redemption and keep the form editable if it has become unavailable. Do not
  reveal whether protected/admin-reserved usernames exist.
- Register every new `/api/v1/...` route through the route file, Nitro import
  map, and `apiEndpointDocs`, and use size-capped JSON readers plus the shared
  rate-limit system.

Likely API surface (names may be refined during implementation):

- `POST /api/v1/invites` — create an invite for the current user.
- `GET /api/v1/invites` — list the current user's bounded invite history.
- `POST /api/v1/invites/revoke` — revoke one owned pending invite.
- `POST /api/v1/invites/resolve` — accept the fragment token in a size-capped
  JSON body and return only the safe inviter label, editable prefill, and
  lifecycle state.
- `POST /api/v1/auth/register` with an optional invite token — validate,
  register through the one account path, apply accepted profile values, and
  consume the token.

## Privacy, safety, and abuse controls

- Set `Referrer-Policy: no-referrer` on the redeem experience and avoid
  third-party resources there so the bearer token does not leak through
  referrers. Never log the raw token or include it in analytics/error prose.
- Rate-limit invite creation and redemption, cap outstanding invites per user,
  and make invalid/expired/revoked responses non-enumerating.
- The recipient must be able to discard every suggested field. Clearly label
  the values as suggestions from the inviter, not values verified by Thingtime.
- Invite prefill cannot grant admin status, upload permissions, storage
  allowances, email verification, app scopes, friendships, chat membership, or
  any other privilege.
- Revoking an invite prevents future redemption but does not delete or alter an
  account that already redeemed it.

## Done when

- A user can generate two invites and receives two different URLs; neither URL
  exposes the prefilled values.
- Every combination of omitted/present username, display name, bio, avatar, and
  banner round-trips into an editable registration form and applies only the
  values the recipient accepts.
- Registration still uses the real account API and preserves email
  verification, session creation, subscription/storage setup, and upload
  permission defaults.
- Single-use, expiry, revocation, concurrent redemption, username collision,
  tampered token, body-size, rate-limit, and privilege-injection tests pass.
- API responses, logs, browser history beyond the opaque URL, and analytics do
  not expose token hashes, credentials, private signup data, or rejected
  prefill values.
- Desktop and mobile browser checks cover create/copy/revoke, valid redemption,
  edited prefill, and every invalid-link state with notifications through Lopu.

## Existing anchors

- `remix/app/api/utils/auth/registerUser.ts` — the single account creation path.
- `remix/app/api/utils/auth/users.ts` — profile fields, projections, uniqueness,
  and profile-media rules.
- `remix/app/routes/api/v1/users/profile/_profile.tsx` — the current profile
  mutation contract.
- `remix/app/api/utils/attachments/` — managed profile attachment binding and
  storage accounting.
