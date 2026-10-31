# PR 761 — Saved recording Things and Send to Lopu

2026-09-10 · `codex/lopu-saved-recording-handoff` → `develop`

## Scope

- Explicitly selected owner-private ready standalone audio recording Things
  join the existing transcription/notes/todos and confirmed Lopu handoff paths.
- Automatic discovery stays Watch-only; source crystal and binding stay intact.
  Transcript comments remain relational children. No migration/index added.
- Recording-page link/ID controls negotiate recordings 1.5.0. Personal worker
  1.1.0 and hosted run 1.5.0 document additive source support and write fences.
- Desktop right-click and phone three-dot menus offer Send to Lopu on owned
  private recording candidates. The server rechecks protected source fields.
  Preflight checks capabilities/account/processor; explicit confirmation precedes
  the POST. Cancellation, disabled settings and account changes do not send.
  Only the clicked Thing is sent; no implicit multi-selection bulk handoff.
- Preserve the PR 760 delivery-smoke work after its develop merge. Graphify
  snapshots are regenerated, never line-merged. Keep phone content inset.

## Evidence

- Local production build and Vercel output verification pass.
- Full Lopu suites pass; Lopu UI: 146 tests; capabilities: 38 tests before the
  menu-only addition. Typecheck ratchet remains at its 108-error baseline.
- Targeted lint: no errors, existing Things effect/type-import warnings remain.
- Compiled server: matching recording capability versions and anonymous local
  private/no-store 401 walls, with external API fallback explicitly disabled.
- Real local HTTP signup + private text-only Watch-shaped fixture, disposable
  in-memory device pairing, visible Chrome at 1440/390px: both menus render,
  processor-disabled error does not enable settings, cancel produces zero
  handoff POSTs, full-page scrolling has no horizontal overflow. Fixture deleted,
  processor disabled/deselected, own session logged out. Account/device metadata
  remains. No real audio, Keychain or Claude account used for this UI test.
- Earlier exact-head CI at 4f6c9563c3d8a81a8635652539afd1d4dfdc9daa passed;
  it does not prove subsequent menu commits. Check the PR's current head/checks.

## Still required

- Positive ready saved-audio upload → actual local STT → native Claude text
  analysis → private transcript/notes/todos → confirmed Lopu conversation.
- Upload-approved disposable QA account, or explicit real-account personal
  processor pairing/enablement consent; never bypass account upload approval.
- Current-head CI and reachable deployment; production promotion and physical
  Watch/iPhone acceptance remain separate. Do not call uploads or providers healthy
  based on synthetic tests, capability metadata, configuration or compilation.
