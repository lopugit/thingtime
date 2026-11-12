# Account suite installation and offline editing

Bundled suites use the existing materializer and the normal editable Builder
Things. An account can install its bundled copy on this device while offline.
Anonymous work remains in the anonymous workspace and never enters account sync.

The account installation records one durable intent and its exact initial local
revisions in the same transaction as the local suite. Its constituent Things are
held out of ordinary uploads until their canonical account identities have been
resolved. This matters when the device has not cached an already installed suite:
ordinary UUID creates would duplicate the account's existing definitions.

The intent is scoped to the selected origin, owner, data plane and workspace
lease. Its request ID and bundled-content digest are immutable across retries.
The suite queue runs independently of other local queues. Local edits and normal
Run example interactions remain available while its account operation is pending.

## Canonical account operation

The additive receipt protocol requires `api.webpages-suites-install` 1.7.0 and
uses the existing `POST /api/v1/webpages/suites/install` route:

```json
{
  "key": "<bundled-suite-key>",
  "onlyMissing": true,
  "requestId": "<fresh-operation-UUID>",
  "bundleVersion": "suite-bundle-v1:<SHA-256>"
}
```

Use the normal account transport, including same-origin and expected account/data
plane headers and the selected Character header when delegated. A public manifest
is discovery only; it grants no account access. Legacy session requests retain
compatibility, and also receive transactional installation.

The canonical installer serializes installs with the existing protected Timeline
owner lock. Definition lookup, canonical create/update, quota accounting, History
and the receipt share one active-plane Mongo transaction. No separate uniqueness
constraint is imposed on users' existing duplicate keys. `onlyMissing` preserves
customized account definitions. A new request with a different bundle digest is
refused before content writes; a previously committed request replays its original
receipt even after catalogue or account content changes.

The receipt includes the exact schema, Component, Action, data and page mapping,
plus canonical snapshots/revisions. Bearer links, token grants and attachment
handles are omitted. Bounded snapshot chunks are private relational Timeline
records, validated by digest on read. Timeline's binary storage is not a claim of
at-rest encryption. The receipt does not publish any content.

## Local identity adoption

The device stores the validated receipt before attempting adoption. Adoption is
atomic with queue acknowledgement: canonical IDs and references, local changes,
sync baselines and relevant dependent records must agree before holds are released.
Untouched bundled defaults must not overwrite customized account content. Edits
made since local installation are preserved; overlapping changes require the
normal explicit comparison choice. Uncertain ordinary writes remain immutable.
An explicit preserved-version choice may supersede a settled conditional-write
conflict after checking the fresh remote revision, local revision and saved
version journal. An active claim or an uncertain pending write cannot be replaced
through that path; automatic retries retain their frozen operation and body.

Scoped aliases keep earlier local page and Component references usable. Component
catalogue reads resolve the old family ID before local and remote lookup, without
rewriting ordinary family names or borrowing another workspace's aliases. Original History events
and hashes remain immutable; version operations resolve their canonical target
explicitly. Cross-identity branch merges require compatible ancestry and may be
refused; a successful restore does not establish every branch-merge case.

## Verification boundaries

Focused local tests exercise admission, scope and lease fencing, lost-response
replay, atomic rollback, dependency holds, canonical identity mapping and History.
The real API fixture is `remix/scripts/suite-install-acceptance.mts`; the normal
browser fixture is `remix/app/local-workspace/accountSuites.browser.test.ts`.
Both require the disposable test session and enforced browser/backend isolation.
They must not run against an existing account or a production origin.

The normal browser acceptance must cover incomplete cache, remote customizations,
offline Install and Run, later local edits, cold reload, reconnect and explicit
conflict choices, canonical readback and old local URLs at 1440/390/320px.
Implementation and focused tests alone do not complete that acceptance. The live
[progress tracker](progress/anonymous-local-first.html) records the current state.
