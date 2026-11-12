# Canonical native identities — 12 November 2026

Canonical user creation and identity reads now consume an explicitly scoped native
repository alongside sessions. Existing Mongo/legacy selectors and projection stay
unchanged. A session-only native scope or unsupported user operation cannot borrow
Mongo authority. Native identities preserve canonical self-owned user envelopes,
protected hashed uniqueness and ordinary user projections.

The shared Things definition covers general shareId and protected uniqueKeys;
identity and canonical storage accounting coexist on the same provider and reopen.
Batch identity reads use one transaction/scan and preserve deduplication/order;
OR evaluation still scales with stored rows times requested keys, so this is not
an indexed-query performance claim.

The document-store suite passes56 tests, including nine new identity regressions.
Raw TypeScript and scoped lint pass with0 errors/warnings. The receipt identifies
exact source and commands. This is repository/real-file evidence, not normal HTTP
signup acceptance. No new API/provider selection is activated.

Remaining canonical chain: signup-wide transaction and tier/subscription creation,
vault binding, notification/verification outbox, account roster, normal session
resolver subscription/Character checks and explicit Nitro readiness. These must
operate coherently before the runtime can claim a working SQLite account API.
