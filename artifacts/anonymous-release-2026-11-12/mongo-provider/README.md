# Local MongoDB alongside SQLite — 12 November 2026

User direction: retain and ship local MongoDB as well as SQLite. The existing
macOS desktop build downloads checksum-pinned MongoDB Community 8.0.34 at build
time and embeds its binary, source archive, license and third-party notices.
It is not a first-launch download. LocalRuntime selects the bundled executable
for a fresh managed profile and retains existing configured database choices.

## Actual offline API verification

`node electron/scripts/test-bundled-local-runtime.cjs` passed against the
recorded compiled Nitro middleware and bundled mongod. The disposable profile
used an authenticated loopback single-node replica set and synthetic accounts.
All account and content writes went through the normal API.

- Register and read the first account; negotiate the exact local origin's
  canonical Things capability.
- Create/read/edit a private Data Thing with API-minted identity and revision.
- Verify the second account's actual session; refuse its read/edit and anonymous
  reads. Refuse unauthenticated database access independently.
- Stop and restart both API and database; recover the session, exact content,
  privacy and second-account isolation.
- Refuse a stale revision, verify unchanged content, then delete normally.
- Deny non-fixture network access deliberately to prove this scenario works
  offline. This is an acceptance condition, not a general agent network policy.

The first attempt exposed an obsolete fixture assumption: a `node_middleware`
build does not open its own listener. The fixture now invokes the actual Desktop
`startRendererServer` socket owner in each fresh API process. No product
authentication or runtime behavior was relaxed. Packaging/lifecycle tests passed
30 checks; the socket owner's focused suite passed separately. See
[verification.json](verification.json) for exact artifact and log hashes.

## Limits

This is source-built Node/Nitro plus genuine bundled MongoDB, with a test
encryption adapter. It is not new signed Electron/OS safeStorage/UI acceptance,
nor an explicit content/ledger/history rollback test. The compiled bytes are
hashed; they are not presented as a fresh final-source packaged release.
Both fixture ports were released and its temporary profile was removed.

MongoDB bundling currently targets macOS arm64/x64. Windows/Linux packaging
and iOS MongoDB are not established by this run. MongoDB's
[supported server platforms](https://www.mongodb.com/docs/community-platform-support/)
do not include iOS. SQLite remains the in-process portable provider work; its
BSON transaction primitive is tested, but canonical API integration remains open.
Provider selection must remain explicit and profile scoped: no cloud-failure
fallback, automatic migration, or dual writes to independent databases.

## Later main integration

Main `284f73d44` (PR #1477) landed during verification. The combined password
contract stays 1.10.0 and includes the imported 1.9.1 same-site AppID correction.
Focused passkey/AppID checks pass 11 tests and canonical capability checks pass
206, with no skips. [Commands and hashes](main284-verification.json) retain their
source attribution. Earlier Mongo/native compiled-runtime receipts are not
retrospectively treated as fresh runs of this later merged source.
