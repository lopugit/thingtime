# PR #790: signup invitations with gifted credits

[Pull request](https://github.com/lopugit/thingtime/pull/790) · branch
`codex/gift-credit-invites` · 2026-09-13 · Codex (AI)

Personal users create one-use links in Settings → Lopu with a gift reserved from
their existing credit balance. The recipient can replace the suggested avatar,
display name and username and only needs a password. Optional email retains
verification and password recovery.

Creation, claim and refund use home MongoDB transactions. Claim is part of the
canonical account and subscription creation transaction and cannot create two
accounts from one link. Active billed turns block gifting; billed turn reservation
rechecks positive balance to avoid racing the last available credits. Failed
ledger writes roll back. Invited accounts receive no extra starter grant and no
new administrator, upload or Lopu-verification privileges.

Tokens have 256 bits of entropy, appear in link fragments and are stored only as
hashes. The signup page retains the fragment until successful navigation so
refreshes and root-data remounts work; it never saves it as an auth return-to hint.
The management list always includes all open reservations plus 30 recent closed
invites. Terminal records drop private suggestions and token hashes. Avatar
uploads are moderated, metadata-stripped 128px JPEG thumbnails capped at 16 KiB.
They use the canonical profile avatar field without opening general uploads.

Unused links expire after 30 days. Cancellation and expiry return credits once.
An hourly CRON_SECRET-protected Vercel route processes 50 expired reservations per
run; owner reads also settle expiry. Its home-only partial index has no TTL, since
records must not be deleted before the refund. Existing collection index-budget
tests include this index.

Contracts: `api.auth-invites@1.0.0`, `api.auth-invites-expire@1.0.0`,
`api.auth-register@1.2.0`, `api.lopu-chats-reply@1.7.1`.

Validation after integrating main `8c1be369f`:

- Full `test:unit` and production `build` pass.
- 15 focused invitation tests cover amount precision, hashes, privacy, moderation,
  transaction rollback, refunds, replay, capacity, history visibility and routes.
- Authentication API read-only suite: 25/25 passed. Live disposable API accounts
  prove password-only signup, edited profile/avatar persistence, fresh login and
  concurrent redemption (one 200, one 409), with replay denied. Positive gift
  conservation and rollback are covered by transactional unit fixtures; live QA
  used zero-credit invites.
- Desktop 1280px and mobile 390px browser checks cover recipient prefill, photo
  removal/replacement, profile editing, refresh, centered layout and full scrolling.
  Settings creation/link/cancellation controls were inspected on both sizes.
  Chrome initially worked but extension control became unavailable; final
  responsive checks used the in-app browser. New-password submission was tested
  through the API.
- The built Vercel handler returns 200 for both capability manifests with the new
  registered invite, expiry and signup contracts. TypeScript has 106 pre-existing
  diagnostics, below the configured baseline of 108.
- Graphify structural and semantic refresh completed through the repo CAS wrapper.
  Its extractor reported a pre-existing-style patTokens cross-chunk identifier
  collision; source inspection and tests remain authoritative for that area.

Local validation: [localhost](http://localhost:11000), API 11002, HMR 11001.
Tailscale/Funnel could not be verified: its installed wrapper targets the missing
Tailscale application. Production/preview deployment and exact merge SHA evidence
are reported on the PR rather than freezing an outdated deployment in this note.
