# PR1056 — Resume Mac backup imports across reconnects and restarts

[Pull request](https://github.com/lopugit/thingtime/pull/1056) · branch `codex/sync-import-resume`

## Behavior

After Commander seals a native capture, reconnecting previously created a new browser inventory and repeated its import from entry zero. The admitted backup job now retains its exact local inventory identity. Journal headers provide committed entry, skip and page offsets; captured inventories resume validation from its committed cursor. A dedicated retention pin is written atomically with the job so viewer changes and cleanup cannot retire an unfinished import.

The native source survives until a durable review or run head owns the import. Initial imports and fresh conflict-review imports remain separate. Scope, reviewed configuration/revision, native generation, coverage and count checks still fence stale work. A pre-upgrade initial import can be adopted only when its retained local, nonderived inventory matches the saved native capture ID and generation. Remote inventories and checkpoint derivatives cannot be adopted.

No external API contract changes. This uses existing native capture paging and keeps live authority checks before effects. Android remains deferred.

## Validation

- 420 shared file-sync tests and one module-mock transport test pass.
- Focused coverage includes short native pages, interrupted import/validation/planning, actual journal reopen, two-restart retention cleanup, stale/cancelled CAS writes, atomic rollback, generation/policy replacement and legacy migration.
- Independent review found a missing retention pin; the integrated fix and regressions passed with no remaining findings.
- Typecheck ratchet exits 0 with the existing 92 diagnostics versus baseline 89; no changed file-sync diagnostics.
- Structural Graphify outputs refreshed. Documentation semantic freshness is not asserted.

## Installed acceptance

Signed build, upgrade adoption and normal Quit/reopen acceptance are pending. The existing installed backup continues importing its sealed capture. No payload receipt or complete backup is claimed from inventory counts; first verified payload bytes remain an open parent-task requirement.
