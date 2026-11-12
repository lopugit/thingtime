# Protected native app-shell bootstrap

Local development acceptance on 12 November 2026. The source inventory identifies
base `e603402b5` plus the exact root-data changes; this is not deployed, installed
full-UI, iOS or clean-commit CI acceptance.

The canonical `/api/root-data` now runs inside the protected SQLite account
composition. It returns the selected public data plane, null hosted dataEnvironment,
normal public app configuration and the current local session user. It never
resolves a request-selected Mongo endpoint or forwards to a remote account API.
Origin, actor, data-plane, background-work and host-lifetime checks are shared
with the ordinary native account routes. Both capability generators publish
`api.root-data` 1.2.0 only when the composition is ready.

55 root-data, 211 capability and 11 native-runtime tests pass. The fixture's four
entry/manifest guard tests pass. Full typecheck, zero-error ratchet, full lint,
canonical web build/inventory and both actual MongoDB and SQLite HTTP fixtures
pass. Inputs remain unchanged through the run. Full lint has warnings; no
warning-free claim is made.

The compiled SQLite fixture uses real macOS safeStorage, registers a disposable
account through the normal API, reads root data anonymously and with its session,
reopens a fresh Electron/API process with the same user/plane, then verifies
logout clears the user. Unsupported Things/password APIs remain refused.
No external email delivery, user-facing SQLite selector or full native UI is
claimed. Session/cookie/key values are not written to the receipt.

Compiled Nitro SHA-256: `5617e642b47a394b354effc21c3f36e0acfb00ccbdc24db421b4d25a204c058f`.

[Focused checks](focused.json) · [Compiled checks and frozen input inventories](compiled/verification.json)
· [Actual SQLite root-data/reopen receipt](compiled/sqlite-http.log)

Next: canonical content and Timeline transactions, complete product APIs, iOS
protected host integration and real device acceptance, production update trust,
and hosted agent artifact delivery remain open.

## Additional prerequisites

[Deletion accounting receipt](deletion-accounting/verification.json) records the
34 SQLite and 41 existing storage/subscription checks and the reviewed quota-credit
fix. This does not enable generic Things, Timeline or native reconciliation.
The original compiled receipt predates this additional accounting change; use the
final-integration receipt for the combined desktop payload.

[iOS checkpoint](ios-protected-profile/README.md) retains the compiled development
target and bounded simulator-control evidence. Real Keychain retention and full
account HTTP remain unverified; test and inventory evidence limitations are explicit.

## Final combined desktop checkpoint

[Final integration receipt](final-integration/verification.json) passes all seven
canonical checks with unchanged source: TypeScript, zero-error ratchet, full lint
(0 errors, 374 warnings), build, inventory verification, actual bundled MongoDB
HTTP and actual Electron safeStorage SQLite HTTP. The latter includes canonical
root-data and retained sessions/roster/plane across process replacement.

Final Nitro SHA-256: `599430a5e88c513acb7e5070ad00b732ada645bfba343062ed7231d5ec55e5a3`.
This build includes the reviewed deletion-accounting prerequisite. iOS compilation
used its separately frozen earlier payload; it is not acceptance of this new one.
Plan checks pass at 1440, 390 and 320 pixels with full scrolling, filters/search,
counts, navigation and task-owned browser cleanup.

Graph maintenance uses a scoped semantic pass for the small changed runbooks and
new evidence summaries. The large TESTING/CHANGELOG/PR history and screenshots are
not claimed as newly semantically indexed; structural snapshot coverage is checked
separately. The earlier broad semantic pass exceeded its bounded budget.
