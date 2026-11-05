# Account drafts and post templates

Drafts are protected, owner-private `draft` Things in the home collection.
`draftMode` distinguishes working drafts from reusable templates. They consume
normal account storage and are excluded from generic Thing CRUD, feed and search.

## Entry points

- `remix/app/drafts/`: bounded transport, serialized revision queue, account/editor
  recovery hook, post snapshot conversion, Thing event adapter and shared picker.
- `remix/app/api/utils/drafts/`: transactional writes, copies, owner projections
  and durable media binding. File children stay in the attachment lifecycle.
- `remix/app/routes/api/v1/drafts/_drafts.tsx`: full user sessions only, expected
  actor checks, fail-closed rate limits and private/no-store responses.
- PostComposer loads drafts and templates; PostThingMenu saves visible posts as
  templates. Plain comments use the same protocol. Definition, schema and Thing
  editors preserve their editing state without publishing it.

## Contracts

`GET /api/v1/drafts` lists bounded summaries; `?id=` loads one. Optional surface,
context and cursor scope lists. POST operations: `save`, `delete`, `from-post`,
`instantiate`, `recover`. Saves use an expected revision plus immutable write id. Retries
reconcile the exact old operation before sending newer edits. Conflicts preserve
local text and offer a new draft with independent media copies. Deletion leaves a quota-accounted empty tombstone
so delayed writes cannot resurrect it. Device retirement records retry cleanup.

Snapshots preserve raw editing values (512 KiB, bounded JSON depth and file IDs).
Capture writes a synchronous local recovery copy, then syncs after 250ms idle or
at most one second of continuous edits. Post/comment submission captures the live
editor and immutable submission identity locally, then starts remote draft sync
without awaiting it. Draft save failures never prevent posting. After confirmed
posting, retirement detaches the old draft immediately; cleanup waits only in the
background for an already-started save. Old completions cannot restore the posted
draft or overwrite the next composer. Revision conflicts preserve newer remote
work. Other editors retain their existing flush-before-navigation contracts.
Transient failures retry with backoff. Device recovery retains the same post
retry identity when storage is available; remote draft availability is not a
posting prerequisite.
Account, origin, editor target and old-editor callback guards prevent cross-talk.
The picker preference controls automatic account resume; device recovery remains
on. Account changes also scope the local Thing workspace and BroadcastChannel.
Anonymous and account workspaces remain separate. Signing in never copies or
uploads anonymous content; moving it requires an explicit portable export/import.

Definition snapshots retain the original `baseUpdatedAt`. Restoring a draft
against a newer saved definition (or restoring a legacy draft without a known
base) preserves its text and blocks publication. Selecting the latest saved
version first retains the recovered source in Timeline, then retires the account
draft. A failed Timeline backup leaves the account draft intact.

Schema form snapshots use version 2 and retain JSON fields as raw text, including
incomplete syntax and whitespace. Schema-aware conversion parses those fields
only for validation/publication; legacy snapshots with parsed JSON are converted
on restore. JSON values inside objects and array items retain their positions.

Template creation and use both copy through the canonical attachment service,
including upload approval, authorization, moderation, quota and cleanup. Only
working drafts can donate media to published posts. Templates keep independent
bytes; URLs remain linked URLs. Clearing a draft releases its remaining media
back to the normal expiry/reaper lifecycle, preserving files already published.

## Verification

`test:drafts`, `test:autosave`, `test:feed`, `test:editorjs`, `test:schemas`,
`test:attachments`, `test:api-capabilities`; real API
`verify-account-drafts.mjs <ignored local fixture.json> --media` and the
[account draft checklist](../../TESTING.md#account-drafts-and-reusable-post-templates).


## Anonymous workspace drafts

`local-workspace/drafts.ts` implements the same protocol over scoped IndexedDB.
`things.ts` owns post/file commits and `posts.ts` reuses canonical post request
mapping and native projections. The attachment queue stores local bytes before
reporting ready; template/recovery copies atomically duplicate them and remap
snapshot references. Draft deletion releases only draft-bound files. Post saving
has no draft-save prerequisite. `DraftPicker` labels device-only storage explicitly.
Run `test:local-workspace` alongside the account suites above; the local composer
manual checklist covers offline edit previews, template independence and reload.

Post/comment URL selections now use the same scoped draft protocol. Metadata-only
`LocalLinkedAttachment` rows have draft binding and expiry without a Blob/hash.
Template/recovery copies assign independent local and account request IDs and
remap snapshot references; working drafts donate links to posts without awaiting
remote draft writes. Account drafts wait for canonical link receipts through the
existing file journal. Known registered URL drafts refresh with exact owner and
target checks, without fetching a byte descriptor; first-seen server-only links
still require their complete online transfer adapter. `linkedDrafts.test.ts`,
`accountLinkedAttachments.test.ts` and `linkedApi.test.ts` cover copies, retries,
quota/identity/abort refusal and capability negotiation. Four native linked
scenarios remain pending the final isolated package run; see the
[focused evidence](../../artifacts/anonymous-local-first-2026-10-23/linked-media/README.md).
Account draft permissions and upload admission are unchanged.


## Account local queue and native editor adapter

`local-workspace/accountDrafts.ts` wraps the same `LocalDrafts` store with atomic
queue admission. Editor revisions remain independent from acknowledged server
revisions. Unsent saves coalesce; uncertain writes retain their immutable body
and write ID across reloads, newer edits and retirement. Cross-tab claims and
scope leases fence completion. Conflicts preserve both versions for review.

`AccountFileSync.draftHooks` resolves confirmed upload receipts, checks retained
access in the copy transaction and registers independent template/copy uploads.
`retainDraft` uses the existing owned-file descriptor and atomically commits all
originals with the complete draft snapshot. Draft media stays out of the ordinary
file library. Canonical read refusals remain effective after local release.

`accountDraftClient.client.ts` now routes native account draft requests through
that scoped store. `accountDraftCatalog.ts` retains bounded summary pages without
fetching draft bodies or files; exact reads retain complete snapshots and originals.
The worker drains drafts independently of content, files and interactions. The
shared picker and recovery hook capture the current account/origin/data-plane
lease; the sync panel exposes retries and reviewed conflict choices.

`accountThingTransport.drafts` negotiates `api.drafts` 1.1.0 and sends expected
account/data-plane preconditions. Draft storage remains home-pinned. New templates
can be created explicitly; existing templates accept exact retries but cannot be
edited in place. Account-only/shared post copying retains the canonical server
copy path; locally complete posts use independent local copies.

Service checks include `accountDraftClient.test.ts`, `accountDraftCatalog.test.ts`,
`accountDrafts.test.ts` and `accountDraftFiles.test.ts`. Opt-in
`accountDraftSync.browser.test.ts` proves cold offline text recovery, bounded
1440/390/320px picker layout, private reconnect, posting despite draft-endpoint
503s and subsequent cleanup. `accountBoundMedia.browser.test.ts` verifies native
post/reply byte persistence, private reconnect and deletion replay.

Integration remains in progress: earlier device recovery keys need explicit safe
migration/recovery; released-upload cleanup, template/media donation races and
native conflict review need complete acceptance. The full local-first merge gate
in `docs/local-workspaces.md` remains open.

The draft queue has its own `syncPump` scheduler. A held draft request cannot
hold the content worker's next pass; upload completion wakes drafts when their
originals become ready. The native draft test holds the draft POST unresolved
and requires the private post to reach the real account within eight seconds,
before releasing that draft request. This tests normal completion independently
of the draft transport timeout, in addition to rejection/retirement handling.


## Generic Thing editor recovery

`thingDraftWorkspace.ts` connects the native Thing event adapter to the existing
local draft protocol with a captured workspace lease. It shares the recovery-key
helper with `useAccountDraft`; late saves, loads and callbacks cannot adopt a new
account, origin, data plane or generation. Normal same-workspace navigation still
drains the final edit and acknowledges its original recovery key.

Generic route views and non-embedded editor windows resume their validated scoped
recovery copy once after the tree hydrates. This closes the gap where a draft was
saved but the separately debounced whole-tree snapshot reopened older text.
Recovery uses the canonical Thingtime codec, retains cycles and Dates, and does
not emit another authored edit or broadcast. Corrupt recovery remains untouched
with a visible paused-saving error. Embedded/foreign previews do not resume into
the user tree. Earlier unscoped recovery keys are deliberately not auto-assigned;
the explicit legacy recovery work remains open.

Run `thingDraftWorkspace.test.ts` and the opt-in
`thingDraftWorkspace.browser.test.ts` (`TT_LOCAL_THING_DRAFTS_URL` must be a
loopback production-client server, with the shared Playwright/Chrome paths).
The native browser fixture creates a text Thing through its normal type menu,
saves/loads through the picker, reloads offline after a later edit, checks the
picker at 1440/390/320px, and verifies corrupt recovery is retained. Native
account/origin/data-plane switches across every editor remain a wider acceptance
gate; a service-level retired-lease test does not establish that entire matrix.


## Plain comment recovery

`hooks/useCommentDraft.ts` uses `useWorkspaceDraft` with a captured eligible actor,
workspace generation and target. `plainCommentDraft.ts` validates/reviews earlier
text-only device copies; `PlainCommentDraftTools.tsx` exposes source review and
append without replacing current text or adopting old operation IDs. Both native
PostCard comment/reply fields share this flow. Earlier keys are retained after
posting. Rich/media recovery stays in its original editor. Run the plain-comment
unit/browser fixtures, workspace/draft/feed suites and anonymous discussion
regression. Setup and remaining gates: [local workspaces](../local-workspaces.md#plain-comment-draft-recovery--2026-10-17).


`workspaceSwitch.browser.test.ts` adds native cross-tab account-switch acceptance
for held legacy tree/plain-comment review and copy reads, plus a real successful
comment response delivered after the original account retires. The fixture waits
for the original queue acknowledgment before asserting one server comment.
Use the loopback-only setup in [local workspaces](../local-workspaces.md#native-cross-tab-draft-isolation--2026-10-17).
This closes those account-switch cases; origin/data-plane and rich/media cases
remain open.


## Read-only account legacy review

`AccountDraftClient.reviewList/reviewRead` use fresh bound account reads without
retaining original IDs, media or queue state. Shared summary/body validators serve
both normal retention and review. The `accountDraftReview` facade captures the
editor lease before resolving a worker. Plain-comment recovery discovers only the
exact older raw context, paginates bounded summaries, previews, then re-reads before
appending plain text into an independent scoped draft. It preserves working drafts
and templates, refuses rich/media/pending-submission state, and requires verified
account connectivity only for fetching the account-only source. Anonymous/device
editing and already copied text remain local. Run `accountDraftClient.test.ts`,
`plainCommentDraft.test.ts`, the enabled remote-plain and account-switch browser
fixtures, and the existing device/anonymous regressions. [Setup and evidence](../local-workspaces.md#account-only-older-plain-drafts--2026-10-17).


## Rich composer context isolation

PostComposer now uses `useWorkspaceDraft` for post/edit/rich-comment sessions and
keys its UI by the current workspace generation. `workspaceDraftContextSync`
computes the existing SHA-256 context on first render; the async helper retains
its original contract. Working drafts must match the exact destination context.
The shared picker can explicitly include reusable post templates; LocalDrafts
instantiates an independent copy with the destination context, atomically remaps
media, fences retry/concurrent context changes and refuses pending submissions.
Old unscoped working drafts remain preserved for the unfinished explicit legacy
recovery flow. Run richWorkspace.browser, accountDraftSync.browser and
remotePlainComment.browser plus the workspace/draft/feed suites.
[Setup, scope and evidence](../local-workspaces.md#rich-composer-workspace-scope--2026-10-17).


## Offline native post template menu

`PostThingMenu` uses verified workspace content identity for owned offline posts.
`drafts/postTemplateSession.ts` captures its lease, coalesces duplicate clicks and
preserves retry IDs; unmounts and identity changes retire callbacks. The normal
`from-post`/`instantiate` services still own validation and independent byte copies.
Run `offlinePostTemplate.browser.test.ts` with the documented loopback fixture to
verify anonymous and account copying, source deletion, private reconnect and
preserved templates. See the [checkpoint](../local-workspaces.md#offline-post-templates-and-bound-parent-deletion--2026-10-17).
