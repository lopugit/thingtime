# Account theme device workspace

Theme Studio now uses the device adapter for account saves, deletes and selected
theme changes. Each commits locally; content and selection have independent
background senders. This is one part of the incomplete
[local workspace rollout](local-workspaces.md). Account transfer, protected local
History and the wider feature matrix remain integration gates.

`local-workspace/accountThemes.ts` wraps the existing `LocalThemes` writer with
an account/origin/data-plane scope. Theme content stays in the same local Things
store and uses the canonical theme sanitizer and portable exporter. Queue and
claim metadata stays outside portable content. Anonymous themes never construct
this account adapter, and login does not adopt their records.

Local writes finish transactionally before any network request. Each sender
claims one immutable request; later edits can finish while it is in flight.
An uncertain create is replayed before its later update or deletion. Concurrent
tabs cannot acknowledge another tab's claim. Complete remote catalogues use read
and mutation generations, so stale responses cannot erase local edits. Incomplete
or malformed responses cannot infer deletion. Workspace and theme quotas roll
back content and queue metadata together.

Conflict review checks the exact local revision and remote snapshot again.
Keeping an independent copy remaps its ID, leaves the account original intact,
and starts the new copy privately. If an account source was deleted, keeping the
device content makes a fresh private copy rather than resurrecting its old ID.
Unknown outcomes cannot be discarded through the conflict-review path. Related
device Things prevent silently deleting their retained parent.

`themeTransport.client.ts` negotiates `api.themes-sync` **1.0.1** and
`api.mongodb-endpoint` 1.1.0, then uses bounded, same-origin, non-redirecting
requests with the expected owner and selected data plane. Both confirmation and
response identity are rechecked. Offline or anonymous content identity is never
remote authority. Home-plane storage is explicit even when the selected content
plane differs.

## Receipt correction

The first integrated device test reproduced a false conflict after creating a
new theme and then editing it. The receipt originally hashed the in-memory insert
object, while MongoDB stored `_id` first in the BSON document. The writer now
rereads its actual stored postimage within the same transaction before hashing
and recording the receipt. The shared BSON comparison itself is unchanged;
unknown fields and exact stored representation still participate in conflict
detection.

`themeSync.api.test.ts` asserts that a create receipt's version equals the next
real snapshot. `accountThemes.api.test.ts` also exercises a discarded successful
create response followed by another device edit, then a real concurrent account
edit, reviewed independent copy, private read refusal, canonical export and
independent deletion. All use ordinary APIs and disposable private fixtures.

## Local checks — 2026-10-17

- `npm --prefix remix run test:local-workspace`: 501 passing, 56 opt-in skips;
  the offline shell suite adds four passing checks.
- Theme/server/shared-BSON suite: 24 passing; capabilities: 102 passing.
- Focused device/transport/anonymous-theme coverage: 13 passing (included above).
- The server receipt regression and device API fixture were also run explicitly
  against the isolated loopback replica; all fixture theme entries were cleaned.
- Full TypeScript matched the same 91 preceding diagnostic signatures. These are
  existing errors, not a clean typecheck.

To run the opt-in device API fixture from `remix/`, set
`TT_ACCOUNT_THEMES_API_URL` to the isolated loopback app,
`TT_ACCOUNT_THEMES_ARTIFACTS` to a local output directory and
`TT_SHARED_PLAYWRIGHT_PATH` to the installed Playwright module. Run:

```sh
node --import tsx --test app/local-workspace/accountThemes.api.test.ts
```

The fixture refuses to register unless the API reports the authorized disposable
Mongo host `127.0.0.1:22463`, replica set `draftPreview`, with no custom database.
It does not accept a production URL. Artifact output includes a validated
`theme.transfer.json` and value-free verification summary. This test uses the
actual HTTP API with an IndexedDB fixture; it is not native browser UI acceptance.

## Active selection and native UI — 2026-10-17

`api.themes-sync` 1.1.0 adds `selection` and `select`. The normal secure account
writer uses an opaque version of the actual stored preimage. Selection changes
and immutable Timeline receipts commit together. Retrying a receipt never
reapplies an old choice after another normal writer or theme deletion.
The route retains full-session, owner, selected-plane, same-origin and rate
admission before mutation and response disclosure. Clients negotiate 1.1.0
before selection operations; catalogue writes retain the 1.0.1 minimum.

The account workspace worker retains the catalogue and pointer independently.
Local applying does not wait for theme creation on the server. A new selection
waits for its theme's remote identity only in the background; an uncertain
previous command replays before a later desired choice. Content conflicts offer
exact review, keep-device/account choices and an independent private copy.
Selection has separate review and retry. Copying an active theme also queues
its remapped selection. Unknown results cannot be discarded through review.

Theme Studio keys state to workspace identity, refreshes on scoped cross-tab
changes, preserves usable lists on errors and defaults new saves to private.
It only offers a public share link after synchronization. ThemeHost picks up
retained selected content through the same local facade rather than requiring
an online public-theme read. Existing customizations remain intact.

Local verification for this increment: full local workspace suite 506 passing
with 57 opt-in skips, plus four shell checks; server/capability subset 68 passing
with three opt-in skips. The real selection API fixture passed explicitly.
There were 38 focused device/facade/auth/route
checks passed; TypeScript retained the same 91 prior diagnostic signatures.
The native browser fixture passed offline save/apply/cold reload, independent
private content/selection synchronization, native deletion, no offline mutation
requests, no page errors, and 1440/390/320px screenshots and width measurements.
The earlier real selection API fixture also covered concurrent retries, changed
normal selections, immutable write IDs, selected-theme deletion and stale writes.
These are local results, not CI or deployment acceptance.

Run the browser fixture against the built isolated app with
`TT_ACCOUNT_THEMES_URL`, `TT_ACCOUNT_THEMES_ARTIFACTS`,
`TT_SHARED_PLAYWRIGHT_PATH`, and optional `TT_SHARED_CHROME_PATH`:

```sh
node --import tsx --test app/local-workspace/accountThemes.browser.test.ts
```

## Remaining integration

Complete account theme transfer and protected local History through the existing
shared contracts. Expand native acceptance to editing, conflict comparison,
private copies and identity transitions. Check public/shared gallery retention
and selection, not just the owned catalogue. Reconcile latest main and verify
current-head CI and a real deployment before the wider rollout can merge.
