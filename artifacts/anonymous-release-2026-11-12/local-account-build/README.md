# Combined local-account build — 12 November 2026

Canonical main c9e1bf9c438dc9e11da5b5072e95324e244e8c8e is integrated with the
frozen SQLite account transaction, managed-local desktop acceptance tooling and
iOS exact-key development filter fix. This build uses c039dee85 plus the recorded
merge and dirty source, not a clean-commit or production artifact.

All 5,422 scoped source hashes match before and after. Canonical typecheck and
zero-baseline ratchet pass; full lint reports zero errors and 374 warnings.
`build:web`, `verify:web`, and the genuine bundled MongoDB HTTP fixture pass.
Exact commands, source maps, artifact hashes and logs are retained here.

The compiled Nitro entry SHA-256 is
`ef8123c805272920d5ddf0e5a3d64d735c42886f7619327950d4083fecc1bd50`.
The complete native web inventory and metadata are retained. The build reports
its existing ImageMagick WASM parse warning before successful server completion;
a successful build alone does not establish every image operation.

The Mongo check uses a disposable authenticated loopback replica and synthetic
accounts through the normal API. It verifies registration, private CRUD, account
and anonymous refusals, API/database restart persistence and stale revisions,
then cleans its owned resources. Its credential-store adapter is synthetic;
actual Electron safeStorage and automatic replacement have their own app receipt.
No SQLite HTTP profile is activated, no real account is modified and no production
release is implied. The final iOS app and desktop tests must consume these exact
bytes and report their own actual outcome.
