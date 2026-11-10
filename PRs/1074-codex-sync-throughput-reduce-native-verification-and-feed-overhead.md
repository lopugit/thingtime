# Reduce native verification and feed overhead

The saved Home upload had 128 pending operations, matching the planner cap. Native feed requests transported only 128 rows and every RPC deep-verified the full outer Electron app before launching the bridge. A bounded installed-bundle sample measured 1406 ms for that full verification, including 850 ms for outer resource traversal. At the observed index rate, indexing alone required approximately 2663 such RPCs/hour; the extrapolated cost is a sampled estimate, not measured aggregate execution time.

After the first successful full verification, runtime requests still freshly verify both child executables plus outer signed identity, team and entitlements at the exact resolved installation path. The bridge retains its independent strict live-parent check. Any failure invalidates the initial proof. Explicit verification, status, service registration and release/install paths retain full outer verification. No TTL/mtime/watcher cache or executable-verification cache is introduced.

Mac file-access 1.11.1 counts complete change rows and separators with a reserved envelope under the 512 KiB response cap. Corrected hosts transport up to 4096 changes while the shared client persists/wakes in 128-entry chunks. Older hosts keep 128-entry requests. First-chunk execution and exact partial-page restart are preserved. Root execution remains serialized; authorization, source drift, leases, operation IDs and receipts are unchanged.

## Verification

- Electron bridge 32/32; focused streaming 15/15; AppleFileSync batch 1/1; MacFolderSync 42/42; native parent policy/context 8/8.
- Real native SQLite JSON pages parsed by the production renderer: 2000 contiguous entries across 507815/383295-byte pages. The synthetic 1024-entry feed requires one corrected-host RPC rather than eight old-host RPCs.
- Bounded signature sample against the unchanged installed signed app: initial full 1136 ms/9 subprocesses; subsequent scoped 531 ms/8. This does not prove installed backup throughput.
- Full shared fileSync suite: 501/501 plus its structural contract test pass. The two new large-batch cases use 60-second budgets after the concurrent suite exceeded their original 10-second budgets.
- Raw TypeScript checking reports 92 existing diagnostics (baseline 89), none in owned files; the repository ratchet passes with its warning. Structural graph refresh accompanies publication; Markdown semantic freshness remains unverified.

## Acceptance

A final signed app and same-job installed before/after throughput comparison remain required. Preserve Home's configuration, grants, local files and receipts; independently download a newly confirmed file. No current Home job or installed app was changed during this investigation.
