# PR 1282: Keep Commander indexes fresh without interrupting search

Date: 2026-10-29. [Pull request](https://github.com/lopugit/thingtime/pull/1282).
Branch: `codex/commander-background-index`; target: explicitly authorized `main`.

## Result

Commander maintains applications, commands, files and folders in the background.
Filesystem notifications coalesce into affected-subtree refreshes, with periodic
full reconciliation and source pruning. Search combines committed SQLite WAL
snapshots with transient exact-path metadata observations during a full scan;
it never starts or waits for an indexing run. The launcher footer
shows a measured unique searchable total and refresh age; detailed scan progress
remains in Settings. Unknown legacy totals stay explicitly unmeasured.

Overlapping sources use reference-counted unique path/kind counters. Saved
configuration fingerprints include effective filesystem roots. Legacy schema-3
snapshots remain searchable during migration through bounded current-source,
existence, hidden and ignore-policy checks. Ignore precedence matches the real
walker, including `.ignore`, `.gitignore`, repository excludes and globals.
Legacy filtered pages can temporarily contain fewer results until reconciliation.
The observation operation reuses the normal metadata candidate and eligibility
paths, returns tombstones for removed or ineligible items, never traverses
descendants, and never writes index rows or presents an overlay as measured
committed totals. It separately marks safe ordinary directory traversal for
yielded background discovery after parent-only notifications. Raw readback is
scoped to active sources and verifies exact metadata and indexed descendant
existence before a transient item or deletion marker can be retired.

Short-prefix search ranks basename groups through the existing covering index,
then loads metadata for the selected names. This preserves ranking and avoids
loading and sorting every file or folder for each keystroke; it adds no index or
arbitrary searchable-data limit.

The isolated macOS development lane has its own bundle identity, port, data,
cache, Keychain service and fixture roots. Native verification also reproduced
and fixed a telemetry pipe deadlock. Development fixtures do not substitute for
final signed, installed acceptance against the user's real enabled roots.
The enabled built-in Emoji & Symbols shortcut opens its local view immediately
when execution HTTP is stalled. Execution/history recording remains an
asynchronous best-effort request; its eventual reply cannot replay navigation.
Disabled extension and command settings still apply.

## Verification retained by the task

- Before the installed event-storm failure, TypeScript type checks/builds and
  265 tests passed, with changed-client 7/7 and Launcher 36/36 focused checks.
  Final recovery verification passed a focused 25-test runtime batch (six
  overlay, four notification-worker, thirteen scheduler/counts and two real
  integrations), plus TypeScript checks/builds.
- Task-reported final Rust indexer 63 tests passed; core 33 tests and Swift 45
  tests remain retained evidence for their unchanged final implementations.
  Coverage includes incremental rename/delete, overlapping sources and unique
  counts, current-source catalogue reads, legacy policy versus the actual
  walker, and a separate WAL reader during an uncommitted writer transaction.
  Three additional metadata regressions cover new unindexed files/apps/folders,
  ignored or missing paths, exact-path scope and operation during a held writer
  transaction without catalogue writes, safe directory traversal and scoped raw
  readback before and after commit.
- Real bundled-daemon fixture acceptance observed new files, folders and apps
  after 896, 1001 and 1077 ms. During updates, 54 searches had p95 88 ms and
  maximum 117 ms; deletions returned the measured count to baseline. These are
  isolated-fixture results, not evidence of real-root event-storm handling.
- A separate real-process held-writer fixture exercised nine file/folder/app
  mutation stages while the canonical writer was stopped. Changes appeared in
  about 740–786 ms in final verification; after resuming the writer, scoped readback retired the
  overlay and restored measured counts. Parent-only notifications also covered
  child-file and nested-app create, rename and delete behavior.
- Reviewer-measured read-only SQL on the existing 4,323,109-record schema-3
  database: old `a` exceeded four seconds separately for files and folders;
  old `th` took 3519.8 and 2480 ms. Optimized warmed combined file/folder
  queries took 73–79 ms for `a` and 33–38 ms for `th`. The first cold-ish `a`
  measurement totaled 764 ms. Warm strict `tart` FTS reads took 28–32 ms for
  6766 matches. No concurrent commits were observed during these real-database
  measurements; the concurrent-writer claim is covered separately by the
  synthetic WAL regression.
- Native rendered desktop/narrow-window footer, live fixture search results and
  Activity were checked. The narrow footer layout was corrected and rechecked.
  Eight focused UI-hook tests and the UI build passed for the stalled-execution,
  disabled-command and late-reply shortcut behavior; installed shortcut
  acceptance remains part of the final native gate.
- Notification-worker recovery checks injected 250,000 events while 30
  overlapping HTTP health probes remained responsive (maximum 13.91 ms in the
  final focused run).
  Alias/database-write exclusion, covered-event notification deadlines and the
  actual OS fixture passed. These focused results do not replace final
  installed real-root acceptance.

## Installed acceptance and recovery gate

The first signed installation from `dd437255d` failed real-root acceptance:
the parent task observed approximately 93% Node CPU and a sample dominated by
FSEvents, which starved the daemon event loop. The parent stopped Commander.
The fixture results above did not reveal this real-root failure.

The installed database has already migrated to schema 4. Preserve that data;
the old schema-3-only bundle is not a safe rollback. The recovery changes move
filesystem notification handling off the daemon event loop and normalize
macOS Data-volume aliases before excluding database writes. Their focused
verification and the final installed result must be recorded in the PR before
completion or merge; source publication alone does not pass this gate.

Canonical bundle output is `Commander/dist/Commander.app`; the installed copy is
`~/Applications/Commander.app`. The final recovery bundle must retain the
stable Developer ID signing requirement, verify its installed signature, launch
from that installed path, and pass real enabled-root responsiveness and change
acceptance. The native acceptance lane owns the next installation and final acceptance; the parent task owns any merge.

The signed build `2026102902` subsequently passed real installed responsiveness
and automatic file/folder/child/app create, rename and delete acceptance. Sixty
health probes returned HTTP 200, with maximum 56 ms. The saved profile remained
unchanged. However, its full reconciliation exceeded the saved 512 MiB memory
ceiling (observed 707/780 MiB), preserving the old snapshot but leaving file and
folder totals unmeasured. That count failure remains a release gate.

The memory repair replaces the pinned ignore walker's unbounded pre-callback
sibling queue with lazy bounded-depth chunks and a private on-disk SQLite
frontier. A bounded channel backpressures metadata, directory handles remain
within the saved ceiling, and SQLite temporary work uses files. The frontier has
a 2 MiB cache; its file and the index database/WAL/SHM are excluded from indexing.
Ordinary disappearing or inaccessible boundary entries remain diagnostics;
storage and resource failures abort the transaction and preserve the old index.
This trades temporary disk I/O for bounded traversal memory without changing
settings, schema, search limits or eligibility rules.

Focused regressions compare the real ignore walker across directory-handle and
depth settings, cover wide file/directory siblings and concurrent boundary
removal, and verify exact SQLite reconciliation counts and private-file
exclusion. The opt-in release metadata traversal of `/` completed 3,995,979
records in 181.115 seconds with peak resident memory 18 MiB. It did not write the
production index and does not prove the full SQLite writer or final footer.
Native build `2026102903` must still complete the installed full reconciliation
under the unchanged saved 512 MiB policy and verify the measured total/freshness.
The native acceptance lane owns that signed installation; the parent owns merge.

## Graphify evidence boundary

The semantic refresh could not produce usable responses: three attempts per
chunk returned empty output despite a healthy local proxy. The owned attempt
was stopped. Publication uses the repository wrapper's structural refresh and
portable immutable snapshot. New documentation semantic coverage remains
unverified; a structural graph or successful export does not establish it.

## Decisions

Keep source eligibility and totals conservative during legacy adoption; retain
eligible cached results without pretending the old source totals are current.
Use existing indexes and bounded metadata filtering rather than a foreground
rebuild or a legacy-policy view that defeats the covering search index. Preserve
the user's installed data and isolate development fixtures. Do not merge until
the corrected signed installation passes real-root acceptance.
