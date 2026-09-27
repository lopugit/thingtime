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
at most one second of continuous edits. Flush before publishing/navigation.
Transient failures retry with backoff. Publish identities are saved before submission so reloads retain the same retry identity.
Account, origin, editor target and old-editor callback guards prevent cross-talk.
The picker preference controls automatic account resume; device recovery remains
on. Account changes also scope the local Thing workspace and BroadcastChannel.
The old device workspace is copied once to the first opening account, retained
in the old key, and is never uploaded merely by hydration.

Definition snapshots retain the original `baseUpdatedAt`. Restoring a draft
against a newer saved definition (or restoring a legacy draft without a known
base) preserves its text and blocks publication. Selecting the latest saved
version first retains the recovered source in Timeline, then retires the account
draft. A failed Timeline backup leaves the account draft intact.

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
