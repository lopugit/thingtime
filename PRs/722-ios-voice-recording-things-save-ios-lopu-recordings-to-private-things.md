# PR 722: Save iOS Lopu recordings to private Things

PR: https://github.com/lopugit/thingtime/pull/722
Branch: `codex/ios-voice-recording-things` → `main`
Native release: build 29, `https://thingtime.com`

New completed native Lopu audio segments export to M4A and upload through the
canonical multipart attachment flow as `purpose: recording`. They are standalone
owner-private attachment Things visible in `/things`, with no parent binding or
draft expiry. The own-things list admits only ready standalone recordings
through a narrow protected-kind exception, before pagination and within the
existing owner/folder/token fences. Generic attachment CRUD remains protected.
The Things read feature is 1.7.0 (operation contract 1.6.0). The original CAF and any TXT transcript stay in Files → On My
iPhone → Thingtime → Lopu Recordings. Transcripts retain their existing chat/page
behavior; this change uploads the audio file.

Private-upload approval, full-session authentication, storage reservation,
server-verified media detection, S3 checksums and canonical ACL enforcement all
remain in effect. Upload/complete feature and operation contracts are 1.2.0;
the native client checks the selected origin's well-known capability manifest
and confirms its authenticated owner before sending audio. App cookies never go
to S3 and redirects are refused.

The local outbox contains account/origin-bound file references and stable request
IDs, never credentials. It survives relaunch. Lost completion responses retry only
completion; a replayed completed start returns the same ready attachment without a
second reservation. If an expired pending upload was removed, retry uses the same
request ID. Account/destination changes cancel the old worker. Local files remain
available when permission, storage, network or capability checks block an upload.
Build 27 and earlier files are not automatically imported because they lack an
authenticated account association.

## Verification on 2026-09-09

- 41 iOS simulator tests pass, including playable real CAF-to-M4A export,
  relaunch recovery after lost completion, wrong-account refusal and rejection of
  an unrelated presigned upload host. Existing voice recovery tests remain green.
- Focused attachment, route-permission, capability and recording-library tests
  cover finished audio, draft/foreign/protected-row exclusion, and folder/token
  fences. The earlier attachment/capability run passed 111 tests. Targeted
  ESLint passes. Full TypeScript checking reports existing baseline errors; the
  required CI ratchet remains the merge gate.
- Local voice UI inspected at desktop and 390 × 844. Opened settings are within
  the mobile viewport (300px wide, x=90), page width is 390px with no horizontal
  overflow, and bottom controls remain visible. Chrome control repeatedly timed
  out; the in-app browser was used for the rendered check.
- The initial signed IPA contains build 28 and `ThingtimeWebURL=https://thingtime.com`;
  its Live Activity extension also has version 28. Apple upload succeeded.
  Apple reports processing VALID and internal IN_BETA_TESTING for build 28.
  Final delivery uses build 29 to also include the Watch changes that merged
  into main during validation; its release receipt is verified separately.
- Physical iPhone microphone → production upload → Things playback and actual
  lock-screen Live Activity acceptance are not proven by the simulator. The new
  save/pending notice requires native upload events and awaits that device check.
- Graphify incremental semantic extraction and portable output generation ran;
  existing shared import/semantic-node collisions still limit graph completeness.

Local: http://localhost:12450/lopu/voice
Preview: https://pr-722.previews.dev.thingtime.com (verify deployment before use).
Funnel is unavailable: the installed Tailscale shim points to a missing app.

## Acceptance

Update TestFlight to build 29, reopen Thingtime on `thingtime.com`, record a short
voice segment, stop, and open the saved recording link or `/things`. Verify one
private playable audio Thing, local CAF/TXT retention, and another-account denial.
Exercise offline/reconnect and account switching with a pending recording. The
server must advertise both upload and complete features at 1.2.0 before uploading.
