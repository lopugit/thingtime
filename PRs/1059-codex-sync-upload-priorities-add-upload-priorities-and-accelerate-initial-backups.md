# PR 1059 · Upload priorities and initial backup planning

Device backups can prioritize an ordered list of relative file/folder paths.
The list is saved per account, selected origin, data plane, device and connection.
Editable Builder blocks expose each input, heading, status, repeated label and
control. The file tree offers Upload next; folder prefixes include descendants.
Exclusions still apply and priorities cannot create new planned operations.

The journal reserves an immutable operation before lookup/publication, preserving
that reservation across lost replies, cancellation, restart and priority edits.
Required copy ancestors execute first, confirmed rows are skipped in bounded
pages, and Trash remains children-first. Legacy running journals conservatively
resolve their next potentially published operation first. Schema v12 prevents
older writers from reopening changed scheduling state.

For sealed initial backup/upload plans with deletes disabled, an empty destination
and empty baselines, skip redundant changed-ancestor indexing and reads. Retain
excluded-ancestor checkpoint flags, page/byte bounds and completion gating. An
older indexing plan migrates only with matching complete instances, counts and
active pins. Other plans keep the full two-pass path.

## Verification · 20 October 2026

- 451 shared file-sync and progress tests pass, plus the module-mock transport
  check (452 total). Planner coverage includes 20,000 paths, interrupted migration,
  changed inputs, exclusion protection and equivalence with the original planner.
- Priority tests cover CAS, account fences, parent ordering, overlapping paths,
  interrupted publication, legacy recovery and declared-count corruption.
- The real Rust backup walker test preserves hidden Git objects, refs, worktree
  metadata and pointer files even when repository .gitignore excludes them.
  Default dependency rules do not exclude .git.
- Isolated Chromium checks desktop and mobile, scrolling to the bottom, priority
  save/reorder/remove/reload, tree selection, rejected drafts and individual
  nested Builder edits with save/reload. No production effects occur in fixtures.
- Typecheck ratchet passes with the unchanged warning: 92 diagnostics against
  baseline89, none in changed files. This is not a clean full-project typecheck.
- Parent reviewed the scheduling and planner changes; the missing preview-read
  overrun guard was restored and covered by a corruption regression.
- Structural graph refreshed. Semantic document indexing remains unverified
  after the existing backend hollow-response failure.

## Installed acceptance and boundaries

Signed runtime build source: b539cda207ca32ce1d704ce2eef48838957e7188.
Build, exact-head CI, merge, installation and actual upload-order acceptance are
tracked separately in the HTML task plan. The prior installed backup retains
3,653,988 indexed entries and53,728 explicit skipped observations; payload
receipts are still0 during preparation. A priority does not prove a complete
backup. No local removal is implemented or performed. Complete cloud verification,
Git/worktree dependencies and excluded/skipped-content coverage are required
before offloading. Android remains deferred.

Branch: `codex/sync-upload-priorities`

PR: https://github.com/lopugit/thingtime/pull/1059
