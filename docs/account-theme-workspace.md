# Account theme device workspace

Theme Studio now uses the device adapter for account saves, deletes and selected
theme changes. Each commits locally; content and selection have independent
background senders. This is one part of the incomplete
[local workspace rollout](local-workspaces.md). Protected local
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

`themeTransport.client.ts` negotiates `api.themes-sync` **1.4.0** for complete catalogues,
**1.5.0** for new device content/selection writes carrying home receipt context, and
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

Complete protected local History and theme organization through the existing
shared contracts. Expand native acceptance to editing, conflict comparison,
private copies and identity transitions. Check public/shared gallery retention
and selection, not just the owned catalogue. Reconcile latest main and verify
current-head CI and a real deployment before the wider rollout can merge.

## Offline portable export — 2026-10-17

Theme Studio's existing Transfer → Export / Download uses the dedicated owned
device theme snapshot through `accountExport.ts`. New themes and unsynchronized
edits can download without remote authority, draft saving or a sync receipt.
The canonical transfer collector, serializer and validator remain shared with
normal imports. Portable content includes the name and tokens; account identity,
visibility, active selection and queue metadata are excluded. Folder exports
include retained owned theme children and preserve in-bundle placement.

`api.themes-sync` 1.2.0 adds an explicit home `folderId` (or null) to snapshots.
Older caches cannot silently assume root placement: they require a fresh compatible
snapshot. Same-version metadata upgrades preserve pending token edits. A home
theme cannot be attached to a same-ID folder in a selected custom database.
Prepared downloads recheck theme deletion and workspace identity. Generic
protected mutations remain restricted to their dedicated paths.

`accountThemeExport.test.ts` covers new/pending themes, folder membership,
canonical round-trip with fresh IDs, old metadata, deletion and owner/origin/plane
isolation. `accountApi.test.ts` exercises offline facade dispatch. The native
`accountThemes.browser.test.ts` downloads and validates actual JSON at
1440/390/320px before reconnecting; `themeSync.api.test.ts` checks folder placement
through the normal API and its effect on conditional versions.

## Local import and private duplication — 2026-10-17

The normal JSON/ZIP importer admits account themes through a dedicated hook in
the same local transaction as ordinary Things, ID remapping and folder placement.
Theme content uses canonical validation and becomes a new private copy. Import
does not change active selection. Copy/fork reuse the same exporter/importer.
No account request or draft save is needed for local completion. Invalid content,
quota or cross-plane placement refuses the entire transfer without partial rows.

Imported theme intent uses the existing independent theme sender. Only that
sender waits for an imported folder's account receipt. A frozen request retains
its original content and placement through an uncertain result; later edits queue
behind it. Catalogues keep the 1.2.0 requirement. Commands with folderId negotiate
api.themes-sync 1.3.0; other write and selection minima are unchanged. The canonical
theme writer locks the owned home folder and commits tokens, placement, storage
accounting, protected History and the immutable receipt in one transaction.
Omitting placement preserves the stored folder. Legacy placement requires migration.

Themes stay home-pinned. A selected custom data plane may import an unfiled
theme; a transfer joining it to a selected-plane folder must be imported in the
home library. This preserves the existing managed-placement restriction. Account-authored History,
shared gallery retention and the wider feature matrix remain unfinished.

Run accountThemeImport.test.ts and accountApi.test.ts for atomicity, private
remapping, offline copy/fork, background dependency ordering and scope refusal.
The guarded themeImport.api.test.ts covers real canonical placement, rollback,
immutable replay, private reads and selected-plane boundaries. The native
accountThemeImport.browser.test.ts imports a filed editable theme offline, reloads
and downloads the remapped folder, then reconnects through independent senders.

Local validation (2026-10-17): 104 focused import, copy, export, transport,
receipt and capability checks pass; the full device suite has 518 passes and
60 opt-in skips, plus four offline-shell passes. Conflict copies preserve an
uncached existing folder without waiting for a nonexistent device create;
imported new folders still gate only the background sender. TypeScript retains
the same 91 normalized pre-existing diagnostics. Focused lint has no errors and
the unchanged constructor warning. The final client build passes.

The opt-in real API fixture passes 26 checks with cleanup: placement/content
atomicity, immutable replay, invalid/foreign-folder rollback, omitted-placement
preservation, home/custom boundaries and private reads. The native clean-browser
fixture passes offline normal import, cold reload, canonical folder download,
remapped IDs/tokens and independent private synchronization after reconnect.
It records no offline mutations or page errors and measures/screenshots
1440/390/320px without horizontal overflow. An initial API attempt reached the
stale 1.2.0 process and refused placement; the managed stack was refreshed and
1.3.0 verified before the passing rerun. These are local results only.


## Device library organization — 2026-10-17

The normal library projects owned themes through the dedicated theme adapter.
Mixed moves and deletes commit with ordinary Things in one device transaction;
theme tokens, private audience and the independent sender stay authoritative.
Generic protected content writes remain refused. Deletion clears active selection
and retains a scoped receipt tombstone so delayed catalogue/library reads cannot
resurrect a confirmed deletion.

Ordinary folder deletion drains children to their surviving parent immediately.
Only the remote folder sender waits for theme moves or deletes; uncertain commands
replay unchanged before later placement. Late-retained children are drained through
the same placement hook. Conflicts preserve local content and require review and
folder retry. Custom-plane folders never drain same-ID home placement. The account
worker wakes dependent senders and announces late local placement changes.

Anonymous ordinary folder deletion now has the same preservation behavior, including
standalone file bytes. Explicit recursive deletion still removes descendants;
deleting an active theme/algorithm clears its local selection in that transaction.

Run accountThemeOrganization.test.ts, themeOrganization.test.ts and the existing
account delete/import/export/theme suites. accountThemeOrganization.browser.test.ts
contains separate clean-account and anonymous native-browser flows. Account-authored
History, broader theme/library title editing, home-partition integration, public
and shared gallery retention, identity transitions and the full rollout matrix
still require completion.

Local validation: 525 workspace tests and four offline-shell checks pass; 62
opt-in tests are skipped in that suite. Both organization browser tests ran
explicitly and passed against the built client and isolated API fixture. Account
mixed moves, cold reload, folder drain and deletion synchronize privately after
reconnect; anonymous folder drain and applied-theme deletion make zero account
writes. Screenshots and bounds at 1440/390/320px show no horizontal overflow.
The account run records zero offline device reads or mutations and no page
errors. Device suites pass 80 checks. The client build passes; full TypeScript
retains the same 91 prior diagnostic signatures. Focused lint reports no errors
and five existing warnings across the workspace/device files.

The browser run exposed a remote computer-refresh warning in offline library
browsing. ThingsPage now enables device discovery only for matching authenticated
identity. useDeviceStore pauses remote refresh/event polling when offline, keeps
cached snapshots and resumes on reconnect. It suppresses automatic disconnect
errors without changing remote-action authorization. Broader device cache
origin/plane isolation remains an audit item.

These are local results. CI, deployed acceptance and the full rollout are not
complete. Ignored JSON/screenshots are under
`tmp/account-theme-organization-browser-reviewed/`.


## Offline display titles — 2026-10-18

The normal library Rename dialog now uses a metadata-only local theme operation.
It keeps the source name, tokens, selected theme, ownership and visibility intact.
The existing workspace transaction commits the display title and account intent
together. Stale timestamps, invalid titles, missing ownership and custom-plane
renames refuse without partial changes. Generic protected-content updates remain
unavailable. Anonymous renames record their approved theme History projection
and never construct an account sender.

The existing conditional theme command gains optional `title` in
`api.themes-sync` 1.4.0. Omission preserves stored metadata; explicit null clears
it. Snapshot responses include title or explicit null. Retained older caches
require a metadata refresh before claiming a complete export, and upgrade only
the missing metadata without replacing pending token edits or local title intent.
Lost write replies replay the original immutable command before later renames.
The canonical writer commits content, title, accounting, History and receipt
together. Existing home title changes require home selection; independent new
copies can carry their own title under a custom selection.

Portable `thingtime.transfer` v1 theme crystals retain optional display titles.
Normal server import/export and local remapped copies use the same validator;
owned title metadata is read with the existing home-library boundary. Public
theme projections remain unchanged. Import/export capabilities advance to
1.12.0 / 1.16.0, and first-party clients negotiate them before remote transfer.

Local validation: 529 workspace checks and four offline-shell checks pass; 62
opt-in cases remain skipped in that default suite. Both title/organization browser
cases ran explicitly against the built client and disposable loopback API and
passed. Normal anonymous/account Rename survives cold offline reload at
1440/390/320px with no page errors or offline account mutations. Account title,
source name, folder moves, folder drain and deletion converge after reconnect.
The live API fixture proves title/content/receipt atomicity, exact replay,
changed-replay refusal, omitted-title preservation, explicit-null clearing,
foreign-folder/custom-plane refusal and normal canonical export/import into a
fresh private ID. Fixture entries are cleaned through the API. Evidence:
`tmp/theme-title-live-api/` and `tmp/theme-title-live-browser/`.

The first account browser run exposed a duplicate capability preflight in the
library Rename UI. The selected adapter now owns capability negotiation: local
completion needs no network manifest, while remote mutation still uses the
existing negotiated adapter. The rebuilt-client rerun passes both account and
anonymous cases. The client build passes; TypeScript reports the same 91 baseline
diagnostics (47 distinct normalized signatures), and focused lint has no errors
and six pre-existing warnings. Capability and title/transport/transfer checks pass.
These are local results; current-head CI and deployed acceptance are unverified.

Wider protected-kind renaming, account theme History, home-partition integration,
shared gallery retention and the full matrix remain open.


## Stable home receipts — 2026-10-18

New device theme and active-selection commands freeze `receiptPlane: home`
with their immutable request. `/api/v1/themes/sync` 1.5.0 accepts an explicit
`context: { storagePlane: "home", receiptPlane }` for `write` and `select`.
The current selected-plane header, full account, origin and repeated admission
checks still apply. Context selects no database and carries no authorization.
The canonical home writer still validates folder ownership, theme access,
versions, quota and protected Timeline receipts.

An older pending command without this field retains its original selected-plane
receipt identity. Migration code must store that original plane before moving
the record; changing it to home would change the digest and turn an uncertain
retry into a conflicting request. A retry keeps both the command and context
unchanged even when later device edits have completed. Legacy requests without
context preserve their previous placement/title restrictions. Explicit home
context permits owned home metadata changes while another content plane is
selected, and never permits a custom-plane or foreign folder as home placement.

The isolated `themeImport.api.test.ts` fixture checks real receipts across a
selected-plane switch, old command replay, altered context/content refusal,
home-folder ownership, selection replay without reapplying an old choice, and
normal private transfer import/export. It uses disposable loopback accounts and
cleans fixture entries through normal APIs. Run it with
`TT_THEME_IMPORT_API_URL`, `TT_THEME_IMPORT_API_ARTIFACTS`, and
`TT_SHARED_PLAYWRIGHT_PATH`; it refuses a non-isolated database.

This is receipt compatibility for the home-cache integration. The device theme
cache still uses the selected-plane partition. Lossless consolidation of old
partitions, mixed imports, cross-tab home invalidation and account theme History
remain unfinished. No cache migration is enabled by this increment.
