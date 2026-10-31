# PR #961 — Configurable dictation silence and Hear me out

Branch: `codex/voice-silence-settings`. The user explicitly requested merging this feature into `main` and updating the installed Mac app.

## Behavior

- Ordinary Mac/browser dictation writes into the editable message field, then sends after five seconds without new speech. Lopu settings and the voice gear share a persisted custom delay from 1–120 seconds.
- Chat settings exposes the same Hear me out preference. It chooses device dictation, never auto-sends, and displays one “Send now?” popup after ten seconds of silence. New speech or Keep listening dismisses it; another ten seconds asks again. The microphone remains active until an explicit send or Stop.
- Silence and confirmation call the composer's existing guarded Send/queue action. Typed prefixes, attachments, access checks, queued messages and failed-send recovery retain their existing behavior. Queue delivery cannot overwrite a newer unsent draft.
- Stop, edits, errors, lock, leaving voice mode, account/chat changes and unmount cancel pending work. Timer generations and capture ownership fence late callbacks.
- Desktop speech bridge 1.1.0 adds an explicitly validated continuous mode. It removes the native 1.5-second cutoff for ordinary dictation while preserving legacy/private-page utterance capture. The web adapter also accepts bridge 1.0.0.
- Native iOS recording does not support Hear me out; enabling it stops an active native session and the recorder refuses to restart in that mode. Direct voice and private-page Transcribe retain their flows while Hear me out is off.

## Validation and limits

- All 232 Lopu UI unit tests and six desktop speech IPC tests pass. The Swift ThingtimeSpeech product builds locally.
- Browser fixtures using the real composer/store and synthetic speech/HTTP pass default/custom silence, repeated reminders, explicit confirmation, Stop/resume, editing, mode switches, stale results, rejected-send restoration, spoken-reply cancellation and queue delivery without draft loss.
- Desktop and 390px layouts inspected. At 390 × 844 the reminder measured x=48, y=700, width=280, height=119, with no horizontal overflow. Chat/voice settings share updates; decimal delay edits commit correctly.
- Targeted ESLint reports no errors. Raw TypeScript reports 91 existing diagnostics outside changed files; the warning-only ratchet is not a clean typecheck claim.
- Graphify structural output is refreshed through the repository wrapper. All seven semantic chunks failed through the local Codex proxy with `502 codex_execution_failed`; updated Markdown semantic coverage is unverified, including this note. Existing semantic data is retained.
- Synthetic browser speech proves application behavior, not microphone recognition quality. Signed installation and release evidence are recorded on the PR after delivery.
