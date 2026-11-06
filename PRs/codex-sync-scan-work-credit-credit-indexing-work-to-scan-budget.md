# Credit indexing work to the shared scan budget

Branch `codex/sync-scan-work-credit`, worktree `sync-scan-work-credit`, started
clean from freshly fetched `origin/main` at `bd80571a88fed16b750d82f5adf9af9c3c634e11`.

The old limiter restarted each chunk deadline at the current time, adding its
entire byte-rate delay after hashing, SQLite/metadata work and timer oversleep.
Keep a shared virtual deadline instead, granting at most 100 ms of aggregate
idle credit. Reservations remain serialized; cancellation remains responsive.
No user preferences, API/native contracts, file-size limits or app installation
change here. Final signed app delivery is tracked by the parent sync task.

Verification and release-profile fixture results are recorded below before merge.

## Matched release comparison

Both binaries were built with locked Cargo dependencies and the release profile:
base from an immutable `git archive bd80571a filesystem-indexer`, patched from
this branch. The same disposable APFS fixture contained 1,024 files (4 KiB,
128 KiB and 1 MiB), 928 nested directories and 16,613,376 content bytes. Each
binary used a fresh SQLite observation database, 5,000,000 B/s scan policy,
15% CPU target and one worker. Cold means empty observation cache, not flushed
OS page cache. No personal filesystem or cloud transfer was used.

| Phase | Base | Patched |
| --- | ---: | ---: |
| Cold scan | 6.224 s | 3.352 s |
| Cold seal | 0.203 s | 0.201 s |
| Warm scan | 0.453 s | 0.457 s |
| Warm seal | 0.201 s | 0.206 s |

Cold scan was 46% lower and near the 3.323 s byte-budget floor. Both scans
accounted for exactly 16,613,376 content bytes; warm scans read zero bytes.
Both returned all 1,952 entries with zero independent file-fingerprint/size
mismatches. Patched peak process RSS was 12.36 MiB cold and 12.48 MiB warm.
This bounded fixture is not sustained production throughput or memory scaling.

Binary SHA-256: base `929dc96c914a6d734e6d4be9186f892979e572863f73f2c93d3f60464ff8e5a4`;
patched `ee67d19fa051e341cea5a1fac76a44999e9b555c1ab56443d027dd70f3afc238`.
Commands and phase observations are retained locally under
`/tmp/tt-sync-scale-acceptance/release-comparison.py` and `release-comparison.json`.

## Validation

Changed indexer crate: 89 tests passed, one pre-existing ignored personal-root
memory test. Five focused limiter tests passed after the final test-only
addition, including fake-clock work credit, oversleep, aggregate tiny reads,
serialized reservations/burst bounds, and real concurrent callers/cancellation.
No HTTP or native protocol change requires a capability version bump.
