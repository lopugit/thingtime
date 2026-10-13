# PR #952: Keep voice transcription in the editable message draft

Mac/browser speech recognition previously put partial words in a temporary deck preview and sent final utterances automatically. Stopping capture cleared that preview, losing the words the user expected to keep.

The ordinary voice surface now passes cumulative recognition results into the same draft reducer that owns typed text. Each recognition instance owns one replaceable span after the existing draft; a new instance appends a new span. Stop and recognition failure leave the draft untouched. Typing and Send stop capture before changing the draft, and existing recognizer/owner/chat fences reject late callbacks. Dictation observes the composer's 8,000-character limit. Sending retains normal attachments and failure recovery, with optional spoken replies. Explicit cancellation resolves the speech promise even when the browser never dispatches an end/error event, allowing the next turn to proceed.

Dedicated private-page transcription, direct realtime voice, and the iOS native bridge keep their existing behavior. No API or account configuration changes are required.

## Validation (2026-09-27)

- 216 Lopu UI tests passed; the focused five draft and four desktop-adapter tests passed.
- The synthetic browser fixture mounts the real voice surface, composer and store. It passed in compact and page layouts at desktop and 390px viewport widths: live revisions, stop/resume, mode switches, manual edits, recognition failure/restart, stale callbacks, explicit Send, rejected-send recovery, and stopping speech followed by another successful Send. HTTP and speech are synthetic, so this does not claim real microphone acceptance.
- Changed-file ESLint: zero errors, one existing import-type warning. Full TypeScript: 91 existing errors, none in the changed files.
- Code graph refreshed. The local semantic proxy returned `502 codex_execution_failed`; Markdown semantic indexing is not verified. Existing semantic data is preserved.

## Delivery

PR: https://github.com/lopugit/thingtime/pull/952
Branch: `codex/voice-composer-draft`

Merge to main is explicitly requested by the user. After required checks pass, publish the official signed Electron release from main (bundled UI changes do not trigger it automatically), reinstall the production-signed app, and verify real microphone dictation in the installed app. Record release, installed version, and native acceptance in the PR description after completion.
