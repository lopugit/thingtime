# Account theme device workspace

The device adapter is implemented; normal Theme Studio wiring and active-theme
selection synchronization remain pending. This is one part of the incomplete
[local workspace rollout](local-workspaces.md), not a claim that account themes
already work offline through every application screen.

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

## Remaining integration

Bind the adapter and its independent sender to the existing account workspace
worker; retain local list state during catalogue refresh and show errors/retries.
Wire the normal Theme Studio to those methods and scoped cross-tab invalidation.
Complete active-theme selection synchronization, conflict controls, account
transfer integration and protected local History through the existing shared
contracts. Verify actual offline create/edit/apply/delete/cold reload, narrow
layouts, identity transitions and reconnect through the native browser UI.
Current-head CI, deployed verification and the wider rollout remain separate gates.
