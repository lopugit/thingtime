# Proven task-owned SIGKILL and retained-WAL recovery

Passed 12 November 2026 Melbourne time, with the exact UTC timestamp recorded
in `verification.json`. This independent run addresses the original experiment's
missing unclean-exit/WAL evidence. Original receipts and executed hashes remain
unchanged one directory above.

Both real SQLite files had nonempty 8272-byte WALs after the final primitive and
collection commits. The writer's simctl-returned PID31913 was checked twice
against the exact installed probe executable in this newly created simulator;
its executable hash matched the built simulator harness. Only that PID received
SIGKILL. The runner observed its exit, then verified both retained WAL files had
identical size and SHA256 before any recovery launch. The new PID33614 read the
committed primitive record, final collection update, saved definitions and BSON
typed data. The reader closed its handles. Independent bounded terminate,
shutdown and delete operations each returned0; the task simulator was deleted.

The actual frozen source is `40c57f919ac1824103cb8307a1fcda145ceb25f5`.
All four Git source blobs were copied byte-for-byte without newline normalization
and independently rechecked. MongoDB6.21.0 resolves through the actual Remix
workspace; esbuild0.28.1 resolves through that workspace's Vite dependency.
The real imported runtime reports Node24.22.1, SQLite3.53.4, platform ios and
arm64. Simulator runtime/SDK27.0. No downloads, fake MongoDB, mock SQL store,
account activity, canonical HTTP imports or stable-app changes occurred.

The revised runner refuses command admission after its overall30-minute deadline.
Each cleanup operation is independently bounded and catches failure; final
receipt persistence occurs despite cleanup errors, and acceptance includes
successful cleanup. This successful run verifies the executed success path;
cleanup timeout/error injection was not performed.

`verification.json` preserves exact executed source, bundle, harness and archive
hashes plus native assertions, ownership checks, WAL witnesses and cleanup.
Its `frameworkSha256` is the archive-extracted binary before ad-hoc signing;
`provenance.json` additionally identifies the signed framework actually loaded.
The runtime was imported from the digest-verified prerelease, not reproduced
from its sources. Physical-device signing/linking, WebView integration, offline
API/auth/accounting, power-loss durability and production readiness remain
unverified. SIGKILL recovery is narrower than physical-device power-loss proof.

```sh
python3 iOS/scripts/native-sqlite-probe/run.py \
  --cache /tmp/thingtime-ios-sqlite-pr1000-02 \
  --runtime-cache /tmp/thingtime-node24-pr1000-bab94d1d \
  --runtime com.apple.CoreSimulator.SimRuntime.iOS-27-0
```
