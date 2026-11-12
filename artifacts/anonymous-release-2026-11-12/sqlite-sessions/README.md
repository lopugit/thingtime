# Canonical SQLite session persistence — 12 November 2026

The existing `createSession`, `getLiveSession` and `revokeSession` helpers now consume a typed home-session repository. Mongo remains the default; an internal scoped native repository uses the real SQLite collection provider. No API request, database failure or user input selects that repository automatically.

The canonical `test:document-store` suite passes 47 tests, including ten session regressions. These cover expiry, revocation and exact key removal, restart persistence, duplicate session identity races, independent home planes, expired/detached scopes, and hostile BSON metadata without executing getters or serialization hooks. Scoped lint and TypeScript pass. `verification.json` retains commands and source hashes.

This removes a real authentication persistence dependency. It is not registration/login API acceptance: user/vault, tier/subscription, roster, settings/rate-limit, notification, verification and outbox repositories plus explicit provider readiness remain required. Caller-owned native transactions are refused until an actual shared transaction capability exists. Expired/revoked reads fail immediately; a native TTL cleanup worker is not implemented. No account rows were seeded or existing account data changed.

The combined fresh-bundle Mongo HTTP regression is recorded separately in `../native-integration-build/`; it tests the normal Mongo path after this extraction.
