# Owned profile capacity — 26 October 2026

Source baseline: `62bd66098f10dd684f1c9527bd989e2027f4eed3`; the delivery commit contains this capacity follow-up. All results below are local. This is not deployed or installed macOS acceptance.

## Delivered

- Owned lists negotiate themes **1.3.0** / algorithms **1.2.0**: bounded 64 cursor windows, owner/domain-scoped cursors, cancellation and five-second DB query deadlines. Modern records supersede legacy twins. Empty advancing pages are valid. Live pagination never authorizes deletion; retained catalogues still use the integrity-checked stream.
- Canonical creation removes the 100/50 count ceilings, retaining real byte quotas and protected transactions. Sync 1.8/1.6 and protected profile import 1.14 negotiate the change. Legacy unpaged lists keep their compatibility windows.
- Preserve the already-shipped main 1.2 focus-token codec. History v2 coexists with frozen v1 under timeline 1.23.
- Preserve pre-upgrade frozen theme commands through client/server parsing and exact receipt digest matching. Explicit focus additions, even current default values, cannot replay a legacy receipt. No digest fallback or receipt rewriting.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Owned profile paging, creation/quota and token codec | 38 passed | [log](owned-profiles-final.log) |
| Theme sync, transfer and History | 36 passed,4 opt-in skipped | [final log](theme-sync-replay-final.log) |
| Workspace and offline shell | 856 + 4 passed,98 opt-in skipped | [final log](workspace-replay-final.log) |
| Both capability manifests and compatibility | 135 passed | [log](capabilities-final.log) |
| TypeScript | exit 2, 91 diagnostics, none in changed paths; not a clean check | [final diagnostics](typecheck-final.log) |
| Changed-source lint | 0 errors; existing useApi warning | [log](lint.log) |
| Sanitized client and Nitro server build | passed after the replay correction | [log](build-replay-final.log) |
| Built HTTP, disposable replica sets and gateway | passed | [structured result](gateway-replay-final.json), [log](gateway-replay-final.log) |
| Plan in isolated native Chromium | desktop/mobile/320px, filters/search/full scroll, no overflow; cleanup verified | [verification](plan/verification.json) |

The built API run created 105 themes and 65 algorithms through canonical conditional saves. Identical final saves replayed their receipts. Complete streams matched exact persisted IDs/content/versions at both owner and gateway. A normal theme create and algorithm branch then succeeded; both GET paths returned all 106 themes and 66 algorithms over bounded pages. Anonymous, cross-site, wrong-owner and malformed-cursor refusals passed. The follower made zero direct Mongo connections. Disposable backend traffic was OS-sandboxed; all owned resources were cleaned up.

Separate focused History/backup tests passed 89 checks before the replay correction; 22 contract/receipt/transport/queue checks passed after it. Independent review reproduced and then verified the old-receipt regression, including all five default-equal explicit focus additions. Those overlap the suites above and are not additive totals. Pre-upgrade receipt replay, legacy twin/timestamp ordering and quota rollback are unit/mock evidence, not a live historical-row or production check.

## Evidence boundaries

Initial integration failures are retained in earlier logs: obsolete manifest/transport fixtures and missing History focus fields. The actual replay defect was fixed rather than weakening receipt matching. The first successful capacity build is retained as [before-replay evidence](gateway-before-replay.json); the final rebuilt run above supersedes it.

The plan browser check exercises the HTML tracker, not full product UI. Live legacy migration/concurrent snapshot pinning, whole native UI journeys, larger individual write/transfer envelopes, the five-second large-paste gate and broader device/provider/account cases remain open. The preview gateway previously lacked the sync features; a matching frontend manifest alone does not prove deployed operation. New delivery CI is reported separately on PR #1000.

No merge, manual deployment, public test content or existing account mutation. The shared LLM proxy service and credential were left unchanged. Graphify uses structural indexing here; semantic freshness is not claimed.
