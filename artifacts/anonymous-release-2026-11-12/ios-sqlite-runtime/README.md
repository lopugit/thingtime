# iOS SQLite runtime and process-restart acceptance

Passed on 12 November 2026 Melbourne time (observed UTC timestamp in the receipt).
The original process-restart experiment used a fresh task-owned iPhone17 Pro simulator running
iOS27.0, SDK27.0, the pinned imported NodeMobile24.22.1-0 framework, Node24.22.1,
and its genuine `node:sqlite` SQLite3.53.4. The simulator was deleted afterward.
No previous simulator, stable app, account, production service or database was
changed. There were no downloads or dependency rebuilds.

`verification.json` contains exact frozen source/bundle/framework hashes and
both native receipts. `provenance.json` records executed harness hashes,
MongoDB6.21.0/BSON/esbuild dependency versions and independently checked parity
between frozen source bytes and the Git objects at
`40c57f919ac1824103cb8307a1fcda145ceb25f5`.

The probe exercised actual `openSqliteDocumentStore` and
`createCollectionProvider` modules, bundled with their real installed dependencies:

- Real on-disk SQLite creation; async transaction rollback; caught duplicate
  error abort; deterministic primitive pagination; close and reopen.
- Exact BSON bytes, preserving ObjectId, Date, Binary subtype128, Decimal128,
  Int32, Double and a Long beyond JavaScript's safe integer range.
- Durable collection definitions; unique-constraint failure rolls back an
  earlier update even when its error was caught; type-exact filtering, update
  and cursor pagination; collection close and reopen.
- A final committed write deliberately left both database handles open. The
  runner terminated PID41363 and relaunched the same installed probe as
  PID46382. Independent startup read back the committed document,
  collection definition and updated typed data. This proves process-restart
  persistence; no nonempty WAL observation or unclean termination was recorded,
  so this receipt does not establish crash/WAL recovery. Both DB files had actual
  `SQLite format 3` headers. Final handles closed successfully.

Reconstruction command (cache paths below are local diagnostic artifacts):

```sh
python3 iOS/scripts/native-sqlite-probe/run.py \
  --cache /tmp/thingtime-ios-sqlite-pr1000-01 \
  --runtime-cache /tmp/thingtime-node24-pr1000-bab94d1d \
  --runtime com.apple.CoreSimulator.SimRuntime.iOS-27-0
```

The executed source was frozen before another agent's current storage work.
The runtime was imported from a digest-verified upstream prerelease, not rebuilt
from source: binary reproducibility remains unproven. This harness compiled
its own separate UIKit executable and used ad-hoc simulator signing. It does
not establish physical-device linking/signing, App Store eligibility, native
app WebView integration, offline HTTP/API authentication/accounting coverage,
MongoDB compatibility or production readiness. No fake MongoDB or alternate SQL
store was used. Canonical Nitro was not imported in this focused storage probe.
The next integration step is the real native HTTP/API service selecting this
SQLite provider through the canonical collection contract.

The original native receipt uses the check label `app-process-restart-wal-recovery`;
that historical label is broader than the observations. The retained receipt is
unchanged. Interpret it only as committed-data process-restart persistence.
The stronger SIGKILL/nonempty-WAL experiment is recorded separately under
[`crash-recovery-02/`](crash-recovery-02/README.md); it passed with retained WAL
size/hash witnesses and a verified task-owned SIGKILL. Original executed-tool hashes
remain in `provenance.json`; they do not identify the revised runner.
