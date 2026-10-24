# TESTING.md — per-area manual test checklists

## Account large files

- [x] Save a 70 MiB file offline through the normal file browser; cold reload and download exact bytes before upload. Reconnect and verify the real private upload.
- [x] In a fresh browser context without paired-device capabilities, download that account file; the paired-device 32 MiB limit must not block it. Open the normal inspector to retain the original, cold reload offline and verify the independent SHA-256 again. Guest and foreign-owner retention reads remain refused.
- [x] Scroll the file browser top to bottom at 1440×1000, 390×844 and 320px; no overflow, page errors, whole-file reads or offline mutation requests.

## Characters

- [x] Switching a composer Character leaves exactly one editor and the matching sync panel; duplicate sibling React keys must not retain an old actor’s composer. The native check also verifies roster refresh when the same root workspace regains confirmation.

- [x] Load the owner-only Character roster, go offline and cold reload. Save distinct drafts as the owner and two Characters; switch back, reload and open the normal draft picker. Each identity must retain only its own drafts, without HTTP writes. Check the picker and sync panel at 1440, 390 and 320px.
- [x] Reconnect with confirmed authority while draft sync returns 503. Character posting must complete independently; verify the server author ID, private visibility and anonymous 404. Review/retry must leave saved draft content intact.
- [x] Local regression: delegated draft partitions include principal, actor, origin and data plane. Direct Character sign-in cannot adopt a delegated partition; retired callbacks and anonymous scopes cannot reopen it. Retained selector labels contain no credentials/profile/admin grants.

- [x] Isolated real API + desktop/390px browser acceptance (2026-10-18): create a separate-login Character, select/restore the session, post, comment, reply and post in a private subspace; compare persisted author IDs. API checks cover all login modes, membership denial, owner privacy, tier changes and revocation.
- [x] Type immediately into a newly mounted editor after changing Character. Post must become enabled without another keystroke; initial editor setup must reconcile input made before listeners attach.

- [ ] Create switch-only, inherited-password and separate-password Characters through Settings. Reload and verify their generated IDs, names and modes against the owner-only API roster.
- [ ] Inherited login follows the owner's current password and email second factor. Separate login rejects the owner's password; switch-only rejects password login.
- [ ] Post, comment and reply as each identity. Public profiles/posts never reveal the private owner ID; direct Character sessions cannot list siblings, select the owner or become admins.
- [ ] Lock one session to a Character; another session remains unchanged. The account roster continues to represent the authenticated principal. Return to the owner and verify its session still works.
- [ ] After Character writes, verify both its ledger and the owner's ledger remain valid. Change the owner's tier/overrides and verify Character reads and write admission agree without copying owner audit fields or usage.
- [ ] Private-subspace post cards describe their membership restriction rather than claiming anyone can see them.
- [ ] A Character cannot read or post in a private subspace before explicit membership; after admission it can coordinate through posts/comments, while a stranger remains blocked.
- [ ] Disable a Character after login and while selected; revoke direct sessions and reject further login/posts. Re-enable without restoring revoked credentials. Unavailable selections never fall back to anonymous authorship.
- [ ] Switch composer identities with unsaved drafts/media; drafts remain account-specific, delayed requests retain their actor, and a restored media preview reauthorizes the selected Character.
- [ ] Inspect settings, post/comment composers, selectors and session controls at desktop and 390px widths. Scroll top to bottom and open dynamic controls; no horizontal overflow, clipping or overlapping text.
- [ ] Confirm admin ownership lookup works and non-admin/Character sessions cannot use it. Verify scoped app/PAT tokens cannot adopt another identity.


## Agent browsers and editable tasks

- [ ] Install the task suite, create a task, add/complete todos and append progress;
      compare the rendered records with API readback and reload both pages.
- [ ] Exercise browser install, cancellation, duplication, exclusive claims,
      launch, live view, mobile/desktop sizes, scrolling and release in the
      installed Mac app; scroll the controls and task pages from top to bottom.
- [ ] Device defaults and the per-task checkbox persist. Existing claims keep
      their effective policy after defaults or task preferences change.
- [ ] Two agents run the full app concurrently with separate MongoDB records,
      cookies, storage and profiles; crossed lease IDs/tokens are refused.
- [ ] Isolated IPv4/IPv6, direct-IP and redirected external requests fail from
      browser and backend. Restricted rules permit only the selected IP/ports.
- [ ] Missing test auth/database configuration fails closed. The bundled app is
      readable by the actual non-root container UID, and Mongo startup retries
      recover from an initial connection refusal using a fresh client.
- [ ] `/index.html` and a deep route such as `/login` reference the same client
      module, and that module returns JavaScript rather than fallback HTML.
- [ ] Expiry, release, failed launch and app restart clean only owned sessions;
      a live controller cannot be replaced and old handles cannot claim a new lease.
- [ ] Native publisher downloads retain signatures and hashes; duplicated
      unrestricted browsers start without personal cookies or saved storage.
- [ ] The signed and unsigned packaged-module checks load the native driver
      and Puppeteer from the app archive and verify the separate container
      resources. Launch the installed app; a valid signature alone cannot catch
      a runtime module accidentally excluded by `extraResources`.
- [ ] Build and launch the full container from the packaged Mac app. Its traced
      bcrypt, Sharp/libvips, resvg and cbor-extract dependencies must load their
      locked Linux builds through the app resolver. A version mismatch or missing
      native binary fails image installation before it can be claimed.

- [ ] A daemon disconnect during release reports failure and retains the claim;
      after recovery, release removes only the verified owned resources.
- [ ] Quit during container/native preparation and native duplication: no
      background install or copy persists after shutdown completes.
- [ ] Switching database identity with the same owner/task IDs never reuses
      the previous database's native registration, claim or live view.

See [the runbook](docs/agent-browsers.md) for commands and evidence boundaries.

## Agent overview and task reporting

- [ ] Author the dashboard page, components, schema references and write
      Actions as saved Things in Thingtime. Confirm no account-specific Thing
      definitions or credentials are committed with the reusable adapter.
- [ ] Use an external `AGENT_OVERVIEW_AUTHORED_THINGS` JSON fixture to identify
      disposable local saved Things. Keep it outside Git and verify selected
      origin, IDs and `api.agent-overview` 2.0.0 before the run.
- [ ] Compare project/task/agent records and relational todo, question and
      progress Things with ordinary API readback under the same authorized
      viewer. Verify ACL, Character, app namespace and scoped-token boundaries.
- [ ] Exercise hierarchy, projects, agents, kanban, reports and questions
      views; search/status/project filters; optional CSV active/blocked/complete
      classifications; and cursor paging beyond 50 rows.
- [ ] Change classifications or another cursor-bound filter and confirm the
      old cursor is rejected. Confirm raw statuses, numeric depth and absent
      titles are left for saved-page presentation; no indent, label or fallback
      title is expected from the API.
- [ ] Confirm complete versus partial coverage and lower-bound partial counts.
      Include detached parents and cycles; preserve rows and identify unresolved
      parents until their scan completes.
- [ ] Leave measurements unknown and verify null/unavailable display, never
      fabricated zero or inferred runtime. Record only measured values and
      compare them against source Things.
- [ ] Receive a stream snapshot, heartbeat and changed snapshot. Reconnect to
      the current view without claiming event replay. Revoke access or change
      data plane during streaming; stop presenting prior data as current.
- [ ] In Builder, independently edit nested text, controls, icons and repeated
      fields in the externally authored saved page. Save/reload and confirm
      behavior; inspect desktop/mobile top-to-bottom and expanded controls.
- [ ] Confirm no automatic ChatGPT/Codex transcript, tool, billing-token or
      process-state capture is claimed by the read adapter.

See [the adapter guide](docs/agent-overview.md) for the contract, external
fixture boundary, coverage, stream recovery and Builder acceptance.

- [ ] After merging another feature, password title search still filters before pagination, preserves q across pages, and both manifests advertise api.passwords 1.2.0; client and route search tests remain present.

## Local workspaces and account sync (in-progress rollout)

- [x] Retained account discussions: create a private Thing and comment through
      the real local API/native composer, visit the comment permalink, then cold
      reload both surfaces fully offline. Retain exact comment-only kinds and
      authors, show partial coverage, refresh without remote writes, and check
      1440/390/320px bounds. Delete the remote target, observe its refusal, then
      verify both offline views omit the old comment. Run
      `accountDiscussions.browser.test.ts`, the recording lifecycle browser
      fixture (including already-retained offline file comments), and existing
      `accountPosts.browser.test.ts`. Unit coverage must fence late reads across
      both projection caches at byte/record quota, preserve authored data and
      isolate account/data-plane/cursor scopes. New account comments/replies,
      complete page membership and parent-thread offline recovery remain open.

- [x] Anonymous imported file metadata: in a clean no-account browser, import a
      standalone recording ZIP offline through Things. Open its native detail,
      edit title, description and display filename, and cold reload. Download
      the folder through the normal export dialog; canonical annotations and
      exact original bytes must survive with no UI capability field in the JSON.
      Reconnect and verify zero remote writes. Check 1440/390/320px and retain
      account upload/retention/deletion coverage in
      `accountRecordingImport.browser.test.ts`. Imported `local-` IDs and upload
      `local-file-` IDs must both work; ID prefixes alone must never grant edits.
      Foreign workspace, shared-link and bound/draft UI eligibility stay refused.

- [x] Existing account-file retention: open an owned standalone original through
      the normal media route. Inject truncated bytes: show a retention warning
      and preserve the valid online view. Retry; edit details offline and download
      identical bytes. Production build: cold reload before and after editing,
      reconnect and verify the original account file, with zero upload requests.
      Check native rendering at 1440/390/320px and one Files-list alias. Drop a
      successful deletion reply and verify identical durable receipt retry.
      `accountFileRetention.browser.test.ts` uses explicit loopback/admin
      fixtures; `TT_LOCAL_FILE_RETENTION_COLD=1` selects production-shell mode.
      Unit coverage must refuse foreign/shared/linked/bound/blocked content,
      changed descriptors, quota overflow, expired leases and late transactions;
      retain conflicting edits and keep the original alias on upload completion.
      Full-quota deletion and three-file concurrency admission must pass.
      Unvisited files, parent-folder discovery and managed/bound media remain open.

- [x] Existing saved-file deletion receipts: in a disposable account, upload a
      standalone file through the real storage lifecycle, then delete it with
      `retainReceipt:true`, canonical `id` and a freshly read `expectedUpdatedAt`,
      without its original upload request ID. Replaying after discarding the
      response must return `deleted:true` and refuse the late original start.
      Missing IDs return 404 without reserving a row. Guest, foreign owner/admin,
      cross-origin, Watch durable operations, stale versions, bound/linked/import
      drafts and unfinished uploads remain refused. Race an annotation with
      deletion: exactly one wins. A lost cleanup claim or unconfirmed legacy
      removal must not return a durable acknowledgement. Run attachment and
      capability suites, `accountExistingFile.browser.test.ts` and the existing
      `accountFiles.browser.test.ts` with their explicit loopback/admin fixtures.
      Verify built attachment-delete 1.4.0 in both discovery manifests and docs.
      Opened standalone originals are covered by the retention check above;
      wider media retention remains outstanding.

- [ ] Normal account files: use the Files picker offline, create a folder, move
      the file with Cut/Paste, download identical bytes and open its native media
      route at 1440/390/320px. Local completion must not await account listing or
      upload. Reconnect through the normal approval/upload lifecycle; own server
      aliases must appear once under their stable local ID. Shared media contexts
      and keyed URLs must never resolve viewer device bytes. Cancellation may
      retain recovery bytes, but ordinary reads and previews must refuse them.
      Check scope retirement, scope-only tab invalidation, late reads, deletion
      and restoration. Run `accountFileUi.browser.test.ts`,
      `accountFiles.browser.test.ts`, workspace, Things and attachment suites.
      Existing account files not retained on this device, managed imports and
      broader list membership remain separate acceptance gates.

- [ ] Completed file deletion: delete an uploaded standalone file while offline
      and with browser storage exhausted. It disappears from Things immediately;
      recovery bytes remain private until an exact durable acknowledgement.
      Change account details, reject a stale native review, restore the device
      file at full quota, and delete it again without losing the worker wake.
      Race the reviewed deletion with annotation: exactly one succeeds. Drop a
      successful deletion reply; retries must reuse the frozen version/request,
      eventually release bytes, and reject a late original upload start. Legacy
      cleanup must retain the receipt. Test missing-file reads, malformed replies,
      bound/unfinished refusal, metadata pause, storage reopen and native review
      at 1440/390/320px. A delayed moderation verdict must not modify deleting or
      cancelled files. Run workspace, attachment, moderation and capability
      suites and the enabled file browser fixture. Built delete 1.3.0 must be
      discoverable; anonymous and Watch request-id mutations remain refused.
      Existing remote file retention and broader media integration are still outstanding.

- [ ] Durable upload cancellation: cancel a never-started local file offline
      with no remote calls. Lose a real start reply, cancel from the native sync
      panel offline, and verify bytes remain until a durable cancellation reply.
      Lose that reply too; reconnect/retry must remove device bytes without
      re-uploading. Replaying the original request, including after legacy
      abort/delete, must fail. Cancel-before-start and concurrent start/cancel
      must leave one private quota-accounted zero-object receipt with no expiry.
      Finalized, finalizing and bound uploads require reviewed deletion; legacy
      or malformed acknowledgements must retain bytes. Check competing tabs,
      owner/origin/plane isolation, original save replay refusal, cancellation at the
      exhausted browser storage (both never-started and attempted uploads), and
      multipart settlement. Verify native controls at 1440/390/320px, abort 1.2.0
      in both built manifests, anonymous 401 and Watch refusal for the new mode.
      Run workspace, attachment, storage, schema, Things and capability suites,
      plus the enabled account file browser fixture. This is cancellation of
      queued files, not acceptance of the unfinished ordinary account file UI.

- [ ] Conditional file deletion: malformed versions fail 400, stale versions
      fail 409 without touching bytes, and a real annotation/delete race using
      one timestamp has exactly one winner. Repeat deletion after a lost reply;
      content must remain 404. Existing deleting rows must resume cleanup with
      the original timestamp, preserving multipart deferral and quota billing.
      A skipped claim with a live row must not return completed success. Run
      attachment/capability suites and the enabled account file browser fixture;
      verify built manifests and docs advertise delete 1.3.0 and anonymous calls
      remain 401. Missing rows are not proof of durable upload cancellation;
      durable request-id mode below provides that fence.

- [ ] Account file details: save annotations and a folder selection offline,
      reopen storage, reconnect, and wait for the file and folder dependencies.
      Drop a successful annotation reply; recovery must retain newer local edits
      and never upload the bytes again. Concurrent same-field changes require
      comparison; unrelated account changes merge. Check stale review refusal,
      Keep device/account choices, competing tabs, cancellation, quota rollback,
      and original save retries after filing. Review at 1440/390/320px. Run
      `accountFileMetadata.test.ts` and the real `accountFiles.browser.test.ts`.
      The browser fixture must import the app's exact Vite module URLs after HMR,
      never a second bare-import workspace singleton. Normal account picker,
      listing/media still have separate completion gates.

- [ ] Conditional file metadata: run attachment, Things, capability and local
      workspace suites, then enable `accountFiles.browser.test.ts`. Concurrent
      annotations using one version must have one winner and one 409; stale
      annotation/move must preserve current metadata, placement and bytes.
      Malformed versions and conditional multi-item/non-move requests fail 400.
      Verify both built-server manifests advertise annotation 1.2.0/bulk 1.6.0,
      docs routes return JSON, and anonymous mutations remain 401. Clean completed
      fixture uploads with `/attachments/delete`, assert success and content 404;
      generic Thing DELETE cannot prove cleanup of protected attachments. Close
      test browsers even when cleanup fails. These checks do not claim native
      account picker or durable metadata reconciliation acceptance.


- [ ] Durable account file adapter: `accountFiles.test.ts` and
      `accountTransport.test.ts` cover atomic metadata/bytes/intent quota rollback,
      original request identity, checksum-locked parts, permission refusals,
      malformed plans, tab claims, cancellation, credentialless signed PUTs and
      completion-only retry after a lost response. Enable
      `accountFiles.browser.test.ts` against the disposable Vite/replica fixture
      documented in README. Save bytes with the browser fully offline; verify
      zero mutations, normal approval refusal, private upload after fixture-admin
      approval, one byte PUT after a dropped completion reply, exact owner bytes,
      guest 404, and the open retry panel at 1440/390/320px. Relative signed URLs
      resolve at the current origin; do not loosen CSP for a different local
      storage port. This checks the internal adapter, not the pending account
      file picker/media/post-binding implementation.


- [ ] Search → This device: normal-import more than 20 local Things, disconnect,
      search and page them, add numeric/nested/tag/date field filters, and reload.
      Invalid paths/operators/types must show errors while keeping prior results.
      No local query sends an API search or mutation. Switch to Online search and
      back: caches, pages and cursors stay separated. Check 1440/390/320px bounds.
      In a disposable account compare field results with the real API, cold-reload
      device search and confirm a separate anonymous context sees no private rows.
      Also run `structuredSearch.test.ts`, `publicSearch.test.ts`, API facade tests
      and opt-in `structuredSearch.browser.test.ts`. Prototype names must never
      become datatype aliases; unsupported shortcuts/ranking fail explicitly.

- [ ] In a disposable local account, move multiple ordinary Things into a folder
      offline, cold-navigate/reload that folder, then reconnect. The server must
      remain unchanged until the account is verified; sync must carry actor,
      data-plane and timestamp preconditions. Check new-folder ordering, move to
      root, ambiguous retries followed by another move, conflict review, and
      whole-batch rollback for cycles/missing sync bases. An unavailable remote
      archive probe must reject a promise and never unmount the local folder.
      Fresh and cached listings must respect pending local placement. Run
      `accountSync.test.ts`, `accountApi.test.ts` and opt-in
      `accountMove.browser.test.ts`; verify 1440/390/320px and fixture cleanup.

- [ ] Settings → Things → Device storage works without login and after a cold
      offline reload. Import a local Thing in another tab and refresh the meter;
      it includes local History/internal records without requesting an account.
      A missing, malformed or count-mismatched ledger must show unavailable and
      preserve last-known usage/content. Retry after repair must converge. Test
      zero-byte files, quota rollback and every scope; account/origin/data-plane
      changes retire pending reads immediately. Reading protection must never
      call `persist()`. Explicit requests must report granted/denied/unsupported,
      failed/timeout and stale-workspace outcomes accurately. A late `persisted()`
      response after timeout must not start a protection request. Check desktop,
      390/320px and normal Things/History links. Run `storageStatus.test.ts` and
      the opt-in `storage.browser.test.ts` against a production client build.

- [ ] After saving local content, find Timeline in Things and library search,
      open it, cold-reload offline, return to Things and rename a local item.
      Reload again and verify the name without a capability-manifest request.
      Check 1440/390/320px, managed folder menu restrictions, paged membership,
      retained history after current-content deletion and no account partition
      leakage. Ordinary rename/move/delete/export, target/folder placement and
      import into Timeline must fail without changing content. Run the local
      Timeline unit and native browser regressions.

- [ ] Restore a page with recorded components offline, open its `restored-` copy
      from Things, verify the native preview, add a comment/nested reply, rename,
      and cold-reload at desktop/390/320px. No account Timeline/mutation HTTP or
      public fetch for the restored identity may occur. Local browser Actions
      must read/update/delete the copy without altering the shared original.
      A deleted copy must stay local-not-found; a public same-format ID must still
      use credential-free reads. An ID present only in an account partition must
      grant no anonymous mutation/Action access. Switch workspace while routing
      and reject the stale read before transport. Run `restoredRouting.test.ts`
      and both offline History/detail browser regressions.

- [ ] Anonymous History export: offline, name a saved version, add a note, change
      the current Thing and export the earlier version. Inspect the actual JSON:
      original content/event/receipt, selected name and notes, no account HTTP.
      Cold-reload and export a deletion's before-image. Missing compact ancestry
      and oversized archives must fail clearly with retained history unchanged;
      closing the editor or changing workspace must not trigger a late download.
      History archives preserve dependency references, not inline transfer data.
      For portable historical content, restore recorded components and use normal
      Thing export/import; verify remapped IDs and unchanged shared components.
      Run `timelineExport.test.ts`, the offline History browser download and the
      guarded `timeline-versions.integration.mts` account regression.

- [ ] Anonymous History: offline, undo one saved edit while preserving later
      independent fields, merge a variation into current content, and restore an
      earlier page with recorded components. Verify native previews and Builder
      cold reload at desktop/390/320px with no mutation/account Timeline HTTP.
      Recorded copies must not change shared components or sibling pages. Recover
      a deleted ordinary Thing with its original identity; a deleted folder falls
      back to Things. Replays must return the original receipt; stale heads and
      component edits between review/commit must fail. Inject an aborted or failed
      receipt write and verify content, copies, history and quota roll back.
      Retained drafts must still pass normal schema validation on apply. Run
      `timelineVersions.test.ts`, the offline History browser test and both
      guarded version/component API integrations against a disposable replica.

- [ ] Anonymous branch merges: offline, select a version and use the variation
      row's Review and combine control. Resolve all content/component conflicts,
      preview recorded definitions, save, and cold-reload in Builder. Verify
      desktop/390/320px and zero account/mutation HTTP requests. The current Thing
      must remain unchanged. Invalid choices and retired/foreign scopes fail;
      stale-head pushes retain the proposal; oversized captures fail before
      payload decoding. Run `timelineBranchMerge.test.ts`, the offline History
      browser test and guarded `timeline-branches.integration.mts` account parity.

- [ ] Anonymous variations: while offline, select a saved version, create a
      variation, edit its fields, open it in Builder, save and cold-reload.
      Recorded components must render with Actions/live data paused, and the
      current Thing must remain unchanged. Check 1440/390/320px, including the
      phone inspector and unobstructed preview. Observe zero mutation/account
      Timeline requests. Concurrent stale/divergent pushes must fail safely;
      uncertain retries replay exactly and quota failures roll back effects,
      heads and ordering. Foreign/retired scopes must never fall through to HTTP.
      Run `timelineBranches.test.ts`, the offline History browser test and the
      disposable real-account `timeline-branches.integration.mts` regression.

- [ ] Anonymous version names: use Versions offline to name, rename, reload,
      clear and reload again. Verify the pinned badge and immutable effects,
      no HTTP mutations, and desktop/390/320px controls. Concurrent tabs must
      reject stale revisions; retries after later changes return their original
      receipt without overwriting the newer name. Failed name storage must roll
      back its effect and ordering. Run `timelineVersionNames.test.ts` and the
      offline History browser test. Server integration must validate against the
      exact operation ID sent and clean up its own created Things on failure.

- [ ] Anonymous History notes: open Message on a saved change while offline;
      save plain text, cold-reload and remove it. Confirm device-only copy and
      zero account/mutation HTTP calls. Eight concurrent notes must be the cap;
      a ninth retains its text with Retry/Dismiss without breaking History.
      A delayed add after removal cannot resurrect text. Failed deletion-marker
      storage must roll back deletion and quota together. Batch page limits
      must count multibyte notes and exclude notes from unselected events.
      Run `timelineNotes.test.ts` and the normal offline History browser test.

- [ ] Anonymous History: normal-import a page and component, rename offline,
      open its recorded native preview, then cold-reload offline. Content and
      canonical history must commit together; no account Timeline/mutation
      requests may occur. Verify saved-on-device labels and 1440/390/320px.
      Run `local-workspace/timeline.browser.test.ts` against the loopback
      production preview with `TT_LOCAL_TIMELINE_URL` and shared browser paths.
      Unit coverage must retain old component captures after edits/deletion,
      roll back content when history fails, page large records, reject damaged
      links/indexes and fence old identities across concurrent connections.

- [ ] Anonymous page sources: normal-import an editable schema/Data/Action/
      Component/page bundle. Both source-bound Components and native Collections
      must load without sign-in, refresh after a local control, and survive a
      cold offline reload. Inert previews make no run. Malformed pages show an
      error. Verify 1440/390/320px and zero account mutation requests.
- [ ] Source caches and local forms must retire across anonymous/account/origin/
      data-plane boundaries, even when the page and block IDs match. Never adopt
      legacy viewer-only cache entries or cache shared-root run results. Run the
      opt-in `sourceWorkspace.browser.test.ts` lifecycle regression against Vite
      with `TT_SHARED_TEST_URL`, `TT_SHARED_PLAYWRIGHT_PATH`, and optional
      `TT_SHARED_CHROME_PATH`; use a fresh browser and disposable local data.

- [ ] Anonymous Actions: create in the native editor, cold-reload offline, run,
      edit in Fields/Source, save and reload. Invalid JSON cannot save; execution
      failures show their actual error. Local definition drafts do not require an
      account Timeline. Export/import through Transfer remaps IDs and omits run
      records; deleting an Action removes its protected details. Check 1440,
      390 and 320px, current-workspace cache separation and no account mutation.
- [ ] Action host refactors must preserve missing-input search predicates:
      `where: { field: "$input.optional" }` still filters null/missing values;
      resolving an omitted input must never erase the filter. Run the live
      server Action suite and local nested/scope/history/identity tests.

Use a disposable account and an isolated local Mongo instance; do not run mutation
checks against existing personal data. Full feature coverage is tracked in
[docs/local-workspaces.md](docs/local-workspaces.md).

- [ ] Anonymous create/edit/export must make no account write. Login/logout and
      account/database switches never adopt or expose another workspace's data.
- [ ] Block Things + webpage resolve endpoints: create a private Builder page,
      edit and save text, then reload. The native renderer retains the page and
      the sync panel says it is saved on the device. Reconnect and verify exactly
      one private Thing with the latest text through the real API.
- [ ] Save again after a sync acknowledgement without reloading: the server's
      timestamp must not cause a false local editor conflict.
- [ ] Edit the server copy concurrently. Reconnect: preserve local edits, stop
      replay and show comparison. Keep either reviewed version; type or change
      the server after review and verify the stale choice is refused.
- [ ] Unsupported attachment/control fields must use their complete adapter or
      fail clearly; never report a successful partial local write.
- [ ] A definitive validation failure can be corrected and retried. A lost
      response replays its original immutable body and does not duplicate data.
- [ ] Check expanded sync details at 1440×1000, 390×844 and 320px: nav clearance,
      long IDs, scrollable comparisons and all choice buttons remain usable.
- [ ] Cold-reload a previously loaded account page with all networking disabled;
      edit/save/reload again. Restore networking with root verification blocked:
      no account mutation may occur. Unblock root verification, reconnect, and
      verify the same private Thing receives the queued edit. A dirty editor
      must retain its content across this transition.
- [ ] Open Builder offline without a cached server list page. Show locally saved
      pages/components, distinct device pagination and an incomplete-library
      notice. Never mistake the known local subset for the full account library.
- [ ] Older overlapping root reads (including failed ones) cannot change the
      newest accepted workspace pointer. Logout removes offline access to the
      previous account pointer; anonymous content is not adopted on login.
- [ ] A definitive root/session refusal retires old editors and sync leases;
      re-confirming the same account never revives their pending callbacks.
- [ ] Block or stall IndexedDB opening: report a bounded storage error, retry
      after recovery, and close late connections without committing abandoned work.
- [ ] Logged out on `/themes`, save/edit/reload a named theme, then cold-reload
      offline. Download JSON through Transfer, import a new copy, apply and delete
      it. Verify no account mutation, unchanged active selection after import,
      private local labels, and usable controls at 1440, 390 and 320px. Public
      profiles/gallery remain readable without borrowing account credentials.
- [ ] Logged out, create/select an algorithm, cold-reload Settings → Things
      offline, rename/branch it, download/import/re-export JSON and delete it.
      Preserve weights/statistics with fresh IDs and unchanged active selection;
      show private-interest warnings and usable 1440/390/320px controls.
- [ ] Train from a disposable public-feed response fixture without publishing a
      post. No anonymous track request or page-hide beacon may reach the server.
      Switch accounts with queued/in-flight events: clear the old session, never
      seed or train the new owner's profile, and ignore stale completion toasts.
      Built-in sorts never train. Storage failures must be visible.
- [ ] Logged out and offline, import a canonical ZIP with actual file bytes;
      no Upload step or network request is needed. Cold-reload, export through
      the normal dialog, import that download and delete the original. The copy
      must export identical bytes with fresh IDs. Verify 390/320px controls.
- [ ] Missing/corrupt/oversized local bytes fail before metadata is committed;
      quota rollback/refund and identity changes never expose another scope.
      Component media/dependencies rebind to the copied bytes. A folder holding
      standalone files drains them to its surviving parent without deleting bytes;
      explicit recursive deletion removes descendants and their bytes. Target-bound files
      cascade with their target. Clear all disposable test data afterward.
- [ ] A missing local Thing with a remaining account sync entry becomes a
      visible error; it cannot stall unrelated pending writes. Deletion with a
      missing usage row must not throw or create negative quota totals.
- [ ] Logged out and offline in Browse files, add PNG/text/empty files through
      the normal picker. Download exact bytes, copy and cut/paste between folders,
      cold-reload a native media page and verify the decoded image at 1440/390/320px.
      No paired-device discovery, account request or HTTP byte fallback may run.
- [ ] Local media URLs revoke after deletion, unmount and identity retirement;
      late reads cannot recreate them. Corrupt/missing bytes and preview capacity
      failures show errors, not blank-success previews. HTML/SVG downloads remain
      opaque and empty pending src/href values are omitted.
- [ ] Re-render the native Thing page without changing workspace identity:
      API callback identities stay stable and no repeated-fetch/update-depth loop
      occurs. Retired callbacks cannot target the next account's API cell.
- [ ] Logged out with networking disabled, use the normal composer to select
      an image, autosave a draft, save/edit a post and cold-reload it. Reopened
      edit/template media tiles must decode local object URLs, never request a
      server attachment URL. Posting must succeed without a saved draft.
- [ ] Create a local comment and nested reply, cold-reload and expand replies:
      persisted children must reappear through native post/list projections.
      Local author labels cannot link to an unrelated account profile.
- [ ] Save a local post as a template, instantiate an independent working copy,
      save it, delete the original and cold-reload the copy's actual image.
      The reusable template remains. Cleanup/tombstones preserve committed files;
      corrupt bytes, quota failures and wrong-purpose files roll back atomically.
      Export/import image posts and image comments with fresh IDs: verified
      attached-file context must reach the canonical validator, and comment
      files retain comment purpose so later edits succeed. Check desktop/390/320px
      and clear only disposable test fixtures.
- [ ] All local feature families, queue deletion/import/move semantics and
      multi-tab UI refresh require separate acceptance before rollout merge.

## Reusable local video compression

- [ ] File selection is visible immediately on both the intrinsic page and a
      previously saved Web Platform media program, without Run example. Change
      settings after selecting a file; Start must use them without losing it.
- [ ] Compress PNG/JPEG/TIFF/HEIC and animated GIF fixtures locally. Independently
      decode outputs: compare dimensions, alpha, orientation, frames, delays and
      loops, including optimized delta rectangles. Duplicate two compressor instances; each native file label must target its own input. JPEG transparency requires an explicit background. APNG, layered or
      multi-page images, unsupported SVG and invalid files fail clearly.
- [ ] Cancel while image codecs load and while encoding; stale jobs cannot
      publish a preview/download. Asset loading fetches public same-origin WASM
      only; selected bytes never enter a request. The worker still denies network.
- [ ] In the actual Builder, edit nested heading text, a label, a numeric field,
      a button and image preview independently; move/duplicate a control, save,
      reload and verify the live compressor. Keep installed/deployed acceptance
      separate from the isolated regression fixture.
- [ ] Install `media-tools` as the intended account; inspect the returned owned
      Page, Component and Action. An origin with suite capability below 1.7.0 refuses
      this install before mutation; compatible 1.7.0 accepts it.
- [ ] Run the isolated browser flow documented in README: actual WebCodecs
      conversion, MP4 H.264/AAC, WebM VP9/Opus and explicit audio removal. Compare
      downloaded bytes, codecs, dimensions, duration and tracks using ffprobe.
- [ ] The opaque preview frame still has no same-origin permission. Its fixed
      secure-host worker can encode and has a network-denying response CSP.
      An iframe-local worker must not regress into a false unsupported browser.
- [ ] Invalid files and unsupported codecs show a useful error and clear old
      downloads. Cancel, Stop / clear, replacing the selected file and replacing
      a run terminate work; delayed worker output never recreates a download.
- [ ] Change settings and document labels/styles; save an edited Component,
      reopen it through Builder and run it with those saved defaults. Reloading
      never retains local selected video bytes. Check access as the owner.
- [ ] On the intended deployed origin, encode a synthetic local clip, preview
      it and download it. Compare the result with the independent source.
- [ ] At desktop and 390px widths scroll the complete page and preview; open
      the JSON editor and saved Component controls. No clipping, overlap or
      horizontal overflow, including progress, errors, video and download.
- [ ] Shared documentation examples still validate through saved-Thing grammar
      after adding guide sections; locate examples by section ID, not position.
- [ ] Lopu's default and custom base prompt paths retain framework-discovery
      guidance for `/docs/builder`, components, demos and Action inspection.
      Missing tools or short Action budgets never imply encoding is impossible.


## History timeline design concept (`docs/design/thingtime-history-timeline/`, `/docs/design`)

Fictional-data design concept for unified Thing history (TODO 56). Nothing is
persisted; every check is client-side.

- [ ] `/docs/design?entry=thingtime-history-timeline` lists the entry as an App
      concept and the preview iframe renders the page; the bundle URL
      `/docs/design-bundles/thingtime-history-timeline/index.html` renders it
      standalone with no console errors.
- [ ] Desktop (≥ 821px): the History browser shows the timeline beside a detail
      panel; the selected row ("You changed colour on Primary button") is
      highlighted and the panel shows its before/after diff.
- [ ] Phone (390px, or the gallery's phone preset): the panel is hidden until a
      row is tapped, then opens as a bottom sheet with a ✕ close; Escape and the
      backdrop close it; no horizontal scroll anywhere on the page.
- [ ] Scope, kind/who/what chips and the search box filter rows; counts on the
      kind chips follow the scope; an empty result shows the "Nothing recorded
      matches these filters" state rather than a blank pane.
- [ ] Clicking a scrubber bar jumps the timeline to that day and highlights the
      day header; a day with no changes explains that instead of jumping.
- [ ] Restore / Undo / Try a variation each ADD a row at the top with a system
      message and a Lopu toast; no existing row disappears.
- [ ] Section 4: toggle Offline, Make an edit → the new row and the header pill
      say "Saved on this device"; Reconnect & sync → they turn "Synced" while
      the button variation stays "Saved on this device".
- [ ] Section 3: Send changes with a pending review opens the merge card;
      choosing an option resolves it, adds exactly one "Reviewed and combined"
      row, and clears the "Needs review" pills. Clicking the other two options
      afterwards does nothing — one review has one resolution, and the card
      keeps showing which option was kept.
- [ ] Section 3 draws exactly one Thing — the section claims "the same data as
      the browser above", so every graph node must open the **Primary button**
      panel (it is the only Thing with a variation and the conflict the merge
      card describes). The card reads "Primary button · component · 3 versions ·
      1 variation · v3 now"; the variation label, the merge note and the svg
      `aria-label` all say the shared starting version is **v2**; and "Try a
      variation" appends a Primary button variation `from v2`.
- [ ] Select "Matched the new tokens" on Primary button: the panel's ancestry
      reads `v2 · from v1` and the Versions tab lists that v1 ("Created Primary
      button") — every version the ancestry names is in the list.
- [ ] Settings toggles and the retention segmented control respond; "Show
      messages in the timeline" off hides message bubbles in rows and the panel.
- [ ] With `prefers-reduced-motion: reduce`, no animation runs and the sheet,
      toast and rows still appear.
- [ ] Look → Cards / Line / Frames inside the timeline browser, at every scope:
      with Everything the horizontal strip carries every Thing's changes (the
      Thing card of each event), with This Thing a picker row chooses the Thing;
      Cards alternate above and below a spine that fills to the selected change
      with a minimap; Line shows alternating labels and day ticks; Frames is a
      filmstrip with change chips on the connectors; kind/who/what chips, search
      and the day scrubber still apply; clicking a card, node or label opens the
      detail panel without the strip jumping; the variation lane appears for
      Primary button in every look; "Open the Evolution concept" links to the
      sibling entry. The app bar shows Scope and Look — there is no separate
      Versions view (section 3 explains variations as lanes).
- [ ] `/docs/design?entry=thingtime-history-evolution` and the bundle URL
      `/docs/design-bundles/thingtime-history-evolution/index.html` render with
      no console errors and open on the Cards look: the Thing's cards as of each
      version alternate above and below the spine with an edit callout each,
      no card overlaps a neighbour, the spine fill reaches the selected card,
      later cards are faded, the minimap shows dots and a viewport window that
      follows the strip's scroll, and Density → Compact narrows the cards and
      hides messages. The Thing picker switches Things (Primary button adds a
      dashed variation row); Look → Line and Frames still work.
- [ ] Spacing → Real time keeps true positions (crowded same-day edits spread
      just enough to read) with day ticks; Even spaces versions uniformly.
- [ ] Scrubber and ←/→ move the selection and scroll it into view; Play steps
      through versions and stops at the last; Compare marks A and B (across the
      variation lane too) and lists differing properties; Restore appends a
      version and the line grows; nothing disappears.
- [ ] 390px: the strip scrolls horizontally inside the app frame with no page
      horizontal scroll; labels narrow; the detail and compare panels stack.

## Unified Timeline

- [ ] Contextual messages (2026-10-13): select a synced change in `/history` and
  in a Thing's History; the detail panel shows Changes / Message / Versions tabs
  at desktop and in the 375px bottom sheet. In Message, save a note: it appears
  as a bubble under that row in List, Cards and Frames (not Line), with "Saved
  on this device" until the sync receipt lands, then without it. Reload: the
  note persists; the Messages toggle (URL `messages=off`) hides every bubble.
- [ ] Offline: add a note, reload, reconnect — exactly one note syncs; retrying
  the same command returns the original. Add nine notes to one change: the
  ninth is refused with the limit message and stays dismissible. Remove a note
  twice: idempotent, storage refunded. Explain a pending (unsynced) change: the
  button is disabled with "Sync this change first". Ask Lopu on a synced change:
  the Lopu bubble has the gradient border; with no model configured the 503
  message shows and nothing is stored; an unverified or credit-less account
  gets the chat's Lopu refusal instead and nothing is stored. Restore/merge/recovery rows show dashed
  system lines without invented version numbers.
  Run `test:timeline`, `test:api-capabilities` and `test:timeline:notes` on the
  guarded `timeline-rs` replica.

- [ ] Named versions, undo, compare with now and export (2026-10-13): select a
  synced saved change and open the Versions tab at desktop and in the 375px
  bottom sheet. Each row is a select button plus a sibling strip (name field,
  Save, Clear when named, Export); typing and Enter never select the row.
  Name a version with an 80-character name, rename it, Clear it: the 📌 badge
  (ellipsised, never pushing the title out of its row) appears beside the title
  in List, Cards, Frames and Line, in the Versions row and in the detail
  heading, and a name-change effect event appears beside the named version in
  its lane. Scroll the sheet to the bottom with the field focused: Save stays
  reachable. Close the sheet with Escape mid-typing and reopen: the draft is
  still there. Search by the name in "Search loaded history". Pending (unsynced)
  and draft rows show disabled controls with "Sync this version first" /
  "Only saved versions can be named". Rename the same version from a second
  device or tab, then Save here: the inline 409 offers Refresh, which re-prefills
  the current name and the next Save succeeds.
- [ ] Undo this change: make three edits to different properties, select the
  middle one, press "Undo this change…": the card reads "Review undo", the
  comparison says "Before this change", the page preview button "Preview before
  this change", apply says "Undo this change"; after apply the later edit is
  kept, the notice reads "Undid this change. Every version is still in your
  Timeline.", the new row shows the system line "Undid just this change · later
  edits to other properties were kept" and the header "Undid <source> ·
  continues from <head>". Edit the same property again, undo the earlier edit:
  the overlap needs a choice (Keep current / Use the earlier value); choose the
  earlier value and apply. Undo the same change again: the 409 "already
  reverted" message renders inline. Create/delete/activity rows have no Undo
  button.
- [ ] Compare with now (Changes tab): on a synced version press "Compare with
  now": Then/Now boxes replace the Before/After list, "Back to before / after"
  restores it. On a deleted Thing's last version the panel says "This Thing no
  longer exists now". On a split-snapshot (large) version the Then/Now list
  shows content instead of the retained-only notice. A page version with
  non-component dependencies shows "Compare with now is not available for this
  page version yet."
- [ ] Export: press Export on a synced row: a `history-<thingId>-<eventId>.json`
  file downloads (unsafe id characters become `_`, name capped at 120 chars),
  the inline notice reads "Exported <name or label> · <file>", and the file's
  `event.id` is the row's id. A synced deletion exports its `before` content.
  Export of a version over the 4 MiB response ceiling shows the server 413
  message inline and the version stays in History.
  Run `test:timeline`, `test:api-capabilities` and `test:timeline:versions` on
  the guarded `timeline-rs` replica, plus
  `node --import tsx --test app/components/Timeline/timelineExportDownload.test.ts app/components/Timeline/timelineVersionControls.test.ts`.

- [ ] History settings, sync hold, per-Thing pause and entry points (2026-10-14):
  open `/settings/history` at desktop and 375px, reload it, press Back, then
  open `?settings=history` from any page: the popup shows the same category
  and its "Open settings page" link lands on `/settings/history`. Rows, in
  order: Show messages (device only), Pause syncing (account, all devices),
  Keep history (stored only, "Coming: nothing is deleted yet"), Paused Things
  (ids linking to `/thing/<id>`, Resume per row, never a fabricated title),
  Export history. No storage row. Signed out: the "Sign in to manage these
  account settings" card. Temporary or service account: "History settings
  need a full account." with no settings request and no toast. Against an
  origin whose manifest lacks `api.timeline-settings`: "This Thingtime doesn't
  support history settings yet." with Retry (the well-known manifest is CDN
  cached for up to five minutes after a deploy). Block the settings GET:
  inline error + Retry, no Lopu toast on mount.
- [ ] Hold and resume: on two sessions of one account (home + selected
  database) create pending rows offline, switch "Pause syncing" on, reconnect:
  nothing uploads, `/history` and a Thing's History read "Sync paused · n
  waiting on this device" with a "History settings" link, the Settings row
  shows the per-queue counts, and from 1600 pending the "Resume soon — this
  device holds at most 2000 changes." warning appears. Resume: both queues
  drain within the next pass and the status returns to "Saved to your
  account". While held, select a pending row: Restore / Undo / Review and
  combine say "Resume sync to restore or compare this version", Compare with
  now "Resume sync to compare this version", the Versions-tab strip "Resume
  sync to name or export this version", a saved note or branch command reads
  "Saved on this device. Resume sync to save this … to your account.", and
  Retry sync in Variations is disabled with the Resume sync link. Synced rows
  keep every control.
- [ ] Per-Thing pause: on an owned Thing (feed card ⋯, `/thing/<id>` ⋯) at
  desktop and 390px "Pause draft history" follows History with the ⏸️ / Lucide
  pause icon; it is absent for other users' Things, from the Drive right-click
  menu and bulk menus, and while prefs are unavailable. Pause: the verb flips
  to "Resume draft history" (▶️), the Thing's History shows the orange
  "Paused" badge, the Settings list shows the id, and the Builder page and
  definition editors stop capturing drafts ("History paused for this Thing.
  Edits are not captured on this device; saved versions still record.") while
  Recover / Dismiss / "Use latest saved version" are disabled with "Paused ·
  History is paused for this Thing. Resume history to recover or dismiss
  drafts." Save the definition: the server revision still appears in History.
  Resume: capture returns and a draft pinned before the pause is still
  recoverable. Pausing the 201st Thing is refused inline (max 200).
- [ ] Entry points: an owned `/thing/<id>` shows the owner-only History section
  collapsed ("Show history" mounts the panel; no Timeline polls before that),
  with "Open History browser" (`/history?storage=…&thing=<id>`) and "History
  settings"; other users' Things and diagnostics show no section. The `/history`
  header and the History modal header link to History settings and the modal
  closes on navigation. Editing an existing post shows the ghost "History"
  button beside Undo/Redo/Changes and opens that post's History; new posts,
  comments and Builder rich-text fields show no History button.
- [ ] Export: press Export history (online, connected): a
  `history-export-<ownerId>-<date>.json` file downloads with
  `kind: "thingtime-history-export"`, `formatVersion: 1`, `ownerId`,
  `dataPlane`, `storage`, `bounds`, `truncated`, `entries`, `notes`, `names`;
  it is refused by the single-version import check. The IndexedDB cache size
  does not grow. Offline or unverified: the button is disabled with "Reconnect
  to export". Force a 429 with `Retry-After: 2` on the scan: the export waits
  and completes; four 429s in a row surface the rate-limit message inline.
  Run `test:timeline` (includes `historyExport.test.ts`,
  `historyPrefs.test.ts`, `historyPrefsStore.test.ts`,
  `timelineSettingsRoute.test.ts`, `historyPrefsClient.test.ts`),
  `test:settings`, `test:things`, `test:api-capabilities` and
  `test:rate-limit`. The `users.ts` secure-blob round-trip is integration tier:
  exercise it through `POST /api/v1/timeline/settings` on the guarded
  `timeline-rs` replica set beyond the injected-collection unit test.

- [ ] With only admission storage available, run an ordinary server Action.
  Preserve its actual result and sealed completion. Block recovery requests:
  desktop and 390px show local retention, and the pending History event survives
  reload. Restore quota/reconnect: exactly one identical remote receipt appears,
  its local delivery proof clears, and no second Action request is sent.
- [ ] Refuse altered event/proof, another owner/database, missing admission,
  session-token substitution and the known dev signing key. Concurrent recovery
  retries charge once. A definitive proof refusal retains pending/dependent
  work while unrelated drafts continue. Unavailable/full IndexedDB reports
  failed local retention without hiding the actual result. Logout/account/source
  switches never expose or migrate another scope's pending completion.
  Run `test:timeline`, `test:api-capabilities`, and `test:timeline:action-outcomes`
  with the guarded replica, configured private signing key and synthetic admin.

- [ ] Delete an owned public Thing, then recover its deletion or an earlier saved
  version from History. Desktop and 390px must show **Recover Thing privately**,
  the absent current state and an inert result preview. Recovery keeps the
  original ID, private audience and every prior version after reload/sign-out.
- [ ] Change a component, folder placement or deletion head after preview;
  require a fresh review. Two simultaneous recoveries have one winner; retrying
  that exact operation returns its original receipt. A lost folder defaults to
  Things root only after preview. Existing private foreign IDs cannot be reused.
- [ ] Recover a page with two recorded component copies; force the second copy
  to conflict and verify no first copy, recovered page, event/head or storage
  charge survives. Delete at full quota without creating new captures; recovery
  must still pay for new content and refuse atomically when the account is full.
- [ ] Published pointers survive deletion, ignore client drafts and exact older
  retries, and use the same local/remote branch records. They never appear as
  pushable variations. Legacy histories without pointers use bounded reads;
  protected/attached records and missing deletion evidence refuse safely.
  Run `test:timeline:recovery`, `test:timeline`, the guarded core/component/branch
  regressions and `test:timeline:quota` with its isolated synthetic admin fixture.

- [ ] Open an owned saved page's **Page + related** history. Its Components,
  Actions, Data and Schemas appear in List/Cards/Line/Frames at desktop and 390px;
  scope controls wrap without page overflow. Shared authors' private history
  and unrelated Things stay absent. Reload preserves scope/look and cached rows.
- [ ] Edit a dependency through the API with History open: its event appears on
  the next visible poll. Link an older Thing: reset paging includes its older
  history. Remove a reference: old members disappear from the view without
  deleting their own history. Block refresh: cached rows remain. Reject/delete
  the root: clear that scope rather than flashing previously authorized rows.
- [ ] Select a component in a page's related stream: the page's variation controls
  cannot send/create/merge from that component version. Run `test:timeline:related`
  on the guarded replica, `test:timeline` and the capability contract tests.


- [ ] Open `/history` and a Thing's History. Switch Everything / This Thing and
  List / Cards / Line / Frames; selection and recorded details stay consistent.
  Reload the global URL with kind/source/change/sync/search/day filters and
  verify the same scope. Counts/search describe loaded history only.
- [ ] At desktop and 390px, check non-overlapping alternating cards/labels,
  horizontal scrolling contained inside the strip, the minimap window, scrub
  slider, arrow/Home/End navigation, Play/Pause and reduced-motion behavior.
  On mobile selection opens a scrollable bottom sheet; Close/Escape restores
  access to the strip. No page-level horizontal overflow.
- [ ] Compare two versions of one Thing, including a variation. Comparison must
  be read-only; another Thing or unsupported compact content must refuse with
  a clear explanation. Recorded titles never become today's title. Stable page
  block IDs expose prop changes; ordinary data called blocks stays data.
- [ ] Preview recorded components from every look. Actions remain inert. Try a
  variation / Get latest changes / Send selected version / Review and combine
  use the same queued commands as the prior branch UI. Sign out or change
  account/data source and all private cards, details and comparisons disappear.

- [ ] Restore a page whose shared component changed through the API. Review
  recorded/current/result previews at desktop and 390px. Apply: the page uses
  its reviewed private copy; another page keeps the original shared key and
  current definition. Reload and verify exact Thing/capture readback.
- [ ] Merge an independent branch after a restore changed component IDs. Stable
  block identities must surface the incoming component change for review, not
  silently drop it. Choose a side and verify the rendered saved result.
- [ ] A component edit after preview must return 409 even without a page edit.
  An exact retry returns one receipt. Concurrent applies yield one winner with
  no orphan copies. A failure during the second insert rolls back the first
  insert, page, history and storage accounting.
- [ ] A recorded unavailable ref becomes an inactive placeholder even if its
  original ref now resolves. Missing legacy capture history requires explicit
  current components or another version. Literal data fields named blocks never
  become page references. A large split snapshot must still restore intact.
- [ ] Run `test:timeline:published-components`, `test:timeline:integration`,
  `test:timeline:component-merge` and `test:timeline`. Preview Actions remain
  inactive; sign-out and account/source changes hide private comparisons.

- [ ] Merge named page branches with independent component changes, overlapping
  definitions, absent legacy captures, captured unavailable refs, removed/added
  refs and folder-only ancestry. Independent definitions combine; overlaps need
  an explicit choice; missing history never becomes today's definition. Page
  conflicts are reviewed before component choices. The result retains exact
  canonical capture links and never rewrites the published page or components.
- [ ] Compare Current branch, This version and Merge result on desktop/390px.
  Preview Actions send no execution request. Long version names wrap clear of
  Close preview. Save after review with Timeline requests blocked, reload, open
  the pending version's page preview, reconnect and verify exactly one branch
  advance with the selected captures. Sign-out hides all private previews.
- [ ] Run `test:timeline:component-merge` on the guarded replica set and
  `test:timeline`. Check malformed/foreign/substituted capture links, explicit
  missing versus unavailable definitions, stale choices, grouped payload byte
  preflight, 128-record read batches and aggregate structural/byte bounds.
  Old clients must refuse retained dependencies instead of dropping them.

- [ ] Save a page with own/author-key, shared and inaccessible component refs
  through the API. Change the definitions and revoke sharing. History → Preview
  page and a branch at the original revision must still show the recorded
  readable definitions; an originally inaccessible ref stays unavailable.
  Current components appear only after the explicit comparison choice. Version
  refresh leaves exactly one preview control; toggling back restores the original.
- [ ] Preview at desktop and 390px, with the inspector open and closed. The
  component-choice button must remain reachable beside the inspector; History
  must wrap without horizontal overflow. Action probes produce no Actions/run
  requests. Media/theme variation is stated in the preview.
- [ ] Edit and save the historical branch without upgrading components. Read
  its exact dependencies back and verify original definitions, then reload with
  Timeline/Things/component requests blocked. Edit/save offline, reload, and
  reconnect: the queued branch advances once with its definitions intact. Check
  an older version without dependencies: show missing history, never label
  today's definitions as recorded. Switch owner/source or sign out and hide the
  private preview immediately.
- [ ] Run `test:timeline:components`, `test:timeline`, `test:webpages` and both
  capability-manifest tests. Oversized or damaged dependency byte metadata must
  refuse before payload decoding; cross-account, duplicated selectors and stale
  sources cannot read the batch. Acknowledged dependency cache eviction is
  recoverable from the remote; pending drafts and uploads retain their identities.

- [ ] Open a named page branch in Builder on desktop and at 390px. Edit text,
  component args and page metadata; Save twice without reopening. Each save
  advances one branch revision. Click Save directly from the first inline text
  edit (without blur/Tab): the button stays reachable and saves that final text
  plus any metadata. Exact-ID reads confirm the published page
  is unchanged. Plain field editing still opens and saves under StrictMode.
- [ ] Reload before Save, recover the branch draft while Timeline/component
  reads are blocked, Save offline, reload again, reconnect and open History.
  The queued push advances once; Open in Builder reopens the accepted version.
  Cached components remain visible. Stale pushes freeze editing and retain the
  local version. Discard cannot race a new edit or save.
- [ ] On branch View and an authored mode=run link, click an Action control: no
  Action request or live source runtime may execute. Branch links with another
  owner/source, and logout, hide private content immediately. Non-page branches
  explain that their fields must be edited through Edit branch.
- [ ] Run `test:timeline:visual-branch` on the guarded disposable replica set.
  Guessed private component refs must not inherit an audience from caller blocks;
  malformed scopes and oversized drafts refuse with private/no-store responses.

- [ ] At 390px, branch names take a complete row above the wrapping controls;
  adding Edit branch must not squeeze names into a vertical column.
- [ ] History → Branches → Edit branch: change a field, verify the device-saved
  notice, reload before Save, and explicitly Resume draft. Repeat offline and at
  390px. Save to branch while disconnected, reload, reconnect and Retry sync;
  verify one branch revision and unchanged published content by exact-ID readback.
  An acknowledged branch save releases only its own draft pin, including retries
  after reload; newer edits and refused pushes retain their recovery pins.
- [ ] Keep a branch editor open while a second caller advances its head. Save
  the older edit: it must remain in History, show a failed push, and require merge.
  A background checkout refresh must not overwrite fields typed from cache.
- [ ] Switch account or database with a branch editor open: no previous fields
  or completion may appear under the new identity. Correct an oversized capture
  and verify the next bounded edit can save; an uncorrected failure cannot flush.
- [ ] Run `test:timeline:branch-merge` for real checkout/edit/retry/divergence and
  private/source refusal. Protected adapters and over-limit checkout must refuse
  clearly without modifying published content.

- [ ] With two disposable databases, select the custom endpoint in the browser.
  Open a saved theme's History on `/themes`: home events appear without changing
  the selection. Open Timeline: the modal closes and Home account stays selected.
  Toggle Selected database: only that database's events appear, even when event
  and Thing ids match. Test desktop and 390px, reload with Timeline requests
  blocked, and recover without losing each scope's cached history. Switching
  accounts or an authorization refusal must hide private cached content.
  Open Thing in home explains the selection change and opens the correct home
  Thing with an account/database-qualified link. Run the guarded
  `test:timeline:home-scope` for real branch/restore and concurrency isolation.
- [ ] Create home/custom Things with the same id and different content. Cache
  each permalink, then block Thing reads and switch databases in another tab.
  Only the matching database's cached content can appear; an uncached source
  offers retry without borrowing the prior view. Unblock and recover. A pinned
  History link must show a recovery action when its database/account differs,
  never render the other Thing. Open in home account and rename it: only home
  content and home history change. Repeat at desktop and 390px with no overflow.
  The guarded HTTP suite checks stale GET/PATCH/DELETE refusals, unchanged
  content/history, malformed source keys and selected-source preconditions on
  explicit-home Timeline requests. Endpoint changes invalidate root identity
  across tabs; deleting a saved endpoint does too, while merely saving one does
  not. API clients omitting the optional precondition retain their old behavior.
- [ ] In fallback mode, root identity and ordinary Thing reads/writes use the
  same upstream with the database precondition, cookie and selection intact.
  Matching requests work and stale ones retain the upstream 409 refusal.
  Actor-fenced commands and vault verification still refuse fallback before
  reading their bodies. Run `test:root-data` for the dispatcher/proxy regression.
- [ ] Create a saved theme, rename/move it in Things, then edit tokens and
  visibility through its dedicated theme API. Shared History preserves every
  exact parent and approved before/after token value; identical saves add no
  event. Public themes still have private history. Invalid writes add no event.
  Select a custom data source and create a theme: its history and accounting
  still commit at home. At the allowance ceiling, token edits refuse atomically
  but deletion retains its approved prior version; retry adds no event/charge.
  Generic protected-content restore remains unavailable. Run the guarded
  `test:timeline:themes` and `test:timeline:quota` HTTP suites.
- [ ] On the disposable replica, set a synthetic user's allowance to its exact
  current usage through the normal admin API. Growing edits, retained shrinking
  edits and restore application return 507 without changing content, timestamp,
  head, events or storage bytes. History and restore previews still work. A
  downgrade below usage returns 409 and preserves the assignment/data. At the
  ceiling, folder moves and deletion drains work; deleting the Thing retains its
  exact before-version and keeps accounted bytes. Retrying deletion adds no
  duplicate event or charge. The error must not promise that deleting a Thing
  frees retained history. Run `test:timeline:quota` using README's isolated setup.
- [ ] Delete a folder with more than 100 children and a nested subfolder.
  Direct children move to its parent, descendants stay under their subfolder,
  and every moved item has exactly one relational event in the deletion's
  operation. Race deletion against creates and moves; no successful write may
  retain the deleted folder id. Race two moves through four folders: at most
  one succeeds if both would create a cycle. Interrupted drains keep the root
  and return an actionable retry, never a false deletion success.
- [ ] Move an ordinary Thing repeatedly without editing its content. Compact
  history reconstructs the exact saved content through those moves; restoration
  never borrows a later edit. A deleted destination refuses without a success
  event. Restoring in the Thing page updates its visible value without a reload,
  keeps later versions, and is usable on desktop and at 375px.
- [ ] Move a protected library item directly and through folder deletion.
  History contains only folder ids, never file keys, archive messages or private
  crystal fields; generic content restore is unavailable. Destinations and all
  ancestors use the same ownership and transaction fences.

- [ ] Rename a theme, algorithm, emoji or chat archive through Things. Shared
  History shows the old/new display titles with the correct source and parent,
  while source names, content, permissions and archived messages stay unchanged.
  A stale or invalid request creates no event; a repeated identical title adds
  no content event. Refuse/roll back the rename if its history cannot commit.
  The metadata adapter never copies credentials or protected payloads, and does
  not offer generic protected-content restoration. The permalink title updates
  immediately after Rename without navigation; original source names stay the
  same in both the optimistic view and the reloaded result.
- [ ] Interrupt the Thing read after a rename/restore or while reloading a
  cached Thing. Temporary network/server failures keep its last-known content
  and offer Try again. Retry recovers without navigation. An explicit missing,
  unauthorized, forbidden or changed-identity response clears the projection;
  another account or Thing never inherits it. Diagnostics remain live-only.
- [ ] Run a server Action with nested updates and a delete. History shows
  Action as the source, a shared operation id, separate events and exact parent
  versions. Repeat through Lopu: AI remains the initiating source, including
  server-hosted browser flows. Concurrent requests and subsequent API edits
  keep their own origin. Client source/actor/operation claims cannot override it.
  Fail a later step: only committed changes appear. Ask/refused tools and browser
  preparation create no successful-change event. Operation grouping does not
  authorize replaying an Action or imply complete Action outcome coverage.
- [ ] Upgrade an earlier local Timeline cache with pending edits and a released
  draft. Pending work survives; the released draft does not reappear. Revisions
  and links are independent records. Missing links fail visibly without deleting
  pending work; cache eviction removes only that cached event's local links.
- [ ] Open `/login` and a public page while signed out, reload, sign in,
  open History, then sign out again. The page must render without the session
  recovery boundary or a null Timeline connection crash. Repeat at 390px.
  A pending discovery or account/database switch never exposes another scope.
- [ ] Open History from Things, Builder and a Component definition. Changes
  made through the API appear without opening an editor; older pages load on
  demand. The private Timeline folder never offers rename/move/share/delete.
- [ ] Edit a block/prop/definition, reload before Save and recover the exact
  draft. Type before Timeline discovery finishes, retry a failed IndexedDB
  write, and reconnect after going offline: original event ids and parent
  order survive. A failed capture cannot later report a successful flush.
- [ ] Save while another edit lands; the newer edit remains dirty and pinned
  for recovery. A background refresh must preserve the draft's original
  version fence as well as its content, so the next save cannot overwrite an
  unseen remote change. Switch account/data source during each async step.
  Repeat while an AI save completes: only an exact content acknowledgment
  clears a dirty editor. Late or metadata-only saves cannot erase new typing
  or an intentional empty page; a new Thing cannot inherit another Thing's head.
- [ ] Preview and restore an earlier version; a new event appears and later
  history remains available. Retry the same request after losing its response;
  it must return the original receipt. Changing its payload must fail.
- [ ] Merge independent fields and overlapping edits, missing vs null,
  reordered arrays, and two-parent histories. Choose each overlap explicitly;
  inspect the resulting comparison before applying. A changed live head,
  missing ancestor, foreign Thing or ambiguous merge base must refuse safely.
- [ ] At desktop and 375px, history lists, version comparisons, draft recovery
  and action controls remain readable and reachable without horizontal overflow.
- [ ] Create a named branch from a selected version, reload, pull it, and view
  its exact version after the event cache has been evicted. Push a descendant;
  published content stays unchanged. Attach another Thing through the API and
  verify each membership has an independent head and shares branch metadata.
- [ ] Select a version and use **Merge selected version…** on a named branch.
  Review independent changes and explicit overlap choices on desktop and mobile.
  Opening, cancelling and reopening the review must not reuse an aborted request.
  Lose connectivity after review: save locally, reload, then retry sync. There is
  one merged event and one branch advance, and the published Thing is unchanged.
  Race a newer branch head after preview; the refused push retains the merged
  version. A full command queue must preserve the already-captured event and
  offer a retry without changing its identity. Switching the selected row must
  not change the concrete version named in an existing review.
- [ ] Restore/merge a compact draft whose ancestry includes a folder move.
  It inherits the historical folder and latest draft content, not the live Thing
  or the older full snapshot's folder. Missing or ambiguous ancestry refuses.
- [ ] Queue a branch while another edit upload is in flight. Its selected
  local version must upload first; deferred work must say waiting to sync.
  Lose a push response and retry with the same identity. Race two pushes:
  one wins, the other remains actionable without claiming history reads failed.
  A refused push can be cancelled while keeping its version; an uncertain
  outcome cannot be discarded. Test wrong-account and generic CRUD access.
- [ ] Send Lopu a saved page whose block context exceeds the message budget,
  a dirty omitted draft, an unready editor and an explicitly empty page. The
  saved clean page is loaded with its real blocks; missing/unready drafts
  never become an empty replacement, including after continuation/resume.

## Editable record app primitives

- [ ] Planner controls: switch day/week, dates, filters and 5/10/15/20/infinite
  page sizes. Move a visit with arrow buttons, its date field and drag/drop;
  verify persisted order/date after reload and stale-revision refusal. Different
  drag groups and account changes must not carry a record into another target.
  Start a debounced search, then change its bound record or disable the view:
  the old pending change must not run against the new binding.
- [ ] Render two copies of one styled Component under different parent CSS
  variables. Each inherits its own theme; an outside element with the same
  class stays unchanged. Check desktop and 390px responsive rules, focus,
  dialogs and the full page through the footer.
- [ ] Copy a Component with deferred collection rows. Row Action bindings,
  dialog completion and stored media resolve to the new copies; runtime item
  fields and unused metadata grant no extra access. Test nested collections
  with small pages and visible budget failures for oversized data.
- [ ] In Add visit, choosing a job fills an empty title, preserves a typed
  title and retains drafts after a failed save. Save/Cancel/Escape return to
  the original screen. Reopen a dialog after a successful save and verify the
  old success does not close it again.
- [ ] Confirm visit/job cards include their authorized property, customers
  and crew. Duplicate links do not duplicate labels; archived customers and
  cancelled job assignments are excluded. Missing references show unavailable
  text instead of the final unrelated record's title.

- [ ] As a team member, open an ordinary shared page and choose its saved
  `$install` control. Cancel the copy dialog, then copy and open it on desktop
  and mobile. The page, Components and Actions are private and owned by the
  member; referenced team records retain their original access. Revoke the
  member and verify fresh reads/writes fail even from their owned copy.
  Changing account/page during the capability request prevents the write;
  changing it during copying prevents stale navigation or success UI.
  Refresh an open copied page after revocation: old records and edit controls
  disappear. Network errors and temporary server failures retain prior data.
- [ ] Copy a saved app with linked Actions and Components. Navigation, map
  markers, address suggestions and save receipts stay on the copied page;
  executable references point at copied Actions while the authorized data root
  stays unchanged. No private copied Actions execute for a foreign viewer.
- [ ] Traverse customer → property → job → visit. Page each related section
  beyond six records, create a child from its parent, and verify a new identity
  with prefilled references. Duplicate without copying media/ownership metadata.
  Time totals exclude archived entries; future completed/cancelled visits stay
  out of Upcoming. Quick status/image changes reject stale revisions and
  preserve unrelated fields. With the upload form expanded, selecting an image
  must not submit its shareId/title/attachment fields to the image Action.
  Post and page comments and nested replies.

- [ ] Local draft fallbacks use saved values only before editing. Clearing text
  stays empty; source refreshes retain the draft; navigating to a different
  record or starting another entry clears it. An address selection updates
  address and place ID together; typing the address clears the old place ID.
- [ ] Switch planner day/week, date, employee and status, then navigate dates.
  Filters persist in the URL and controls; large employee choices remain
  searchable. Linked fields open authorized records by readable title. Viewer
  roles and non-admin team views do not display write forms. Before/After and
  unlabelled Gallery media remain visible across cursor pages.
- [ ] Save and reopen a Component with its own source Action; create, PATCH and
  POST update preserve the binding. A page override still wins. Malformed
  source inputs/refresh policies fail instead of disappearing.
- [ ] Open a populated textarea, change it and save. No textarea/value render
  crash or false session-recovery screen. Internal links retain the SPA, and
  a drawer closes after following one of its links.
- [ ] In a tt-form create a record, repeat the same save and verify one ID.
  While editing, update that record from another client; both the first save
  and a retry after source refetch must reject the stale original revision.
  Start another clears the draft and generates a different operation ID.
- [ ] Search and page a tt-select source with more than 160 choices. A selected
  item outside the visible page remains selected; Enter in its search input
  must not submit the surrounding save form. Check long labels at 375px.
- [ ] Run a browser each with item/index inputs. Oversized batches fail before
  the first request, failed children are not retried, account changes stop
  later children, and child/sibling compute work shares the parent's limits.
  Protocol 1.8 refuses each/expressionLimits; 1.9 accepts them.
- [ ] Draft attachments → saved Action → readback → reload: committed files
  survive, failed saves retain drafts, repeat saves use the same shareId, and
  another record's result cannot mark this draft committed. Test linked and
  uploaded files, gallery/lightbox, Before/After labels and media pagination.
- [ ] Maps request only the visible page of coordinates through saved Actions;
  the map control itself makes no record requests. Check missing setup and
  provider failure, marker links, and the unchanged native compatibility path.
- [ ] Scroll forms, planner, drawer and opened media controls top-to-bottom at
  desktop and mobile widths; inspect clipping, overflow, focus and overlap.
  The composition fixture is local-only and does not prove a live migration.

## Browser Action pagination

- [ ] In Actions → New Action → full program, add a paginated request. Edit
  its destination, cursor and list fields in Fields and Source. Check the
  entire composer at desktop and 375px widths, including expanded arrays and
  the save controls; no clipping or horizontal overflow.
- [ ] Run an owned paginated GET against two real pages. Verify all records
  exactly once, including serials beginning with zero. Missing/repeated
  cursors, expired sessions, account changes and page/item/byte/time limits
  must fail clearly without presenting a partial list as complete.
- [ ] Prepare that Action with no execution version, 1.7 and 2.0 clients:
  each must receive 409. A 1.8 client succeeds. Ordinary 1.7 browser programs
  and server Actions keep their previous execution and limit behavior.

## Remote brightness and files

- [ ] Android selected folders: use only a synthetic test folder with the system
  picker. Verify cancel, activity pause/resume/recreation, account/origin change,
  expired pending selection, persisted restart readback, Check folder and Remove
  access without file deletion. A second account reference must retain its OS
  grant; failed storage must never release an existing reference. Unknown size,
  virtual items, loading/partial providers, missing folders and changed bytes
  with an unchanged timestamp must refuse a complete scan/read. Run Android JVM
  tests and `android/scripts/test-mobile-devices.sh` with a private local fixture;
  the optional `folderSelection=true` test still requires real picker selection.
- [ ] Android folder-control fixture: open
  `/scripts/mobile-folders.browser.html?platform=android` at phone and desktop
  widths; choose/check/remove and fail a request. Retain prior selections and
  avoid overflow. Check the installed signed-in app's native list result too;
  synthetic browser responses cannot prove provider permissions.

- [ ] iOS selected-folder access: choose a synthetic Files folder, cancel the
  picker, relaunch and check the retained grant, then remove access without
  deleting its contents. Switch account/origin or background during selection,
  hashing and reads: stale callbacks never publish bytes or leave controls busy.
  A missing/revoked provider, symlink, changed inode/version, colliding name or
  scan limit must fail without a complete/empty inventory. Hash an 8 MiB + 17
  byte fixture independently and verify its final partial read. Run native
  `MobileFolderTests` and web `test:file-sync`.
- [ ] Folder-control remount regression: open
  `/scripts/mobile-folders.browser.html` in StrictMode at 1280px and 390px,
  choose/check/remove synthetic grants, arm a failure and check again. Existing
  selections remain visible, controls recover after remount/cancellation, long
  names wrap and action groups fit without horizontal overflow. This fixture
  proves UI behavior only; signed-in native picker acceptance is separate.

- [ ] Native iOS pairing: select a compatible local origin, sign in, add this
      device from Things and Settings, reload/relaunch and verify exactly one
      iOS device. Interrupt prepare/complete and retry; change accounts/origins
      during requests; background/foreground the app; revoke the credential and
      reconnect explicitly. Keys/credentials must never appear in bridge replies.
      Run `iOS/scripts/test-mobile-devices.sh` with a disposable local fixture;
      keep simulator signing enabled so secure-storage failures are not bypassed.
- [ ] Mobile device contract: pair signed synthetic iOS and Android descriptors,
  list/read them through the owner API and reload Things. Their platform must
  survive server and client projections without becoming macOS or acquiring
  desktop controls. Changed proof fields and foreign owners must be refused.
- [ ] Persistent sync (acceptance pending native adapters): edit both copies,
  delete one while editing the other, interrupt after accepted publication,
  restart with the same operation IDs and fill the journal disk. No file may
  be overwritten/deleted from an incomplete scan or unconfirmed receipt. Change
  account/origin/data plane during each async stage. Run `test:file-sync`; its
  simulated transport tests do not replace real native/cloud byte checks.

- [ ] A running macOS app with an empty or whitespace-only name must use its
  bundle identifier in the heartbeat. Blank identifiers are skipped before the
  64-app limit; the full state update must still reach the server.

- [ ] On a paired Apple Silicon Mac, change main-display and per-display
  brightness, verify the real panel and next telemetry value, then restore it.
  A display without a usable setter stays unavailable. Existing pairings gain
  updated capabilities on a higher-revision heartbeat without being re-paired.
- [ ] Adjust the brightness and volume sliders with arrow, Home/End and
  PageUp/PageDown keys. Each change must send one remote command and reach the
  observed device state; the thumb must not move without applying the change.
- [ ] Open `/things?files=thingtime` and a device's Files drawer section at
  desktop and 390px widths. Exercise grid/list, name/type filters, sort, hidden
  files, long names, selection, context menus, folder navigation, and the
  expanded pop-up. Scroll the full page, drawer list and pop-up to their ends;
  menus and approval/cancel controls remain visible and inside the viewport.
- [ ] Copy and cut synthetic files and a nested folder between Thingtime and
  an unlocked paired Mac, and between two folders on the same device. Verify
  byte hashes, destination listing and source retention/removal. Refuse existing
  names, self-descendants, links, oversized files and changed source versions.
  Cancel or fail a destination write: original files must remain. A successful
  remote source removal goes to Trash; an uncertain move must not be retried
  blindly. No test should read unrelated home-directory files.
- [ ] Verify deny and ask-every-time device settings, locked sessions, old node
  capabilities, an unapproved upload account, expired results and another
  account's command IDs. Command history/events never contain chunk bytes.
  Repeat directory listing after temporary-upload cleanup: scanning on a
  duplicated descriptor must not consume the subsequent listing's cursor.
- [ ] Session-lock policy checks and lock confirmation must use the narrow
  session snapshot, without enumerating Bluetooth or other hardware. Run the
  controller tests in an unsigned XCTest host: locked approved commands and
  unlocked unapproved commands must be refused, desktop command replay must
  send once, and explicit telemetry refresh must replay its retained response.
  Hardware telemetry and privacy permissions require separate signed-app checks.
- [ ] Run native `swift test`, `test:devices`, `test:things`, `test:attachments`,
  `test:api-capabilities`, a complete web build, and Electron tests. The
  opt-in `TT_BRIGHTNESS_HARDWARE_TEST=1 swift test --filter DisplayBrightnessTests`
  briefly changes and restores the actual display; do not count a skipped
  hardware test or synthetic UI relay as real remote-transfer acceptance.

- Connections/index rollout: keep external-source authorization and private-subspace membership fences after merging shared readers. Stub DNS alongside fetch in outbound redirect tests so machine-local `.test` resolution cannot bypass credential-stripping assertions.

## Integration catalogue

- [ ] As an admin, Prepare builder pages twice: the first call creates the
  integration hierarchy and the second reports unchanged, with zero skipped.
  Anonymous/non-admin calls must fail. Verify capability 1.2.0 before seeding.
- [ ] Follow index → service → individual example → service → index. Confirm
  all 60 Lodash examples fit on one service page and every example resolves
  a real component. Run a chart, a transformation and an API example.
- [ ] At desktop, 390px and 320px, scroll index and service pages to the bottom,
  open the inspector, edit an example input override, save a private copy,
  reopen it and check the default system page remains unchanged. Public templates
  must default to Private when copied; an owned page retains its audience.
  Editing the inputJson block argument must refresh the visible demo inputs. Keys and
  results must never appear in saved page/component documents.

- [ ] Assert 500 unique recipes, pinned CDN URLs and schema-valid private saved
  Things with `test:library`. Run the real browser harness, inspect every failure,
  correct obsolete provider endpoints/defaults and rerun corrected examples.
- [ ] At desktop and 390px widths, search for no results, reset filters, select a
  provider/type/access filter, paginate and scroll the full page to its footer.
  Open Try it, Source and Reuse; check wrapping and horizontal overflow.
- [ ] Save one example, open all three private Things, run the component, and
  verify that its Action Thing prepares the same input payload. Retry a partial
  save using the same copy identifier; account switches start a fresh copy.

## Remote integration runtime

- [ ] Run a pinned visual module and a pure transformation in Chrome. Confirm
  opaque frames and successful worker loading; a module worker bootstrap must
  not silently fail in an opaque-origin frame. Cancel, rerun, invalid JSON and
  input/response limits must resolve visibly without leaving Run disabled.
- [ ] On desktop and mobile, expand key entry and switch views; scroll the whole
  page, check output wrapping, show/hide/clear, and verify that account changes
  discard credentials. Saved Things contain only defaults and registry IDs.
- [ ] Verify no remote package loads while browsing, arbitrary IDs/URLs cannot
  execute, redirects and live Stripe keys are rejected, anonymous API calls fail,
  and `/library/sandbox.html` receives its sandbox CSP on the built deployment.
  Run `test:library`, `test:api-capabilities`, `test:vercel-config` and a full build.

## Service workspace and Vault environments

- [ ] Dashboard, planner, job cards and visit histories show the property street
  address, linked customers and assigned crew. Check multiple linked customers,
  unassigned visits, moved jobs and narrow screens. Customer/B2B views must not
  disclose another customer's name, hidden staff names or raw record IDs.

- [ ] Verify Maps under production CSP: the SDK loads and renders/clicks markers
  with a restricted key, without inline-script or eval exceptions. Check the
  Google SDK/service hosts remain explicit and no wildcard script host is added.
- [ ] Change an existing visit's job; its nested record folder moves with it and
  another time/resource log can still be added without a folder conflict.

- [ ] At desktop and mobile widths, scroll the workspace and every opened record
  dialog to both ends. Menus and dialogs stay above the Thingtime header and
  builder toolbar, with reachable controls and no horizontal page overflow.
- [ ] Open a property and create a job, then schedule a visit from that job.
  Date/time inputs persist after reload, including native picker/autofill paths.
  Job, property and visit links retain context and display names instead of IDs.
- [ ] Use record context menus to edit, duplicate, delete and restore. Cancel is
  non-mutating. The common Trash includes time logs, usage and visits as well as
  directory records. Check before/after media, per-file metadata, comments,
  profile thumbnail/banner choices and reload persistence.
- [ ] Drag visits between days and reorder within a day; verify day/week navigation,
  keyboard ordering and date controls. Log a timed sub-job and equipment usage
  with employee, battery percentage, vehicle, fuel and travel times.
- [ ] Verify Customer/B2B isolation, staff write limits, owner membership protection,
  stale-edit conflicts, explicit private ACLs, moderation and immediate revocation
  on workspace, bound page, comments and attachment requests.
- [ ] In Vault, create a secret in a selected environment. Move an existing secret
  and provider to another environment and Ungrouped without re-entering a value.
  Cancel preserves the previous environment; no response reveals encrypted data.
- [ ] With restricted Google keys, test autocomplete, selecting a result, map marker
  navigation and manual address entry. Switching Vault environment must select
  the matching keys; missing/ambiguous entries show an actionable state.


## Real browser portable transfer acceptance

- [ ] On desktop and mobile, copy a Thing and use Cmd/Ctrl+V on the Things
  canvas and inside Import. Require ready content without a file chooser;
  editable search/text controls must keep native paste. Test clipboard denial,
  invalid content, selection cancellation and account changes. Select and drop
  multiple JSON/ZIP files with colliding portable IDs; all validate before writes,
  import independently in order, and stop on error without replaying completed
  imports. Confirm every copy and attachment through the API and clean fixtures.
  Expand the input panel and scroll to both ends; footer controls must remain
  reachable above floating DevKit controls at mobile widths.

- [ ] Export an authorized chat whose historical participant has a public HTTPS
  avatar. With export capability 1.14.0, require exact image bytes in its ZIP,
  no original URL in the archive, a fresh private avatar after normal upload/import,
  and successful re-export after the source URL is unavailable. Refuse HTTP,
  redirects, private-network DNS, invalid images and excessive sizes without a
  partial archive; do not bypass upload approval or create live recipients.

- [ ] Run `node --import tsx --test app/api/utils/things/recordingTransfer.integration.test.ts`
  from `remix/` with `TT_TRANSFER_RECORDING_TEST=1 TT_TRANSFER_REMOTE_DEV_TEST=1`,
  the approved dev/PR-preview URL and username, and an ephemeral fixture cookie.
  Verify synthetic WAV ZIP bytes, a fresh durable recording ID, anonymous denial,
  source-deletion independence, re-export and both content/Thing 404 cleanup.
  No microphone or transcription is used. If upload start times out before an ID,
  reconcile the logged stable request ID with the identical upload metadata before
  another run; never generate a replacement operation to mask uncertain completion.
  A default skipped test is not acceptance or playback/transcript coverage.

- [ ] Run `node --import tsx --test app/api/utils/things/libraryTransfer.integration.test.ts`
  from `remix/` with `TT_TRANSFER_LIBRARY_TEST=1 TT_TRANSFER_REMOTE_DEV_TEST=1`,
  the approved dev/PR-preview URL and username, and an ephemeral fixture cookie.
  Verify all nine kinds, copied schema/component references, copy-of-copy content,
  anonymous folder denial and 18-record cleanup. The test logs its fixture marker
  before writes. If an import times out without IDs, do not blindly rerun: wait
  out the server deadline, reconcile that marker in Things plus theme/algorithm
  libraries, and resolve any retained records through their canonical APIs first.
  A skipped run is not acceptance; this HTTP test does not replace UI checks.

- [ ] Run the real live-image archive acceptance with explicit
  `TT_TRANSFER_LIVE_MEDIA_TEST=1 TT_TRANSFER_REMOTE_DEV_TEST=1`, a dev/PR-preview
  `TT_TRANSFER_TEST_URL`, the expected `TT_TRANSFER_TEST_USERNAME`, and an
  ephemeral authenticated `TT_TRANSFER_TEST_COOKIE`:
  `node --import tsx --test app/api/utils/things/liveChatMedia.integration.test.ts`
  from `remix/`. It requires the existing self-only fixture, never adds members,
  and verifies ZIP bytes, fresh imported attachment/message binding, anonymous
  denial, unchanged source history during transfer, independent copied bytes
  after source deletion, and 404 cleanup. A default skipped run is not acceptance.

- [ ] A member exporting a live chat must retain a custom emoji referenced by
  another participant, without needing to own its definition. Verify the new
  archive has independent personal emoji bytes and preserves the reaction.
  Standalone export of that other-owned emoji must still be denied; blocked,
  pending, foreign-namespace or missing definitions must not produce a partial
  archive. Negotiate export 1.12.0 before expecting this behavior.

- [ ] After the canonical self-only live chat fixture passes, run
  `TT_TRANSFER_LIVE_CHAT_BROWSER_TEST=1 node --import tsx scripts/live-chat-transfer-browser.integration.mts`
  from `remix/`, using an ephemeral approved preview session and expected
  fixture username. Verify real clipboard Copy, ZIP download/file-picker import,
  exact history, unchanged source messages and imported-copy cleanup. The test
  refuses chats containing anyone else and never sends messages or creates a
  live chat. It writes fixture content to the macOS clipboard. Media and AI
  history require separate acceptance; do not infer them from this test.

- [ ] Messenger details: open Transfer with an active or pending membership;
  Copy and Download must be accessible, but Cut must be absent. Open Download
  and Import dialogs above the drawer at desktop/mobile widths, scroll the
  drawer fully, and confirm opening/closing controls sends no chat mutations.
  `node --import tsx scripts/messenger-transfer-ui-smoke.mts` in `remix/`
  covers this with a fictional account; live clipboard/history acceptance is separate.

- [ ] When wiring live Messenger export, supply a complete authorized snapshot
  including former authors/reactors and every thread. Preserve edits, tombstones,
  reply links and safe historical system content; never export membership roles,
  receipts, source user authority or credentials. Reject incomplete/oversized
  history rather than emitting a truncated successful archive.

- [ ] Stall export metadata: Copy/Download must leave busy state within 30
  seconds with an actionable error and no automatic retry. Retry Download after
  recovery produces a real ZIP. Check desktop/mobile dialog bounds. Cancellation
  and account changes prevent late exports; file-byte downloads are not subject
  to the metadata deadline.

- [ ] Right-click a fixture folder in Things. Copy and Cut must put all nested
  history on the real OS clipboard; Cut alone must not move/delete it. Download
  from that same context menu must produce a ZIP containing the folder and its
  descendants. The real browser harness exercises these controls before the
  shared Transfer-menu checks.
- [ ] Stall the archive GET indefinitely: within 15 seconds, show a recoverable
  timeout with Retry, not permanent "Opening private history". Retry must load
  normally after the network recovers. Unmount/account changes must cancel the
  deadline and prevent late responses from exposing the previous account's data.

- [ ] With explicit disposable dev-session variables, run
  `node --import tsx scripts/transfer-browser.integration.mts` from remix.
  Requires `TT_TRANSFER_BROWSER_TEST=1`, a PR preview origin, expected fixture
  username and ephemeral cookie; never store the cookie in a file or command
  argument. This opens fresh headed Chrome and overwrites the macOS clipboard
  with disposable fixture data. Check Copy/Paste import, Cut/Paste move,
  downloaded JSON and ZIP imports through the file chooser, desktop/mobile
  bounds, and successful cleanup.
- [ ] Additionally set `TT_TRANSFER_BROWSER_BINARY_TEST=1` only when the fixture
  already has upload approval and its normal rate-limit window permits it.
  Select a generated two-image ZIP, click Upload, import, download the actual
  ZIP and re-import that downloaded file. Both same-name/same-size images must
  survive browser dedupe with exact bytes and annotations. Delete the source
  archive and download the copy again; require independent file IDs and bytes.
  Inspect `media-desktop.png` and `media-mobile.png`, and require every fixture
  upload to return 404 after cleanup. A refusal or unrun opt-in is not acceptance.
  This currently added media phase still needs its first live passing run.

## Private chat archive import integration

- [ ] Run the opt-in `test:transfer-binary` against the approved upload-enabled
  dev fixture. Verify archive avatar/message bytes and annotations survive ZIP
  re-import and source deletion; all created roots and uploads must be cleaned
  up. This storage test complements, not replaces, the visible gallery checks.
- [ ] Include an imported custom reaction in that real ZIP test. Verify the
  projected emoji ID/bytes and re-export after deleting the source emoji;
  fixtures must use the stored `emoji` purpose, not upload alias `custom-emoji`.

- [ ] Owned archives appear as private root entries in Things/folders, never as
  separate historical message/person rows. Open reaches the read-only archive
  page with the correct Back link. Other users, PATs, apps, service accounts,
  deleting roots and custom planes do not list them. Exporting an owned folder
  preserves the entire included archive group and its folder placement.
- [ ] On desktop/mobile, expand participants, scroll all history, open/close
  Transfer → Download, retry a failed load and switch/sign out. The importer is
  You; historical people have Archived badges and no profile/mention/send/react
  actions. Old private content disappears on identity refresh. Check fixed-nav
  clearance, long text, reply links and modal bounds. The local fictional smoke
  is `node --import tsx scripts/archive-ui-smoke.mts` from remix; it proves no
  real account lifecycle or media bytes. Open the historical gallery lightbox,
  confirm shielded media cannot be reached by its navigation until Show Anyway,
  and check pending badges and file download links. Flagged historical avatars
  and unavailable files must not be fetched. Referenced owner-bound custom emoji
  images render; missing/flagged/foreign images show an unavailable placeholder
  without fetching them. No historical reaction chip performs a live action.

- [ ] Cut an owned archive and paste into another owned folder, then back to
  root: only root placement/timestamp change; message, participant, reply,
  reaction and media IDs remain identical. Stale/deleting/mixed-kind roots,
  historical children, foreign folders and non-first-party callers must fail.
  Re-read the full history and verify quota is unchanged. The selected origin
  must advertise bulk 1.4.0; repeat after deleting the containing folder.

- [ ] Download/Copy an owned archive, then re-import: preserve every historical
  message, reply, reaction, archived identity and media byte under fresh private
  IDs. Optional traversal must not truncate history. Missing emoji/media access
  or excluded required files/links must fail the whole export. Independent child
  roots and non-first-party owners cannot export archive history. Require export
  1.9.0 on the selected origin; repeat with avatar, gallery and custom emoji bytes.

- [ ] Use a real stored-upload emoji ID (emoji_ plus 64 lowercase hex digits)
  in live Messenger and an archive. Import must remap it to the fresh personal
  emoji; archive reads and message projections must retain/resolve the token.
  Legacy UUID/short IDs still work. Oversized noncanonical IDs and invalid hash
  characters fail; feed reactions still reject every custom token. Verify real
  image bytes and rendering separately from parser/identity unit tests.

- [ ] Run the explicitly enabled `test:transfer-archives` against the provided
  dev fixture only after its capability preflight succeeds. Verify no skipped
  live test and no cleanup failures. It covers folder export, metadata ZIP
  encode/decode and re-import, move and source-deletion independence; separately
  test avatar/emoji bytes and the visible chat UI.

- [ ] GET /things?id=<archive>&archive=true as the importing owner returns the
  complete historical group, exact text, reply/thread/reaction references and
  ordered attachment IDs. It must not return userId, ACLs, roles, tokens, S3
  paths or live-user lookup results. The client requires api.things 1.15.0.
- [ ] Archive attachment metadata preserves labels, order and target IDs in
  one bounded batch. Blocked/noncanonical media is omitted, pending owner media
  has pending=true and NSFW media has nsfw=true. No moderation diagnostics,
  object/upload keys or unknown crystal fields escape. attachmentTargets still
  covers blocked bindings, preventing incomplete exports. Verify the shared
  gallery with real stored image/video/audio bytes separately from fixture UI.
- [ ] Signed-out/PAT/app/service readers cannot use archive mode. A foreign,
  missing, deleting or custom-plane archive does not expose history. Oversized
  or inconsistent history returns an error, never a truncated success. All
  responses are private/no-store, including auth and retryable failures.

- [ ] Delete an imported archive through DELETE /things from the owner session:
  drain stored files, remove all history rows and refund storage. A stale
  expectedUpdatedAt returns 409 before cleanup. A deferred provider operation
  returns a sanitized retryable error, retaining history for another deletion.
- [ ] Repeat as another user, PAT, app, service account, cross-origin caller or
  custom data plane: no archive lookup/deletion authority. A participant/message
  ID cannot delete the archive. Require api.things 1.12.0 before client deletion.

- [ ] Import a complete archive with folders, avatars, message galleries,
  replies, deleted tombstones and custom emoji reactions. Verify fresh IDs,
  exact history, importer-as-self and archived counterparts; no real user,
  membership, invitation or notification writes. This awaits archive UI/export.
- [ ] Make a later archive fail. Earlier completed archives use whole-archive
  cleanup; deferred object deletion retains their roots and earlier dependencies
  in remainingIds. Cancel during the final commit: do not report success.
- [ ] Reject orphan/mixed-kind archives and source participant userId/roles
  before any writes. Generic Thing CRUD must not modify archive records.
- [ ] Require api.things-import 1.9.0 before upload/import; reject pre-archive,
  missing and incompatible-major manifests from the selected origin.

## Feature Stack activity and run chat

- [ ] Open a saved run with one merged, one conflicting, and one failed target.
  Only the merged target contributes to progress; each card names its next step.
  A running merge gate says waiting, not working. No rolling finish ETA appears.
- [ ] Check absent/stale heartbeats, closed PRs, queued workers, all-merged and
  stopped runs. Fresh PR status and old worker telemetry remain distinguishable.
- [ ] Open Ask Lopu, send a question, observe queued/answering/answered and failed
  delivery. Turn auto-refresh off; manual Refresh still works. Switching runs or
  accounts removes the prior conversation and draft immediately.
- [ ] Simulate accepting a POST then losing its response: Retry same message
  creates no duplicate. Delay a GET across Send; its older response must not hide
  the accepted question or a newer reply. Test long text and keyboard focus.
- [ ] Test online/offline/old-controller/ended states. New sends are disabled when
  unavailable; a saved uncertain request remains retryable with the same UUID.
- [ ] Check the entire dashboard from top to bottom at desktop and 390px widths,
  open and close chat, scroll long replies/history and verify no overflow.
- [ ] In the updated trusted action, ask what the run is waiting for. Verify the
  response against its actual job/step/PR facts; asking to restart does not restart.
  Cancel/restart a test run and prove stale attempts cannot publish new replies.
- [ ] Check unauthenticated admin reads/writes, bad/stale/cross-run signatures,
  oversized bodies, lease expiry and capability negotiation. All chat responses,
  including errors, are private/no-store and expose no worker lease or credential.


## Session read recovery

- [ ] Keep an unsaved draft and an expanded panel open, fail both background
  `/api/root-data` reads, and return to the tab: the same page and component
  instances remain mounted. Restore connectivity: data refreshes without reload.
  Repeat at desktop and 390px widths. A cold-start failure retries on focus,
  reconnect and a bounded timer; never replay a mutation.
- [ ] Fail a root read after switching or signing out in another same-origin tab:
  old account content disappears and cannot be restored by a delayed read.
  401/403 and malformed responses clear the fallback; changing route/query/origin
  cannot borrow the previous route's data.

- [ ] Fail the first `/api/root-data` GET after sign-in: one automatic retry
  restores the app without repeating the login POST. Fail both reads: show
  a clean error with Try again and Reload page, never a raw stack or response.
- [ ] Restore connectivity and click Try again: render current session data.
  Cancel navigation during a request/backoff: no abandoned request retries.
- [ ] Switch accounts with a delayed/failing root read: previous account content
  disappears immediately; stale generations cannot reveal it. Successful
  switches reset account-owned component state. OTP challenges stay mounted.
- [ ] Check recovery at desktop and 390px, scroll top to bottom, and keyboard
  focus both buttons: no clipping, overlap or horizontal overflow.

## Inherited Thing context menus

- [ ] Type/paste a query, change kind/view/display/sort/group, open a Thing and
  use browser Back/Forward and reload. The URL and controls retain the same
  search and rules. Fast consecutive changes must not drop query characters;
  folder navigation clears only the new entry's query, not the previous entry.
- [ ] Drawer destinations and Thing-menu Open/View data are real anchors:
  command/control-click, middle-click and the browser's open-in-new-tab menu
  leave the current page unchanged. Alt/Shift keep browser-native behaviour.
  Mutations remain buttons; disabled actions have no navigable href. Drawer
  reorder ignores modified pointer presses, and profile/settings are sibling
  links rather than nested interactive controls.
- [ ] Open the same recording/post from Things (grid, list, columns, kebab and
  right-click), its post card, the generic Thing page and recording activity.
  Base labels/order come from the Thing menu; recording activity targets the
  recording ID, never its processing-job ID. No per-card lookup on initial paint.
- [ ] Test keyboard arrows, Escape/back, focus return, touch, pinned menus,
  long labels and the full page/menu scroll at desktop and 390px. With a visible
  scrollbar, the menu's right edge stays inside document.clientWidth minus 8px.
  Options loaded while a submenu is open replace stale options immediately.
- [ ] Post privacy opens beneath Share / permissions, preserves Custom and
  hidden-link consent, and rolls back failed changes. Moderator-only flairs,
  reports, approve/remove, pin, lock, NSFW and spoiler keep their existing guards.
  Bound media and foreign Things never gain ordinary owner mutation rights.
- [ ] Cancel Send to Lopu: no mutation. Try a foreign, public, bound or unavailable
  recording and switch account/unmount during lookup or confirmation: no handoff.
  Missing/wrong-origin/breaking api.things-actions blocks before any write.
  Repeated confirmed handoffs still deduplicate through the protected writer.
- [ ] Multi-select Things: bulk actions retain their exact target count; Send to
  Lopu is absent. Test folder clipboard/paste and explicit Open versus Preview.
  Message edit/delete still pass through chat-membership authorization.

## Recording folder transfers

- Cut an owned durable recording, paste into an owned folder, and confirm the
  same recording ID/bytes/ACL remain; no upload or deletion should occur.
- Download that folder as ZIP and re-import. The fresh recording must be filed
  in the fresh parent folder, not silently moved to My Things root.
- Import a lone recording into Current folder. Delete the destination during
  placement and check explicit failure/compensation, never a dangling folder.
- Refuse draft, bound/profile/linked, foreign-owned and custom-endpoint moves;
  an old bulk capability must prevent client dispatch.

## Recording transfer lifecycle

- [ ] `recording-import` upload starts require private-upload approval, including
  when public uploads alone are approved. The same request ID cannot be reused
  across recording-import and ordinary recording/post purposes. Completed drafts
  retain expiry; expired or already committed draft replays return 409.

- [ ] Verify normal approved
  uploads retain recording purpose throughout import; incomplete imports stay
  expiring drafts, do not appear in My Things, and are reclaimed normally.
- [ ] Verify committed imports are new private recordings with preserved bytes
  and annotations. Replay, another owner, expired/bound/profile media and wrong
  byte counts must fail without changing existing recordings. Verify quota and
  metadata changes commit together and a failed commit leaves a recoverable draft.
- [ ] Export a standalone recording and a mixed recording/component ZIP on
  desktop/mobile. Download/clipboard/import/re-export must preserve bytes and
  annotations with new IDs, including embedded recording URLs and file-ID
  collisions. A no-files recording export must fail, not create an empty copy.
- [ ] Simulate a lost import response, then close the dialog. It must not retry
  the mutation or delete potentially committed recordings. A ready upload-start
  receipt must go directly to completion metadata, never PUT the bytes again.

## Account algorithm device queue

- [ ] Lose a profile save response, then edit/train again locally. Retry the
  original command unchanged before sending the newer profile. Training counts
  must not double; a forged or mismatched acknowledgment cannot mark it synced.
- [ ] Use two tabs: one live claim sends once, deletion during a create remains
  pending after its receipt, and older catalogue reads cannot resurrect it.
  Conflict review must reject either side changing after review. An independent
  copy receives a new private ID and preserves profile weights/statistics.
- [ ] Branch before the source has synced, then remove that source. When its
  creation was confirmed, sync the branch before deleting the source. When it
  never existed remotely, keep local branch content for explicit copy review.
  Local operations must not wait for network access in either case.
- [ ] Retain a large valid profile, edit it and sync without duplicating its
  entire weight map into base metadata. Wrong account/origin/selected plane,
  missing capabilities, oversized or incomplete responses must preserve local
  work. Run the account algorithm and transport tests in `test:local-workspace`.
- [ ] The native account facade, editor/feed, selection worker, transfer hooks
  and conflict UI still require activation and clean-browser acceptance before
  declaring the algorithm family complete.

## Conditional account algorithm sync

- [ ] On a disposable loopback replica, use API-created accounts to create a
  private canonical profile through `/api/v1/algorithms/sync`. Repeat the exact
  write and verify one profile with unchanged training counts; changed content
  under the same write ID must fail. Two different saves at one version must
  yield one success and one conflict. A normal metadata edit invalidates an old
  offline version. Normal export/import preserves exact profile content with
  fresh IDs, no publication and no active-selection change.
- [ ] Anonymous, temporary, service, other-owner, cross-origin and stale-plane
  requests must not reach private storage. An oversized or incomplete catalogue
  must be an error, never a successful empty snapshot. Discover both versioned
  manifests before writes. Keep the current selected-plane check when retrying
  a home-bound receipt after a verified selection change.
- [ ] Delete the selected profile and verify selection clears atomically. Select
  another profile, retry the old delete and verify the new selection survives.
  Replaying an old creation receipt must not resurrect the deleted profile.
  Run `algorithmSync.api.test.ts` using the README disposable fixture setup.
- [ ] Account offline editor, selection queue, review and native reconnect tests
  remain required before declaring account algorithms locally complete. Existing
  anonymous algorithm checks above must remain independent of this endpoint.

## Portable theme transfers

- [ ] In Settings → Things → Feed algorithms, copy/download a trained profile,
  then import JSON and ZIP at 1280px and 390px. Verify exact weight maps and
  training statistics, fresh private/unshared copies, unchanged active selection,
  anonymous/other-owner denial and no overflow through full-page scrolling.
  The private-interest warning must be visible before export and on import.
- [ ] Reject algorithm transfer fields that attempt to set sharing, active state,
  lineage or training events. Reject invalid/out-of-range weights and statistics
  before writes; a later mixed-import failure uses the dedicated delete writer.

- [ ] On `/themes`, use Transfer to copy/download a saved theme at desktop and
  mobile widths. Scroll the full page, open the transfer dialogs, then import
  JSON and ZIP files. Verify fresh private copies in My themes, equal resolved
  tokens, no change to the active theme, and denial for anonymous readers.
- [ ] Reject theme entries with account fields, folder placement, child Things
  or attached galleries before writes. A later mixed-import failure must clean
  new themes through the dedicated theme delete writer, never generic CRUD.

## Background AI execution and recovery

- [ ] With disposable data and `LOPU_CHAT_PROVIDER=test`, send a reply, navigate
  away, close its tab with another origin tab open, then repeat with all origin
  tabs closed. Reopen task overview/chat: one user turn, assistant turn and set
  of tool receipts. Start two separate chats; both progress independently.
- [ ] Same-chat concurrent replies are refused. Retrying uncertain admission with
  its identical ID never increases inference/billing; changed payload gets 409.
- [ ] Stop, reload and Retry / Continue: keep partial text and completed receipts,
  never replay old approvals. Cover missing done, malformed JSON, complete tool
  JSON without closing fence, max-token truncation, deadlines and provider loss.
- [ ] Switch accounts during requests, including switching back: no stale output,
  patch or navigation crosses sessions. Reject foreign owner/origin/data-source
  task reads and output for deleted/inaccessible conversations.
- [ ] Desktop and 390px: drawer sub-tab, Running/Needs attention/Recent, expanded
  output, Stop, chat links and recovery buttons. Scroll entire pages/chats and
  open tool details; check static rings, wrapping, clipping and overlap. At
  480–767px the header account link occurs once and notifications fit.
- [ ] Interrupt worker support in a disposable browser: direct observation reuses
  the same accepted operation with no duplicate output. Verify built manifests
  and >=300-second server function budget. Check musing, voice transcript reply
  and AI completion after navigation; real provider acceptance needs configured
  credentials, separate from provider-less fallback/validation fixtures.

## Unified Lopu conversations, scheduled Things and discussions

- [ ] Model and settings popovers remain visible and clickable above the floating
  Lopu window/mobile scrim. Repeat on `/lopu` and embedded chat at 390×844,
  desktop, and a short viewport. Select a model after scrolling the list; toggle
  a setting and reopen to confirm it sticks; test repeated trigger taps,
  Escape, and outside taps without closing the chat. Scroll to the last setting.
  Regression fixture: `/scripts/lopu-popovers.browser.html?surface=floating&autorun=1`
  (`surface=page` or `surface=embedded` for the other real surfaces). Synthetic
  HTTP/preferences only; assert hit testing, not just DOM presence. Chakra's
  **positioner wrapper** must use the shared popup layer; content-only z-index
  leaves a visible-in-DOM menu trapped beneath the window.

- [ ] With a musing, AI completion, or chat request without a chat ID running, open a fresh Lopu chat on the page, floating window, and Messenger. It must show Send and accept a first message; Stop must not cancel unrelated tasks. An existing chat with a running reply or workflow must still prevent duplicate sends and stop its own task. Regression: `lopuRecoveryReload.test.mts`.


- [ ] A saved Lopu reply stopped by a tool/hop/time/token limit automatically continues without a fixed count cap with fresh request IDs and the same chat/model. Stop, an account change, pending confirmation, incomplete tool, missing saved assistant, or a truncated stream prevents continuation. Switching chats must not redirect the continuation or change the newly selected model. Continuations do not resend attachments, stale builder blocks, or confirmation grants; provider/network failures keep manual Retry / Continue available. Exceed the former 24 tools, 12 hops and four-minute deadline; a healthy task continues. Hosting checkpoints rotate only after completed tool batches.
- Browser regression: `/scripts/lopu-send.browser.html` mounts the real chat
  view, uploader, store and background-task transport with synthetic HTTP. Run
  the full send checks: type while an upload is held; Send/Enter stay blocked;
  submission collapses the tray immediately; acceptance clears its files while
  the reply is still running without deleting committed media; pre-acceptance
  rejection restores files and preserves newer typing; retry clears correctly.
  The old disabled-field and unstable imperative-handle guards must fail it.

- [ ] The floating Lopu header expand control is a link to `/lopu` (or
  `/lopu/voice` in voice mode). Normal click expands in the current tab;
  Cmd/Ctrl-click, middle-click, Shift-click and the context menu retain native
  link behavior without closing the original chat. Check desktop and mobile.

- Browser regression fixture: `/scripts/chat-attachments.browser.html` uses the
  production Lopu/Messenger composers and uploader with synthetic HTTP/storage.
  Run its paste/drop checks at desktop and 390px, then inspect both trays and
  attachment detail popovers. No real messages or uploaded files are created.
  This worktree (`thingtime-chat-attachment-input`) uses localhost port 13100
  (HMR 13101, Nitro 13102). Funnel is unavailable: the installed Tailscale CLI
  wrapper points to a missing `/Applications/Tailscale.app` binary.

- [ ] Paste screenshots/files and drop multiple files directly on the Lopu and
  Messenger text field with the media tray closed. Each appears once; ordinary
  text paste/drop still edits text. Disabled/editing composers reject files.
  At desktop and 390px, scroll through an expanded tray and open its controls;
  check overflow. Lopu clears media at message acceptance while the reply is
  still streaming; a rejected send retains media for retry.

- [ ] Read a page with related components, search/list Things, and follow each
      Open anchor before and after reloading the chat. Verify actual hrefs,
      keyboard and new-tab navigation, safe external links, long labels at 390px,
      expanded details, and top-to-bottom scrolling. Unsafe URL schemes stay text;
      unsaved drafts and unresolved references do not invent destinations.

- [ ] At 390px width, historical tool rows put long summaries below their label
      and status icon, not in a narrow side column. Check approval, success and
      failure states through the full chat scroll; desktop retains compact rows.

- [ ] Reload a chat containing a tool that requested confirmation, then a later
      successful confirmed call. The historical request says "Approval requested"
      without a failure icon or renewed Confirm button; the later success stays
      successful. Actual permission/provider failures still render as failures.

- [ ] Keep a tab open across a deployment that adds a required capability.
  If a task reports an incompatible contract, Refresh task must negotiate a
  current manifest without reloading the tab or changing the account. Repeat
  after offline, HTTP failure and timeout. Wrong-origin, missing or breaking
  contracts must still prevent the dependent operation.

- [ ] After Lopu creates a reminder or reports a failed action, ask what
  happened in a later turn and after reload. Its server-loaded history retains
  bounded public success/failure receipts, never raw results or approval tokens.
  Verify current state before changing or repeating an earlier action; history
  is not fresh authorization. Test split assistant replies and tiny context caps.

- [ ] Native bridge 1.3: start direct audio in a populated chat and confirm
  context recall; switch back to text and reload both speakers' saved turns.
  Disconnect during saving, quit/reopen, retry and verify no duplicate turns.
  Switch account/domain while a save is in flight: no transcript crosses the
  boundary, no old save navigates a new conversation, and credentials are not
  stored in the on-device outbox. Test queue-full/disk-failure recovery, native
  transcription-only chat reconciliation, old-build upgrade messaging, and
  stopping during microphone permission or WebSocket startup.

- [ ] Direct web voice: start in an existing text chat, speak, switch back and
  reload; both speakers remain in that chat. A new voice chat gets one ID.
  Go offline during saving, reload and retry; no duplicated turns or new AI
  requests. Stop while granting microphone permission; no late stream starts.
  Switch accounts during a fetch/save and verify private history never crosses
  accounts. Test the pending-save/retry panel at desktop and 390px widths.
  On a deployed build, confirm the CSP permits only the supported voice host
  and the microphone session connects without a CSP violation.

- [ ] Desktop and 390px: switch Chat → Voice → Chat repeatedly; keep the same
  chat ID, history, draft and attachment selection. Reload a saved transcript.
  Check device transcription and direct-provider voice separately.
  Route exports must share the exact component identity, not separate wrapper
  functions: wrappers remount the composer even when they render the same page.
  Search for a long unbroken Thing ID: labels wrap within the picker, its Done
  button remains reachable, and the composer Send button stays fully in view.
- [ ] Attach a device file and select an owned Thing. Send once, refresh and
  verify the file still opens privately. Retry failures and switch accounts
  during upload; never bind, display or delete another account's attachments.
- [ ] Open a note, todo, recording and post from `/things`. Open their preview
  dialogs and detail pages, scroll top to bottom, and post/load older comments.
  Verify each comment is its own Thing with targetId; original crystal stays
  unchanged. Test hidden links, read-only audiences, deleted parents and logout.
- [ ] Ask Lopu to comment; the full proposed comment and target are shown before
  Confirm. Cancel must write nothing; changing text or target invalidates approval.
  Use an ordinary request without explaining tool internals: Lopu must call the
  proposal tool and open the actual card, not merely ask for a typed yes/no.
- [ ] Create interval and time-zone cron tasks in all three delivery modes.
  Inspect their searchable Things and separate run notes; test existing/new
  chats, notification mute, pause, completed todos, quota failure and lost leases.
  A retry must not duplicate a message; ambiguous AI runs stop for review.

- Signed-out boot recovery: abort an initial static JavaScript dependency at
  desktop and 390px widths. Recover once with the full share query/fragment
  preserved; persistent failure shows a reachable manual retry, not a blank
  root or reload loop. Storage-denied sessions offer manual retry only.
  Existing rendered content and unrelated resource errors remain untouched.
  Run `test:preview-build`; opt into its real Chrome tests with
  `TT_SHARED_PLAYWRIGHT_PATH` and `TT_SHARED_CHROME_PATH`.
  Record the actual browser version, not just the application bundle name.
  For production-client sharing coverage, build with `build:client` and set
  `TT_SHARED_BUILT_CLIENT=1` in the local-only shared composition fixture;
  API requests remain real while the browser consumes the built client bytes.
  Combining media sharing with recording Things must retain the newer contract
  on both manifests and keep standalone recordings owner-private by default.

- Shared page resolve recovery: return a 503, 429, network failure or invalid
  JSON from the page resolver. Show an explicit Retry rather than "not here";
  Retry must load the complete shared composition without signing in. A failed
  same-viewer refresh keeps its last loaded page; a 401/403/404 clears it.
  Switching viewer, target or hidden-link key must clear the old page and
  pending component results before the replacement response arrives. Check
  cold failure and recovery at desktop and 390px widths.

- After merging notification families, verify recording reminders and subspace
  moderation retain separate categories and all preference switches. Recording
  reminders and mod-queue email stay opt-in. Confirm both capability manifests
  advertise the combined additive versions and deleting parents retains both
  vote and recording-job/reminder cascades.

- Personal recording runtime: run the synthetic WAV and M4A through local
  decoding/transcription and native signed-in Claude Code. Verify grounded
  todos exclude completed/negated actions; review proper-name accuracy.
  Assert tools/customizations are disabled, prompts travel on stdin, inherited
  API credentials/endpoint overrides are excluded, native user identity is
  preserved for sign-in, output/time/audio limits apply, and temporary files
  disappear on success, cancellation and failure. No automatic jobs should be
  enabled merely by exercising this local adapter.

- Recording reminders fan out to native push only after their private todo and
  daily notification transaction commits. Retries never send another push for
  the same daily ID; blocked preferences/checkpoints send none. A push transport
  failure does not erase or duplicate the durable bell reminder.
## System vault and OAuth-only Claude

- [ ] System lists the existing CI credential IDs and integration secrets; CI Control uses the same list and its Manage link opens System.
- [ ] At desktop and 390px, scroll System top to bottom. Open platform menus, replacement forms, and Show dialogs for long names; no large blank form gaps, clipping or horizontal overflow.
- [ ] Add/rotate/enable/reorder a disposable Claude OAuth entry. The next Claude and signed CI request use the same enabled entries; legacy Anthropic API keys are rejected and excluded from delivery.
- [ ] Request Claude Opus 5 with High effort. Confirm the provider reports that model; a failed OAuth credential may retry another account with identical settings, but cannot become GPT-4o mini or drop the effort setting. Text, tools, cancellation, usage, refusal and incomplete-tool failures remain correct.
- [ ] Deployment variable lists and mutation responses never contain values. Wrong password, revoked admin access, wrong-origin requests and arbitrary project fields fail closed. Show opens only the selected encrypted variable; Vercel-sensitive values stay write-only. Add a disposable preview variable without overwriting an existing variable, replace it, and delete it; each successful write reports that redeployment is required.
- [ ] Build the Vercel output, verify the compressed native runtime and function size, then smoke the built server's capability manifest for System environment 1.0.0, vault reveal 1.1.0 and platform credentials 3.0.0.

## Verified vault reveal

- [ ] At desktop and 390px widths, CI, external integrations and personal Secure Vault offer Show without changing ordinary value-free list responses.
- [ ] Open Show, cancel, reopen; wrong password and cancelled passkey reveal nothing. A current password or same-account user-verified passkey reveals only the selected item.
- [ ] A revealed synthetic credential clears on Hide, close, account change, navigation, blur, tab hiding and 30-second timeout. Closing during a pending request prevents late values appearing. Opening another Show closes the first.
- [ ] Inspect the full page and open modal top-to-bottom: long labels/credentials wrap, all buttons stay reachable, no horizontal overflow on mobile.
- [ ] Cross-origin, anonymous, non-admin admin-vault access, other-owner personal entries, replayed/expired/wrong-session passkeys and fixed-limit exhaustion fail without decryption. Every response is private/no-store; no plaintext enters list caches or request logs.

- Thing detail back links accept only `things`, `actions`, or `feed` as `from`.
  Unknown values and prototype keys such as `toString` must display a working
  Back to feed link on desktop and mobile.

- Rich-text editors initialize when a browser omits `crypto.randomUUID`.
  Multiple mounted editors of the same saved block keep independent tune IDs;
  plain registry identifiers are never treated as credentials.

- At 390px and desktop widths, the Lopu message input stays inside its composer
  card after typing and resizing. Measure the textarea and card bounds, not
  just document width (a clipped ancestor can hide overflow). Open/close chat
  settings and inspect the bottom controls after scrolling.

- Combined Watch/Lopu/Builder release: build both embedded native targets;
  iOS-only ActivityKit source must not compile into watchOS. Nested Builder
  `ttArg` and `ttFormat` data must share the existing output-size budget and
  must not execute template-shaped action result data. Confirm logout clears
  Watch history, passkeys, Builder source/detail data and Lopu chat caches.

- Signed-out first paint: `/`, `/builder/demos`, and `/watch/pair` must render
  without a Watch approval banner exception. Account switching and temporary
  sessions never show another account's cached Watch requests; expired and
  dismissed requests stay hidden.

- Watch release integration: the Nitro health contract smoke accepts documented
  `degraded` / `migration-required` responses, but rejects contradictory readiness
  or unavailable storage. Separately require `ready` on the release deployment;
  passing the contract smoke alone is not proof that uploads are enabled.

Run the checklist for every area a PR touches, in a live browser against the
local dev stack (`npm run web-pms`, worktree stacks get their own port trio —
see `AI_ALL.md`). Each list is the distilled regression history of that area:
every line exists because it broke once. Add a line whenever a new bug class
is fixed, and cite the checklist you ran in the PR description.

## Lopu Apple Watch recording automation

- [ ] Recording transcript quotes: verify real Watch attachments and comments
  using inherited ACLs beneath their private parent; sharing the parent or
  rebinding/deleting either child must remove the quote on refresh.
- [ ] Recording transcript quotes: on desktop and 390px mobile inspect a post,
      Thing/media detail, chat attachment and recording activity. Saved text
      appears beneath its own player/file; switching audio tracks switches the
      quote. Expand/collapse a long multiline transcript, scroll to the bottom,
      and copy its text. No overflow, markup execution or empty quote shell.
      Batch lookups negotiate recordings 1.7.0; missing/deleted/foreign/shared
      sources or comments reveal nothing. Account switch/unmount fences stale
      replies. A transient refresh failure preserves same-view text; successful
      deletion/revocation refresh clears it. No inference or data migration.

- [ ] Recording/AI subscription rates: Free retains configured windows, Plus receives 5x, Pro/PAYG bypass only the two product request-rate buckets. A spoofed request tier or foreign account cannot grant access. Upgrade/downgrade re-resolves the protected home assignment and keeps the same account bucket across sessions/devices/IPs. Entitlement/limiter outages return private 503 without provider calls; finite exhaustion returns 429/Retry-After. Authentication, upload constraints and provider quotas stay enforced. Negotiate ai-complete 1.1.0 and lopu-recordings 1.2.0; reject older/breaking manifests.

- [ ] Shared AI endpoint: negotiate `api.ai-complete` on the selected origin, then submit text with 1–4 owned Secure Vault IDs. Reject inline URLs/tokens, audio, foreign IDs anywhere in the list, temporary/service/scoped accounts, cross-origin or non-JSON requests, duplicate IDs and oversized input before external delivery. Force a 429 on one endpoint and verify only the next selected endpoint receives its own credential; stop on success, malformed output, unsafe host, other 4xx or caller cancellation. Inspect redacted attempt receipts, no-store and fail-closed rate limiting. Existing recording retry/consent tests must still pass against the same shared waterfall engine.

- [ ] Credential waterfall: select/reorder/remove up to four own API connections per stage; paste no keys into recording settings. A missing default or deleted last connection must not prevent replacing it. Claude must never be selectable for audio. Verify 429/401/timeout fallback, first-success stop, and no repeat per key; invalid output/unsafe endpoint must stop. Disable consent or change the selected list after the first failure and verify no second provider receives content. Another account's connection ID must be rejected and responses must contain no tokens/endpoints. Verify desktop and mobile controls, open selects, full-page scrolling and optimistic rollback.

- [ ] Force a storage-download failure and provider 401/429 in the isolated test harness. Verify recording status identifies the failed step and never exposes raw errors, credentials, signed URLs, or transcript content. Retry must preserve completed checkpoints.

- [ ] On desktop and 390px mobile, open `/lopu/recordings`, verify the account,
      refresh status, save options/time zone/hour, and scroll to the bottom.
      Inputs must not overlap; missing `AbortSignal.timeout` must not prevent
      loading. Preserve loaded state during background refreshes.
- [ ] With no provider configured, show that fact and prevent enabling; an
      already-enabled account must still be able to disable automation.
- [ ] With explicit opt-in and a configured provider, upload a new private
      Watch recording. Verify transcript comments and private notes/todos,
      source links, quota accounting, and a visible completed receipt.
- [ ] Retry after a provider failure or interruption after a committed comment:
      the transcript and derived Things must not duplicate. Long emoji
      transcripts split into valid comments within the comment size limit.
- [ ] A different account, temporary user, scoped credential, cross-origin
      mutation, invalid settings or unauthenticated scheduler cannot change
      state or disclose recordings. Switching accounts clears the prior view.
- [ ] Disable automation or privatization eligibility during processing:
      no later content write succeeds; re-enable without scanning old uploads.
- [ ] Send reminders twice on one local date: one bell entry per unfinished
      todo. Completion, paused reminders and disabled notification preferences
      stop subsequent alerts. Check a DST transition and the next local day.
- [ ] Verify actual native push on a paired Watch separately from bell history;
      a provider-configured flag or HTTP 200 is not end-to-end proof.

## Native Commander network speed test

- [ ] Account allowances: Free 4/hour, Plus 20/hour, Pro/PAYG unlimited by
      default; admin overrides and historical tier snapshots remain effective.
      Back-to-back tests work within the budget. Changing IP or session never
      resets an account budget; different accounts do not share an IP quota.
- [ ] Invalid/revoked or wrong-origin account tokens fail without guest fallback.
      A selected locked account must prompt sign-in/unlock, not run anonymously.
- [ ] A quota-denied zero-sample retry preserves the previous speed readings.
      Switching accounts clears prior-account results and rejects stale replies.
- [ ] Settings → Account → Compare account features shows the live tier
      allowances at desktop/mobile widths. Admin tier and subscription editors
      expose speedTestsPerHour, with null for unlimited and 0 for disabled.

- [ ] Activity: run one 17.6 MiB each-way test against the deployed origin;
      confirm 5/5 download and upload samples, no 400/413, and no upload request
      exceeds 2 MiB. Wait through a latency refresh: both speed values remain.
- [ ] A streamed upload without Content-Length succeeds only for the exact
      allowlisted byte count; short, oversized, and false-length bodies fail.
- [ ] Interrupt a direction or hit its cooldown: completed measurements remain
      visible, partial results are labelled, and Retry-After is actionable.
      Opening a second Commander window must not duplicate an in-flight test.
- [ ] Both capability manifests advertise download 1.1.0 and upload 2.1.0; incompatible/missing
      capabilities are rejected before transferring the speed-test payloads.

## ChatGPT / Codex MCP connector

- [ ] `GET /.well-known/oauth-protected-resource`, `GET
      /.well-known/oauth-authorization-server`, and the Thingtime capability
      manifest return the deployed HTTPS origin and the MCP path exactly.
- [ ] From ChatGPT Developer mode, add the deployed MCP URL. The authorization
      page works at desktop and a 390px mobile viewport, requires `resource`,
      state, and S256 PKCE, and never reflects a personal access token in the
      redirect or an error page.
- [ ] The OAuth connection page starts with Thingtime SSO rather than a token
      form. After SSO, its background-generated default is non-expiring
      read/write-all Things access; Advanced settings can narrow scopes,
      regenerate the generated token (revoking its predecessor), and add a
      manually scoped additional account without exposing a credential to a
      chat, redirect, or error page.
- [ ] After selecting Connect Thingtime, the page visibly enters its
      completion state, reports an in-page error if preparation fails, and
      only then navigates to the exact registered OAuth callback.
- [ ] Connect two PAT-backed accounts at different explicitly allowed origins;
      list/select them in ChatGPT and verify reads use the selected account.
      An unallowlisted endpoint, non-PAT credential, read-less PAT, replayed
      authorization code, altered callback/resource, or altered verifier must
      fail closed.
- [ ] In an unauthenticated existing chat, `@Thingtime login` reaches the MCP
      tool (rather than failing as an HTTP transport error), returns its
      tool-level `mcp/www_authenticate` challenge, opens that chat host's OAuth
      browser, and returns only through its registered callback. Without
      starting a separate CLI listener or a new chat, add two named accounts on
      that page, then confirm `@Thingtime list accounts` exposes safe metadata
      for both. Bridge credentials have no default expiry but become unusable
      immediately after their account or connection is revoked.
- [ ] Confirm a read/search tool succeeds with `things.read`, while each write
      tool asks for ChatGPT confirmation and the target API rejects a PAT that
      lacks its exact Things scope. Disconnecting an account removes its bridge
      access; removing the last account revokes the ChatGPT bridge session.
- [ ] With a known Thing ID outside the first recent/list page,
      `get_thingtime_thing` calls the exact-ID API and returns that Thing or the
      stable `thing_not_found` error; it never falls back to list/search. With a
      known parent ID, `list_thingtime_comments` returns only directly attached
      comments and preserves `limit`/`cursor` pagination without fetching global
      comment rows.
- [ ] `tools/list` exposes all 32 tools with the Thingtime MCP App output
      template; prompts and static UI/contract resources work before OAuth,
      while account-scoped resources return the OAuth challenge. In the app,
      inspect Result, Diff, and Raw tabs at desktop and 390px mobile widths,
      select multiple rows, expand details, and verify Apply stays disabled
      until the explicit confirmation checkbox is checked.
- [ ] Preview a create/update/delete plan with least-privilege scopes. Change
      one target after preview and verify apply returns 409 without performing
      any operation; with fresh preconditions, verify serial apply, honest
      partial failure receipts, encrypted history, and undo-as-a-new-preview.
- [ ] Create a valid `Thingtime Capability` data Thing with `$input`
      placeholders, start it, and verify its exact signed preview must match the
      persisted workflow run. Reject missing inputs, duplicate targets, more
      than 25 operations, raw query/operator keys, URLs/routes, and code.

## Limitless MCP Lab (`/docs/mcp`)

- [ ] On a production-CSP preview, the embedded review app renders its Result,
      Diff, and Raw tabs instead of remaining on the empty placeholder; the
      route CSP permits only the review module's exact SHA-256 hash and keeps
      `unsafe-inline` / `unsafe-eval` absent.

- [ ] Open `/docs/mcp` at desktop and 390px mobile widths. Confirm the live
      contract badge resolves without replacing the optimistic release counts,
      all six stat cards fit without horizontal overflow, and the docs drawer
      opens, closes, and identifies **Limitless MCP Lab** as active.
- [ ] Select all five missions. Each selection must update the prompt, expected
      outcome, ordered tool pipeline, and embedded review cards without a page
      reload; **Copy** copies only the selected prompt.
- [ ] In the embedded shipped MCP App, inspect Result, Diff, and Raw; select a
      row, expand Full details, and scroll to the bottom. The read-only morning
      mission must not show an Apply control. Write-composing missions must keep
      Apply disabled until the confirmation checkbox is selected, then fail
      closed with the host-only message rather than mutating data.
- [ ] Load the page with MCP discovery unavailable. The release contract and
      workflow cards remain immediately usable, the page shows the quiet
      release-contract state, and no spinner, blank page, recursive request,
      iframe error, or console exception appears.

## Admin integration vault + policy proxy

- [ ] Sign in as an admin and open **/admin → External integrations**. Without
      `THINGTIME_ADMIN_VAULT_KEY`, the visible warning explains setup and
      **Save secret** is disabled; no browser request reveals a credential.
- [ ] With a disposable 32-byte base64url vault key, save a labelled Vercel
      token. Refresh and confirm its row shows only label/id/date—not masked or
      plaintext value. Deletion is blocked while an endpoint references it.
- [ ] Save a Vercel endpoint with read + **Create new items only**, then verify
      an existing environment key is blocked before POST and the redacted audit
      contains only operation, path, status, and outcome—never body, token, or
      secret value. Generic endpoints cannot claim create-only semantics.

## Lopu voice + personal Secure Vault

- [ ] Desktop speech bridge 1.1.0 requests continuous capture only for the
      message composer, so the native 1.5-second utterance cutoff cannot preempt
      its configurable silence window. Private-page Transcribe and older bridge
      clients retain the utterance boundary. Reject non-boolean continuous-mode
      requests before spawning a helper; 1.0.0 clients remain supported.

- [ ] Standard Mac/browser dictation writes partial and final words directly
      into Message Lopu, with no separate transcript preview. Enable Hear me out
      while checking draft-only interactions.
      Begin with typed text; stop mid-phrase, edit, resume, and switch Chat ↔ Voice:
      preserve the draft and append new speech without repeating revised words.
      A recognizer restart/failure retains the draft. Typing and explicit Send
      stop capture; late callbacks cannot overwrite edits or refill a sent draft.
      Rejected sends restore the text. With Spoken replies on, stop playback
      and send again: cancellation cannot hang the turn queue or start the mic.
      Run `scripts/lopu-dictation.browser.html`
      in page/compact layouts at desktop and 390px, then verify real speech in
      the signed installed Mac app. Private-page Transcribe and Direct voice
      keep their existing dedicated flows when Hear me out is off.
- [ ] Dictation defaults to five seconds of silence before sending the entire
      current draft once and stopping the microphone. Speech during the delay
      resets it; final/restarted recognizers do not duplicate text or extend a
      silent deadline. Settings → Lopu → Voice transcription and the voice gear
      share a persistent custom 1–120 second delay (default 5); check reload,
      empty/invalid/extreme inputs, decimals, and cross-tab preference sync.
- [ ] Chat settings → Hear me out never auto-sends. After ten seconds of silence
      with words in the draft, one “Send now?” popup appears while listening
      continues. Keep listening/Escape dismiss it; another ten seconds asks
      again. New speech dismisses and resets it. Send now sends the latest whole
      draft exactly once; rejection restores it. Stop, typing, chat/account/mode
      changes, lock and unmount cancel pending prompts/sends. Empty captures do
      neither. While Lopu is replying, silence/Send now use the ordinary message
      queue; later delivery must not replace a newer unsent draft. Test standard and compact layouts at desktop and 390px, including
      keyboard focus, scrolling the voice settings, and popup overlap. Enabling
      Hear me out overrides Direct voice/Transcribe; an already active native
      iOS recording stops and cannot restart in this unsupported mode.
      Run both regressions in `scripts/lopu-dictation.browser.html` separately.
- [ ] On Mac, listen silently across at least two native no-input retry cycles
      (15 seconds), then speak: silence must not show a red service error or
      send a message; the phrase fills the draft and the selected silence policy
      sends once or asks. Stop ends
      capture/retries. An interrupted helper still reports a real error, and
      retry clears it without removing conversation messages.
- [ ] After a microphone permission or recognition failure, retry voice input:
      the previous recognition error disappears immediately, a successful
      transcript fills the draft, and existing messages/turn failures remain.
      Repeat a failed retry and switch chats; errors must not accumulate or
      leak into another conversation. On Mac, interrupt a disposable native
      capture to exercise recovery without resetting OS permissions.
- [ ] With iOS build 29 and private uploads approved, finish a voice segment:
      `/things` contains one playable owner-private M4A recording and Files
      retains the original CAF/TXT. Open the saved notice at desktop and 390px;
      its recording link is usable and long filenames do not overflow.
- [ ] Interrupt upload completion, reopen Lopu, and confirm one recording Thing
      with no duplicate PUT or storage reservation. Disconnect before upload,
      reconnect, and confirm pending local work resumes. A server lacking
      attachment upload/complete 1.2.0 receives no recording write.
- [ ] Switch accounts/destinations with pending audio: the new account must not
      receive the earlier recording. Denied private-upload approval or full
      storage leaves the recording local and shows a pending notice.
- [ ] Advance attachment draft cleanup past its TTL: completed recording Things
      survive, while abandoned pending recordings and ordinary post drafts
      still expire. Another account cannot read the private recording. The
      /things listing includes ready standalone recordings but excludes pending
      recordings, other attachment purposes and protected account records; root
      and folder filters and token visibility restrictions remain effective.

- [ ] With build 25's general native bridge (no `lopuVoiceVersion`), tapping
      voice says to update Thingtime and does not claim the mic is active.
      With build 27's compatible voice capability, native recording starts.

- [ ] iOS voice recovery: allow Microphone but deny Speech Recognition and verify
      the distinct Settings instruction; allow both, speak, pause, then stop
      mid-utterance. Each utterance is submitted once and remains in the selected
      chat after reopening it. Stop during a permission sheet and rapidly
      stop/start: no delayed callback may restart the microphone. Retry a
      recognition failure three times: it stops with an actionable error.
- [ ] After native voice capture, open Files → On My iPhone → Thingtime →
      Lopu Recordings; play the CAF audio and read its TXT transcript. Repeat
      with the reply endpoint offline; both local files must survive. Check the
      recording notice at 390px and desktop widths with a long filename.
- [ ] Disable Live Activities, start voice, and verify recording continues with
      a clear Settings notice. Enable them and start in the foreground after
      the microphone permission sheet closes; lock the physical iPhone and
      verify the Live Activity. Stop/start must not end the replacement activity.


- [ ] Open `/lopu/voice` at desktop and 390px mobile widths; scroll the
      conversation from top to bottom, open and close the gear before and
      during a session, and confirm the header, the gear popover, messages
      and the voice deck never clip, overlap, or cause horizontal page
      scrolling.
- [ ] In a clean anonymous browser, load the production offline shell, disconnect,
      then open **Settings → Security → Secure Vault**. Create the independent
      device passphrase, environment, key value and provider. Verify native
      forms at 1440/390/320px; reload locks and the same passphrase restores
      entries. Wrong passphrases, quota refusal and damaged saved rows preserve
      ciphertext. There must be no account Vault/reveal requests or writes.
- [ ] Anonymous selected-value reveal clears on blur, hiding, page exit, manual
      Hide, vault lock and after 30 seconds. Move an entry out of an environment
      before deleting it; a nonempty deletion must fail without changing either.
      Race child creation against group deletion and verify one coherent result.
      Inspect device storage after deletion too: notification history must not
      contain vault names, values or passphrases outside the encrypted records.
- [ ] Supply a malformed/non-string or over-32-KiB replacement provider token:
      reject it before touching the saved account record. An omitted/empty token
      remains the explicit retain-existing operation. Confirm both capability
      manifests advertise `api.lopu-vault` 1.2.1 and keep account host restrictions.
- [ ] Add a disposable provider in **Settings → Secure Vault**, grouped under a
      test environment. Refresh and verify only metadata returns to the
      browser—never plaintext, masked text, IV, tag, or ciphertext. Updating
      without a new token retains the stored token; deleting removes it.
- [ ] Select that provider for the chat (the gear's provider select or the
      composer's picker). Confirm continuous listening pauses while the
      provider responds and while Lopu speaks, then resumes without hearing
      Lopu's own voice. Toggle **Spoken replies** before, during, and after
      the session and verify replies render, and speak only while it is on.
- [ ] Verify a provider connection's model is optional. The Secure Vault form
      offers the kind's catalog models (realtime voice models marked) plus a
      **Custom model id…** entry and shows the chosen model in the stored
      metadata line; a custom compatible host requires a model id. A
      connection saved without a model runs on its kind's first catalog model
      (`GET /api/v1/ai/models` → `vaultProviders[].model`), and a turn's meta
      names that model. Reasoning and speed are chosen per chat in the
      composer, never stored in Secure Vault.
- [ ] Exercise **Direct voice**. With no provider chosen, a catalog model, a
      provider whose kind has no realtime model (any non-xAI connection), or
      Transcribe mode on, the gear's switch is disabled and its hint reads the
      reason in one line; Settings → Lopu 🦄 mirrors the switch. With an xAI
      connection the switch enables, a realtime-model select appears
      (Grok Voice / Grok Voice Think Fast 2.0), and starting the mic mints a
      credential through `/voice/session` — the network log shows only the
      ephemeral token and `wss://api.x.ai/v1/realtime?model=…`, never the
      stored key — then streams PCM both ways; the provider's transcripts and
      reply text land in the conversation list, Spoken replies off suppresses
      playback, and Stop closes the socket. When the mint is refused (vault
      key missing, connection not yours) a Lopu toast says why and device
      transcription runs.
- [ ] Turn on **Transcribe mode**, speak several final utterances, and verify
      each creates a separately numbered, timestamped, owner-private Thing page
      and streams back into chat as a quote with a working page link. Provider
      selection and Direct voice stay disabled and no provider request occurs
      in this mode.
- [ ] Reject unauthenticated vault/voice/session requests, non-JSON bodies
      (415), guest sessions (403), oversized bodies, missing provider tokens,
      non-HTTPS or private/local endpoints, unallowlisted custom hosts,
      private DNS resolutions, redirects, oversized provider responses, and
      rate-limit-store failures. Error responses must not echo provider
      bodies or credentials; `/voice/session` refusals carry no `session`.
- [ ] Make the provider answer a **non-JSON rejection** — an HTML or empty-body
      429/502/504, the shape an edge/CDN returns before the API is reached —
      for both the voice turn and `/voice/session`. The Lopu toast must name
      the status ("rejected the request (429)"), never "unreadable response":
      the status is the only thing telling the user whether to wait, re-key,
      or pick another model. Covered by `npm run test:lopu`
      (`app/api/utils/lopu/voice.test.ts`).
- [ ] In the iOS app, grant microphone and speech access from the user action,
      start Lopu, lock the device, and verify recognition/replies continue and
      the Live Activity moves through listening, thinking/transcribing, and
      speaking. Confirm native reply requests carry only unexpired cookies
      matching the active Thingtime origin and API path. Stop the session and
      confirm the microphone, audio session, and Live Activity all end.
- [ ] In iOS direct voice (`inputMode: provider-audio`), deny Speech
      Recognition but allow Microphone; the session should still start,
      stream and play realtime audio under the background audio session,
      update the Live Activity while locked, post the provider's transcripts
      into the conversation, and close its WebSocket and player cleanly on
      Stop.

## Deployment peer explorer (`/peers`, `/api/v1/admin/peers`)

- [ ] As an administrator, open **Dev → Deployment peers**. Verify the first
      page retains current rows while Refresh runs, requests at most 25 rows,
      and **Load next bounded page** advances only one opaque cursor page (no
      all-peers request or automatic unbounded hydration).
- [ ] Exercise Grid, Cards, and List at desktop and 390px widths. Search
      origin, `active`/`expired`, a signing-key fragment, and each displayed
      timestamp via the property selector; every view shows the same filtered
      rows with no horizontal page overflow (the List table itself may scroll).
- [ ] As a non-admin or signed-out user, `/peers` shows only the quiet access
      gate and `GET /api/v1/admin/peers` returns 401/403 with private no-store
      headers. Confirm no browser response contains `syncCursor`, request
      signatures, a peer secret, or a private key.

## Admin integration vault + policy proxy

- [ ] Sign in as an admin and open **/admin → External integrations**. Without
      `THINGTIME_ADMIN_VAULT_KEY`, the visible warning explains setup and
      **Save secret** is disabled; no browser request reveals a credential.
- [ ] With a disposable 32-byte base64url vault key, save a labelled Vercel
      token. Refresh and confirm its row shows only label/id/date—not masked or
      plaintext value. Deletion is blocked while an endpoint references it.
- [ ] Save a Vercel endpoint with read + **Create new items only**, then verify
      an existing environment key is blocked before POST and the redacted audit
      contains only operation, path, status, and outcome—never body, token, or
      secret value. Generic endpoints cannot claim create-only semantics.

## Passkeys + cross-deployment auto-login

- [ ] TestFlight passkey updates preserve the embedded Watch companion, both production push entitlements, the configured preview origin and matching phone/Watch build numbers; the signed phone includes `webcredentials:thingtime.com` and Apple CDN association matches it. Verify saved-key sign-in on a real device.
- [ ] Slow login-options response + immediate passkey click or navigation: the old autofill request never opens a sheet or submits an assertion. Repeat with account-switcher login and the auto-login popup.
- [ ] With 1Password enabled, click passkey sign-in, then Cancel: the button becomes usable immediately even if the extension ignores AbortSignal. Retry once; navigate away and verify no stale sign-in completes. Check desktop and 390px mobile through the footer.
- [ ] Two login tabs can finish independently. Replaying a saved challenge cookie and zero-counter assertion fails. Wrong origin, missing UV and mismatched userHandle all fail.
- [ ] Switching accounts in Security immediately shows only that account’s cached passkeys; failed list fetches show a retry action, not a misleading empty list.
- [ ] Both capability manifests advertise passkey register/options and login/options at 1.1.0; the client rejects missing, older, wrong-origin or breaking contracts.
- [ ] iOS release: the signed app includes `webcredentials:thingtime.com`; the HTTPS AASA response includes its exact application identifier. Verify Face ID sign-in and registration on a physical device after installing the rebuilt signed app. A simulator build alone is not acceptance evidence.

- [ ] Passkey app-link dedupe rides root `uniqueKeys`, never a crystal-path
      unique index: `node scripts/verify-passkeys.mjs` covers it (two data
      things may share one `crystal.linkKey`; the real link still dedupes to
      one row and keeps counting). After deploying, re-run the
      `backfill-relationship-unique-keys` migration from /admin so legacy
      `passkey-app-link` rows get stamped — until then they dedupe through the
      crystal-path fallback in the upsert filter.
- [ ] `things_passkey_link_key_unique` is gone from the `things` collection
      after a boot (`db.things_v2.getIndexes()`). On a dev machine running
      several worktrees against ONE local mongod, a sibling checkout still on
      pre-fix code re-creates it at its next boot — drop it again and update
      that worktree; it is not a code regression.

- [ ] Settings → Security → "Add a passkey ✨": wrong password → error toast,
      no platform sheet; correct password → the browser/1Password/iCloud sheet
      opens and the saved passkey appears in the list with provider name,
      created date, and your nickname. Cancelling the sheet shows NO error
      toast (cancel is silent). Inspect both registration and login options and
      confirm `userVerification: "required"` matches the server verifier; a
      completed Face ID/Touch ID/1Password ceremony must not return a generic
      verification failure.
- [ ] `node scripts/verify-passkeys.mjs` (from `remix/`, dev stack up) passes
      every check — full software-authenticator ceremony: registration, duplicate
      409, challenge replay refusals, usernameless login, lastUsed + linked
      apps, revocation blocking login, revoke-before-delete, hint liveness.
- [ ] Login page: "Sign in with a passkey 🔑" completes a login (platform
      sheet → welcome toast → roster merged, other accounts untouched); the
      username field offers the browser's own passkey autofill popup
      (conditional UI) on browsers that support it.
- [ ] Revoked passkey: revoke (password-confirmed) → the passkey stops logging
      in IMMEDIATELY (401), stays listed with a Revoked badge, Delete appears
      only after revocation and asks for the password again.
- [ ] Passkey login bypasses email-OTP 2FA (a 2FA-enabled account logs
      straight in with a passkey — the passkey is the second factor).
- [ ] Auto-login popup: with a live session on another `*.thingtime.com`
      deployment, a signed-out visit shows the "Continue as… ✨" corner card;
      picking an account routes to `/login?u=<username>` with the username
      prefilled and password focused; "Not now" snoozes it for a day; it never
      renders on `/authorize`, `/reset-password`, or while signed in. On a
      foreign `*.vercel.app` login/register page, the recovery card is the
      intentional exception: it opens the matching first-party hub.
- [ ] Hint liveness: log out on the OTHER deployment → the suggestion
      disappears here on the next fetch (hints resolve live sessions, never a
      cached identity). `GET /api/v1/auth/account-hints` responses carry no
      email — only id/username/displayName/avatarUrl.
- [ ] Account-hint response privacy: both the same-origin endpoint and the
      credentialed federated resolver send `Cache-Control: private, no-store`;
      their `Vary` headers include `Cookie` (the resolver also includes
      `Origin`) and a 429 retains its `Retry-After` header.
- [ ] Cross-deployment account hint: the compact row names the deployment
      environment (for example `Dev preview · PR #68`, never `Production` for
      a preview); expand its chevron to reveal every environment badge, exact
      origin, and last-active time without selecting or signing in as the
      suggested account.
- [ ] Vercel-preview account recovery: on a `*.vercel.app` login page, the
      account card remains available and opens `https://dev.thingtime.com`
      (not production) for the same development environment. The preview
      itself cannot read the `.thingtime.com` cookie; the Dev Thingtime popup
      must present its first-party signed-in account choices instead.
- [ ] Data-authority identity: deploy a Preview whose branch name and
      `VERCEL_ENV` disagree with its configured `THINGTIME_DATA_ENV`. Root
      data and `/api/v1/capabilities` must expose the same safe
      `{ id, kind, federationId, authorityOrigin }` identity; sign-in routing
      must use that authority rather than infer an environment from Vercel
      metadata. No database host, database name, connection string, or secret
      may appear in either public response.

## Login with Thingtime anywhere (federated hints + SSO handoff + FedCM)

- [ ] Commander desktop OAuth: from the signed macOS Commander app, open
      Thingtime login and complete consent in the system browser. The callback
      must reach only Commander’s exact `127.0.0.1` loopback origin, exchange
      a one-time S256 PKCE code, and create the expected Keychain-backed
      account. Replaying the callback code, changing the callback URI, or
      changing the verifier must fail without creating another grant.

- [ ] `node scripts/verify-federated-login.mjs` passes (31 checks) against two
      stacks on DIFFERENT databases (recipe in the script header — stack B
      must be a production build; a second dev stack silently shares `.env`'s
      database). Proves: per-environment hint authority + federated resolve
      (CORS allow family / deny others, read-only), handoff aud binding,
      cross-environment fail-closed, single-use + replay-revokes-session, and
      the full FedCM accounts→assertion→session loop.
- [ ] On a `*.thingtime.com` page, DevTools → Network shows at most
      `MAX_FEDERATED_ORIGINS` (4) `/account-hints/resolve` fan-out fetches,
      only for origins the local endpoint reported `unresolved`, and the
      popup/login strip merges accounts without duplicate users.
- [ ] On a NON-thingtime origin (immutable `*.vercel.app` preview) while
      signed out: the corner card offers "Sign in with Thingtime 🌈" (never
      the hints list); the button opens the `/authorize?self=1` popup, the
      popup shows "Continue to <host>?" with the ACTIVE account, Continue
      signs the page in (welcome toast) and the popup closes; Cancel closes
      with nothing shared. In Chrome with FedCM available, the native
      "Continue as" sheet ALSO auto-appears on page load (no click; the
      browser's own dismissal cooldown governs re-prompts) and completes the
      same loop. Until the hub code is live on production thingtime.com, set
      `localStorage['tt-sso-hub'] = '"https://pr-<N>.previews.dev.thingtime.com"'`
      (JSON string, matching localCache format) on the foreign origin to
      point both flows at a preview hub sharing the deployment's database.
- [ ] The `/authorize?self=1` popup signed OUT shows the embedded login (with
      the cross-deployment hints strip) before the confirm card.
- [ ] Replaying a captured sso-session code fails AND kills the session it
      minted (theft response); a code redeemed on the wrong origin 403s; an
      expired (>2 min) code 401s.
- [ ] FedCM endpoints refuse non-browser fetches (no
      `Sec-Fetch-Dest: webidentity` → 400) and `/fedcm/accounts` 401s when
      signed out.

## Public upload approval (new-signup permissions)

- [ ] Register a brand-new account. `POST /api/v1/auth/register` returns
      `publicUploadsEnabled: false` AND `privateUploadsEnabled: false`;
      `POST /api/v1/attachments/uploads` answers `403` with
      `code: "public_uploads_not_approved"` for public purposes (`post`,
      `comment`, `custom-emoji`, or no purpose) and
      `code: "private_uploads_not_approved"` for private ones (`message`,
      `profile-avatar`, `profile-banner`).
- [ ] Open the verification link. `emailVerified` flips to `true` while both
      `*UploadsEnabled` flags stay `false` — verifying an email must never be
      what grants uploads.
- [ ] Scopes stay independent: approve only `private`
      (`POST /api/v1/admin/users/public-uploads` with `scope: "private"`) and
      confirm `profile-avatar`/`message` starts pass the gate while `post`
      still 403s; approve only `public` on another account and confirm the
      reverse; `scope: "all"` enables both, and a request without `scope`
      keeps the legacy public-only behavior.
- [ ] At desktop and 390px mobile widths, withheld post/comment/custom-emoji
      composers show the public approval card while withheld message/profile
      composers show the private card. Approving only one scope unlocks only
      its matching pickers after revalidation; there is no one-boolean alias.
- [ ] Revoke a scope while a draft upload is already selected. The picker stops
      accepting new files, but the current rows and their finish/retry/remove
      controls remain reachable so lifecycle cleanup still works after
      revocation. Once the draft is empty, the approval card replaces it.
- [ ] Confirm the `admin.new_user` message reaches
      `THINGTIME_ADMIN_NOTIFICATION_EMAIL` (default `admin@thingtime.com`) with
      the username, display name, email, user id, and signup time. In dev read
      it from the `email_messages_v2` outbox.
- [ ] Stop the mail provider (or set an unroutable recipient) and verify again:
      verification still succeeds and still redirects to `/login?verify=success`
      — a mail outage must never fail a committed verification, nor grant the
      permission.
- [ ] In **/admin → Users**, the account shows a `pending` Uploads badge and
      the warning banner counts it. Use the **Approve ▾** menu: "Enable public
      uploads" / "Enable private uploads" flip only that scope (badge shows
      `public` or `private`), "Enable all" turns the badge green `all` — each
      optimistically with a Lopu toast — and the matching upload starts stop
      403ing.
- [ ] Withhold from the same menu: that scope 403s again ("Withhold all"
      returns the badge to `pending`). An account that predates the change (no
      `meta.publicUploads`/`meta.privateUploads`) shows `all`, and an admin row
      shows `all` with no menu.
- [ ] Non-admins calling `POST /api/v1/admin/users/public-uploads` get `403`;
      a missing `userId`, non-boolean `enabled`, or unknown `scope` gets `400`;
      an unknown user gets `404`.
- [ ] Run `npm run test:attachments` (it carries the public-upload permission
      unit tests alongside the upload-gate regression test).

## Social meta / link unfurls (`remix/app/api/utils/meta/socialMeta.ts`, `socialPreview.ts`, `socialCard.ts`)

- [ ] Raw crawler HTML has one matching title, canonical, og:url, og:image and
      parseable Schema.org JSON-LD graph. Image URLs are absolute 1200×630 PNGs
      with matching Open Graph/Twitter alt text; GET the actual image bytes.
      `/things` exposes collection context only, while private/missing/account
      targets are noindex and have no structured UGC. Query/fragment secrets
      and user-authored script terminators never become executable markup.
      Check a freshly composed Messages/Messenger preview separately from old
      cached bubbles; see `docs/seo-social-metadata.md`.

- [ ] `/invite`, `/branding`, `/`, and an unknown SPA path return the white
      press-kit wordmark PNG as absolute `og:image` and `twitter:image`, with
      1200×630 dimensions and a large Twitter card. Branding uses the shared
      page title; unknown paths use `Thingtime - Your Home for Everything`. Query/fragment secrets never
      enter metadata. Custom `/feed` and public post cards remain custom.

Crawlers never run JS, so verify with plain `curl` against the Nitro port (the
Vite dev port serves the raw shell without injection; in production, Vercel
routes every public share surface plus `/social-card` to the Nitro `__server`
function — `remix/scripts/patch-vercel-output.mjs`).

- [ ] `curl -s <nitro>/post/<public post id>` returns `og:type article`, an
      `og:title` carrying the author + truncated text (or the poll question),
      an `og:description` capped near 200 chars, an absolute `og:url` /
      `/social-card?path=...` `og:image`, and `twitter:card summary_large_image`.
- [ ] `curl -o card.png '<nitro>/social-card?path=/post/<public-photo-post-id>'`
      yields a valid 1200×630 PNG. A two-photo post is a two-tile collage; a
      four-or-more-photo post is a four-tile collage, while its excerpt, author
      and `N photos` badge remain visible alongside it. Text, image,
      marketplace, and structured Thingtime posts each have their own card
      variant; polls show question + options, listings show
      price/category/location, and shares identify the original content type.
- [ ] A rich comment permalink has the comment treatment; a reply permalink
      has the threaded reply treatment and identifies its visible parent.
      Comments with photos retain their collage, while text-post attachments
      select a video, audio, or file treatment rather than the generic card.
- [ ] `/media/:id`, `/thing/:id`, `/p/:id`, `/profile/:username`, `/feed`,
      `/explore`, deep docs/catalogue URLs, and `/social-card?path=/...` each
      produce a route-appropriate title, eyebrow and descriptive card rather
      than the indistinguishable pink placeholder. Standalone image, video,
      audio, and file routes have distinct media treatments. A published
      `/p/:id` page uses its name, description or safely extracted block text.
- [ ] Fail closed: `curl -s <nitro>/post/<private post id>` and
      `/post/<garbage id>` both return ONLY the generic site block —
      indistinguishable from each other, and no post text, author, or image
      may appear anywhere in the HTML. (Status stays 200 by design: h3 treats
      a 404 Response from this middleware as "unhandled" and would fall
      through to the raw source template — see `server/routes/[...].ts`.)
- [ ] The image renderer fetches only stored, public Thingtime image
      attachments via a short-lived download URL; a linked remote attachment,
      private attachment, oversized response, malformed `path`, or non-image
      MIME type never becomes a server-side fetch or an image-card leak.
- [ ] User-authored text with `<`, `>`, `&`, quotes, and newlines arrives
      HTML/XML-escaped and whitespace-collapsed inside both `content="…"` and
      the generated card.
- [ ] `curl -s -H 'x-forwarded-host: thingtime.com' -H 'x-forwarded-proto:
      https' <nitro>/post/<id>` derives `https://thingtime.com/...` absolute
      URLs (the request-origin pattern, not a hardcoded host).
- [ ] The colourful Thingtime browser-card (wordmark, five-colour mark and
      playful icon treatment) remains readable at 1200×630 and iMessage-sized
      previews; no text or photo tile clips at the edge.
- [ ] Check the card from the **deployed** preview, not just locally:
      `curl -o card.png '<preview-origin>/social-card?path=/feed'` and open it.
      Cards ship their own Liberation Sans (`socialCardFontData.ts`) because the
      Vercel runtime has no system fonts, and a dev machine's fonts hide a
      missing one — a fontless deploy renders full artwork with zero glyphs.
      Emoji are deliberately dropped from the PNG (the face has no pictographs,
      so they would draw as tofu boxes) while the `og:`/`twitter:` text tags
      keep them. Non-Latin scripts the face lacks (CJK, Arabic, Thai) still draw
      as tofu — known gap.
- [ ] `npm --prefix remix run test:social-previews` passes.
- [ ] After `npm run build`, `verify:vercel-output` passes: the permalink
      and social-card routes sit between the API routes and the SPA fallback,
      point at the Nitro server function, and trace the native PNG renderer.
- [ ] A normal browser load of `/post/<id>`, `/profile/<username>`, and
      `/p/<id>` still renders the SPA (the injected head block must not break
      the shell).

## Emailed-link origin trust (`remix/app/api/utils/auth/appOrigin.ts`)

Verification and password-reset links carry single-use auth tokens, so a
`Host`-derived origin is an account-takeover primitive: the victim gets a real
email whose link points at the attacker.

- [ ] `npm run test:auth-origin` passes (APP_URL precedence, spoofed/lookalike
      hosts, the multi-tenant `*.vercel.app` namespace, Vercel preview vs
      production env precedence, and the local-dev host allowlist).
- [ ] With `APP_URL` set, `curl -X POST .../api/v1/auth/password-reset -H 'Host:
      attacker.example'` (and the same via `X-Forwarded-Host`) emails a link on
      the `APP_URL` origin — never the supplied host.
- [ ] With `APP_URL` UNSET on a Vercel preview, the emailed link uses the
      deployment's own `VERCEL_BRANCH_URL`, and a spoofed `Host:
      attacker-xyz.vercel.app` does not change it. Our own preview namespace is
      NOT trusted from the Host header — anyone can deploy into `*.vercel.app`.
- [ ] With `APP_URL` unset and no Vercel env (plain local dev), links use the
      requested origin for `localhost`/`127.0.0.1`/`[::1]`/`*.thingtime.com`/
      `*.ts.net`, and any other Host yields `https://thingtime.com`.
- [ ] All four emailed-link routes stay on the helper: `register`,
      `resend-verification`, `password-reset`, `service-account`.

## Canonical AI instruction links (`AI_ALL.md`)

- [ ] After a history-based guidance refresh, every new recurring rule links to
      PR evidence and a current source/runbook. Group promotions with their
      original feature; distinguish open/closed/merged metadata from deployed
      behavior and retain explicit review/acceptance limitations.
- [ ] The preserved global snapshot between the labelled markers is byte-for-byte
      equal to the captured source (verify its recorded SHA-256). Keep it
      reference-only; it must not override the current repo's Graphify, runtime
      or contribution guidance. Do not modify the live global source or symlinks
      when updating repo-only guidance.
- [ ] Root `AGENTS.md` and `CLAUDE.md` are relative symlinks whose target is
      exactly `AI_ALL.md`.
- [ ] `cmp -s AI_ALL.md AGENTS.md` and `cmp -s AI_ALL.md CLAUDE.md` both pass,
      and root `CODEX.md` is absent.
- [ ] In a fresh Git checkout, `git ls-files -s AGENTS.md CLAUDE.md` reports
      mode `120000` for both links and both still resolve to `AI_ALL.md`.

## Repository-root Vercel builds

- [ ] Leave a custom-domain or Vercel preview tab open across an alias flip,
      then navigate to a route whose chunk was not loaded before the deploy.
      Chromium, Safari, and Firefox each perform exactly one hard reload and
      land on the requested route instead of the dynamic-import error surface.
      With the chunk request kept broken, the tab must not reload-loop; after
      ten healthy seconds, a later alias flip can claim one new recovery.
- [ ] Run `npm run test:vercel-root`: it proves root `vercel.json` owns the
      build, the nested config is absent, automatic Git deployments are limited
      to exact `main` and `develop`, `github-actions` and generic Preview
      duplicate SHAs skip, the `develop` Custom Environment still rebuilds an
      already-previewed SHA, a valid Nitro artifact is staged at root, and
      invalid source output preserves the prior artifact.
- [ ] Run `npm run build:vercel` from the repository root. Confirm both the
      existing Remix verifier and the root wrapper pass, then inspect
      `.vercel/output/static/index.html` and `.vercel/output/config.json` rather
      than an `outputDirectory` selected by the dashboard.
- [ ] Confirm the Vercel output verifier rejects any server chunk that leaves
      `unicode-emoji-json/data-by-emoji.json` as a runtime package lookup
      without tracing the JSON asset. In an isolated copy of the generated
      function (with no parent checkout `node_modules`), importing the search
      chunk must not throw `MODULE_NOT_FOUND`.
- [ ] In Vercel, clear the old `remix` Root Directory and all Build, Install,
      Output Directory, and Ignored Build Step overrides; select Other as the
      framework. Confirm a product-branch commit builds from root and serves
      `/`, one `/assets/...` file, and `/api/root-data` from the same deployment.
- [ ] Fetch `/.well-known/thingtime-capabilities.json` from the built Vercel
      output, its preview URL, and the production alias. It must reach Nitro and
      return JSON with the exact request origin; it must never fall through to
      `index.html` as `text/html`.
- [ ] Confirm a disposable feature-branch push creates no automatic Vercel
      deployment, while exact `main` and `develop` pushes still do. The product
      config must map minimatch `**` to `false` (including branch names with
      `/`) and explicitly map both retained branches
      to `true`; the thin control-plane config must set
      `git.deploymentEnabled` to `false` and retain `ignoreCommand` as a second
      fail-safe.

## Lopu CodeQL all-branch listener

- [ ] Open or update PRs targeting `main`, `develop`, `github-actions`, and an
      older feature branch without the current listener. Confirm normal
      `pull_request` runs own targets that carry the listener, while the
      default-branch `pull_request_target` run performs only the protected
      metadata handoff for missing listeners. Confirm no target-context job
      checks out PR code, no redundant analyzer cancels an in-flight scan, and
      both language contexts finish green for the latest immutable snapshot.

## Lopu wildcard `all`-branch maintenance

- [ ] Run `node remix/scripts/workflow-caller-contract.mjs` and confirm product
      branches contain no `.github/workflows/all-branch.yml` or rebase-specific
      listener. Push `develop` and `main`, exercise every PR lifecycle transition
      including draft and close, wait for the `53 * * * *` backstop, and invoke
      the `build-all` and `backfill-codeql` maintenance choices manually. Every
      path must appear under **Lopu PR manager**, call the corresponding
      protected implementation, and keep at most one model-backed Lopu job
      active without cancelling it.

## Develop-target Vercel PR previews

- [ ] Confirm `.github/workflows/develop-pr-preview.yml` and its controller
      listener are present on the default `main` branch, while the reusable
      implementation and controller script are present on the protected
      `github-actions` branch, before expecting `pull_request_target` to run; a
      listener present only on the feature PR is deliberately inactive.
- [ ] On a product branch, run
      `node remix/scripts/workflow-caller-contract.mjs` and
      `node --test remix/scripts/vercel-config.test.mjs`: the thin listener
      calls the trusted implementation on `github-actions`, `.github/scripts/`
      is empty, and every Vercel cron `(path, schedule)` pair appears exactly
      once.
- [ ] Manually run `Develop S3 PR preview` from `main` with a valid develop PR
      number: the caller converts the dispatch string to the reusable
      workflow's numeric `pr_number`, creates the controller job instead of a
      zero-job failure, and performs the requested publish or cleanup.
- [ ] Run the protected controller self-test and inspect its prebuilt deploy
      arguments: `--prebuilt` and `--target=develop` are present, while
      `--skip-domain` is absent because Vercel accepts that option only for
      production-target deployments.
- [ ] Inspect an eligible PR's two runs: the `pull_request_target` dispatcher
      has no GitHub Environment/Vercel secret, checks out no code, and emits one
      bounded `repository_dispatch`; only the downstream default-branch run
      enters `vercel-develop-pr-control`, checks out `main`, and receives the
      controller secret. Neither GitHub job executes the PR head.
- [ ] Replay or forge a dispatch payload with a wrong source run id, workflow
      path, repository, PR, action, actor, or head SHA: the privileged job fails
      closed before any Vercel mutation. A stale legitimate dispatch also no-ops
      after the live PR SHA fence.
- [ ] Inspect the private `vercel-develop-pr-control` GitHub Environment
      without printing values: only the `main` deployment branch is allowed,
      `VERCEL_CUSTOM_ENVIRONMENT_ID` contains the exact immutable develop ID,
      `DEVELOP_PREVIEW_TRUSTED_ACTORS` is explicit, the Vercel token is the
      fresh dedicated `VERCEL_DEVELOP_DEPLOY_TOKEN` environment secret, the two
      domain variables match controlled domains, the masked
      `THINGTIME_DEVELOP_S3_CORS_PROBE_URL` secret is an unsigned exact
      develop-bucket HTTPS object URL with no query, and no live `env_*` ID,
      bucket name, or token appears in tracked controller files or workflow
      logs.
- [ ] Confirm the active `main` `Basic Protection` ruleset has no bypass,
      requires a pull request with resolved review threads, both strict Web CI
      jobs, and the CodeQL Analyze checks for actions and javascript-typescript,
      and blocks deletion and force-pushes. Confirm the controller Environment
      has no required reviewer so event cleanup and six-hour reconciliation
      remain automatic. CODEOWNERS presence alone is not an enforcement check;
      independent CODEOWNER approval is optional future hardening once a second
      trusted collaborator can review changes.
- [ ] Enable `CODEQL_CENTRAL_PR_ENABLED` and update a PR targeting an older
      feature or stack branch that does not contain the CodeQL listener. The
      `pull_request_target` run must perform metadata-only handoff with no
      checkout, CodeQL initialization, AI secret, or repository code execution;
      its separate `workflow_dispatch` run must revalidate the live head and
      upload both language categories against the exact merge ref. Repeat with
      a conflicting PR whose old merge ref still exists: its parent mismatch
      must be reported and the fallback must scan `refs/pull/<number>/head`.
- [ ] Update a PR whose target already carries the normal listener. Its
      `pull_request` run—not the target-context fallback—must remain the owner
      of both Analyze job contexts required by branch protection. Confirm the
      listener's `control-plane` call reaches the unprivileged analyzer without
      the former nested `actions: write` workflow-validation error, while the
      `pr-handoff` call is skipped.
- [ ] On the corresponding `pull_request_target` event, confirm only
      `pr-handoff` calls the protected metadata bridge and `control-plane` is
      skipped. The bridge may dispatch the exact unprivileged scan but must not
      check out repository code or receive an AI/provider credential.
- [ ] Re-dispatch the same unchanged PR head after both CodeQL categories are
      present: the protected scope job must report that analysis is complete and
      skip initialization. Dispatch an older expected SHA and confirm it no-ops
      rather than scanning or publishing against stale PR state.
- [ ] In Vercel, confirm `dev.thingtime.com` is bound to the literal `develop`
      Git branch and has no domain `customEnvironmentId`, rather than being
      bound to the whole Custom Environment; the Custom Environment's own domain
      list is empty. Confirm a newly built generic Preview has all current
      `develop` variables plus the six existing Preview-only values, while
      production MongoDB/JWT/S3 values remain absent.
- [ ] On a `develop` Custom Environment deployment, confirm `/api/root-data`
      reports `THINGTIME_VERCEL_ENV=develop` and
      `THINGTIME_SHOW_DEPLOYMENT_STATUS=true`; `/api/v1/vercel/status` returns
      JSON with HTTP 200, and `/status` renders the deployment status instead of
      the React Router 404 boundary. Repeat on an ordinary Preview deployment.
- [ ] Open or update a same-repository, trusted-author PR targeting `develop`:
      the `Develop S3 PR preview` workflow deploys the exact head SHA, the
      one marker comment moves through deploying to ready, the GitHub Deployment
      reaches success, and the comment links
      `https://pr-<number>.previews.dev.thingtime.com`; verify the deployed SHA again
      after the build completes.
- [ ] Open the deployed PR preview's footer and confirm it shows the exact PR
      branch plus the complete 40-character head SHA, with each linking to the
      matching GitHub tree/commit. Confirm `/api/root-data` reports the same
      values and neither label falls back to `git/unknown`.
- [ ] For an exact SHA that already has a READY generic Preview, run the
      controller again and confirm its `develop` Custom Environment deployment
      builds instead of ending `CANCELED`; the PR alias, GitHub Deployment, and
      marker comment must reach the ready state for that exact SHA.
- [ ] Confirm the wildcard Vercel domain is verified and detached, its
      Cloudflare `*.previews.dev` CNAME targets `cname.vercel-dns.com` with
      DNS-only proxying, and `_acme-challenge.previews.dev` has NS delegations
      to both `ns1.vercel-dns.com` and `ns2.vercel-dns.com` without moving the
      apex nameservers or delegating a broader subtree. Confirm its Git branch
      and Custom Environment bindings are empty. Do not require Vercel's
      external-DNS advisory to report `misconfigured: false`: independently
      confirm a probe hostname resolves to Vercel's currently recommended
      CNAME target and the published PR alias presents a valid certificate.
- [ ] From that alias, sign in and upload/remove a small attachment: the direct
      S3 `PUT` preflight permits only that exact origin pattern, `PUT`, and
      `x-amz-checksum-sha256`; it exposes no headers, the bucket remains private,
      and storage usage returns to its original value. Repeat from
      `https://dev.thingtime.com` and a newly built generated
      `https://thingtime-*-lopugits-projects.vercel.app` Preview; reject an
      unrelated origin.
- [ ] Update the PR twice: the same alias moves to the newest successful SHA,
      the comment is edited rather than duplicated, and older workflow-created
      develop deployments are deleted. A canceled/superseded run must not move
      the alias after the newer SHA wins.
- [ ] A fork PR, draft PR, non-allowlisted author/actor, read-only collaborator,
      and PR targeting `main` never receive a controller-managed develop alias.
      If Vercel builds their ordinary Preview, confirm it uses only the shared
      development role/data plane and cannot assume the production AWS role.
      Retargeting or converting an eligible PR to draft cleans its existing
      controller-managed alias/deployment.
- [ ] Confirm `*.previews.thingtime.com` is not used by the develop controller.
      Until a separately protected production-preview controller exists, no
      ordinary Preview can assume the production role or publish a trusted
      production-preview alias.
- [ ] With two eligible PRs open, use disposable accounts and verify that their
      aliases intentionally see the same development data/quota plane; do not
      describe either alias as an isolated sandbox.
- [ ] Close the develop-target PR: its alias is removed, its transient GitHub
      Deployment becomes inactive, and workflow-created Vercel deployments are
      deleted without moving `dev.thingtime.com`.
- [ ] Simulate a missed close/interrupted cleanup with workflow-tagged test
      resources, then run/wait for the six-hour scheduled reconciliation: it
      removes stale alias/deployments idempotently while preserving unmarked
      deployments and the stable `develop` branch deployment. Manually dispatch
      one PR number and verify the bounded per-PR recovery path separately.

## iOS web destination drawer

- [ ] At a phone-width native WebView destination, open the web app navigation
      drawer from the top-left menu icon. The same fixed icon used by mobile web
      stays inside the drawer header while the page and top nav move aside; no
      duplicate icon appears at the drawer's outside edge. Close it, scroll from
      the page top to bottom, reopen it, and confirm the icon remains tappable.
- [ ] From any media composer in the native iOS app, choose Add Media → Take
      Photo or Video. The system requests camera access instead of terminating
      the app; photo capture returns a selectable file. Repeat with video and
      confirm microphone permission is requested, then verify Photo Library
      selection still returns media without a crash.
- [ ] Confirm
      `https://thingtime.com/api/v1/vercel/deployments?limit=50&history=10`
      reports `source: "api"`, `hasError: false`, and `deploymentGroups` with
      up to ten newest-first deployments per branch before testing the native
      picker. The compatibility `deployments` array must still expose one
      latest row per branch. A tokenless response or `Vercel API returned 403`
      means the Vercel project token must be repaired and a fresh deployment
      built before the app can discover previews.
- [ ] Launch the iOS app with at least twelve returned destinations, open the
      left-edge Web destination drawer, and scroll from the first row to the
      final row and back. The header, refresh, and close controls stay pinned;
      rows do not clip or overlap the home indicator in portrait or landscape.
- [ ] Drag vertically over a destination row and confirm the list scrolls
      without dismissing the drawer. Then swipe predominantly left and confirm
      the drawer closes; reopen it, select an off-screen preview, and confirm
      the web view loads that exact URL.
- [ ] Find a branch whose newest deployment is queued/building and whose prior
      deployment is ready. Expand the branch row, confirm both deployments are
      shown newest first and the ready child is labelled `Last successful`,
      then select that child and verify the WebView loads its immutable URL
      rather than the queued branch alias. Reopen the drawer and confirm the
      selected branch expands automatically with the child checkmark visible.
- [ ] Expand and collapse several branches while scrolling to the bottom and
      back in portrait and landscape. Nested deployment rows remain inside
      their branch cards, disclosure controls stay tappable, and vertical
      scrolling never triggers the horizontal drawer-close gesture.

## Apple Watch notifications

- [ ] Code input: four evenly spaced squares backed by one native input. Paste
      a complete PIN with Cmd/Ctrl+V into any square (including replacing a filled
      PIN), test autofill, select-all, arrow keys and backspace, and preserve
      leading zeroes. Pasting an older eight-character code expands all eight
      squares; no paste/autofill may get trapped in the first square. Check both
      desktop and 390px layouts, focus ring, keyboard submission and accessible label.
- [ ] With 1Password installed, focus the approval input and fill all digits.
      Its saved-password badge must not cover the last square. Native
      `one-time-code` autofill and Cmd/Ctrl+V must still fill the complete code.
- [ ] Start with **Paired iPhone** selected, open the signed-in companion, and
      verify another session of the same account/domain shows the exact prefilled
      Watch/device/PIN. No credential may be claimed before explicit approval.
      A different account must not list, look up, approve, or rebind the request.
- [ ] Repeat using **Username** (including `@username`, a typo and wrong domain)
      and **Enter code**. A `/pair/1234` link preserves all four digits, including
      leading zeroes, through login. Check the five-minute expiry, unique active
      PIN reservation, and five guesses/account limit with a visible retry error.
- [ ] Verify quick-approval cards at 390px and desktop widths through the full
      scroll range, dismiss with **Not now**, and approve another request. Account
      switching/sign-out must never flash the previous account's request.
- [ ] Open `/watch/pair` without query parameters on desktop and a 390px phone.
      Sign in, enter a fresh Watch code, review the matching device/account, and
      approve. Confirm the Watch claims the credential and downloads notifications;
      no hidden pairing ID or Watch web browser is required. Invalid, wrong-domain,
      expired and already-consumed codes must offer recovery without logging secrets.
- [ ] Leave code approval pending beyond 90 seconds (31 polls), approve, and
      confirm pairing still completes. Interrupt network access, retry approval,
      switch domains mid-request, and replace an expired code. Cancelled requests
      must not restore an old code/account or overwrite the new connection state.
- [ ] Select an origin without `api.watch-pairing` 1.2.0 and confirm the Watch
      shows an actionable domain/preview hint rather than a missing-endpoint error.
- [ ] Pair a fresh Watch directly against both `thingtime.com` and
      `dev.thingtime.com` once their manifests support the feature. Approve the four-digit code while
      signed in, confirm the Watch receives only its device credential, and
      verify notification refresh/read state works with the iPhone app closed.
      A second account must remain independently selectable after relaunch.
- [ ] On the smallest supported Watch, confirm the signed-in header shows the
      selected account's avatar, **@username**, domain, and live status. Scroll
      through the whole screen, tap the toolbar refresh and **Check & refresh**,
      and verify checking/success/error states plus Last check and Last live
      reply remain readable without clipping.
- [ ] Open Settings, switch between production and development accounts, add
      another account, and remove only the selected account. Confirm no account
      reuses another origin's credential, snapshots, upload outbox, or inbox.
- [ ] Under **Add private Thing**, confirm **Record** is the default first
      favourite and that Settings can enable/disable the available favourites
      while preserving their stable system order and the main Add action.
- [ ] Create a private audio or photo Thing directly from the Watch, interrupt
      the upload at each stage, and confirm retry uses the same request/Thing
      identity without duplicate Things. The created record remains owner-only
      and the Watch retains its local source until completion.
- [ ] In `/things`, open the paired Apple Watch device. Confirm last sync,
      status, battery/low-power health, last error, created-Thing count, and the
      owner-only recent Things created by that exact Watch update after refresh.
- [ ] On a signed-in paired Watch, confirm the connection section identifies
      the active account as **@username**, keeps the current connection state
      visible, and always shows **Check & refresh**. Tap it and confirm the
      control changes to **Checking…**, then returns with updated **Last check**
      and **Last reply** times without exposing a reusable session credential.
- [ ] Regression class (2026-09): install a TestFlight build configured for a
      preview over an older install that implicitly retained `thingtime.com`.
      Confirm the iPhone migrates to the configured origin, the Watch displays
      that origin plus matching iPhone/Watch build numbers, and notification
      history downloads. Then explicitly select production and confirm a
      relaunch preserves that deliberate choice.
- [ ] Update only the iPhone app while leaving an older companion on the Watch.
      Confirm the Watch connection section displays both build numbers, warns
      that they differ, and clears the warning after the Watch app updates.

- [ ] Launch the Watch app with the paired iPhone app closed, then open
      Thingtime on iPhone. Confirm the Watch visibly moves through **Waiting for
      iPhone** / **Checking Thingtime sign-in** to **Connected to iPhone**,
      displays the last reply time, and reconnects without exposing or copying a
      reusable web session credential. Repeat while signed out and confirm it
      settles on **Sign in on iPhone**.
- [ ] Leave the iPhone unreachable through the Watch's bounded 2, 5, and
      10-second retry sequence. Confirm loading stops with an actionable status,
      **Retry connection** starts a fresh attempt, and opening the iPhone later
      consumes the safely queued refresh without duplicate work.
- [ ] On a signed-in paired Watch, confirm the inbox initially shows the newest
      10 notifications. Tap **Load previous 10** repeatedly and verify each page
      appends in newest-first order without duplicates or gaps, including when
      two notifications have the same `createdAt` timestamp.
- [ ] Open **Notification history**, choose **One date**, and fetch the first
      10. Confirm only notifications inside that local calendar day appear.
      Switch to **Date range**, choose inclusive From and Through dates, and
      confirm **Fetch 10 more** pages through that full period without crossing
      either day boundary.
- [ ] Tap **Download whole period**, background or close both apps while the
      transfer completes, then reopen the Watch app offline. Confirm the archive
      persists, initially reveals 10 rows, and **Show 10 more** reveals the rest
      without network access. Mark an archived row read, relaunch, and confirm
      its read state remains saved. The archive must contain no more than the
      service-retained latest 500 notifications.
- [ ] Queue both a historical page request and a period download while the
      iPhone is unreachable, then open the signed-in iPhone app. Confirm each
      request resumes once, a stale response cannot overwrite a newer selected
      period, and malformed or metadata-mismatched archive files are rejected.

- [ ] On a signed-in paired Watch, open **Add private Thing**, pick one and five
      Photos-library screenshots, and record a short audio clip. Confirm every
      item remains queued across a Watch app relaunch until the iPhone reports
      success, then appears as a searchable owner-only Thing with exactly one
      bound attachment and `acl: ["tt:user"]`.
- [ ] Put the iPhone offline before choosing a Watch screenshot, then restore
      connectivity and open the signed-in iPhone app. Confirm the same stable
      request resumes without duplicate attachment Things; repeat while signed
      out and confirm the Watch explains that Thingtime must be opened and
      signed in, without losing the queued bytes.
- [ ] Tap **Record**, deny microphone access, and confirm Apple's
      native recorder returns safely without crashing. Grant access, save a
      several-second recording, and confirm the completion callback does not
      falsely report that Thingtime could not prepare it while the file is still
      finalizing. Confirm the `.m4a` appears under **Saved recordings**
      after relaunch. With **Upload after saving** enabled, confirm it queues
      automatically; disable that preference, save another recording, and
      confirm it waits for selection in the saved-recording screen.
- [ ] Open **Saved recordings**, tap one retained Watch recording, and
      confirm it creates a new private Thing without altering the retained
      original. Swipe-delete another saved
      recording and confirm only that on-watch copy disappears. Confirm the
      explanatory copy does not claim third-party access to Apple's sandboxed
      Voice Memos library and directs existing Watch Voice Memos to the synced
      iPhone Thingtime upload flow.
- [ ] Against an origin missing or breaking any required attachment/Things
      capability, confirm the iPhone fails closed before reserving storage and
      the Watch shows the compatibility error. Verify normal uploads use the
      active WebView origin and never copy its session credential to watchOS.
- [ ] Regression class (2026-09): `WCSessionFile` is temporary on receipt. Kill
      the iPhone app immediately after delivery and confirm the inbox copy still
      resumes on next launch; the Watch must retain its original until the
      private Thing creation result arrives.

- [ ] Regression class (2026-09): build the signed iPhone + Watch IPA with
      Xcode 26.2, verify the locally exported IPA, and upload the same archive
      through `xcodebuild -exportArchive` with `destination: upload` and the App
      Store Connect API key. Confirm App Store Connect accepts the upload
      without relying on Xcode 26 `altool`, which can report a platform error
      while incorrectly exiting with status 0.
- [ ] Regression class (2026-09): inspect the exported IPA and confirm the
      companion watchOS app is under `Payload/Thingtime.app/Watch/`, not
      `PlugIns/`; App Store Connect rejects the latter as an invalid directory.
- [ ] With an iPhone paired to an Apple Watch, open Thingtime on the iPhone and
      sign in. Launch the watch app and confirm it leaves “Pair Thingtime” without
      asking for a password or exposing a session credential on the watch.
- [ ] Tap Enable alerts on the watch, approve the system prompt, relaunch both
      apps, and confirm the iPhone and watch APNs registrations appear through
      `/api/v1/notifications/devices` without either token appearing in the JSON
      response or generic Thing APIs.
- [ ] From a second account, create a friend request, follow, comment, reply,
      reaction, share, and mention. Confirm the watch alert names the actor, the
      inbox refreshes, the unread count matches Thingtime, and tapping an unread
      row marks that same notification read on the phone/web inbox.
- [ ] Send the same payload to the paired iPhone and watch registration and
      confirm only one user-visible alert appears. Repeat in Debug/sandbox and a
      signed Release/production build so each token uses the matching APNs host.
- [ ] Disable a push type and then the push master in Settings → Notifications;
      confirm new events of those types produce neither a watch alert nor a
      watch inbox row. Re-enable them and verify delivery resumes.
- [ ] Sign out on the paired iPhone and confirm the watch returns to the pairing
      screen and later activity for that account produces no device alert. The
      registration may await cleanup, but its revoked/expired session binding
      must make it immediately ineligible. Then sign in as another account and
      confirm both device tokens move to the new owner without leaking the prior
      inbox.
- [ ] Exercise signed-out, empty, unread/read, denied-alert, long actor name, and
      two-line preview states on the smallest supported watch. Scroll top to
      bottom; no row, badge, toolbar item, or permission message clips or overlaps.
- [ ] Regression class (2026-09-10): send a notification test and a reminder with
      a long ID; the APNs collapse header must fit 64 bytes, preserve stable
      coalescing, and produce an accepted provider result on registered devices.
- [ ] Regression class (2026-09): APNs device tokens are variable-length binary
      values. Register a token longer than 32 bytes and confirm it is accepted,
      deduplicated by hash, retained only in protected secure storage, and removed
      after APNs reports `BadDeviceToken`, `Unregistered`, or HTTP 410.
- [ ] Regression class (2026-09): a device row is keyed by token alone, so
      re-registering must REBIND it to the caller. Sign in, register the device,
      sign out (revoking that session), sign back in, and re-register the same
      token: the alert must still arrive. Repeat as a different account on the
      same device and confirm alerts follow the new owner. Pinning `ownerId` or
      `targetId` at insert makes both cases permanently undeliverable — the row
      keeps a dead session id and re-registration cannot heal it.

## Worktree dependency bootstrap (`remix/scripts/ensure-dependencies.js`)

- [ ] In a fresh linked worktree with no copied `node_modules`, run
      `npm run worktree-setup`: every direct Remix dependency is linked and
      `npm --prefix remix run ensure-deps -- --check` passes.
- [ ] Fresh-worktree bootstrap (`remix/scripts/worktree-bootstrap.cjs`): create
      a linked worktree (`git worktree add ../tt-check -b tmp/check`), confirm
      the tracked `post-checkout` hook wrote `worktree-bootstrap.log` in the Git
      directory and that `remix/node_modules/.pnpm`, missing env files copied
      from the main checkout (the `.env*` entries of `.worktreeinclude`), and
      `.claude/launch.json` (entries `thingtime-web-<derived port>` attaching to
      the PM2 stack and `thingtime-web-<derived port>-foreground`) exist;
      `git config --worktree --get core.hooksPath` prints `.githooks`.
      `npm run worktree-bootstrap` a second time changes nothing. Start
      `npm run worktree-setup` while the background bootstrap is still
      installing: the second run prints "Another dependency install is
      running; waiting" and both finish with a complete `node_modules`
      (`remix/node_modules/.thingtime-install.lock` is gone afterwards). Remove
      the worktree afterwards.
- [ ] With the pnpm virtual store present but top-level `eslint` and `vite`
      links removed, run `npm run worktree-setup`: both links are restored
      without copying dependency files from another checkout.
- [ ] Run `npm run worktree-setup` again: it exits successfully without
      reinstalling, then `corepack pnpm --dir remix run lint:files --
  scripts/ensure-dependencies.js scripts/dev.mjs` starts ESLint normally.
- [ ] In a disposable worktree, remove one transitive pnpm link required by
      ESLint while leaving every direct dependency link present, then run the
      targeted lint command: the startup probe performs one forced relink and
      ESLint starts. `npm --prefix remix run ensure-deps -- --check` also proves
      both ESLint and the directly declared Prettier CLI can start.

## Branding page (`remix/app/routes/branding/_index.tsx`, `remix/app/components/Branding/`)

- [ ] `/branding` renders full-width with a centred max-width column at desktop
      (≥1280px) and mobile (375px); no horizontal scrollbar at either size and
      no borders/cards/checkerboard grids anywhere — previews sit on soft
      panels only.
- [ ] Every variant section (wordmark, icon, both pink cuts) shows its live
      SVG preview; the light/dark panel dots swap the preview surface.
- [ ] "Download SVG" and "PNG · 1024px" point at real committed files under
      `/branding/generated/<slug>/…` (200s, not client blobs); the ready-made
      grid lazy-loads (`loading="lazy"`) one `<img>` per size up to 10000px,
      wordmark sizes keep the 27:5 trimmed aspect (e.g. 1024×190).
- [ ] Ready-made sizes render as two lines — the SVG line
      (`SVG · scalable · <size>`) above the PNG line — and every PNG chip is
      labelled `PNG · <W>×<H> · <KB/MB>`; chips wrap without horizontal
      scroll at 375px.
- [ ] Custom export: format PNG/SVG, any width, padding all-sides and
      per-side, background transparent/white/ink — downloads a file named
      `thingtime-<slug>-<W>x<H>.<ext>` where W/H include padding, and fires a
      Lopu success toast (errors also route through Lopu, never `alert`).
- [ ] Exports and previews are whitespace-trimmed: `npm --prefix remix run
    test:branding` passes (trim + padding + pixel-size unit tests).
- [ ] Press kit grid renders all generated marketing images; the portrait
      phone wallpaper previews as a centre crop and must not stretch its grid
      row (no giant empty gap beside it).
- [ ] Palette swatches copy their hex via clipboard with a Lopu toast.
- [ ] After changing `logoMatrix.ts` matrices/colours, re-run
      `npm --prefix remix run branding-assets` and commit the refreshed
      `remix/public/branding/` + `brandingAssets.generated.json` (byte-stable
      when nothing changed).

## Marketing suite (`remix/app/routes/marketing/`, `remix/app/components/Marketing/`, `remix/app/marketing/`)

- [ ] `npm --prefix remix run test:marketing` passes: 1000+ pages, 1000+ social
      assets, unique slugs, every related/in-page link resolves, every page
      builds hero-first and CTA-last, every mock screen renders every
      `data-wt` target its walkthrough scripts use.
- [ ] `/marketing` hub: counts match the catalog, every category card and the
      social card navigate, the search box lands on `/marketing/search?q=…`
      with results, the showcase walkthrough autoplays and pauses when
      scrolled out of view.
- [ ] Category index (`/marketing/styles` is the largest): groups render with
      counts, the filter narrows client-side, "Show more" paginates without
      reloading, nothing scrolls horizontally at 390px.
- [ ] A page from each kind opens by URL (`landing/feed`, `guides/passkeys`,
      `walkthroughs/feature-messages`, `compare/thingtime-vs-notion`,
      `compare/notion-alternative`, `compare/feed-vs-twitter`,
      `for/developers`, `for/developers/open-api`, `use-cases/recipe-book`,
      `use-cases/recipe-book/vs-notion`, `concepts/thing`, `templates/car`,
      `styles/dark-neon/polls`, `faq/themes`,
      `checklists/creators-getting-started`): hero renders with the animated
      rainbow highlight word, tables scroll inside their own wrapper, FAQ
      accordions toggle, the walkthrough cursor moves/clicks/types over the
      mock screen, the social block shows three images with working PNG/SVG
      downloads, related links resolve. An unknown slug shows the not-found
      card with suggestions (no white screen).
- [ ] Dark trends (`styles/dark-neon/*`, `styles/gradient-glow/*`,
      `styles/kinetic-type/*`, `styles/listicle/*`) keep every text readable
      and the sub-nav chips legible; the browser tab title and meta
      description follow the page (`useMarketingSeo`) and revert when leaving
      `/marketing`.
- [ ] `/marketing/social-media`: the menu is navigable (feature → style →
      format) and the URL updates; the grid re-renders with the right count;
      PNG download produces a file at the platform's exact pixel size and SVG
      opens standalone; "Copy caption" copies hashtags; "Download all shown"
      caps at 40 and reports skipped items via Lopu; sidebar collapses to a
      Menu button at 390px.
- [ ] Reduced motion: with `prefers-reduced-motion: reduce` the cursor jumps
      instead of gliding, the rainbow text is static and the hero voxel logo
      does not float.
- [ ] Drawer: the Marketing hub appears with its seven children and keeps the
      drawer open on click like Branding/Docs.

## Composer — Thingtime tab (`remix/app/components/Feed/PostComposer.tsx`)

- [ ] Seed the `thingtime` LocalForage value with valid-looking hostile and
      malformed legacy function tags plus root `set` / `get` runtime
      methods, then load `/feed` ONCE: no payload executes, the code-defined
      editor factory is restored, the
      collapsed “What's on your mind?” control opens, Editor.js accepts focus
      and typing, Latest / Filters and the global search remain interactive,
      and the repaired stored snapshot already contains neither runtime method
      nor any function source before a second navigation.
- [ ] Open the feed composer → Thingtime tab: the editor shows exactly ONE
      root property, `New Thing`, with no default children (no `name`).
- [ ] The live editor path is session-scoped (`tmp.<sessionId>.New Thing`).
      While signed in, add a field and reload: account draft recovery restores
      the value into the new session. Opening a second composer preserves the
      first composer's branch. Successfully publishing clears only its draft.
- [ ] Post button stays disabled until the thing has real content (empty
      strings don't count; numbers/booleans/nulls do).
- [ ] Photos toggle ON requires ≥1 valid image URL before Post enables;
      Marketplace toggle ON requires valid listing fields. Toggling either
      off re-enables Post on thing content alone.
- [ ] Posting a thing + photo + listing renders the card as thing → photo
      grid → listing, with the first photo appearing exactly once.
- [ ] Change type on the `New Thing` root (context menu → change type):
      string shows a text editor that accepts input; boolean shows a boolean
      editor; the seed effect must NOT clobber the converted value back to {}.
- [ ] Rename the `New Thing` root TWICE in a row (click the key, type, Enter;
      repeat) on a FRESH page load: both renames must land in the store, not
      just the visible text. Regression class: memoized JSX pinning a
      mount-time `updatePath` whose `parent` was undefined pre-seed, and
      string path bindings (editor leaf, composer draftPath) not following
      the first rename (`path-renamed` bus event).
- [ ] The in-post editor height-drags via the bottom handle (mouse and touch)
      with no upper limit, and never below the small floor.

## Post and comment attachments (`remix/app/components/Attachments/`)

- [ ] A freshly registered (both-scopes-withheld) account sees the 🔐
      approval-pending card in place of the upload dropzone in the post,
      comment, AND messenger composers (the card is purpose-aware), and a
      direct `POST /api/v1/attachments/uploads` returns 403 with the
      purpose-matched `public_uploads_not_approved` /
      `private_uploads_not_approved` code — never the part/complete-only
      `media_upload_not_granted` code. Registering records an
      `admin.media_upload_request` email and verifying the email records an
      `admin.new_user` alert to the admin inbox in `email_messages` (neither
      unlocks uploads).
- [ ] After an admin approves ONLY private uploads, the messenger composer and
      profile media upload work while the post/comment composers still show
      the 🔐 card (and vice-versa for public-only); approving all unlocks
      everything after a reload/revalidation, and revoking flips surfaces back
      while abort/delete of in-flight drafts keep working.
- [ ] Withhold BOTH scopes while an upload is in flight: the already-started
      `POST /api/v1/attachments/{parts,complete}` calls answer
      `403 { code: "media_upload_not_granted" }` from the extra any-scope
      check, mapped to the same 🔐 copy, while abort/delete of that account's
      own drafts keep working. Withholding only one scope must NOT block the
      other scope's in-flight parts/complete.
- [ ] With `THINGTIME_MODERATION_PROVIDER=test`, upload an image named
      `tt-test-nsfw.png` to a post: after analysis it renders heavily blurred
      with a red border, light red wash, centered NSFW badge, and a
      `Show Anyway` button that reveals it (per attachment, per page view).
      An image named `tt-test-illegal.png` disappears from public payloads and
      its `/api/v1/attachments/content` URL 404s for non-admins, while a
      `moderationFlag` row appears in `/admin` → Moderation.
- [ ] With `THINGTIME_MODERATION_PROVIDER=openai+claude` (+ both API keys), a
      clearly clean image stamps `clear` with provider `openai` (free omni
      screen, no Claude spend) while an explicit image stamps via provider
      `claude` (escalated) — check the provider column in `/admin` →
      Moderation. With `ANTHROPIC_API_KEY` removed, an omni-flagged image still
      lands `nsfw` (blur + flag) instead of staying pending.
- [ ] `/admin` → Moderation → AI moderation settings: switching Media uploads
      to "OpenAI omni only (free)" updates the "running:" label and subsequent
      uploads stamp provider `openai`; switching either surface to Off stops
      new stamps. Choices survive a reload (settings collection, not local
      state).
- [ ] With an OpenAI key configured, a post/comment containing threatening
      harassment vanishes from feeds/threads for everyone shortly after
      creation and a `text` flag row (with excerpt, no View button) appears in
      `/admin` → Moderation; Clear restores the post, Block re-hides it.
      Editing a clean post to add flagged text re-screens it.
- [ ] Hybrid create gate: with text moderation on, posting text that omni
      flags as block-worthy never appears in any feed/thread — even a refresh
      fired immediately after posting (the doc is born blocked; a `text` flag
      row appears for admins). With `TT_TEXT_SCREEN_BUDGET_MS=0` (or omni
      unreachable) the same post appears instantly and then vanishes once the
      async verdict lands.
- [ ] Fail-closed pending flow: with text moderation on and omni unreachable
      (or `TT_TEXT_SCREEN_BUDGET_MS=0`), a new post appears for its author but
      NOT for other accounts; once omni is reachable again (queue retry or
      cron sweep) the post appears for everyone and follower notifications
      arrive at release time. Turning text moderation Off releases any
      stranded pending posts on the next sweep.
- [ ] URL-photos moderation: a post created through the multi-URL photo flow
      pointing at an explicit external image gets flagged (nsfw advisory row
      with the URL in the excerpt) without any text in the post; editing the
      listing title or tags of a clean marketplace post to violating text
      re-screens it.
- [ ] Text sweep safety net: with text moderation on, manually strip the
      `moderation` field from a flagged post (simulating a mid-flight death),
      then hit `/api/v1/moderation/sweep` with the CRON_SECRET bearer (or the
      admin Run analysis sweep button) — the post gets stamped/flagged and the
      "text post(s) awaiting analysis" count in `/admin` → Moderation drops.
- [ ] Top-level post, rich comment, and reply composers use the same responsive
      attachment gallery and `🏞️ Add Media` tile. The existing multi-URL photo
      flow remains available as a quota-saving alternative on every rich
      post/comment surface.
- [ ] In Photos, add one public image URL, then paste several newline-separated
      URLs. Valid unique URLs become responsive preview tiles in stable order,
      duplicates are skipped, invalid/credentialed URLs remain editable with an
      accessible error, and linked images use `referrerPolicy=no-referrer`.
- [ ] The visual upload area uses responsive thumbnail tiles plus a real
      `🏞️ Add Media` control. At desktop and 390px mobile widths it has no
      horizontal overflow; the URL fallback panel and every lower composer
      control remain reachable after scrolling top-to-bottom.
- [ ] Upload rate-limit regression: on an approved test account, two 25-file
      selections fit the default 60/minute start budget (including retry headroom).
      Exact legacy 30/hour settings upgrade; custom and disabled settings remain.
      Inject one 429 with Retry-After at start, part signing, and completion:
      wait before retrying, preserve the request/upload IDs and file, and finish
      once. Persistent 429 stops after two automatic retries; a wait over 60s
      shows the real wait and retains the selection. Remove the file, unmount,
      or switch accounts during the wait: no late request may start. Check the
      error tile and full composer at desktop and 390px through the footer.
- [ ] Pick and drag/drop raster images, a supported video, and an arbitrary
      file. Safe image/video previews appear immediately; each row reports
      progress; Post stays disabled until every selected file is Ready; and posts accept more than 25 unique files (including edits and retained linked media).
      Comments and other purposes retain their existing count limits; upload
      concurrency, per-file checks and account storage quotas still apply.
- [ ] With 30 post files and mixed network/finalization failures, Retry all queues
      only recoverable failures, preserves order and upload identity, and never
      exceeds three active transfers. Double-click Retry all, then remove a
      queued file or switch accounts: no duplicate or late upload may appear.
      Terminal failures remain removable. `scripts/media-gallery-preview.html`
      exercises the production composer with synthetic transport and no writes.
- [ ] In feed/profile/post/media pages, upload photo → video → photo. Verify
      that every layout reads in that order, including mobile's two columns.
      Open the video in the shared popup, play/pause/seek, step both directions,
      copy/open its Thingtime permalink, and reload it. Check secret-link media,
      desktop and 390px layout, long filenames and the bottom of the page.
      Unrevealed NSFW videos remain shielded and absent from popup navigation.
- [ ] A profile shows direct-user, current-group, friend and mixed-audience
      grants; removing a grant hides the post. Undiscovered link-only posts
      remain absent. Visit a current secret link and return to its author's
      profile: that account/browser sees the collected post and can reopen its
      media. A second account/browser cannot. Rotate the key, remove hidden
      access, block or delete the post: previous discovery no longer authorizes
      it. Anonymous identity persists via localStorage/cookie; raw bearer tokens,
      discovery records and private IP metadata never enter public projections.
- [ ] With Photos off, drop image, video/audio, and generic files onto the
      collapsed post prompt, expanded body editor, and comment/edit composer.
      Photos opens and every file enters the single bounded uploader once.
      Marketplace, Things, and Poll selections and entered values stay intact.
      Repeat with Photos already open, dropping inside and outside its panel;
      preserve existing attachments, text/link dragging, and tile reordering.
      During submission/recovery, drops must not mutate the frozen draft or
      navigate away. Portaled Thing editors must not attach files to the post.
- [ ] With the post/comment text editor focused, paste (⌘/Ctrl+V) a screenshot,
      copied image, video, and generic file. File-bearing pastes turn Photos on
      when needed and queue into the one Media & files panel; pasting again
      anywhere inside that open panel does the same. Plain/rich text paste stays
      in the focused field, and pasting inside the separate Thing editor modal
      never attaches the file to the post.
- [ ] Upload and publish a small MP3, M4A (including an Apple Watch recording),
      FLAC, WAV, Ogg/Opus, and WebM audio attachment. Each final card and its
      `/thing/<attachment-id>` detail view shows native controls instead of a
      download-only row; the content response is `inline` with its detected
      audio MIME; a multi-audio post advances through its queue in attachment
      order; and "Save full file offline" plays the complete same-account
      IndexedDB copy after a reload. Check desktop and 390px mobile widths for
      no overflow, then remove the offline copy and confirm streaming resumes.
- [ ] With two or more selected files, drag the ⠿ grip (mouse AND touch) to
      reorder media tiles and file rows; arrow keys on a focused grip move one
      step, Home/End jump to the edges. Tiles reorder live while dragging, a
      tile drag never triggers the panel's file-drop styling, and the posted
      card renders images and files in exactly the chosen order after reload.
- [ ] Composer type badges are additive toggles: Text stays selected while
      Photos, Marketplace, and 📦 Things each switch their field group on and
      off independently (Things + Marketplace + Photos can all be live at
      once); clicking Text switches every extra group off. A plain text post
      shows no media/attachments panel until Photos is toggled on, and the
      saved post type is derived (things > marketplace > photos-with-visual >
      text) so files-only media still saves as a text post.
- [ ] URL media is unified into the Media & files panel: the add-by-URL input
      sits inside the panel below the upload grid with an `Add` button (Enter
      adds too). Each valid URL mints a linked attachment via
      `POST /api/v1/attachments/link` and lands in the SAME grid/file list as
      uploads — image/video extensions become media tiles, file extensions
      (pdf, zip, md…) become file rows, and extensionless URLs are probed
      (image if it loads, file otherwise). The same URL added twice creates
      two separate attachments. `javascript:`/credentialed/over-long URLs are
      rejected; a `.pdf` can never claim a visual kind. URL adding works even
      while uploads await beta approval (no storage is consumed).
- [ ] Linked attachments render on cards exactly like uploads — same gallery,
      layout modes, lightbox, reorder — but their bytes come straight from the
      external URL (`referrerPolicy=no-referrer`); linked file rows and the
      lightbox/media-page Download open the original URL in a new tab. Delete,
      post-delete cascade, and draft reaping of linked media never touch S3
      (works with private storage unconfigured).
- [ ] Edit a post with 2+ attachments: the composer shows exactly one Media &
      files panel containing the original attachments and new-media controls;
      no duplicate gallery or second drop zone appears. Dragging or arrow keys reorder the
      bound set, Save persists the order (card + `/post/:id` + reload agree),
      and saving with no changes sends no attachment sync. A stale edit saved
      after the post's attachments changed fails with the refresh-and-try 409
      rather than half-applying.
- [ ] Edit a post and add a new upload AND a new URL: Save binds both into the
      post after the existing media (PATCH attachmentIds = full desired
      order), the updated card shows them immediately and after reload, and
      the same flow works on a rich comment (purpose stays `comment`).
      Removals never happen via Save — a list missing a VISIBLE bound id is
      rejected with the 409, while moderation-hidden bound ids are exempt and
      keep their binding + trailing order.
- [ ] In both new-post and edit-post composers, every ready uploaded or linked
      attachment has a visible, keyboard-labelled delete button. Deleting an
      existing bound attachment removes only that exact post binding and
      attachment; a stale/mismatched target fails closed and restores the tile.
- [ ] Edit a legacy post that still carries crystal.images URLs: they appear
      in the media panel as linked tiles, reorder/remove like anything else,
      and Save migrates them into linked attachments (crystal.images empties;
      the card renders identically through the attachment gallery).
- [ ] Upload an image where a moderation provider is configured: while
      analysis runs the OWNER still sees the media with a "Checking…" badge
      (card tile + file row + edit composer), other accounts don't see it yet,
      and saving an edit during that window succeeds instead of 409ing.
      Blocked media stays hidden for everyone including the owner.
- [ ] Cancel an in-flight file, remove a completed draft file, and retry both a
      failed part upload and a failed completion. No file is silently omitted,
      duplicated, charged twice, or left in a permanent uploading state.
- [ ] Drop the upload-start response after the server reserves storage, then
      retry/remove: the stable request id resolves the same owner-scoped upload
      without a second charge. A different account using that request id gets
      its own opaque attachment id and learns nothing about the first.
- [ ] Remove an MPU before any part URL is issued: its empty reservation refunds
      promptly. Remove after a part URL was issued: the UI explains that bytes
      remain reserved while lifecycle-backed cleanup settles, without exposing
      server or S3 error text.
- [ ] Post an attachment without body text, then post URL photos and uploaded
      attachments together. The optimistic card receives stable metadata only
      and survives a later reload without persisting a presigned URL.
- [ ] Add an attachment-only comment, a text-plus-files comment, and a reply
      containing an image, video, and generic download. Each renders inline or
      as a safe download exactly like the parent post, survives reload and its
      `/post/:id` permalink, and never persists a presigned URL.
- [ ] Build a 6+-deep reply chain and attach a file at multiple depths. An
      authorized viewer can open each file through the inherited root ACL;
      logged-out, unauthorized, broken-chain, and custom-Mongo collision reads
      return not found without revealing attachment metadata.
- [ ] Simulate a lost attachment-comment response, then retry. The immutable
      shareId, comment payload, and exact attachment set reconcile once without
      a duplicate comment or second quota charge. A definitive first-attempt
      rejection returns the composer to an editable state.
- [ ] Delete an attached reply, an attached comment subtree, and finally the
      root post. Every descendant object's exact S3 version is removed before
      its attachment Thing and quota charge; a partial remote failure keeps the
      remaining tombstone billed and retryable rather than orphaning bytes.
- [ ] Feed, profile, nested repost, and permalink cards render vetted raster
      images and videos inline. SVG, HTML, script, and unknown types render only
      as named download rows; their bytes never execute inline.
- [ ] Upload a QuickTime screen recording (a `.mov`, or a QuickTime container
      misnamed `.mp4` — check for `ftypqt` magic bytes) plus an MKV or M4V.
      Each finalizes as its sniffed `video/*` type and plays inline in feed and
      permalink cards; the decision follows magic bytes, never the filename
      extension.
- [ ] Upload a non-web-playable container (for example an AVI) and confirm its
      download row labels the real sniffed container (for example "AVI video"
      from `detectedContentType`) instead of `application/octet-stream`, while
      the bytes still download as opaque octet-stream.
- [ ] In a browser missing the codec inside an allowed container (for example
      HEVC QuickTime in Firefox), the failed `<video>` degrades to the named
      download row instead of an inert black player.
- [ ] For a ready upload finalized before magic-byte detection (crystal
      `application/octet-stream`, no `detectedContentType`, renders as a file
      card), run the admin `POST /api/v1/attachments/backfill-detected-types`
      sweep — `dryRun: true` first, then for real, following `nextCursor` while
      `hasMore` — and confirm the already-posted attachment flips to inline
      video (or gains its sniffed download label) without re-uploading, with
      name, size, and any owner-authored title/description unchanged. A repeat
      run reports zero changes.
- [ ] Let a content URL expire at the storage provider and open the attachment
      again: the stable authenticated `/api/v1/attachments/content?id=…` route
      issues fresh access. A private post's attachment fails closed for another
      account and logged-out browser.
- [ ] Exhaust the active account tier, then select a file larger than the
      remaining allowance. Every post, comment, message, reply, emoji, avatar,
      and banner picker shows the fixed account-quota message with delete-media
      or upgrade-tier recovery; it must never call this an unavailable
      environment or echo ledger/provider detail. Removing the draft or
      deleting the bound content reconciles usage, and `ready` / `reconciling`
      / `unavailable` storage labels never present unknown accounting as
      unlimited capacity.
- [ ] Switch Thingtime accounts during prepare, hashing, direct upload, and
      completion. Requests and XHRs cancel, local previews clear, and no draft
      attachment ID or storage content crosses into the new account.
- [ ] Simulate a lost post-create response: the exact first payload becomes
      inert, retry uses the same post id and attachment set, and an exact GET
      readback completes once without duplicating the post. A first-attempt
      attachment 409 does not freeze an otherwise editable draft.
- [ ] At desktop and narrow mobile widths, long filenames truncate without
      horizontal overflow, multi-sentence errors span the available row width
      instead of wrapping one or two words per line, controls remain at least
      44px touchable, keyboard users can add/retry/cancel/remove files, and
      progress/error updates are announced without stealing focus.
- [ ] Through the local Vite proxy or a trusted reverse proxy, attachment and
      profile-media mutations succeed only when `Origin` matches the forwarded
      public host/protocol. A mismatched origin or `Sec-Fetch-Site: cross-site`
      request remains forbidden even if forwarded headers are spoofed.
- [ ] In the production AWS account, all four account-level and bucket-level
      Block Public Access switches are on, Object Ownership is Bucket Owner
      Enforced, versioning is enabled, default encryption is on, and no bucket
      ACL or public-access policy is present.
- [ ] The Vercel OIDC role trust policy matches the exact team audience and
      `owner:<team>:project:<project>:environment:production` subject. A
      production function can assume it; preview/development tokens cannot.
- [ ] The Vercel Custom Environment named `develop` has an exact `develop`
      branch matcher, owns the verified `https://dev.thingtime.com` domain,
      and is the only non-production scope containing the four Sensitive S3 /
      cleanup variables. Generic Preview contains none of them.
- [ ] On an ordinary feature-branch Preview, selecting a file fails before
      quota reservation with the fixed client-authored “private uploads are
      unavailable in this environment” guidance and offers the public image URL
      fallback. Never expose Vercel, proxy, AWS, role, bucket, or request text.
- [ ] The develop role trusts only
      `owner:<team>:project:<project>:environment:develop`. A deployed develop
      function can assume it, while a feature-branch
      `environment:preview` token and local `environment:development` token
      are both denied.
- [ ] The attachment role is limited to `objects/*` and the documented eight
      version-aware multipart/object actions. Confirm `s3:ListBucket`,
      `s3:DeleteObject`, ACL, and bucket-administration actions are denied.
- [ ] The bucket policy denies HTTP and TLS below 1.2 for non-service
      principals. CORS preflight succeeds only for the production origin's
      `PUT` with `x-amz-checksum-sha256`; a different origin, method, or header
      is denied, and no response header is unnecessarily exposed.
- [ ] Repeat the bucket controls against develop: only
      `https://dev.thingtime.com` can preflight its checksum-locked `PUT`, and
      neither environment's role can read, write, list, or delete objects in
      the other environment's bucket.
- [ ] The enabled `objects/` lifecycle rule aborts incomplete multipart uploads
      after seven days and permanently expires noncurrent versions after 30
      days. Account and bucket settings still match after a fresh console load.
- [ ] Upload a tiny production attachment, record its S3 VersionId and storage
      usage, then delete its post. That exact version is permanently absent
      before the Thingtime ledger refunds the bytes; no delete marker or hidden
      noncurrent copy stands in for deletion.
- [ ] Call `/api/v1/attachments/cleanup` with no bearer, a Thingtime user token,
      and an incorrect cron secret: every request fails closed. The exact
      production `CRON_SECRET` succeeds only through the scheduled cleanup
      path, and a cleanup retry never exposes the secret or raw S3 errors.
- [ ] After this PR's routes are deployed to `develop`, confirm the develop
      EventBridge rule invokes
      `https://dev.thingtime.com/api/v1/attachments/cleanup` at minute 17 each
      hour through its one-purpose API Destination/role. Its exact develop
      secret succeeds, missing/wrong secrets fail, and EventBridge reports no
      failed invocation.
- [ ] After the same deployment, upload a tiny attachment on
      `dev.thingtime.com`, complete it, render or download it, then remove the
      draft or delete its post. The exact S3 version disappears and the account
      storage meter returns to its starting value without touching the
      production bucket.

## Media thing pages — masonry, lightbox, `/media/:id`, annotate (`remix/app/components/Attachments/`, `remix/app/routes/media.tsx`)

- [ ] On iPhone (Safari and the app), Android and desktop, open a tall document
      and a landscape image in the lightbox. Pinch around off-centre text to
      zoom 1–5×; drag with one finger after lifting the other. Image edges stay
      bounded, and the page behind stays still. Try cancelling a gesture,
      rotating the device, switching images/video, and closing/reopening:
      no stuck drag, stale zoom or accidental close. Zoom +/- and the percentage
      reset work with touch and keyboard; desktop double-click toggles zoom.
      Close, download, gallery arrows and video playback remain usable.

- [ ] In both light and dark themes, the lightbox zoom +/- icons and percentage
      remain clearly visible against the dark overlay at desktop and mobile
      widths. Hover/press each control and Tab through them: enabled controls
      keep a white foreground and keyboard focus has a visible white outline;
      disabled zoom limits remain visibly disabled without a hover fill.

- [ ] Gallery download-all: open the lightbox from a post with two or more
      stored images/videos and confirm a folder-down icon sits between Download
      and Close (absent for single-file galleries); it saves the parent post's
      ZIP without closing the lightbox. On `/media/:id` for one of those files
      the context row shows `Download` plus `Download all · N files · size`, and
      the Media options ⋯ menu offers `Download all files (N files)` + `Share
      download link` targeting the parent post; for a media Thing whose parent
      has one stored file the menu instead offers `Download as ZIP` + a share
      link for that media id. Verify at desktop and 375px widths that the extra
      controls wrap without clipping the filename.
- [ ] A post with 3+ images renders the image section as a CSS-columns masonry
      (natural aspect ratios, `break-inside` avoided) with 1/2/3 responsive
      columns; at desktop and 375px mobile widths there is no horizontal
      overflow, and video/file sections keep their existing layouts.
- [ ] Clicking (and keyboard-activating) a masonry image opens the lightbox:
      full image, title/description when present, prev/next across only that
      post's images, a filename link to its canonical `/thing/:id` permalink,
      an Open-page link to `/media/:id`, a download button, and a visible X,
      Esc, and backdrop close. Those toolbar controls sit below the persistent
      navigation at desktop and 375px mobile widths. Error-state tiles never
      open a broken lightbox.
- [ ] Opening an image attachment's generic `/thing/:id` permalink shows the
      raw, safe image in an attachment card — never a blank post-shaped card.
      Its expandable "Referenced by" section stays compact and links to the
      direct post or comment without rendering that reference inline.
- [ ] `/media/:id` renders inside the Thingtime UI shell (nav, centered
      max-width): large media, title/description, author, a link back to the
      parent post, plus working reactions and comments on the media thing
      itself. Comments/reactions persist after reload, an unknown or private id
      404s safely, and `GET /api/v1/things?id=<attachmentId>` leaks no private
      object fields.
- [ ] As the owner, use the pencil affordance on a ready composer tile, an
      edit-gallery tile, and the `/media/:id` page to set/edit Filename preview
      (≤255), title (≤200), and
      description (≤2000). The editor saves via `/api/v1/attachments/annotate`,
      updates optimistically (revert + Lopu toast on failure), clears fields
      when emptied, and the saved values survive reload on card, lightbox, and
      media page. Filename preview replaces the rendered filename while the
      immutable original remains the download filename. A non-owner and an unauthenticated caller get no pencil and a
      403/401 from the endpoint.
- [ ] Annotate a legacy opaque attachment that already has a server-written
      `detectedContentType`. Title/description edits and clears preserve that
      field exactly, so #319/#321's detected label and accounting survive; a
      malformed pre-existing crystal fails closed instead of being rewritten.
- [ ] On `/media/:id`, the timestamp, owner-menu Copy link, and outward Share
      all resolve to `/media/:id` (never the blank `/post/:id` attachment
      projection). Repost/quote controls are absent until attachment-target
      shares have a real renderer, so the media card cannot create an empty
      feed share.
- [ ] Media layout editor: on a post with 3+ images, switch Layout between
      Auto 🧱 / Rows 🥞 / Grid 🔳 in the composer AND in edit mode. Auto and
      Rows show the same labelled final-view preview as Grid. Rows uses visual
      add/remove-row controls and +/- image counts rather than a text pattern;
      extras repeat the last row size. Grid gets a 1-6 column stepper plus
      visible clickable 1×1 per-tile badges cycling
      normal → wide → tall → big. Saved layouts persist through create, edit,
      reload, and render identically for a non-owner viewer; Auto clears
      `mediaLayout` from the crystal. Layout controls only appear with 2+
      visual attachments and never break the drag-reorder grips.
- [ ] Search by the Reaction schema with Emoji contains `heart`: matching ❤️
      reactions return their parent post cards even when the text query was
      previously non-empty. Search `ReplacementBladesV2.3mf` (and an attachment
      title, description, and Filename preview) from Commander/full search;
      the Attachment schema is offered by default and opens the media Thing.
- [ ] Media layout transport: after creating a post or rich comment through
      `useApi`, reopen the editor and confirm the selected Rows/Grid mode,
      columns/pattern, and non-default spans survived the client request. A
      correct pre-submit preview is not sufficient evidence of persistence.

- [ ] Reload a post with a rich comment using Rows or Grid. Its chosen
      `mediaLayout` (including columns/pattern and non-default spans) survives
      the feed, profile, and `/post/:id` projections rather than silently
      falling back to masonry.
- [ ] Server bounds: `mediaLayout` rejects pattern rows over 25 entries or
      outside 1..6, columns outside 1..6, spans maps over 25 entries, and
      non-object payloads with a 400; unknown keys are stripped; legacy posts
      without the field stay valid; Auto removes the `mediaLayout` key rather
      than storing `null`; lightbox order stays attachment order in every mode;
      desktop and 375px render every mode with no horizontal overflow.
- [ ] Drag-resize canvas editor (grid mode): dragging a tile's edge handle
      resizes it snap-to-cell (wide/tall/big), including via touch, with a
      keyboard fallback on a focused tile; the column slider relayouts live;
      the resulting layout matches what non-edit viewers see after save.
- [ ] Deleting the parent post (and separately a single attachment) cascades:
      the media thing's own comments/reactions are removed, its `/media/:id`
      404s, and no orphan child things remain.

## Profile avatar and banner media (`remix/app/components/Profile/`)

- [ ] Open both Edit profile and Settings → Profile. With no saved image, each
      avatar/banner field shows a responsive `🏞️ Add Media` tile and a separate
      “Use public image URL” fallback; all controls remain at least 44px.
- [ ] Select JPEG, PNG, GIF, WebP, and AVIF files. A local preview paints
      immediately, progress/retry/remove remain usable, Save stays disabled
      until the image is ready, and SVG/non-image/empty/>64 MiB files fail with
      fixed client-authored guidance before upload.
- [ ] Save a managed avatar and banner, reload, and verify profile, feed cards,
      search, notifications, Messenger/account navigation, and the owned-account
      roster render the stable same-origin content URL without exposing an S3
      key, upload id, version id, or presigned URL.
- [ ] Load a public profile logged out and verify its current managed avatar and
      banner render. A replaced, unbound, cross-account, wrong-slot, custom-Mongo
      collision, or arbitrary attachment id must return not found.
- [ ] Replace a saved managed avatar/banner, clear it, and switch it to one
      credential-free http(s) URL. The user-slot update and new attachment bind
      are atomic; the old object stays charged until exact-version deletion and
      then the storage meter refreshes to the correct value.
- [ ] Paste a valid external image URL: it previews with no referrer, remains a
      quota-saving remote link, and is never server-fetched. Credentialed,
      protocol-relative, whitespace/control-character, and non-http(s) URLs are
      rejected without raw server/proxy text.
- [ ] Close the editor, navigate away, or switch accounts while a profile upload
      is preparing/uploading/ready-but-unsaved. Requests cancel, local object
      URLs clear, unbound drafts are cleaned safely, and no filename, preview,
      attachment id, or storage state flashes into the next account.
- [ ] Simulate a lost profile-save response and retry the same attachment ids.
      An already-bound exact owner/slot succeeds idempotently; a mismatched slot
      or changed attachment fails closed without deleting another current image.

## Editor windows & layer system (`remix/app/components/Thingtime/EditorSplit.tsx`)

- [ ] Every toolbar control on a FLOATING frame (splits, edit toggle, reader/
      code toggle, pop-out, dock-in, ▲▼ layer arrows, …) fires its action on
      click — none of them start a frame drag. Dragging empty toolbar space
      still moves the frame.
- [ ] The composer's pop-out button duplicates the window into a native
      floating frame (traffic lights + toolbar); the in-post editor stays and
      both live-sync through the store.
- [ ] New frames layer ABOVE the drawer; hovering the drawer brings it to
      front, mouse-leave hands it back.
- [ ] ▼ on the top below-drawer frame / ▲ on the bottom above-drawer frame
      crosses the drawer WITHOUT changing relative window order; ⇧-click is
      bring-to-front / send-to-back.
- [ ] Close or dock a below-drawer frame: the frames stacked above it must
      STAY above the drawer (layer divider accounting).
- [ ] Open a dropdown (feed Filters, Algorithm menu) and a drawer modal with
      a frame floating: menus (10220) and modals (10240/10250) render ABOVE
      the frame; the chrome z ladder is documented in
      `remix/app/components/Nav/Drawer/useDrawer.tsx`.
- [ ] Dragging a window from one editor instance over ANOTHER instance's
      window must not dock (and must never lose the window) — drop targets
      are instance-scoped.
- [ ] `/editor` still opens with its two-window default and the drawer's
      Editor section still lists/saves/restores layouts (embedded composer
      editors must never appear there).

## Editor.js rich text styles

- [ ] In builder inline/modal editors and the post composer, select paragraph,
      heading, list/checklist, quote/caption, table-cell and warning text. The
      palette button opens the same full styling panel for every rich-text field.
- [ ] Test wheel dragging/keyboard controls, HEX/RGB/RGBA/HSL/HSLA input,
      transparent colours and highlights, all decorations, font family, and
      px/em/rem/pt/% sizes with both direct input and minus/plus controls.
- [ ] Apply, save, reopen, and read the rendered content. Builder HTML round trips
      retain selected-text styles and block colours, alignment and custom sizes.
      Changing a substring keeps neighbouring and mixed formatting; Cancel leaves
      the document unchanged, Reset clears styling, and Undo restores the edit.
- [ ] At desktop and 390px mobile widths, select text near each viewport edge and
      scroll top to bottom. The toolbar stays above the selection, wraps within
      the viewport, and remains usable. Scroll the colour panel to both ends;
      controls and Save/Cancel stay reachable without horizontal overflow.
      Hover a desktop toolbar hint then shrink to mobile: hidden hints must not
      leave a horizontal scrollbar.
- [ ] Change a styled heading to paragraph, list/checklist or quote. Text colour,
      size, decoration and alignment carry by default. In Changes, uncheck a
      carry property and confirm only that whole-block property is omitted.
- [ ] Open an unstyled colour picker: lightness starts at 50%. Change colour,
      opacity, size and decoration while watching the actual text. Save keeps
      the preview; Cancel restores the original without losing the preview events.
- [ ] Type, style, insert an empty block, check a checklist item, add a table row,
      convert, move and delete blocks. Undo/Redo buttons and Cmd/Ctrl+Z / Shift+Z
      restore the complete draft, including unfinished blocks and focus.
- [ ] Undo twice and type a different edit. Changes retains both futures with
      their parent events; Restore point revisits either. Revert/reapply a colour
      event preserves later text/size changes; overlapping field edits display a
      conflict without overwriting the current document. Expand Changed properties.
- [ ] Reopen the builder floating editor and toggle inline editing off/on: their
      session histories remain available. Keep two editors with the same block
      IDs open; styling one does not change the other's tune registry or focus.
- [ ] Resize block settings, the style picker and the advanced editor using the
      corner handle and arrow keys. Move the style picker by its title; resize
      the viewport and scroll each panel to both ends. Controls remain reachable.
- [ ] Compare edit/view text bounds with left, centre and right alignment at
      desktop and mobile widths. There is no reserved toolbar gutter; +/dots
      float right for left/centre text and left for right text, using clear space
      beside the text or above the editor. Previous headings and history controls
      remain visible, including inside the advanced modal.
- [ ] On physical iOS, repeat selection with the native context menu and keyboard
      open, including keyboard viewport panning and text near the screen top.
- [ ] Local regression fixture: `/tests/editor-rich-text.html` under Vite uses the
      real editor and builder components with ephemeral data and no API writes.
- [ ] Editor-sink style scrub (`editorJsHtml.ts` `scrubElement`): save a block whose
      stored html carries raw CSS on a NON-span inline carrier — for example
      `<b style="position:fixed;inset:0;z-index:99999">` or
      `<mark style="background-image:url(https://example.invalid/x)">` — then reopen
      it in the inline and advanced editors. Editor.js renders `data.text` as live
      innerHTML there without the render-side allowlist, so every element's style
      must be re-validated through the style-token gate: no fixed-position overlay
      and no outbound `url()` request on open. Legitimate `<span>` colour/size
      styles and block-level `text-align` must still survive the round trip.

## Multi-editor focus (`remix/app/components/Editor/LongTextEditor.tsx`)

- [ ] With the popout open (same path in two editors), click into an
      editor.js field, type, wait ~1s (autosave echo remounts the OTHER
      instance), keep typing WITHOUT re-clicking: the caret must stay exactly
      where it was — no jump to block start, no focus loss. Test typing in
      the popout and in the in-post editor.
- [ ] Single-editor echo: typing continuously through several autosaves in
      one editor never remounts or resets it (signature echo acknowledgment).

## Feed thing rendering (`remix/app/components/Thingtime/ThingView.tsx`)

- [ ] A thingtime post renders its thing as the NATIVE Thingtime tree in view
      mode — right-click opens the thing context menu, Toggle Edit Mode makes
      values editable (numbers get steppers, booleans a switch, Editor.js
      docs the block editor), and edits stay LOCAL: reloading the feed
      restores the server value, and neither the viewer's persisted
      thingtime blob nor the composer's tmp draft branch is touched.
- [ ] A thing that resolves a kind renderer (a `render:` prop naming a kind,
      an explicit kind, or a structural match — in that priority order)
      shows the RENDERED form by default, with a small corner 🌀 icon back
      to the Thingtime view and ✨ back again; things resolving no renderer
      show the tree with no corner icon.
- [ ] Editor.js docs render as rich text by default everywhere: a rich-text
      post body (feed + profile), a nested rich-text value inside a tree,
      and /search crystal chips (plain-text preview, never raw block JSON).
- [ ] In the Text post composer, style several Editor.js blocks (heading,
      colour, alignment, size, repeated whitespace, and a hard line break),
      then tap Post immediately after the final style change. The new feed
      card and `/post/:id` preserve the exact latest block document after a
      reload; no heading appears as literal Markdown such as `## Posts`.
- [ ] At desktop and 390px mobile widths, focus the first, middle, and final
      Editor.js blocks in the Text post composer: the + and settings buttons
      stay on the active block's right/inline-end edge, never below its text or
      outside the editor card. Long and right-aligned text keeps a readable gap;
      both button menus open without clipping or horizontal page overflow.
- [ ] Repeat the same create-and-reload check with a rich comment. Inspect the
      create request and exact-id readback: both must contain the complete
      native `richText` document as well as the canonical `text` fallback.
- [ ] Untrusted (other users') things are only auto-rendered for the
      vetted-safe kinds (rich-text, image, audio, playlist, podcast, article,
      quote, book, movie, link, file, code, repository); every other kind —
      including the arbitrary-markup `chakra`/`element` kinds — falls back to
      the sanitising native tree with no rendered toggle.
- [ ] SECURITY (feed + search): a thing shaped as `kind:'link'` with
      `url:'javascript:…'` renders a card that is NOT a clickable link (no
      anchor, no "Open link"); a `chakra`/`element` thing with
      `props:{position:'fixed',inset:0,zIndex:99999,…}` renders as a data
      tree, NOT a viewport overlay; image/audio/cover URLs with unsafe schemes
      fall back to the emoji placeholder. Verify via DOM: no `a[href^=
"javascript:"]`, no fixed/absolute high-z overlay from post content.
- [ ] Editing a feed thing (context menu → Toggle Edit Mode) and pressing
      Cmd/Ctrl+Z does NOT undo the viewer's own persisted tree — the keydown
      is contained to the sandbox (native field undo still works).
- [ ] Global undo/redo shortcut guard (`useThingtimeMachine.tsx` `keyListener`):
      inside the post composer, a comment box, the login form, and any
      contentEditable (Editor.js block), Cmd/Ctrl+Z performs the editor's own text/history undo —
      no thingtime state changes. With focus on the page background (no editable
      focused), Cmd/Ctrl+Z undoes and Cmd/Ctrl+Shift+Z REDOES (Shift reports
      `e.key === 'Z'`, so redo was unreachable before this guard normalised
      case). Mid-IME composition (Japanese/Chinese input) Cmd/Ctrl+Z never
      triggers a thingtime undo. The guard predicate itself is covered by
      `npm run test:editable-target` (`app/utils/editableTarget.ts`); this
      manual pass is for the wiring and the real browser key codes.
- [ ] A very large thing (deeply nested, hundreds of nodes) mounts COLLAPSED
      and scrolls within a bounded box — it never mass-mounts nodes or
      wall-of-texts the feed.

## Post interactions & inherit chains (`remix/app/api/utils/things/things.ts`)

- [ ] Reacting, commenting, saving, sharing, and opening the `/post/:id`
      permalink all work on a comment nested DEEP in a reply chain (build a
      6+-deep comment-on-comment chain via the UI or API and interact with the
      deepest one) — visibility resolves through the whole `tt:inherit` chain,
      never "Post not found" for a legitimately deep reply. Chain resolution
      is bounded by cycle detection (`aclChainCore.ts`, `npm run test:acl`),
      NOT by a small depth cap: a depth cap silently orphaned deep replies
      while the feed still rendered them.
- [ ] A comment whose parent chain is broken (target deleted) fails closed:
      not viewable, not reactable, permalink 404s.
- [ ] An owner can still open their own image attachment at `/thing/:id` when
      its historic inherited parent is missing: it renders as raw media with
      zero available references. Anonymous, other-user, and visibility-scoped
      token reads still return 404 (the owner recovery exception applies only
      to persisted `attachment` Things).

## Poll voting (`remix/app/api/utils/things/vote.ts`, `PollRenderer`)

- [ ] Compose a poll from the feed composer's 🗳️ Poll tab (question in the
      main box, 2–6 option rows with add/remove) and post it: the card renders
      the poll (question + tappable options), NOT the raw Thingtime tree.
- [ ] Tap an option while logged in: the bar fills and the ✓/accent highlight
      lands INSTANTLY (optimistic), then the server tally reconciles.
      Tapping a different option MOVES the vote (totals unchanged); tapping
      your own option again REMOVES it. `POST /api/v1/things/vote` returns
      `pollVotes { counts, totalVotes, viewerVote }` matching what renders.
- [ ] One vote per user per poll survives races: double-tap fast / two tabs —
      the protected Binary `voteKey` in `uniqueKeys_1` keeps at most ONE vote
      doc per (`crystal.voteKey` = `<pollId>~<userId>`); reloads converge. Run
      `npm --prefix remix run verify:poll-unique-keys` against its explicitly
      allowed disposable replica set to exercise 16 concurrent real-utility calls.
- [ ] Watch preview startup and poll voting retain `things_vote_key_lookup`,
      matching released readers, while `lopu_recording_due` remains available.
      Relationship/legacy index retirement happens only via leased admin migrations.
- [ ] Poll insert/change/removal leaves the account ledger unchanged (protected
      engagement is unbilled), including full accounts. Conflicting vote writes
      return 409 instead of silently reporting an unwritten vote as successful.
- [ ] Logged out: the poll shows results only (bars + percentages visible,
      no vote recorded); tapping toasts "Log in to vote 🗳️".
- [ ] A poll on a private/friends-only post can't be voted on by a viewer
      outside the audience (404 from the vote endpoint — acl + `tt:inherit`
      chains re-checked per vote), and out-of-range `optionIndex` 400s.
- [ ] Generic CRUD refuses the kind: `POST /api/v1/things` with
      `thingtime: ["vote"]` answers 403 (votes mint only through the vote
      endpoint, which writes the server-owned `voteKey`).
- [ ] Vote endpoint failure (devtools: fail `/api/v1/things/vote` once)
      reverts the optimistic bars to the pre-tap tally and shows a Lopu
      error toast — never a stuck wrong count.
- [ ] A shared poll's nested sub-card shows the live tally read-only; voting
      happens on the original's own card/permalink.
- [ ] Deleting a poll post cascade-deletes its vote things (no orphan `vote`
      docs pointing at the gone poll); vote docs never list as /things rows
      and folder copy skips them like reactions/saves.
- [ ] A free-form data crystal with the same `voteKey` cannot squat another
      user's protected vote identity. Generic inputs cannot stamp `uniqueKeys`.

## Subspaces (`remix/app/components/Subspaces/`, `remix/app/api/utils/subspaces/`, `/api/v1/subspaces*`)

- [x] 2026-10-19 isolated real API and desktop/390px acceptance: message send/read, saved views/comments, draft retention, live permission revocation, searchable moderator embeds and independent Builder control/repeated-title edits survive reload. See [PR 1045 evidence and remaining production gates](PRs/1045-subspace-messages-views-and-moderated-embeds.md).
- [ ] Search embedded Things when the search API returns grouped post dictionaries as well as flat arrays; results remain selectable and malformed buckets do not crash the editor.

- [ ] New and existing subspaces have exactly one assigned Messenger space and general channel; provisioning retries and concurrent opens never duplicate them. Run the registered backfill twice and verify all subspaces.
- [ ] Toggle Posts/Messages, retain both unsent drafts, reload the selected mode, and confirm hidden messages do not advance read receipts. Check desktop and mobile to the bottom of both views.
- [ ] Expand all comments shows loaded post comments and replies; turn it off, reload, navigate to another subspace and switch accounts to verify saved preference isolation without unbounded auto-pagination.
- [ ] Pending, banned, removed and former members cannot read/send linked messages, see previews, or download message media; private changes and subspace deletion revoke every entry point.
- [ ] Moderators add, move and remove accessible Things in the sidebar and above-feed regions; non-moderators are refused. Reload and verify order, pagination and placement between composer and first post. Revoke a referenced Thing and confirm it is unavailable without exposing hidden-link keys or granting access.
- [ ] Select nested view/embed control labels independently in Builder, edit/save/reload, and confirm the real controls still act on the correct subspace.


- [ ] Owner can rename a subspace to `thingtime`; posts and memberships retain their IDs, settings navigates to the new URL, and reload works. Non-owner renames return 403; reserved slugs return 400; taken/held slugs and concurrent competing renames return 409 without changing the original. The old URL is released.
- [ ] `/s` lists subspaces newest-first with member counts; search narrows by
      slug/name; **Mine ⭐** shows only joined ones; **Create ➕** (or
      `/s?create=1`, the drawer's Subspaces ▸ Create) opens the modal. The
      slug previews live from the name (`Rainbow Makers` → `rainbow_makers`),
      reserved words (`all`, `mod`, `create`…) and <3-char slugs are refused,
      a taken slug answers 409 with a Lopu toast, and success navigates to
      `/s/<slug>` with the creator as 👑 owner.
- [ ] `/s/<slug>` renders banner (image or accent gradient) + icon + name +
      `👥 members` + access badge, the sort tabs (Hot/New/Top/Rising/
      Controversial; Top/Controversial add a range select), the composer
      LOCKED to the subspace (chip `s/<slug>`, a Title input above the body,
      a Flair select when flairs exist), the post column, and the sidebar
      (About, Rules, Flairs, Moderators, and **Mod tools 🎩** for mods). At
      375px the sidebar stacks below the posts; nothing scrolls horizontally.
- [ ] Join/Leave paints instantly (count ±1, button flips) and reverts with a
      toast on failure; owners see no leave button (API 409s anyway); banned
      viewers see a 🚫 notice and a disabled button; on a private subspace
      the button requests instead of joining (see the join-requests bullet).
- [ ] A post made from the subspace composer shows the `🪐 s/<slug>` chip,
      the title as an h2, and the flair chip — on `/s/<slug>`, `/feed`,
      `/post/:id` and the author's profile alike. The feed composer's
      **🪐 No subspace** select lists joined subspaces; picking one reveals
      the title + flair controls and the post lands in that subspace.
- [ ] Posting rules: unknown flair 400, mod-only flair 403 for members,
      restricted subspace 403 for unapproved posters (✋ hint under the
      composer), private subspace 403 for non-members; PATCHing
      `crystal.flairId` re-runs the same gate (author may flair, but not with
      a mod-only flair). Generic `POST /api/v1/things` with
      `thingtime: ["subspace"|"subspace-member"|"subspace-modlog"|"subspace-report"|"updown"]`
      answers 403.
- [ ] Moderation (··· menu on a subspace post, mods only): Remove opens the
      **Remove modal** (`remove-modal`: a radio list of the subspace's removal
      reasons — title + message — then its rules, then Custom; a note field;
      "Also lock comments 🔒"; "Also ban @author 🚫" with a days input, hidden
      on your own post) and redacts the post for everyone but the author +
      mods (body, media, title gone; "🧹 Removed by moderators — <reason>"
      notice; reason visible to author/mods only) and drops it from every
      feed. The card paints removed + the reason the instant you confirm and
      reverts with a toast if the API refuses; lock/ban follow-ups that fail
      keep the removal and toast on their own. A canned reason stores
      `title — message · note`; a rule pick is sent as `ruleIndex` and the
      SERVER composes `Rule N: title — text · note` (both bounded at 900
      server-side — the note field's `n/max` counter shrinks beside a canned
      reason / rule so nothing you type is sliced off; a note written under
      Custom is trimmed to fit when you switch picks). The lazy default pick
      (first canned reason) only lands while the form is untouched — click
      Custom or start typing before the rules load and nothing flips under
      you. "Also ban" sends the SHORT reason (the canned title / `Rule N:
      title` / your custom text), never the full composed text. The author
      gets a 🧹 `subspace-post-removed` bell entry ("s/<slug> · <headline>" —
      the canned title / the rule citation / the free text; bell previews
      clamp at 140 chars, the full reason is on the post) that opens
      `/post/:id`; the row — like the 🚫 ban / unban rows — comes from
      "s/<slug> mods" (actorId = the subspace, no profile link), never the
      individual moderator, whom only the mod log names; removing your own
      post rings nobody; a second Remove on an already-removed post (a retry,
      two mods racing, an API caller) is a no-op: 200, same reason /
      removedAt, no second mod-log row, no second bell. Approve
      restores it silently. No `window.prompt`/`confirm` anywhere in the
      subspace UI. Approve restores it;
      Pin leads Hot/New with a 📌 badge (max 5); Lock shows 🔒 and makes
      commenting 423 for everyone but mods — replies to replies included;
      18+ / Spoiler toggle badges; Flair submenu (lazy-loaded list). Every
      action lands in the mod log with the actor.
- [ ] `/s/<slug>/mod` (mods only; others see the 🎩 notice): Queue (newest,
      removed included, "Removed only" switch); Members (username + action:
      add/approve/unapprove/kick/make mod/demote, per-row buttons; only the
      owner can promote/demote/moderate other mods; the owner can't be
      banned); Ban (per row and Banned → "Ban someone" by username) opens the
      **Ban modal** (`ban-modal`: reason shown to the user, days — blank =
      permanent, and a private mod note that lands in the `member.ban` mod-log
      detail only, never in the user's `banReason` or bell); a banned row
      leaves the Members list the moment you confirm and comes back if the
      API refuses (the modal stays open with your text); Banned (unban);
      Settings (name, description, icon, accent, icon/banner URLs; access +
      18+ owner-only, disabled for mods); Requests (join + posting-approval
      queues, see below); Rules (add/reorder/remove, ≤15) + **Removal
      reasons** (second card: title ≤80 + message ≤500, ids minted from
      titles on save, ≤20, reorder/remove; a plain member's save 403s, >20 /
      a 501-char message / duplicate ids 400) — saving rules, reasons or
      flairs refreshes what the card menu / Remove modal offer; Flairs (emoji/
      label/color/mods-only, ids minted on save, ≤50); Log (newest first).
      A banned user cannot post, comment, vote, or (re)join; the ban outlives
      leaving; a temporary ban expires on its own.
- [ ] Access: switching to **private** walls `/s/<slug>` for non-members
      (🔒 empty state, feed 403), hides its posts from the home feed, search,
      trending, RSS and direct `/post/:id` reads for non-members, while
      members and mods keep seeing them; outsiders **request to join** and a
      mod accepts (or **adds** them by username); switching back to public
      re-exposes them. **Restricted** keeps reading open but only approved
      posters/mods post (members may request approval).
- [ ] Settings → **Subspaces 🪐**: the vote-pill switches hide the ▲▼ pills
      on posts and/or comments across every mounted card immediately; the
      default sort applies when a `/s/<slug>` link carries no `?sort=`.
- [ ] Deleting a post removes its `updown` votes (cascade); a subspace's
      posts survive it losing a flair (chip simply disappears).
- [ ] Mod page → Settings → **Danger zone ⚠️** (owner only; mods see a
      one-line "up to its owner" note): **Transfer ownership** takes a
      username, opens a confirm modal, and on success the crown moves (the
      old owner's owner-only controls dim instantly, `viewer.role` becomes
      `moderator`, the Lopu toast names the new owner, the new owner gets a
      🎩 `subspace-role` bell entry "s/<slug> · you are now the owner 👑"
      that deep-links to `/s/<slug>`); the API refuses non-owners (403),
      yourself (400), non-members / unknown users (404) and banned members
      (403), and the previous owner can now Leave. While the transfer is in
      flight the Danger zone stays mounted and merely dims (the confirm
      modal keeps its spinner); a failed transfer (typo'd username → 404)
      puts the crown straight back with the username still typed. Two
      transfers racing from the same owner (double-click, two tabs, two API
      clients) commit at most once — the loser answers 409 and the roster
      never shows two crowns. **Delete subspace** opens a modal whose red
      button arms only once `s/<slug>` is retyped (prefix and case
      forgiven); success navigates to `/s` with a toast counting released
      posts (and how many stay private to their authors) + removed
      memberships, `/s/<slug>` shows "doesn't exist" (its cached copy is
      evicted, never repainted), members/mod log are gone, and every former
      post still opens on `/post/:id` as a plain post (no subspace chip,
      flair or mod state; title kept). Posts of a **private** subspace and
      posts the mods had **removed** become author-only private posts (404
      for everyone else, never back on public feeds) — the owner's click
      never publishes what an author never chose to publish; rich
      post+comment things pointing at the subspace are released the same
      way. The slug is **held** (a `subspace-tombstone` row keeps its
      uniqueKey): anyone else gets 409 "held" for 30 days while the previous
      owner may re-found it at once, and `/s/<slug>` stays 404 meanwhile.
      Moderators (403), a wrong `confirmSlug` (400), a delete that lost a
      race with a transfer (409) and a subspace with more posts than one
      call releases (409, doc intact — run it again) are refused; former
      mods get a "s/<slug> · was deleted by its owner 🗑️" bell entry.
- [ ] Join requests (private) + posting-approval requests (restricted):
      on a **private** `/s/<slug>` the header button reads **Request to
      join 🔒** → paints **Requested ✓ · cancel** instantly (the count does
      not move — a request is not a membership: feed 403, `mine=1` empty,
      posting 403, transfer-to 404), toast "Asked to join s/<slug> 🙋";
      clicking again cancels (`/leave`, row gone). Directory cards read
      **Request 🔒** / **Requested ✓**. Mods get a 🙋 `subspace-join-request`
      bell entry ("s/<slug> · wants to join"), a numeric badge on **Mod
      tools 🎩** (links straight to the Requests tab) and a **Requests** tab
      (badge = join + approval requests) with Accept ✓ / Deny per row — the
      row leaves and the badge drops optimistically, both come back on
      failure. Accept → member (🎉 `subspace-join-accepted` bell entry,
      modlog `member.accept`); Deny drops the row (modlog `member.deny`,
      optional reason) and the user may ask again; a mod's **Add member**
      on a requester accepts too; banning a requester removes the request.
      In a **restricted** subspace an unapproved member sees "✋ Only
      approved posters can post here" + **Request posting approval ✋** →
      **Approval requested ✓** (disabled); mods get "s/<slug> · wants to
      post", the request shows in the Requests tab's second card and as
      "✋ asked to post" on the Members row; Approve grants posting and clears
      it, Deny / Unapprove clear it; asking as a non-member (403), for
      someone else (403), when already able to post (400) or in a public /
      private subspace (400) is refused. `members?pending=1` /
      `?approvalRequests=1` are 403 for non-mods; `memberCount` and the
      member list never include pending rows; `viewer.pending` /
      `viewer.approvalRequested` ride every subspace projection and mods
      get `pendingCount` / `approvalRequestCount` on the detail.
- [ ] Request edge cases (S2 review): the server's posting gate IS
      `viewer.canPost` (`canPostIn`) — kicking an approved poster of a
      restricted subspace clears `approved`, so `POST /api/v1/things` answers
      403 for them and a rejoin does not restore approval; a private
      re-request starts from a clean row (never approved); a post card's
      `subspace.viewerRole` is `null` for anyone who is not an active member
      (kicked, pending). A pending join request takes only Accept / Deny /
      Add / Ban / Make mod: approve, unapprove and demote answer 400 ("accept
      the join request first"), kick answers 404, and the requester never
      gets a stray "no longer a moderator" bell. Accept / Deny / Add on a
      request that was cancelled meanwhile answer 409 ("withdrawn — reload
      the queue"; the Requests tab refreshes instead of restoring the row)
      and write no `member.accept` log / 🎉 bell — a cancelled request
      answers 404 outright. Switching a private subspace to public or
      restricted activates every open join request (requesters become
      members, get a "s/<slug> · opened up — your request to join went
      through 🎉" bell; modlog `settings.update` detail `acceptedRequests`);
      switching away from restricted clears open posting-approval requests.
      A member whose temporary ban has expired can request posting approval
      and the request shows in the queue + count (the row heals). A request
      cancelled and filed again (`/join` → `/leave` → `/join`) does not
      ring the mods again while their earlier 🙋 bell is unread (it rings
      once more after they read it); `/join` has its own rate key
      (`subspaces.join`, 20/min → 429).
- [ ] User flairs 🏷️: Mod page → Flairs → **User flairs** card (templates
      with emoji/label/color/mods-only, ids minted on save, ≤50; switches
      "Members pick their own flair" (default on) and "Members may type their
      own text" (default off; ≤40 chars)); any moderator may save it. On
      `/s/<slug>` an active member sees the sidebar **Your flair** card:
      template pills (mod-only ones 🎩 only for mods; the active one shows ✓
      and clicking it again takes it off), a custom-text input when allowed,
      and **Take it off ✕** — the pick paints instantly on the card, the
      header state and every post/comment of theirs on the page, and reverts
      with a toast on failure. The chip (`data-testid="author-flair"`)
      appears right after the author name on post cards, comment rows (all
      shipped levels), the shared-post sub-card and the mod page's member
      rows — only inside subspaces (`authorFlair` is null elsewhere), and
      only while the author is an active member (a pending wearer's chip is
      hidden; a kick or ban STRIPS the pick — a rejoin / unban wears nothing
      until it is picked or granted again — and demoting a moderator strips
      a mod-only pick while ordinary ones stay; the `member.remove` /
      `member.ban` / `member.role` mod-log detail reads
      `userFlairCleared: true`). Renaming a template updates every wearer's
      chip — on the post page AND on a comment's own `/post/<commentId>`
      drill-down; deleting one keeps their snapshot. Mod page → Members →
      **Set flair** opens a Chakra modal (template select incl. 🎩 mod-only
      ones / Custom text… + emoji / No flair; a worn template the mods
      deleted since opens as editable custom text with a "removed" hint;
      Save waits while another member action is saving, and the modal stays
      open with the typed text when the API refuses) — a mod may dress
      anyone, the owner included (who can always override it; the owner's
      row shows Set flair too), bound by neither switch, and only dressing
      someone ELSE writes a `member.userFlair` mod-log entry. API walls:
      anonymous 401, a non-member setting their own 403, someone else's
      without a mod hat 403, unknown template 400, mod-only template as a
      member 403, custom text while it is off 403 / over 40 chars 400,
      self-assign off → a member's pick 403 but clearing still 200, a mod
      dressing a non-member 404 / a banned user 400. The fresh comment
      `POST /api/v1/things/comment` answers with already carries
      `authorFlair` (the root post's subspace, resolved once by the
      interaction gate); the projection resolves every page in ONE
      member-row lookup (posts, shared originals, every comment level).
- [ ] Reports 🚩: on a subspace post (or a comment under one) a logged-in
      viewer who is neither the author nor a mod finds **Report to
      moderators 🚩** in the card's ··· menu (`post-report`; comment rows
      get a small flag icon, `comment-report`); the **Report modal**
      (`report-modal`) lists the subspace's rules (Rule N: title — the first
      one preselected while the form is untouched) + Other and a note (≤500).
      Confirming closes the modal and toasts "Reported — thanks, the mods will
      look 🚩" at once (optimistic — a refusal toasts on its own); a comment
      report lands on the ROOT post (the queue row says "(a comment ↗)").
      Reporting the same post again refreshes your row (`updated: true`,
      still one report) and does not ring the mods again; after the mods
      settled it a new report re-opens it and rings again. Mods get a 🚩
      `subspace-report` bell entry ("s/<slug> · <reason>", from the reporter,
      opens `/post/:id` — deduped against their unread bell), a `🚩 N` badge
      in the post's subspace line (`post-report-badge`, links to the Reports
      tab — only mods ever see `subspaceMod.reportCount`), the count on
      **Mod tools 🎩** (requests + reports) and the mod page **Reports** tab
      (badge = open reports): each reported post renders as its card with
      the reasons tally (×N), the reporters (name · reason · note · when,
      ≤20 listed, "…and N more"), **Remove 🧹** (the Remove modal — the
      removal settles the reports: `post.remove` mod-log detail
      `resolvedReports`) and **Dismiss ✓** (the post stays; mod-log
      `report.dismiss` with `detail.count`); both paint first (group leaves,
      badge drops) and come back on failure (a 404 = settled meanwhile →
      the queue refreshes). The **Resolved** toggle shows how each post was
      settled (Removed 🧹 / Approved ✅ / Dismissed ✓); approve settles open
      reports as `approved` too. A post the author deletes takes its reports
      with it. API walls: anonymous 401, no reason 400, a 501-char note 400,
      an unknown OR invisible post 404 (never 400 — existence is not
      disclosed), a post outside any subspace 400, a banned reporter 403;
      `GET /api/v1/subspaces/reports` 401 / 403 for non-mods, dismiss 401 /
      403 / 400 (no postId, bad action) / 404 (nothing open). Generic
      `POST /api/v1/things` with `thingtime: ["subspace-report"]` answers
      403. Rate key `subspaces.report` (30/min).
      S5 review fixes: a post the mods already removed offers no 🚩 (card
      menu and comment rows) and `/report` answers 409 for it — no row, no
      bell; in a PRIVATE subspace a stranger, a pending requester and a
      banned member get 404 for the post and its comments (an active member
      200); a report row is the reporter's own private thing (generic
      `GET /things?id=` 200 for them, 404 for everyone else); a post that
      MOVED to another subspace keeps its open rows dismissable in the old
      queue without a slug, and the reporter's next report re-files in the
      new subspace and rings its mods; deleting a reported COMMENT deletes
      the rows that flagged it (the post's other reports stay). Reports tab:
      the badge / `Open · N` drop by the group's ROWS (not one per group)
      and reconcile from the server after Remove 🧹, a removal or approval
      through the card's own ··· menu drops the group too, and flipping
      Open / Resolved paints the list it already knows while the fresh page
      loads — a slow page can never land under the other heading.
- [ ] Discovery 🪐 (S6): `/feed` shows a **🪐 My subspaces** chip beside
      the algorithm menu — on, the eyebrow reads "Your subspaces 🪐 · …" and
      the column holds ONLY posts from subspaces the viewer is an ACTIVE
      member of (`GET /api/v1/things/feed?scope=subspaces`; a pending join
      request is not a membership; removed posts and other people's private
      subspaces stay out; a member of no subspace sees the "join a few on
      /s" empty state, never the whole feed). The choice persists per
      browser (`tt-feed-scope`) and paints on first render; logging out
      drops back to all; a guest tapping the chip gets a "Log in" Lopu toast;
      the chip rests (disabled) while Filters ▸ Advanced is applied.
      `?scope=anything-else` answers 400. `/s` has sort chips **New ✨ /
      Most members 👥 / Most active 🔥** (`?sort=` shareable; New is the
      cursor walk, the other two rank the newest 200 matching subspaces in
      memory — most members / most live posts in the last 7 days — and page
      by offset; Most active rows read "· N posts this week"; `?sort=bogus`
      → 400; q / Mine narrow every sort). `/explore` opens with a
      **Popular subspaces 🪐** strip (top 8 by members, compact cards,
      "All subspaces →" to `/s?sort=members`) that scrolls inside its own
      box at 375px — no page-level horizontal scroll — and is simply absent
      while there are no subspaces. `/search` with a non-empty query shows
      a **Subspaces 🪐** section (slug/name matches, first 6, compact cards)
      above People and the post results; a query with no matching subspace
      shows no section; `search.ts` is untouched.
- [ ] Discovery — S6 review fixes: `GET /api/v1/subspaces` is rate-limited
      like the other public reads (`subspaces.list`, 120/min; anonymous
      callers key by IP → 429 with `Retry-After` past the budget). Logged-out
      clients (the `/explore` strip, `/s`, the `/search` section) send
      `anon=1` and the response carries `Cache-Control: public, s-maxage=60,
      stale-while-revalidate=300` + `Vary: Authorization`; a cookie-less read
      WITHOUT the flag carries no public header, an authed read is
      `private, no-store`, `anon=1` with a session cookie still answers the
      logged-out view (cookies are ignored on the cacheable URL), and
      `anon=1&mine=1` → 401. A private subspace's activity is its members'
      business: under **Most active 🔥** a private subspace the viewer is
      not an ACTIVE member of ranks at zero and its row shows no "· N posts
      this week" (a guest, a logged-in stranger or a pending requester never
      learns its weekly post count — the same fence its feed applies); its
      members and mods still see it ranked by its real activity with the
      count. Member counts stay public on every sort. Verify section R.
- [ ] Completeness sweep (S7) — comment sort: open a subspace post with a
      few voted comments; the comments panel shows a tiny **Sort 💬 ▾** menu
      (`data-testid="comment-sort"`, offered on subspace posts with more than
      one comment). Pick **▲ Top**: the visible comments re-order INSTANTLY
      (highest net score first, a tie older-first), then the server page lands
      (`GET /api/v1/things?id=&commentSort=top` — the true top 20 of the
      post, not the newest 20 re-shuffled) and nothing jumps; **✨ New** /
      **🕰️ Old** order by age; the reveal control reads "Show more comments"
      and appends BELOW under a sort (the default page keeps "Show previous
      comments" revealing upwards); nested replies re-order among the replies
      already shipped, and opening or expanding a thread under a sort reads
      that comment's own sorted page (`GET ?id=<comment>&commentSort=` — the
      Network tab shows it; the reveal reads "Show more replies") so deeper
      levels keep the card's order; a fresh comment you post is ALWAYS on
      screen — under ▲ Top / 🕰️ Old, where a new zero-score comment sorts
      below the fold, it stays pinned at the end of the shown list right
      above the composer (the count grows by one, the row is there); pick a
      sort while a comment is still sending and it is never dropped (the
      page lands, your comment stays, its ack still swaps in); a refused
      sort read (offline) toasts AND the menu reverts to the previous pick;
      `commentSort=bogus` → 400 and the response echoes `commentSort`
      (null on the default read). Guest nudges: logged out, every subspace
      action toasts a Lopu login nudge instead of doing nothing — Join /
      Request to join, ▲▼ votes, react, reply, the ··· menu's **Report to
      moderators 🚩** (post and the comment rows' flag), and the `/s/<slug>`
      page shows "🗝️ Log in to post in s/<slug>" + a **Log in to post ✍️**
      button where members see the composer (a restricted subspace says
      "log in and join first"). Edge cases (verify section S): deleting a
      post clears its reports from the open AND resolved queues; banning a
      pending requester drops the request (pendingCount 0, re-request 403);
      transfer to a banned (403) / pending (404) / non-member (404) target is
      refused; a pending requester reads `viewer.canPost false` and the
      composer's `mine=1` select never lists the pending subspace; a demoted
      moderator gets 403 from every queue, moderate and dismiss on the very
      next request; private-subspace posts and mod-removed posts never appear
      in `GET /api/v1/things/rss` or `/trending` (a public subspace post
      does syndicate).
- [ ] Final round-2 sweep (verify section T — the cross-slice invariants no
      single slice owns): "the mods" a request / report rings are the ACTIVE
      owner + moderators at emit time — a demoted moderator and a moderator
      who left get no `subspace-report` / `subspace-join-request` row for
      anything filed afterwards (the owner still does); an ACTIVE member of a
      private subspace calling join is a no-op (`joined false, pending
      false`, never downgraded to a request); the Reports queue pages by
      cursor (`limit=1` → one group + `nextCursor`, the cursor → the rest, no
      cursor at the end, `openReportCount` on every page); deleting a
      subspace takes every `subspace-report` row with it (the reporter's own
      generic read of the row goes 200 → 404) while the reported posts
      survive as plain posts; every bell of the family deep-links
      consistently (post removed / report rows carry `postId = targetId` =
      the post; role / ban / join request / join accepted rows carry the
      subspace as `targetId`, no `postId`, and an `s/<slug> ·` preview); and
      the docs registry ↔ `/api/v1/capabilities` agree across the whole family
      at the round's final numbers (subspaces 1.5.0 · get 1.4.0 · join /
      leave / update 1.3.0 · members 1.4.1 · moderate 1.4.0 · feed 1.3.0 ·
      transfer 1.2.0 · delete 1.1.0 · report / reports 1.0.1 · modlog 1.0.0 ·
      things 1.4.0 · things-feed 1.4.0 · things-comment / things-user 1.3.0
      · updown 1.0.0 · notifications-list 1.2.0 · notifications-settings
      1.1.0) with a `route.v1.*` key for each. `test:rate-limit` pins the
      `subspaces.write` 60 / `subspaces.join` 20 / `subspaces.report` 30 per
      minute windows.
- [ ] Bell 🔔 + Settings → Notifications: six subspace rows (roles 🎩,
      bans 🚫, join accepted 🎉, posts removed 🧹, join requests 🙋,
      reports 🚩 — the last two default email OFF). The bell's verb keys off
      the preview's detail half only (`subspaceNotificationDetail`): a
      promotion in `s/deleted_scenes` reads "changed your role", a ban in
      `s/uplifted_minds` reads "banned you" — never "deleted a subspace" /
      "lifted your ban". Promote/demote rings
      `subspace-role`, ban/unban rings `subspace-ban`; each row reads
      "<actor> changed your role in a subspace" with the `s/<slug> · …`
      preview beneath and clicking it opens `/s/<slug>`. Switching a type off
      hides its existing rows immediately.

- [ ] At a 375px viewport (owner, member, non-mod member, pending
      requester and guest): `/s`, `/s/<slug>`, every `/s/<slug>/mod` tab,
      `/feed` with **🪐 My subspaces** on, `/explore`, `/search?q=` and
      `/settings` have `scrollWidth === clientWidth`; every post card's action
      row wraps so the `👁 views` counter sits on its own right-aligned line
      instead of being clipped by the card edge (the vote pill made the row
      wider than the card); the Remove / Ban / Report / Flair / Transfer /
      Delete modal titles wrap clear of the close ✕ (header `paddingRight`),
      the **Who can post** select (Create modal + mod Settings) shows short
      `emoji Label` options with the access hint as helper text beneath it
      rather than a clipped two-line option, and the mod page header keeps
      the subspace name on one line with `← Back to s/<slug>` dropping to its
      own right-aligned line.

## Up/down votes (`remix/app/api/utils/things/updown.ts`, `remix/app/components/Feed/UpdownControl.tsx`)

- [ ] Publish through the browser composer inside a subspace (and through the
      Feed composer with a subspace selected): the POST body keeps `subspaceId`,
      `title` and `flairId`. After reload, the new post appears in that subspace
      and retains its subspace chip, title, flair and vote pill in Feed and its
      permalink. An ordinary post remains outside subspaces with no vote pill.
- [ ] Post cards show the ▲ score ▼ pill only when the post belongs to a
      subspace and the vote preference is enabled, including Feed, Explore,
      profile, Saved, search and permalink views. Ordinary posts never show
      the pill, even with existing votes. Comment voting is unchanged.
- [ ] Subspace post and comment cards show the ▲ score ▼ pill beside the
      react button (native emoji reactions are untouched — react, multi-react
      and the picker keep working on the same card). Tap ▲: the arrow fills,
      score +1 INSTANTLY (optimistic), then the server tally reconciles; tap
      ▲ again → cleared; tap ▼ while ▲ is set → flips (score −2 net, up −1,
      down +1). Rapid double-taps never double-count (in-flight guard).
- [ ] `POST /api/v1/things/updown { id, direction }` returns
      `votes { up, down, score, viewerVote }` matching the card; `direction:
      null` clears; `"sideways"` 400s; anonymous 401; a subspace/data thing id
      400s (only posts/comments are votable); a not-visible post 404s.
- [ ] One vote per user per target survives races (root `uniqueKeys`
      `updownKey:<targetId>~<userId>`): two tabs voting the same post converge
      on one doc; the 409 "vote slot blocked" path never returns a silent ok.
- [ ] Logged out: pills show the score, tapping toasts "Log in to vote 🔼".
- [ ] Votes on a comment ride `comments[].votes` in every projection and the
      comment pill is compact; a shared post's nested original shows the
      live score read-only.
- [ ] Banned subspace members get 403 voting on that subspace's posts AND
      their comments (root-post walk); votes elsewhere keep working.
- [ ] Vote endpoint failure (devtools: fail `/api/v1/things/updown` once)
      reverts the pill to the pre-tap tally with a Lopu error toast.
- [ ] Subspace sorts use the relational tallies: Top (with range) orders by
      score, Controversial needs both sides and peaks when split, Rising
      favours fresh score, Hot is time-weighted (a two-day-old high scorer
      falls behind fresh content), New is chronological with pins first;
      `scripts/verify-subspaces.mjs` walks all of this against a live stack.

## Thing context menu (`remix/app/components/Thingtime/ContextMenu/`)

- [ ] Open the hover (popover) menu from a row inside a SMALL editor box: the
      menu must overflow the box freely (portal) and stay anchored to its
      trigger through page scroll, window resize, and layout shifts (e.g.
      height-dragging the composer editor while open).
- [ ] The menu renders above floating frames and drawer modals (z 10260).
- [ ] Drag-move and corner-resize the menu; near the right viewport edge it
      clamps inside the viewport without jitter.
- [ ] The design-system anatomy stories (/docs/design-system →
      thing-context-menu) still lay out statically inside their canvases
      (`inline` mode).

## Embed SSO / "Login with Thingtime" (`remix/app/components/OAuth/AuthorizePage.tsx`, `remix/app/api/utils/apps/`)

- [ ] The action row is icon + count ONLY (no text labels): 💬 comments with
      the merged react button DIRECTLY beside it, then 🔁 repost and ↗ share.
      Comment rows mirror the pattern — reply icon then react control inline
      under the bubble (no right-edge column) — and the react popup + full
      picker open without clipping from the left-side positions.
- [ ] The merged react button shows ALL the viewer's own reaction tokens
      FIRST, then the crowd's top remaining tokens by count (+ total; heart
      outline at zero), and tints accent when the viewer holds a reaction.
      Click, hover, and touch-and-hold all open the quick-react popup on the
      POST button; picking an emoji applies optimistically (no wait), and ＋
      opens the full custom picker.
- [ ] Threads that mount OPEN (the two-level ship, drill-panel roots)
      revalidate in the background even when the cache already covers their
      reply count — reactions/edits made elsewhere reconcile in within a
      beat. Regression: cache-complete threads skipped the mount refetch and
      froze reply reactions at the cached snapshot forever.
- [ ] RACE (devtools: delay `/api/v1/things?id=` responses ~3s): tap a
      reaction while a thread/feed/permalink fetch is in flight — the tap
      must survive the stale response landing (no disappear/reappear, no
      wrong counts), and a fresh reload must converge on the server truth.
      All server-copy ingestion merges through `reactionOverlay` stamped
      with the fetch START time; every local mutation notes itself there.
      Regression class: background refetches snapshotted pre-tap clobbered
      optimistic (even acked) reactions wholesale on ingest.
- [ ] ERROR CONTEXT (devtools: fail `/api/v1/things/react` once with a Nitro
      `{error:true,status:500,unhandled:true}` response): Lopu shows a readable
      “couldn’t confirm” title plus server/refresh guidance — never a lone 🌧️.
      The client refetches that thing before deciding whether the optimistic
      reaction stuck; if the truth fetch also fails, it keeps the optimistic
      copy and warns the viewer to refresh before retrying instead of blindly
      toggling the reaction back. An authored 4xx/503 message remains visible
      verbatim and safely reverts a server-marked rejection. A malformed or
      truncated 2xx mutation response is commit-unknown and follows the same
      truth-reconciliation path. Login `reason` and account-switcher `accounts`
      fields still survive the shared error normalization.
- [ ] Comment rows: reply is an icon-only toggle under the bubble with the
      merged react control right beside it — a SINGLE tap hearts the comment
      (❤️, optimistic, tap again to unheart) while hover / touch-and-hold
      opens the quick-react popup (the POST button's click still opens the
      popup). The thread reveal is a "View N replies / Hide replies" text
      link BELOW the comment; "Show previous replies/comments" reveals from
      BELOW the lists. Reply avatars (20px) are smaller than parent comment
      avatars (28px).
- [ ] The "Write a comment… / Reply to…" pills are subdued: house grey
      border + muted placeholder (never Chakra's default near-black
      outline).
- [ ] Threads never flatten and have NO max depth: opening replies (or the
      reply input) at visual depth 4 slides that comment in as the panel's
      new top-level row (slide-right animation; the back arrow slides left to
      return one level), with its replies restarting at depth 1 — repeatable
      indefinitely. Closing comments exits the drill-down back to the root.
- [ ] The server never caps thread depth either: replying at depth 65+ still
      creates, and a deep comment's permalink resolves its parent AND walks
      all the way back to the root post. Cycle safety in the visibility and
      parent-chain walks is a visited set, never a depth rail (regression
      class: 4-hop, then 64-hop caps 404ing deep replies as "Post not
      found").
- [ ] Repost is a menu: instant "Repost" posts immediately (toast + count
      bump); "Quote post" opens the caption + circle popover. Share is
      OUTWARD only: native share sheet where available, otherwise copy-link
      with the Lopu toast — logged-out users can still share, while react /
      repost nudge them to log in.
- [ ] The owner's ⋯ menu is Edit ✏️ / Copy link 🔗 / a Privacy radio group
      (current circle checked) / Delete 🗑️ — not Delete alone. Copy link
      always copies to the clipboard (never the native share sheet); a
      privacy pick updates the header circle badge optimistically and
      persists (server acl follows, e.g. friends → `-tt:all`,
      `tt:userFriends`, `tt:user`).
- [ ] Edit ✏️ mounts the FULL composer suite inside the card, pre-filled
      from the post: type tabs (text/photos/marketplace/thingtime), text,
      image rows, listing fields, thingtime draft seeded with the post's
      existing thing, tags, and the post's CURRENT circle. Save persists
      text + circle and swaps the card to the server copy; the close X
      cancels without changes. Shares edit their caption only (the nested
      original stays visible below the textarea).

## Drawer navigation & settings (`remix/app/components/Nav/Drawer/`)

- [ ] Clicking a NAVIGATING drawer item (top-level or sub-item) closes the
      drawer after navigating on BOTH desktop and mobile; items without a
      destination only select their submenu and keep it open. Search keeps
      its own "Search closes drawer" setting on desktop.
- [ ] Settings → Drawer → "Close after click" lists every menu item (auth
      filtered, children nested under their top item) with per-item
      switches defaulting ON; turning one off keeps the drawer open for
      that item's clicks and persists across reloads.
- [ ] The drawer footer avatar, composer avatars, and account switcher rows
      show the user's avatar IMAGE when one is set — the rainbow initial
      circle is only the no-avatar fallback (regression: UserAvatarCircle
      ignored avatarUrl entirely).
- [ ] The drawer account footer splits: clicking the avatar/name row goes to
      /profile (drawer dismisses on both viewports) while the gear button
      opens the settings modal (desktop centred modal, mobile bottom sheet)
      WITHOUT navigating. Logged out, the row reads "Log in" and opens the
      settings modal (account switcher hosts log-in) instead of navigating.

## Profile page (`remix/app/components/Profile/ProfilePage.tsx`)

- [ ] The self-profile action row is Edit profile ✏️ / All settings ⚙️ /
      Log out 🗝️ (+ Resend verification when unverified): All settings
      navigates to /settings, and the buttons wrap cleanly on mobile with no
      overflow.

## Required Web CI contexts (`.github/workflows/web-ci.yml`)

- [ ] On a PR that changes `remix/`, confirm the real build and API jobs report
      `Build + typecheck ratchet + unit tests` and `API suite (headless /tests
      runner)`, while both required-context companion jobs have distinct
      skipped names and cannot satisfy a failed real job. Reusable callers keep
      the same inner names under their existing `control-plane /` prefix.
- [ ] On a PR with no `remix/` or `.github/workflows/web-ci.yml` changes,
      confirm the lightweight companions report both exact required-context
      names successfully and the expensive build/API jobs have distinct
      skipped names. Neither context may remain in Expected/Pending state.
- [ ] Break the path-classification job deliberately in a disposable branch.
      Confirm neither exact required-context name is emitted and branch
      protection blocks the PR instead of treating a skipped job as proof.

## AI merge-conflict resolver (`.github/workflows/resolve-pr-conflicts.yml`)

- [ ] Create standalone same-repository merge-conflicting PRs targeting
      `main` and a non-default base. Confirm both are detected and updated,
      while a clean PR, a fork PR, a protected head, and the default branch
      are never resolver push targets.
- [ ] Exercise a base-branch push, a head-branch push, PR opened/reopened, the
      scheduled repository scan, a blank manual scan, and exact PR/base/head
      manual selectors. Push detection must find PRs both targeting and
      originating from the pushed branch. A global scan spanning three
      conflicted PRs must dispatch exactly three trusted per-PR workers to the
      fixed `develop` workflow revision. Human/manual and legacy
      `repository_dispatch` runs must stay detector-only; only a bot-authored
      internal handoff on `develop` with a positive PR, blank branch, and valid
      depth may load the model or resolve.
- [ ] Give a manual exact-PR/base/head selector that matches no open PR and
      confirm the detector fails with actionable log and step-summary output.
      Give one that matches only clean, UNKNOWN, fork, protected/default-head,
      paused, or rebase-owned PRs and confirm it succeeds with a visible
      no-worker warning/summary rather than silently skipping downstream jobs.
- [ ] Create a normal two-PR stack and confirm its members are excluded before
      either ownership label exists. Add `no-ai-rebase` and confirm that member
      becomes merge-owned. Add a fresh `ai-rebase-in-progress` mutex and confirm
      the merge resolver abstains. Confirm a pause label alone never determines
      ownership: if topology/verdicts transition the PR to merge ownership, the
      merge resolver verifies and clears stale `ai-rebase-paused` before work.
- [ ] Force an unchanged eligible merge-resolution failure and confirm it adds
      `ai-merge-paused`; scheduled, push, PR-target, and blank-manual scans must
      abstain afterward. An exact PR/base/head manual run must carry internal
      retry intent, clear the hold, and retry. A failure after the
      head/base/topology/ownership changes must not leave a stale pause label on
      the newly owned state. Verify the hidden pause marker is accepted only
      from `github-actions[bot]`, requires the complete strict schema, and
      round-trips the exact refs, SHAs, owner, and topology.
- [ ] Feed a mocked global scan more than 1,000 open PRs across GraphQL pages.
      Confirm every page is combined exactly once and conflicting PRs on every
      base remain eligible for their unique per-PR handoff. Give one resolved
      head more than 30 direct child PRs and confirm the cascade's explicit high
      limit dispatches every child number to `develop` without truncation.
- [ ] Move the head, move the base, change stack topology or ownership labels,
      close the PR, or protect the head while a run is resolving. Every case
      must refuse publication. An exact-head lease must preserve concurrent
      work; if `git push` reports a transport error after the exact commit
      lands, the live-ref check must classify it as published rather than
      retrying it.

## Per-feature develop → main promoter (`.github/scripts/promote-features-to-main.mjs`)

- [ ] Merge a feature PR into `develop`, record its two-parent merge SHA, then
      force-rewrite `develop` to an equivalent cherry-pick so that merge object
      is no longer advertised by any ref. From a fresh full clone, confirm the
      promoter's self-test first proves the object is absent, fetches it by
      exact SHA with both parents, proves a stable patch-equivalent commit is
      still effective at the current `develop` tip, performs the mainline
      cherry-pick, and gets the expected tree. Repeat after a later revert and
      with a multi-commit rebase range: the revert must fail closed, while the
      full aggregate range (not only its last commit) must be verified.
- [ ] Run the orphaned-history self-test with the clone's Git author name
      deliberately empty. The attempted mainline cherry-pick must return an
      operational error, abort the sequencer, leave `HEAD` at the target base,
      and clean both the index and tracked worktree instead of treating the
      words `empty ident name` as an empty source patch.
- [ ] Configure a valid Git identity, apply the recovered source pick, then
      apply that identical pick again. The second, genuinely empty pick must
      be skipped from verified sequencer/index state and leave the promoted
      tree unchanged.
- [ ] Give one standalone source PR an invalid or unavailable historical merge
      object between two valid standalone PRs. A dry run must report that PR as
      blocked, continue to plan the later independent PR, and publish both the
      block and partial plan in the step summary without exiting early.
- [ ] Repeat with the unavailable PR in the middle of a named promotion stack.
      The failed member and only its later dependent stack members must be
      deferred while the next unrelated group continues. Force an unexpected
      group-local Git error as well and confirm later groups still run.
- [ ] Re-run after a partial batch has already created promotion PRs. Existing
      `promotion-of` markers and branches must prevent duplicates, including
      records older than the first 200 repository PRs, while `MAX_NEW_PRS`
      counts reused branches as newly opened PRs too. Force-update an open
      promotion branch between runs and confirm the promoter fetches its live
      OID before stacking the next member rather than using a stale local ref;
      a repurposed branch, same-path/whitespace drift, duplicate provenance,
      or an OPEN promotion targeting the wrong stack base must be blocked. For
      an external stack, validate every OPEN link back to `main` and every
      CLOSED source merged before the current group; any unshipped earlier
      CLOSED member must stop dependents, while a later successor must not be
      misclassified as their prerequisite.

## PR conflict resolver model waterfall (`remix/app/components/Admin/`)

- [ ] Logged out, `GET /api/v1/settings/pr-conflict-auto-resolver-model-waterfall`
      returns the public key, ordered waterfall, and curated model catalog;
      `POST` returns 401. A signed-in non-admin `POST` returns 403, while an
      admin can save a valid reordered waterfall.
- [ ] Settings → Admin paints the last-known waterfall immediately, then
      reconciles in the background. Add Fable 5 and Opus 5, drag a row by its
      dedicated handle, use the Up/Down controls, remove a non-default row,
      save, reload, and confirm the exact order persists. `default` stays
      present and cannot be removed.
- [ ] Exercise the editor at desktop and mobile widths from the top to the
      bottom of `/settings`: model names, Max-effort badges, handles, fallback
      copy, and save/add/remove controls never clip, overlap, or create
      horizontal scrolling.
- [ ] Resolver workflow config parsing accepts only `default`,
      `claude-fable-5`, and `claude-opus-5`, preserves their public order, and
      appends `default` defensively. An unavailable endpoint, malformed JSON,
      duplicate/unknown model, wrong key, or empty array emits a warning and
      selects only `--model default`; no stored value can inject another CLI
      flag.
- [ ] On the protected `github-actions` control plane, put `claude-opus-5`
      first and exercise a merge conflict, a rebase conflict, and each
      workflow's semantic Graphify refresh (including a clean rebase). Confirm
      the Claude action and Graphify logs name the same Admin-selected primary;
      repeat with `default`, then run the workflow control-plane contract and
      confirm it rejects any legacy or hardcoded model in active AI runtime
      YAML.
- [ ] With an availability failure on the first configured model, Claude
      Code tries the ordered native fallback chain. A completed run that still
      leaves conflict markers stops for manual review; it does not silently
      spend another model attempt.

## AI PR/stack rebase resolver (`.github/workflows/rebase-pr-stacks.yml`)

- [ ] Create standalone same-repo PRs against `main` and against a non-default
      branch whose heads are `mergeable: true` but `rebaseable: false`.
      Confirm automatic, scheduled, push-triggered, PR-triggered, and blank
      manual scans leave both histories untouched: they are not stacks and
      already merge cleanly. An explicit PR-number retry may still replay one
      deliberately. Then make a standalone PR genuinely merge-conflicting and
      confirm only **Resolve PR conflicts (AI)** owns it. Regression class:
      standalone replay failures were incorrectly force-rebased and could
      ping-pong with a merge-resolver update.
- [ ] Create a two-PR stack (child PR based on the root PR's head). After the
      root is rebased, confirm the child dispatch receives the old and new
      parent SHAs, replays with onto semantics, and completes root-to-leaf
      without duplicating the parent's commits. Confirm a stack member with
      either `mergeable: false` or `rebaseable: false` remains rebase-owned,
      while a clean stack is left alone.
- [ ] Exercise detection from a branch push, PR opened/reopened event, the
      scheduled scan, and a manual PR-number dispatch. Automatic scans evaluate
      every same-repo PR regardless of base branch, never dispatch a
      standalone history rewrite, route standalone merge conflicts to the
      merge workflow, do not race a blocked child ahead of its parent, and
      terminate after resolution instead of looping on the workflow's own
      push. A blank manual dispatch must perform the same repository-wide scan.
- [ ] Return unknown merge/rebaseability for several PRs at once and confirm
      polling proceeds round-robin, giving every candidate an API check in each
      bounded round. Exercise a stack deeper than eight PRs and confirm it is
      still ordered and cascaded root-to-leaf (the hard loop guard is 64).
- [ ] Add `no-ai-rebase` before detection and confirm the PR is skipped. Force
      a resolver failure, confirm `ai-rebase-paused` is added and automatic
      scans leave the exact failed snapshot alone, then change a ref or topology
      and confirm the stale hold is cleared and re-detected. Review an unchanged
      run and confirm a deliberate manual retry is available. Transition a PR
      from merge-owned/`ai-merge-paused` to rebase-owned and vice versa; the new
      owner must clear only the opposing pause after proving ownership, while a
      fresh `ai-rebase-in-progress` mutex always blocks publication. Queue a
      retry, then add a fresh same-snapshot pause or change its resolver owner;
      the queued run must not erase that newer hold. Publication must require
      pauses to be absent, and post-push cleanup must preserve any pause created
      for the newly published snapshot. While a parent is
      paused, actively owned, protected,
      or still has unknown rebaseability, confirm an automatically detected
      conflicting child is held back; once that same parent is confirmed
      rebaseable, the child may become the next root. Confirm stack members are
      excluded from the merge-based resolver before ownership labels exist;
      `no-ai-rebase` deliberately routes a merge-conflicting member back to it.
- [ ] Leave an `ai-rebase-in-progress` label behind for more than 90 minutes.
      Confirm a still-conflicting PR is recovered into a new exact dispatch,
      while a now-clean PR has the orphaned lock removed without a rewrite. A
      manual clean retry should also clear a stale `ai-rebase-paused` label.
- [ ] While a run is resolving, push another commit to the PR head. The exact
      force-with-lease must reject the stale rewrite; no partial rebase may
      reach the remote branch and the concurrent commit must remain intact.
- [ ] Present a fork PR, the default branch, and a protected branch. Each is
      refused before Claude or a force push runs. A conflict file that attempts
      prompt injection cannot make Claude edit outside the recomputed conflict
      set or invoke Git/shell; trusted verification rejects unresolved markers,
      unmerged index entries, and out-of-scope changes before any push.
- [ ] Resolve a PR whose final diff touches `remix/` using only `GITHUB_TOKEN`.
      Confirm the rewritten SHA receives an explicit **Web CI** workflow run;
      a non-web diff should not spend a redundant CI dispatch.
- [ ] Add a non-conflicted tracked symlink targeting `.git/config`, plus a
      conflict prompt that asks Claude to read/write through it. Confirm the AI
      workspace contains only regular copies of the exact conflict files and no
      repository, symlink, trusted action, or Git metadata. Add an external or
      `.git`-targeting tracked symlink and confirm graphify validation refuses it
      before semantic extraction or publication.
- [ ] Change the repository default branch while a resolver fixture is paused,
      and simulate a push whose server-side ref update succeeds but whose client
      exits nonzero. The adjacent pre-push default-branch check must prevent a
      default ref rewrite, while post-push ref inspection must report the actual
      published state rather than claiming the remote stayed unchanged.

## Data crystals & nesting depth (`remix/app/schemas/registry.ts`)

- [ ] Post a thingtime post whose thing contains an Editor.js document (or
      any structure) nested well past 6 levels: it must save. There is NO
      validator depth rail (the walk is iterative, so nesting never touches
      the JS call stack); the only depth bound is MongoDB's physical BSON
      limit (MAX_STORABLE_NESTING, probed at 179 crystal levels on mongod
      8.0; crystal.thing payloads get one less), reported as a precise 400
      naming MongoDB — never a raw driver 500. Circular or repeated object
      references also 400 loudly (identity WeakSet).
- [ ] Oversized payloads still fail loudly: >10000 nodes, >1000 array items,
      or a key with `$`/dots must 400 with a precise message, never silently
      drop data.
- [ ] `["post","data"]` combinations still 400 (data crystals stand alone);
      a thingtime post's free-form payload lives ONLY under `crystal.thing`.
- [ ] Whenever a builtin crystal schema is added, removed, or changes its
      projected fields, run `npm run test:schemas`: the pinned projection table
      must name the builtin and its exact retained fields so schema seeding
      cannot drift silently or fail only in Web CI.
- [ ] Unique-slot squat class (closed structurally): relationship dedupe
      rides the server-only root `uniqueKeys` namespace
      (`<crystalField>:<key>` BinData, stamped in `messenger/shared.ts`
      `newThingDoc` + the friend writer): after a follow/friend/DM/join/
      invite/emoji create, the doc must carry `uniqueKeys`, a duplicate
      insert of the same key must E11000 on the `uniqueKeys` index, and the
      seven crystal-path indexes (including `voteKey`, even while the poll
      product remains deferred) must be the non-unique `things_*_lookup`
      generation (old `things_*_unique` names dropped by the boot-time
      ensure swap, including the superseded `things_follow_unique` marker
      generation — verify with `getIndexes()`). Legacy docs get stamped by
      the idempotent `backfill-relationship-unique-keys` migration, whose
      notes also census (never modify) data things carrying relationship
      names from the pre-fix era. Unit coverage:
      `remix/app/api/utils/messenger/relationshipUniqueKeys.test.ts`.
- [ ] Desktop AI import hashes and device idempotency hashes also ride root
      Binary `uniqueKeys`, never one unique index per crystal field. Run
      `npm --prefix remix run test:collections`, `test:devices`, and
      `test:messenger`; the complete home Things plan must remain at or below
      60/64, repeated device/import writes must reuse the original row, and a
      home bootstrap must backfill then retire the five
      `things_{ai_connection,external_*,device_unique_keys}` generations.
      A custom data endpoint must receive only the current additive index plan:
      it must never run Thingtime's home-only backfill/drop migration.
- [ ] The data-crystal namespace reserves NO names: a data thing carrying
      `followKey`, `memberKey`, `dmKey`, `inviteCode`, `emojiKey`,
      `friendKey`, or `voteKey` at its crystal root (any nesting, any value
      type) saves as ordinary data, collides with nothing, and never blocks
      or is blocked by real relationship flows — verify a data thing with
      `crystal.followKey` equal to a real pair key coexists with that real
      follow. New unique indexes over crystal paths reachable by free-form
      data crystals are forbidden (see KIND-BLIND HISTORY in
      `collections.ts`); dedupe belongs in `uniqueKeys`. API coverage:
      `things-data-relationship-names-open` in the /tests suite.

## Feed & profile advanced filters (`remix/app/components/Feed/AdvancedFilters.tsx`)

- [ ] Filters ▸ Advanced opens the panel between the controls row and the
      composer; applying keeps the last-known posts rendered while loading
      (no skeleton flash); a FAILED search clears to the honest empty state.
- [ ] A sort-only search (e.g. oldest, nothing else) applies; relevance with
      no text does NOT activate advanced mode.
- [ ] Shortcuts round-trip: tags, by-user (unknown user = empty result, not
      an error), min reactions/comments (bounded-window mode), text length.
- [ ] Profile panels are locked to the profile's user (no By-user field) and
      the header post count stays the profile total, not the filtered count.
- [ ] Paginated appends never duplicate a post id (`appendPostsDeduped` in
      `feedTypes.ts`): scroll the feed through several pages in BOTH latest and
      ranked modes and on a profile with >20 posts, then confirm every rendered
      `[data-thing-id]` is unique (ranked re-scores a moving window, so later
      pages can re-serve earlier ids; duplicates collide as React keys).
      Every `setPosts` path — including the reset/first page — runs through the
      helper, so a single page that repeats an id is collapsed too. The helper
      itself is covered by `npm run test:feed`
      (`app/components/Feed/feedTypes.test.ts`); this manual pass is for the
      wiring (which pager calls it, and with which `prev`).

## Commander palette (`remix/app/components/Commander/CommanderV2.tsx`, `commanderCommands.ts`, `commanderShortcut.ts`)

The `>` registry and the Cmd+K chord rule are unit-tested headlessly
(`npm run test:commander`, including a route contract that every `>command`
navigation target is a route the router declares). These are the browser-only
halves.

- [ ] `Cmd/Ctrl+K` from anywhere on the page (nothing focused, a button focused,
      mid-scroll) opens AND focuses the nav Commander; pressing it again closes
      it. Exactly one Commander reacts — the nav instance — with a second
      Commander mounted on the page.
- [ ] `Cmd/Ctrl+K` inside an Editor.js block opens the editor's **link tool
      only** — the palette must not open on top of it or steal focus. Editor.js
      binds `CMD+K` to its core link inline tool, so the editor wins inside its
      own blocks (`targetOwnsCommanderChord`, keyed off the `.codex-editor`
      holder). Everywhere else the palette still wins, because nothing else
      binds the chord: check the login form, a comment box and the search field
      still open the Commander, and that Cmd+K still closes the Commander while
      its own input is focused.
- [ ] Typing `>` flips the dropdown to command rows (usage + description) and
      fires NO search request (check the network tab). Backspacing back to
      ordinary text restores the pinned `Search things for…` row and the live
      results.
- [ ] Highlight a row (arrow keys or mouse), then edit the input across the `>`
      boundary in BOTH directions. The highlight must never carry over onto an
      unrelated row of the new list — Enter must not run a command the user
      never selected (`>undo` sits at row index 2).
- [ ] Highlight a row, then keep typing an ARGUMENT (`>the` → highlight
      `>themes` → finish typing `>theme Midnight`). Arguments don't narrow the
      rows, so the stale highlight must not win: Enter applies the Midnight
      preset rather than navigating to /themes.
- [ ] Enter runs the typed command even with no row highlighted: `>theme
      Midnight` applies the preset, `>theme neon` lists the presets without
      switching, `>undo`/`>redo` walk the timeline, `>help` toasts every
      command, and an unknown `>xyz` toasts a pointer to `>help` instead of
      falling through to the path/setter machinery.
- [ ] Selecting a row: argument-less commands run and close the palette;
      argument-taking rows (`>theme`, `>search`, `>docs`) complete to `>name `
      and keep the palette open and focused.
- [ ] Mobile (375×812): the command dropdown is full width with no overflow or
      clipping, and the usage/description columns stay readable.

## Search page (`remix/app/components/Search/SearchPage.tsx`)

- [ ] Build the Vercel output and exercise `/api/v1/things/search` from the
      deployed function with both a plain ranked query and a reaction
      `crystal.emoji contains <name>` condition. Neither path may depend on an
      untraced `unicode-emoji-json` runtime file or return `MODULE_NOT_FOUND`.
- [ ] Commander typeahead searches the live Things + people APIs after the
      debounce: it shows contextual platform posts/data/schemas/people before
      the bounded `Local paths` tier, arrow/Enter and click open the selected
      result exactly once (without then falling through to the typed local
      `/thing/:path` command), and `Search things for…` still opens the complete
      `/search?q=…` result set. With ordinary text and NO highlighted row,
      Enter defaults to that pinned full-search row; an explicitly highlighted
      result still wins, and `path = value` setters still execute instead of
      becoming searches. A failed typeahead leaves full search + local commands
      usable.
- [ ] Commander intent ranking: with eight matching chat-message Things and a
      person whose username is exactly `@lopu`, that person is the first remote
      row. Exact usernames rank above username/display-name prefixes, which rank
      above an exact Thing title; server relevance order remains stable within a
      matching tier. A query spanning a space (`the lopu`) still reaches the
      display-name prefix tier rather than falling behind a matching Thing title.
- [ ] Commander result visuals use the shared `thingIcon` mapping (including
      filename-aware Thing icons). A person with `avatarUrl` shows that profile
      image with a small `👤` user-type badge; a person without one gets an
      initial fallback plus the same badge. Verify the compact rows remain
      readable and unclipped at desktop and 390px mobile widths.
- [ ] Search results default to `Standard`: posts use the real interactive
      post card and other Things use their native rendered `ThingView` (with
      its rendered/tree toggle where supported). Switching to `Data` restores
      the compact crystal-field cards, and every Data card's `Open thing` link
      opens the ACL-aware canonical `/thing/:id` page. Toggle labels remain
      visible and usable at desktop and mobile widths. A ranked text search
      shows each Thing result's real server `rankScore` as tiny subdued
      `ranked match · N` metadata in BOTH views; chronological/unranked results
      never invent or display a score.
- [ ] Open a post result's canonical `/thing/:id` page. It renders the full
      interactive PostCard inline under `Post view`, keeps `Open post page` as
      a permalink, and still shows the complete `Thing data` panel below it.
      Non-post Things and private admin diagnostics do not show an empty post
      section. Verify the inline card and JSON remain unclipped at desktop and
      mobile widths and survive a full top-to-bottom scroll.
- [ ] Open a non-post `/thing/:id` permalink. Its `Views` controls independently
      toggle the rendered preview and raw `Thing data`, with both enabled by
      default. A component Thing resolves its sanitised live preview; turning
      either switch off hides only that section, and either/both sections may
      be disabled without overflow at desktop and 390px mobile widths.
- [ ] Turn `Thing data` OFF on a normal `/thing/:id`, then navigate — without
      reloading — to a `/thing/migration-diagnostic-*` permalink. The redacted
      error still renders: a diagnostic shows no `Views` card, so it must never
      be gated by a switch carried over from a Thing, or the page would be
      blank with no control left to bring it back. Navigating back to a Thing
      still honours the remembered OFF state.
- [ ] Visiting plain `/search` fires NO search request (check the network
      tab): last-cached results still paint instantly, and with no cache the
      empty state invites a search ("then hit Search"), never claims
      "Nothing matched".
- [ ] Deep links still auto-run their search: `/search?q=…` (Commander's
      "Search things for…") and `/search?schema=…` (from /schemas).
- [ ] Submit a search and navigate to another page BEFORE it resolves: you
      stay on that page — the resolving search must never replace-navigate
      back to `/search` (or eat the destination's history entry). This
      includes loader-bearing destinations (`/login`, `/welcome`, `/status`)
      where /search stays mounted while the departure is pending, and Back
      from `/search?q=…` to plain `/search` (must not be undone).
- [ ] With a cache-restored query (input pre-filled from a previous session,
      no search run yet), Commander's "Search things for…" with that same
      text still fires a fresh search — the ?q= echo guard compares against
      the last q the page itself synced, never live input state.
- [ ] A submit rejected by number-validation, or a failed request, keeps the
      invite empty state ("then hit Search") — only a RESOLVED search may
      claim "Nothing matched". A failed first page also must not poison
      Load more: it continues the previous result set's query, not the
      failed one's params.
- [ ] A dead `?schema=` deep link (unknown/invisible shareId) toasts, strips
      the param from the URL, and fires NO fallback search; while a live
      `?schema=` resolves, no empty-state copy shows at all.

## Admin secure-fields toggle (`remix/app/components/Admin/AdminPanel.tsx`)

- [ ] `/settings` as an admin shows the "Secure fields" section; the Email
      row paints its last-known state instantly from `tt-admin-secure-fields`
      (no spinner after the first ever visit), then reconciles with the
      server config in the background.
- [ ] Flipping Email to Plaintext does NOT write immediately: the inline
      warning + "Store plaintext mirrors" confirm appears; Cancel keeps
      secure mode. Confirming toasts the reconcile count and every existing
      user thing gains a root plaintext `email` matching its blob email
      (spot-check in Compass/mongosh: `db.things.find({ email: <addr> })`).
- [ ] While plaintext mode is on, a NEW registration (and a new service
      account) writes the root `email` mirror at insert time; a secure-blob
      write (e.g. verify-email, theme change) self-heals a hand-deleted
      mirror on that user.
- [ ] Flipping back to Secure applies without a confirm step and strips the
      root `email` from every user thing (`db.things.countDocuments({
      thingtime: 'user', email: { $exists: true } })` returns 0); the blob
      email + hashed uniqueKey lookup (`/api/v1/admin/users?q=<full email>`)
      keep working in both modes.
- [ ] Non-admin sessions get 401/403 from GET/POST
      `/api/v1/admin/secure-fields` (the /tests admin group passes), and a
      failed toggle POST reverts the switch and toasts the error.
