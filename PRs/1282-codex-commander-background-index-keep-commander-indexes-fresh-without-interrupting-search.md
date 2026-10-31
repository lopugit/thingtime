# PR 1282: Keep Commander indexes fresh without interrupting search

Date: 2026-10-29. [Pull request](https://github.com/lopugit/thingtime/pull/1282).
Branch: `codex/commander-background-index`; target: explicitly authorized `main`.

## Result

Commander maintains applications, commands, files and folders in the background.
Filesystem notifications coalesce into affected-subtree refreshes, with periodic
full reconciliation and source pruning. Search combines committed SQLite WAL
snapshots with transient exact-path metadata observations during a full scan;
it never starts or waits for an indexing run. The launcher footer
shows the last measured committed file/folder count plus the enabled application
and command catalogue, alongside conservative full-refresh age; detailed scan
progress remains in Settings. Ordinary pending changes retain that measured
baseline while live results can update ahead of its count. Legacy or changed
root/policy totals stay explicitly unmeasured.

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
- Task-reported final Rust indexer 67 tests passed; core 33 tests and Swift 45
  tests remain retained evidence for their unchanged final implementations.
  Coverage includes incremental rename/delete, overlapping sources and unique
  counts, current-source catalogue reads, legacy policy versus the actual
  walker, and a separate WAL reader during an uncommitted writer transaction.
  Metadata regressions also cover new unindexed files/apps/folders,
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

## Installed recovery and acceptance

The first signed installation from `dd437255d` failed real-root acceptance:
the parent task observed approximately 93% Node CPU and a sample dominated by
FSEvents, which starved the daemon event loop. The parent stopped Commander.
The fixture results above did not reveal this real-root failure.

The installed database has already migrated to schema 4. Preserve that data;
the old schema-3-only bundle is not a safe rollback. The recovery changes move
filesystem notification handling off the daemon event loop and normalize
macOS Data-volume aliases before excluding database writes. Their focused
verification was followed by the signed installed acceptance below.

Canonical bundle output is `Commander/dist/Commander.app`; the installed copy is
`~/Applications/Commander.app`. The final recovery bundle retained the stable
Developer ID signing requirement, passed installed signature/notarization-ticket
checks, and ran from that installed path. The parent task owns any merge.

The signed build `2026102902` subsequently passed real installed responsiveness
and automatic file/folder/child/app create, rename and delete acceptance. Sixty
health probes returned HTTP 200, with maximum 56 ms. The saved profile remained
unchanged. However, its full reconciliation exceeded the saved 512 MiB memory
ceiling (observed 707/780 MiB), preserving the old snapshot but leaving file and
folder totals unmeasured. That failure led to the memory repair below.

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
Signed installed build `2026102903` subsequently completed all five active
filesystem roots under the unchanged saved 512 MiB policy. The native lane
observed peak Rust RSS 124.64 MiB and 101 health probes, all HTTP 200 with maximum
54.74 ms. Permission warnings were nonfatal, and the profile remained unchanged.
Final aggregate verification used a kind-specific active-source SQL reference:
application catalogue from `applications:` sources, file/folder counters from
active `filesystem:` sources, plus enabled commands.

That successful full commit exposed a footer defect: continuous ordinary live
updates kept `overlay.pending` true and hid a valid measured count indefinitely.
The status correction retains committed counters through transient updates while
preserving legacy, configuration, policy and root mismatch invalidation. It uses
existing cached counters and performs no new per-event count query. The compatible
status correction is advertised as `commander.index-status` 1.1.1. A held real
writer regression repeatedly checks the measured baseline through file/folder/app
notifications, then checks immediate invalidation after a hidden-policy change.
On 2026-10-30, the native lane completed final technical acceptance of installed
build `2026103001`, signed from `9c51cb52b25bf6e4591ee0cd080902619533eae4`.
Its Commander tree `ac4db53b28d4c4279faae57ef306aaaf58a7c614` is identical to
integration head `43d240c38c232903831901c3ec70fe82076f5626`. The soft install
preserved the saved-state digest, designated requirement, valid signature and
notarization ticket; the built manifest reported status contract 1.1.1. The
indexer CDHash matched build 03, retaining that build's real 512 MiB full-scan
and peak-RSS evidence without changing the saved resource policy.

The rendered footer's 2,834,547 items exactly matched the paired read-only SQL
reference: 630 applications + 494,087 directories + 2,339,775 files + 55 enabled
commands. The oldest of 15 eligible source-kind timestamps was independently
44.2 minutes old, agreeing with the rendered 44-minute age. Measured counts
remained visible through continuous ordinary deltas. These are paired acceptance
snapshots; normal filesystem activity changes later totals and age. The final
60 health samples all returned HTTP 200, maximum 38.68 ms. Test fixtures were
removed with zero remaining raw fixture rows; the launcher was left empty and
unpinned. The native receipt is retained in the task's local acceptance cache
at `native04.noindex/final-acceptance.json`.

Physical Cmd+E delivery remains unverified. The ordinary emoji command rendered
1,964 entries. With the launcher unpinned for both controls, app-targeted CUA
Cmd+E and Cmd+Space both produced no action. This comparison does not establish
a physical global-hotkey failure. The retained working build
`2026101902` identifies source `9eca5963d12e7e174927a9000156601887aa9bc0`;
its `GlobalHotKey.swift` is byte-identical to the final source (Git blob
`a9ac8879c85441d49c924b2a6537438c207d3656`). Registration, identifiers and
callbacks, native presentation/bridge and the JavaScript hotkey listener are
unchanged. The added isolated-development guard is inactive for the installed
production bundle. The reviewed local emoji fastpath has focused regression
coverage, but source comparison and ordinary command execution do not prove a
physical key event reaches that path.

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
the user's installed data and isolate development fixtures. Final signed
real-root count, freshness and responsiveness acceptance passed; retain the
physical-keyboard limitation explicitly. The parent owns the merge decision.
