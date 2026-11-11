# SQLite account accounting checkpoint — 12 November 2026

The canonical `applyUserStorageDelta` entry point now consumes an explicit opaque native account/home-plane transaction capability over the real SQLite BSON collection provider. No runtime or user selects SQLite. Mongo behavior remains available and unchanged.

## Verification

From the repository root:

```sh
corepack pnpm --dir remix exec node --import tsx --test app/api/utils/documentStore/*.test.ts app/api/utils/storage/userStorageReadiness.test.ts app/api/utils/storage/storageCore.test.ts
corepack pnpm --dir remix run lint:files -- app/api/utils/documentStore/nativeUserStorage.ts app/api/utils/documentStore/nativeUserStorage.test.ts app/api/utils/storage/userStorageAdmission.ts app/api/utils/storage/userStorage.ts
corepack pnpm --dir remix exec tsc --noEmit --pretty false
```

The separate `integration-checks.json` records both canonical TypeScript gates and full Remix lint: zero errors and 372 lint warnings. Later Electron-only changes retain their own native checks.

Observed results: **48 tests passed**, zero failures/skips/cancellations; scoped lint zero errors/warnings; raw TypeScript zero diagnostics. The receipt records all commands, their outcomes, temporary log locations and SHA-256 hashes for the four authored files plus twelve relevant source dependencies. It describes the tested source bytes, not a later commit or build. Logs were not copied: the structured receipt retains the relevant evidence without duplicate output.

Tests construct synthetic account/subscription/content rows inside module fixtures, through the real BSON collection provider. Account secure state uses the actual `buildUserSecure` helper. They invoke the actual canonical accounting function and canonical logical-byte/envelope validators against real temporary SQLite files. These are **not real API registration, sign-in, native UI or canonical Timeline acceptance**. Synthetic history rows demonstrate shared transaction rollback only.

Coverage includes exact finite quota and unlimited allowance, persisted reopen, Int32 promotion, overflow/underflow refusal, competing two-handle claims, caught-error rollback, wrong owner/plane, counterfeit/foreign/expired sessions, optional ledger timestamp, normal nullable Character metadata and unsupported-state preflight. An isolated import regression refuses SQLite loading while preserving hosted zero/sandbox/session validation behavior.

## Boundaries and remaining work

The typed collection vocabulary is explicit, not Mongo syntax or a drop-in Mongo client. It uses complete correctness-first scans rather than production index performance. String/ObjectId identity and BSON numeric-type distinctions remain explicit.

Native Character entitlement inheritance, pending deltas, reconciliation and corrupt/underflow deletion recovery are unsupported and fail closed before writable callback admission. The Mongo deletion/recovery algorithm retains its existing behavior. Native profile/provider selection, identity/subscription/session initialization, canonical Things and Timeline repositories, required query/index/migration semantics and real API acceptance remain unfinished. No credentials, persistent user data, shared runtime or production application was modified by this checkpoint.
