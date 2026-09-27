# PR #956 — Relational Timeline foundation

Branch: `codex/unified-timeline`. Target: `main`, explicitly authorized by Lopu on 2026-09-27 along with merging tested checkpoints into `main` as work progresses.
PR: https://github.com/lopugit/thingtime/pull/956

## Behavior and storage

Ordinary owned Thing CRUD now records a private revision in the same transaction
as the content and quota ledger. Builder blocks/props and definition source
changes queue recoverable local drafts before their network save. The shared
History opens from Things and the editors, retrieves bounded pages, compares
changes, and restores or merges into the live Thing by creating a new revision.

IndexedDB and the remote Timeline use the same canonical event, relationship,
branch and branch-head records. Each event and relationship is an independent
record. Branch metadata lives once, and each branch/Thing membership has its own
head. No Thing, folder, event or branch accumulates revision or membership arrays.
Small local queue/cache indexes are bookkeeping, not alternate event schemas.
The server wraps these records in protected ordinary Things under the private
Timeline folder, using the existing named collection and shared indexes.

Named branches can be created, pulled, viewed and advanced to a descendant.
Commands persist before transmission. Exact retries retain operation identity;
compare-and-swap rejects stale heads, and a late receipt cannot rewind a newer
local head. Definitive refusals remain actionable without claiming History reads
failed. A selected version survives dismissal of a refused push.

The revision and branch endpoints require the authenticated account and selected
data plane. Generic Thing reads/writes cannot expose or mutate protected history.
Snapshots explicitly project supported content, excluding credential/operational
fields. Pending drafts are kept when downloaded cache is pruned. A late ordinary
or AI save cannot clear newer typing or a dirty empty page.

## Validation checkpoint

Foundation commit `2a8b4d4fc` passed the complete Vite/Nitro/Vercel build and output
verification. Calling the compiled server's actual capability handler returned
HTTP 200 and `api.timeline` 1.2.0. Focused Timeline, schemas, capabilities, storage
and AI-save regression checks passed. Changed-file lint reported zero errors and
28 warnings. The raw typecheck reported 91 diagnostics, with none in changed
files; the configured ratchet baseline remains 89 and was not increased.

A disposable loopback replica set was exercised through real HTTP API calls,
including ordinary CRUD, exact replay, stale versions, privacy/provenance refusal,
normalized links, restore/merge, named branches, two Things in one branch,
concurrent pushes, forward-only enforcement and controlled invalid-version errors.
Fixtures were not inserted through direct database writes. Read-only explain
checks used existing indexes without collection scans or blocking sorts on the
small fixture; these are not production-load measurements.

Browser checks recovered unsaved text after reload, saved it, restored earlier
versions, created and advanced a branch, retained/retried a refused backward push,
dismissed only that refusal, and viewed the acknowledged head. At 375×812 the
History dialog's client and scroll widths were both 351px, and its actions were
reachable. Desktop and mobile screenshots are attached to the Codex task.

The broad local unit run encountered a feed-parser timing threshold under heavy
machine load; the connection suite passed on rerun. An unchanged Graphify lock
test then timed out. A serial continuation was interrupted before changing the
checkout to integrate `develop`, so a complete unit-suite pass is not claimed.
The final `main` integration had one changelog conflict; both entries were retained.
Post-integration check results are tracked in the PR body.

The local semantic proxy health check timed out. Structural code graph refresh
is required, but fresh semantic coverage for changed Markdown is not claimed.

## Remaining accepted scope

This PR is a foundation within the active Unified Timeline goal. The canonical
acceptance ledger remains [docs/unified-timeline.md](../docs/unified-timeline.md).
Open work includes dedicated server writers and safe operational outcomes,
Action/AI provenance, standalone rich text and new unsaved Things, exact historical
dependency rendering, deleted-Thing recovery, branch checkout/edit and branch
merge targets, cache/history controls, retention/quota behavior, and offline,
first-paint, identity/data-plane-switch and live-quota acceptance. An actual
concurrent AI-provider/browser save run also remains unverified.

No production installation or completed end-to-end delivery is claimed here.
