# PR #999 — Posting independent of draft saving

PR: https://github.com/lopugit/thingtime/pull/999
Branch: `codex/independent-post-draft-saving`
Base: `main`

## Behavior

A failing draft API previously stopped PostComposer before its post request.
It also delayed confirmed success while clearing drafts. Posting now freezes the
live editor document and retry identity on the device, starts draft sync without
awaiting it, and independently sends the existing post request. This includes
edits and rich comments; plain comments and nested replies also no longer await
remote draft sync.

Confirmed completion detaches the old draft coordinator synchronously. Its
in-flight save may settle, but its persistence and UI callbacks are fenced off
from the new composer. Cleanup runs separately using the acknowledged revision.
A retirement marker suppresses automatic resumption of completed work even if
cleanup conflicts with a newer remote revision; the newer draft is not deleted.
Device recovery failures remain visible instead of being erased by save status.

No authentication, audience, attachment binding, post validation or remote
revision authorization was changed. Other editor draft flush contracts remain.
There is no new server endpoint or persistent server schema.

## Local evidence — 2026-10-16

- `test:drafts`: 25 passed. Covers stalled/rejected draft sync and cleanup,
  unchanged uncertain post identity/payload, edit/rich comment completion,
  old-save isolation and immediate new-editor progress.
- `test:autosave`: 44 passed; `test:feed`: 78 passed;
  `test:attachments`: 286 passed; `test:editorjs`: 98 passed, 1 existing skip.
- TypeScript: 91 existing diagnostics, none in changed files; not a clean
  repository-wide typecheck.
- Real in-app browser and local Nitro/Mongo fixture: blocked only
  `/api/v1/drafts`; the UI showed “Draft waiting to sync”. A private post
  succeeded and survived reload. A comment and nested reply succeeded at 390px;
  document width was 390px, with no horizontal overflow. Test account was
  disposable; production accounts were not used.
- Browser fault injection and viewport override were removed afterward, and the
  fixture account was logged out. Screenshot evidence remains in the task's
  ignored `tmp/draft-qa/` directory.

CI/preview status is reported on the PR. No production verification or merge is
claimed. The broader anonymous/local-first workspace changes are separate.
