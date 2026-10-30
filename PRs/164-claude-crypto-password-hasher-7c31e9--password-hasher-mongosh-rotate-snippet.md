# PR #164 — Crypto: password hasher + paste-ready mongosh rotate snippet 🔐

- **PR**: https://github.com/lopugit/thingtime/pull/164
- **Branch**: `claude/crypto-password-hasher-7c31e9` (from `origin/main`)
- **Areas**: `/crypto` page, `/api/v1/crypto`, rate-limit config, API docs

## What it is

`hash-password` intent on `POST /api/v1/crypto` + a Password Hasher panel on
`/crypto`: hash a password (or generate one), get the exact stored-format
bcrypt hash plus a mongosh snippet that writes it into a user. The manual
recovery path for a database you own when the emailed reset flow isn't an
option.

## Design decisions

- **Pure + anonymous + non-writing.** Hashing is a function of its input:
  no DB read, no account lookup, nothing leaked about who exists, and
  bcrypt is public. Session-gating would defeat the purpose (being locked
  out is the reason to use it). It never writes — rotating is a manual step
  the operator runs, which deliberately keeps a "reset anyone's password"
  primitive OUT of the API surface.
- **CPU is the abuse surface**, not the output → new `crypto.hashPassword`
  rate-limit key (20/min per IP). bcrypt is ~100ms/call by design.
- **Cost read back out of the hash** (`$2b$<cost>$`) instead of restating
  the constant, so it can't drift from `auth/passwords.ts`.
- **Self-verified before return** (`bcrypt.compare` against its own input):
  a hash that wouldn't authenticate can never be handed out.
- **Supplied passwords are never echoed**; only generated ones (shown once).
  Generator uses an unambiguous alphabet — these get read off a screen.
- **The snippet is the load-bearing part**: things-era users keep
  `passwordHash` INSIDE the `secure` BinData blob, so it unpacks → edits →
  repacks and `$inc`s `secureVersion` to match `mutateUserThingSecure`'s CAS
  write. A plain `$set: { passwordHash }` writes a field nothing reads —
  you'd see `modified: 1` and still be locked out. Covers the legacy store,
  reports a miss WITH the list of existing usernames, and takes collection
  names from `physicalCollectionName()` so a version bump can't produce a
  snippet that edits a frozen generation.

## Verification

21/21 end-to-end (scratchpad `hasher-test.sh`), the key case being the whole
loop: register via the real API → hash a new password → run the returned
snippet VERBATIM in mongosh → new password logs in, old one rejected. Plus
blob integrity (email/accountKind/meta preserved, `secureVersion` 0→1),
generated hashes re-checked with `bcrypt.compare` outside the endpoint,
validation, and browser checks at 1280 + 375 (no overflow).

## The "missing local lopu user" question

Investigated while verifying (Lopu asked whether a migration lost it):
**not a migration.** The local db contained ONLY current-generation `_v2`
collections — no `things`, `things_v1`, `users`, or `users_v1` to migrate
from, so there was no migration that could have dropped anything — and no
trace of `lopu` in any field. Its users were fixture accounts
(`rick.deckard`, `rachael`, `moss.gardener`, …) plus throwaway agent-test
users, day-by-day from 2026-07-21 onward. Conclusion: a local `lopu` was
never registered in this database; the real account lives in Atlas/prod.

Postscript: mid-task (2026-07-30T12:42:36Z) a `lopu` user DID appear —
registered fresh, then email-verified 4s later via the dev link
(`secureVersion` 0→1). So the local account exists now because it was just
created, not recovered.
