# PR #1000 — Anonymous and offline local workspaces

Branch: `codex/anonymous-local-first`. PR: https://github.com/lopugit/thingtime/pull/1000

## Delivery boundary

This is an active implementation checkpoint, not completion of the full local-first
goal. Do not merge until the [coverage matrix](../docs/local-workspaces.md) is
complete. It builds on main and includes the separate posting independence fix
in [PR #999](https://github.com/lopugit/thingtime/pull/999).

## Implemented behavior

Anonymous editors use an isolated browser workspace instead of automatically
creating a temporary account. Owned account Things save atomically with their
sync queue, retain immutable ambiguous retries, and require reviewed conflict
resolution. Offline account startup restores only content identity; remote
requests require a fresh real account/data-plane confirmation. Login does not
adopt anonymous data. Existing authentication and media authorization remain.

Builder resolves native local pages/components, retains unsaved editor state
across reconnect, lists saved device content even without a cached server page,
and refreshes that partial library after account confirmation. Cached rows remain
visible during background refresh. The offline shell contains verified static
assets only, never API responses or private media.

## Local verification — 2026-10-16

- Workspace/offline-shell, root-data, webpage, autosave and draft suites:
  297 passed, four opt-in skips. Additional Things suites: 315 passed;
  media-cache suite: six passed.
- Final client build passed with 230 verified offline assets (10,774,315 bytes).
- Raw TypeScript: 91 diagnostics, exactly matching an independent check of the
  unchanged parent branch. The non-blocking ratchet warns against its stored
  baseline of 89. No baseline was relaxed.
- Real production-build browser acceptance used an isolated local origin and
  disposable replica fixture. Verified anonymous create/edit/reload, account
  outage recovery and conflict review, fully offline account cold startup,
  native edit/save/reload, no mutation while root confirmation was blocked,
  reconnect sync, unsaved state preservation, and offline library layout at
  1440×1000 and 390×844. Earlier sync/conflict checks also covered 320px.
  Browser network/viewport overrides were restored and the fixture logged out.
- Local screenshots: `tmp/draft-qa/account-offline-library-desktop.png`,
  `account-offline-library-390.png`, and `account-library-reconnected.png`.
  These ignored artifacts are local evidence, not a deployed verification.

Graphify structural and semantic refresh completed using the local proxy:
436,858 input / 16,443 output tokens, with 30 files re-extracted. It reported
legacy semantic-cache provenance, duplicate-node and dropped-hyperedge warnings;
the graph remains usable but is not warning-free. The new workspace document
and implementation files were confirmed in both graph and manifest.
The subsequent refresh for this PR note and changelog link was refused by the
semantic shrink guard (changelog 22 to 20 nodes). The existing semantic graph
was preserved and a structural update was run; the latest documentation's
semantic freshness is therefore unverified.

CI and preview verification are separate from these local results. No production
merge, deployment or existing-account content mutation was performed.

## Remaining work

The matrix remains authoritative: local attachment lifecycle, Actions and app
suites, canonical Timeline integration, schema/component catalogs, local social
authoring, themes/algorithms, encrypted vault support, locally capable native
and automation surfaces, account delete/move/import and dedicated adapters,
online cache refresh/pagination, and cross-tab/account-switch acceptance.
The current transfer adapter also needs explicit handling of referenced media
before its export can be considered complete for attachment-bearing content.


## Anonymous themes and retirement recovery checkpoint — 2026-10-16

- Anonymous Theme Studio has dedicated local save/apply/delete and canonical
  import/export, reusing the account token sanitizer and protected-kind boundary.
  Imports receive fresh IDs, remain local and do not change the active selection.
- Production-build browser acceptance passed no-login save/reload, offline cold
  startup/edit/save/reload, normal JSON download/import, apply/delete and responsive
  1440/390/320px checks. Save/delete network observations contained no mutations.
  JSON was independently checked by `validateTransfer`; local evidence is in
  `tmp/draft-qa/anonymous-theme-export.json` and the anonymous-themes-offline PNGs.
- Authoritative root rejection retires existing local/remote leases; repeated
  rejection does not broadcast another invalidation while already pending.
  IndexedDB blocked/error/timeout/close failures permit retry and discard late
  upgrade/success callbacks.
- Incorporated the repository review bot's public profile/waitlist fix. Public
  profile/activity/search and theme gallery reads use the credential-free public
  reader, and callbacks from a retired anonymous facade fail before networking.
- Account theme synchronization, local history and algorithms remain incomplete;
  this checkpoint does not change the full rollout's merge boundary.

The checkpoint's workspace/offline-shell, root, Things and theme tests passed
408 checks. The client build passed with 230 verified offline assets; raw
TypeScript exactly matched the 91-diagnostic parent baseline. Graphify structural
and semantic extraction completed for 31 changed files (439,374 input / 21,826
output tokens), retaining warnings about legacy cache provenance and duplicate
nodes. Public gallery empty-state wording now distinguishes device saves from
account publishing.

Web CI build/unit and API suites passed on prior pushed revision `2e6ea34db`.
The PR preview root and Nitro health now return the real application and ready
API; that read-only check is not acceptance of the unpushed theme changes.

## Anonymous algorithms checkpoint — 2026-10-16

- Reused canonical profile parsing, name/emoji normalization, training and ranking
  for device-only algorithms. Dedicated writers enforce the 50-profile limit,
  stale-update conflicts and atomic quota rollback. Exports omit authority and
  lineage; imports preserve profile content with fresh IDs and unchanged active
  selection. Remote shared-profile branching continues to require an account.
- Normal Settings and feed UI now expose local creation, selection, branching,
  renaming and transfer. The feed states that ranking is per available public
  page; no global ranking or account algorithm sync is claimed.
- All engagement flushes use the workspace facade, replacing direct beacons.
  Identity invalidation clears pending/session events and suppresses stale
  completion notifications. Built-in sorts do not train; failures are visible.
- Local production-build browser: logged-out create/select, offline cold reload,
  rename/branch/download/import/re-export/delete, and 1440/390/320px checks passed.
  A synthetic browser public-feed response exercised the native card observer
  and local training without publishing content. Observed operations sent no
  server mutations. Export validation passed, learned profile content matched
  exactly after UI round-trip, and the imported Thing had a fresh ID.
- Evidence: `tmp/draft-qa/anonymous-algorithm-trained-export.json`,
  `anonymous-algorithm-roundtrip.json`, and `anonymous-algorithms-offline-*.png`.
  All four disposable profiles were deleted; browser overrides restored/tab closed.
- Focused suites: 48 workspace/offline-shell, 78 feed and 315 Things checks
  passed. Raw TypeScript retained the exact 91-diagnostic independent parent
  baseline. The client build passed with 230 verified offline assets.

Full cross-tab/account-switch browser coverage, account algorithms sync and
remaining matrix rows are still required before rollout merge. CI/deployment
verification must be tied to the eventual pushed commit, not these local checks.

## Anonymous attachment transfer checkpoint — 2026-10-16

- Added scoped binary storage sharing one atomic transaction and quota ledger
  with JSON metadata: 16 MiB/file, 1 MiB/JSON record, 64 MiB/workspace.
- Reused canonical file/recording metadata, archive validation/checksums,
  dependency collection and composition-media remapping. Normal Things ZIP
  import/export/copy/delete now works locally without an upload stage or HTTP
  byte fallback. Account import rejects local byte maps before networking.
- Missing/corrupt bytes and quota failures cannot produce partial imports or
  exports. Copies retain independent bytes after original deletion. Generic
  mutations cannot write protected attachments. Non-recursive folder deletion
  still refuses standalone child files; target-bound attachments cascade.
- Local production-build browser: no account, disabled network, normal ZIP
  import/export, offline cold reload, actual-download reimport, original deletion
  and independent-copy re-export passed. Canonical decoding/serialization and
  SHA-256 verified exact 82-byte content and fresh IDs in both browser downloads.
  Import at 390px and export at 320px fit without horizontal overflow. Disposable
  files and browser overrides were cleaned up; task tab closed.
- Evidence: `tmp/local-attachments/browser-export.zip`, `browser-roundtrip.zip`,
  corresponding JSON manifests and `offline-import-390.png`.
- Local validation: 54 workspace/offline-shell and 315 Things checks passed;
  client build passed with 231 verified assets (11,022,887 bytes). Raw TypeScript
  exactly matched the independent parent baseline of 91 diagnostics.

This is the file-transfer/storage checkpoint, not complete attachment support.
Normal uploads, media URL rendering, draft copies, linked galleries and account
sync remain required, alongside the broader coverage matrix, before merge.
CI and deployed verification must be tied to the eventual pushed commit.

Review integration retains the bot's orphaned-sync quarantine and non-negative
usage cleanup in the shared JSON/binary deletion helper. Focused workspace tests,
typecheck baseline comparison and client build are rerun on the integrated tree;
the graph's structural snapshot is refreshed after the merge.
