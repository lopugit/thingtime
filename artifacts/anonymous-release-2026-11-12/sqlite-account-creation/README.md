# Canonical SQLite account transaction — 12 November 2026

The existing `createUserAccount` helper now creates its canonical normalized
identity, bcrypt password hash and trusted initial subscription/zero ledger in
one real SQLite transaction. An explicit native home scope selects this internal
adapter; normal hosted Mongo orchestration remains intact. No HTTP route or
native profile selects SQLite automatically.

`verification.json` records nine frozen source hashes and commands: document-store
68/68, subscription 15/15 and storage 41/41 tests, all without failures or skips;
raw TypeScript and scoped lint pass (zero lint errors/warnings). The parent
independently matched every source hash before the combined build.

Regression coverage includes duplicate races, canonical allowance rollback,
provider-local tier bootstrap, cross-profile/expired transaction handles, caught
malformed insert poisoning, scope exit before commit, and reopening followed by
canonical storage admission. Existing valid published tier bodies stay
authoritative, matching Mongo bootstrap; they are not silently replaced by
current built-in quota values. The hosted orchestration regression uses a
controlled subprocess; the fresh genuine Mongo HTTP check remains separate.

Full SQLite registration is intentionally unavailable: vault binding,
verification/outbox, notifications, roster, full entitlement resolution and
Nitro readiness still need their real adapters. Unsupported account kinds,
invites/onCreated effects and general subscription mutations refuse before a
partial account can be created. This is a completed transaction foundation,
not full offline feature parity or production acceptance.
