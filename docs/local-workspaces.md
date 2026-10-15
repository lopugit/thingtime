# Local workspaces

Implementation in progress on `codex/anonymous-local-first`. This is the normal
Thingtime application, separate from the stateless agent export sandbox in
[no-login-draft-preview.md](no-login-draft-preview.md). The full local-first
rollout is **not ready to merge** until the outstanding rows below are verified.

## Audit of existing support

- `ThingtimeProvider` already persists the legacy editable tree with localforage,
  serialized autosave and cross-tab updates. Account keys remain isolated. The automatic legacy anonymous workspace
  claim is removed; existing account keys are preserved and anonymous data stays
  in its original namespace until an explicit transfer.
- Timeline already has canonical event/link records, IndexedDB recovery, branch
  and note queues. Its provider currently discovers an authenticated remote
  scope before connecting those facilities to editors.
- Account drafts already have bounded snapshots, immutable write IDs, revision
  conflicts, discard tombstones and independent template copies.
- `/things` previously created a server temporary account automatically. That
  was a remote account, not a browser-only workspace. This branch removes that
  implicit request; explicit authentication endpoints retain their checks.
- Modern Things, Builder, components, schemas, Actions, themes and algorithms
  mostly use `useApi`, with additional direct clients for drafts, webpage
  resolution, suite installation, attachments and Actions.
- The existing media service worker reauthorizes private media on every use,
  including cache hits. It cannot be used as an offline private-media bypass.
  It did not previously cache the static app shell or route chunks.

## Storage and authority

`app/local-workspace` is a browser adapter behind the existing application API.
UI components do not open IndexedDB themselves. Local records use the shared
Thing crystal validator, composition reference rewriter and portable transfer
collector/validator. Local bookkeeping is excluded from exported content.

The anonymous namespace belongs to this browser origin. It is distinct from
every signed-in account, API origin and remote data plane. `useWorkspaceUser`
supplies content ownership to local-capable editors; `useCurrentUser` remains
the authentication hook. Local identity is not accepted by server endpoints.
Identity changes invalidate outstanding local operations and abort transactions.
Anonymous work is never implicitly adopted by or uploaded to a later login.

Writes and quota accounting are transactional across tabs. Current bounds are
10,000 records, 1 MiB per record and 64 MiB per workspace. Failed saves report an
error; failed imports roll back. Optimistic concurrency checks retain an editor's
base timestamp. Files require the dedicated local attachment adapter rather than
reusing account attachment IDs.

Anonymous public catalog reads omit credentials. Public catalog cache entries
grant no ownership or write permission. Local writes and cloud operations have
explicitly different implementations; a missing local implementation fails
rather than falling through to an account mutation.

The offline app shell contains only build-produced static files. The build
manifest pins sizes and SHA-256 checksums, caps assets at 2,500 / 96 MiB and uses
four download workers with a 90-second overall deadline. A partial or mixed
deployment cannot become a ready offline shell. Account API responses, bearer
URLs and private media are excluded. The existing media authorization checks
remain in place. The local root fallback stores a confirmed anonymous marker or a minimal account
workspace pointer (origin, account ID and data plane). It never stores a profile
or credential, and an offline root has `user: null`. Local content identity
cannot authorize remote requests. Only the latest accepted root response may
change this pointer; logout/account changes revoke it.

## Coverage and remaining acceptance work

| Area | Current evidence / required completion |
| --- | --- |
| Local storage and account boundaries | Unit-tested persistence, atomic rollback, concurrent edits, scope isolation and identity invalidation. Add browser multi-tab and account-switch regressions. |
| Builder pages | Live logged-out create, text edit, save and reload verified. Component reference maps now reuse canonical selection, with export/render agreement tested for versioned aliases. Finish responsive, component UI, global/site block and interaction checks. |
| Things and folders | Core CRUD, folder placement, cycle checks, copy/move/delete and portable text/component transfer implemented. Finish all normal UI flows and search. |
| Drafts and templates | Shared snapshot/retry/conflict/tombstone semantics implemented locally and unit-tested. Finish template UI, attachment copying, definition/schema recovery. |
| Components and schemas | Local storage and public discovery adapter started. Finish bundled catalog availability, copies, argument editing, schema forms and offline creation. |
| Actions and app suites | Reuse existing bounded executors and suite definitions. Local data/pure/browser operations still need local host integration; remote services must remain explicitly remote. |
| Timeline | Reuse existing records, history UI, drafts, branches, notes, version names, restore and merge. Local authority/transport integration remains outstanding. |
| Attachments and media | Add local blob lifecycle, metadata, rendering, import/export and quota accounting. Never treat a cached cloud attachment as locally authorized bytes. |
| Posts, comments and saved items | Enable local content authoring/drafts and local relationships. Public posting, remote reactions and recipient delivery remain authenticated operations. |
| Themes, visual settings and algorithms | Anonymous saved-theme CRUD, active selection, quota and canonical transfer now work through Theme Studio and have offline browser evidence. Account theme sync, local Timeline history and algorithm library support remain outstanding. |
| Passwords | Audit and implement local encrypted storage/unlock using the existing vault contract. No plaintext substitution or server-password bypass. |
| Apps, integrations and native/browser tools | Separate locally available adapters from paired remote devices, external services and their consent requirements. Verify each applicable local surface. |
| Lopu and automation | Local documents, authored definitions and drafts should remain editable. Provider inference, external delivery and hosted scheduled execution still need their real services. |
| Auth, social, remote devices, billing and admin | Remote authority is retained. Do not substitute a local actor for a signed-in account. |
| Offline startup | Verified static-shell cache implementation and policy tests added. Production-build offline reload, editing, save and second reload passed in a clean local origin. A rebuilt shell also passed account cold reload/edit/reload with no networking. Continue route navigation, update recovery and cross-account browser coverage. |
| Signed-in local-first operation | Owned data/folder/page/component/schema/Action creates and updates now have an atomic account-scoped queue, immutable ambiguous retries, conditional updates and reviewed conflict choices. Native Builder resolves pending pages locally. Local fixture create/edit/reload/reconnect and conflict review passed. Account offline cold startup, native page editing and reconnect verification now pass locally. Complete deletion/moves/imports, attachments, all dedicated adapters, online cached-list membership/pagination and multi-tab UI refresh before merge. No anonymous sync queue may be replayed as account content. |

## Development verification

Run `npm --prefix remix run test:local-workspace` for the storage, draft,
transport and offline-shell tests. Run the existing media-cache suite as well:
`node --test remix/scripts/media-cache.test.mjs`.

`npm --prefix remix run build:client` now prepares the static offline manifest.
Development HMR modules are deliberately not cached. Test offline startup
against a production client build, using an isolated test origin and clean
browser profile. Keep Mongo/account fixtures disposable and use the real APIs
for any authenticated test setup.

The browser evidence in this document is local. Consult PR #1000 checks for the
exact pushed revision; the full rollout has not been merged.


Posting independence is delivered separately in [PR #999](https://github.com/lopugit/thingtime/pull/999).
Posts, edits, rich comments and plain comments/replies no longer await draft
sync or cleanup. Local browser acceptance blocked the draft endpoint while a
private post and mobile comment/reply still completed. This does not imply the
full anonymous/offline feature matrix above is complete.

## Account sync checkpoint — 2026-10-16

`accountSync.ts` commits canonical Thing content and its queue entry in the same
IndexedDB transaction. Scopes include origin, account ID and data plane. Every
remote read and write carries the existing expected-actor and expected-data-plane
headers. Session mismatch invalidates the worker and refreshes root identity;
temporary/anonymous sessions do not start account workers. No anonymous-to-account
migration occurs.

Ambiguous outcomes retain the exact frozen create/update body. Create IDs are
stable UUIDs; updates use the acknowledged server timestamp. A lost response is
acknowledged only after an owned, matching readback. Account timestamps and local
editor tokens are separate, so acknowledging sync does not invalidate the next
save. Definitive validation failures allow corrected content to be retried.
Unsupported fields retain their dedicated adapter; pending local writes refuse
an incompatible online mutation rather than dropping attachments or controls.

Conflicts stop automatic replay. The review UI compares both versions and lets
the user keep either one. Applying a choice rechecks the reviewed server timestamp
and local revision. Typing, another tab or another device invalidates stale review.
Keeping the local version sends a fresh conditional write; keeping the account
version invalidates old editor tokens. This is explicit replacement, not an
automatic semantic merge.

Native Builder reads the same local page/component data, reusing the canonical
component selector. Previously authorized component dependencies are cached under
the account/page scope without ownership or bearer credentials. Missing dependencies
fail explicitly. The account queue does not execute authored Actions.

Local browser evidence used a disposable private fixture on Vite `22460`, Nitro
`22462` and an isolated Mongo replica on `22463`. Blocking the Things and webpage
resolver endpoints still allowed create, edit, save, native render and reload.
Unblocking and retrying produced the same private Thing on the fixture server.
A concurrent server edit produced a conflict; explicit keep-local then synced the
reviewed content. The sync panel was measured at 320/390 CSS pixels with no
horizontal overflow and at 1440×1000. Test network/viewport overrides were removed
and the fixture was logged out. This is endpoint-outage recovery with an available
root session, **not proof of signed-in cold startup completely offline**.

Retained local evidence (ignored, not deployed):
`tmp/draft-qa/account-conflict-desktop.png`,
`tmp/draft-qa/account-conflict-320.png`,
`tmp/account-sync/remote-verification.json`.

## Offline account startup checkpoint — 2026-10-16

The browser can reopen its last confirmed account workspace after a retryable
root/network failure. That fallback contains no authenticated user, profile,
permissions, session or deployment environment. The ordinary authentication hook
continues to return null. A separate content-ownership hook keeps the editor and
local tree in the same origin/account/data-plane namespace, avoiding a switch to
anonymous storage or loss of unsaved editing when connectivity changes.

Account transport rechecks current remote confirmation before capabilities,
before the request and after its response. Losing confirmation aborts the remote
lease permanently, even if the same account later reconnects. Unsupported remote
API fallthrough and account drafts refuse an unconfirmed workspace. A real root
response must confirm the account before queued sync resumes. Anonymous work
never starts that worker. The legacy tree no longer implicitly copies anonymous
content into a first account; previously saved account keys remain intact.

Root binding and persistent pointer changes now occur only after the root
loader's latest-request/generation fence. An older successful or failed request
cannot overwrite or revoke a newer accepted identity. Stale offline pointers,
wrong origins, malformed account IDs, invalid database names, pending identity
changes and authoritative root refusals fail closed.

An offline Builder list can use saved local records even when its exact server
page was never loaded. It uses distinct `device:` cursors, batch projections and
an explicit incomplete-library notice. It does not claim the entire remote
account library is present. Remote pagination cursors cannot be reused offline.
Reconnection and renewed account confirmation restart the list at its first
page without clearing the visible rows. Background refresh does not replace
cached content with a loading spinner.

Production-build local acceptance on `http://127.0.0.1:22470` verified account
page cold reload while fully offline, editable native text, local save and a
second offline reload. Network observations showed no mutation requests while
offline, or after networking resumed with `/api/root-data` deliberately blocked.
A separate authenticated fixture API read confirmed the server copy was unchanged.
After root verification was restored, the queued edit reached the same private
Thing. A separate unsaved page-name edit survived offline-to-authenticated root
reconnection and then saved successfully. Only disposable local fixture data was
changed; this is not deployed or CI verification.

The offline library was also checked at 1440×1000 and 390×844; the phone
document had no horizontal overflow. Reconnecting cleared the device-only
notice without a reload. Evidence: `tmp/draft-qa/account-offline-library-desktop.png`
and `tmp/draft-qa/account-offline-library-390.png`.

The checkpoint suites passed 297 tests with four opt-in skips across local
workspace/offline shell, root data, webpages, autosave and drafts. The client
build succeeded with 230 verified offline assets. Raw TypeScript still reports
91 existing baseline diagnostics; none matched the changed files. Full feature
acceptance, CI and deployment remain outstanding.


## Anonymous saved themes and storage recovery — 2026-10-16

Theme Studio now saves named themes in the anonymous workspace, using the same
`normalizeSavedTheme` token sanitizer as the account writer. Generic mutations
still refuse the protected theme kind. Dedicated save/delete/active operations
stay local; canonical imports validate theme-only content, mint fresh local IDs,
and enforce the 100-theme limit transactionally. Imports do not change the active
selection. Export excludes local identity and visibility bookkeeping.

A production-build browser check with no account session verified save, reload,
fully offline cold load, edit/save and a second offline reload. The standard
Transfer UI downloaded valid canonical JSON and imported a second editable copy;
apply and delete also worked offline. Save/delete network captures contained no
mutation requests. The library fit 1440×1000, 390×844 and 320px with no horizontal
overflow. Disposable local themes and browser overrides were cleaned up. Evidence:
`tmp/draft-qa/anonymous-theme-export.json`, `anonymous-themes-offline-desktop.png`
and `anonymous-themes-offline-390.png` in the same directory.

Public profiles, activity, people search and shared themes remain available
without login through credential-free public reads; the explicit public waitlist
writer remains available. Retired anonymous API facades cannot run those callbacks
under a later account. Account theme synchronization and local Timeline history
are still separate outstanding work; this is not full theme-family acceptance.

Authoritative root refusals now invalidate active local editors and remote
workers as well as the saved fallback pointer. Reconfirming the same account
cannot revive a retired operation. IndexedDB opening has a ten-second bound,
clear blocked/error/closed diagnostics, retry after failure and cleanup of late
upgrade/success callbacks. Focused regression tests cover these failure paths.
