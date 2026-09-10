# PR #731: Lopu unified conversations, scheduled Things, attachments and discussions

## Scope

- One mounted chat composer across standard voice and text, with transcript turns persisted into the selected conversation.
- Direct web voice capture saves final user/assistant transcripts without a second inference call. A bounded account-scoped outbox retries failed saves; recent selected-chat text seeds the provider session before microphone frames.
- Native bridge 1.3 adds protected, account/origin-bound direct-voice transcript recovery, negotiated owner checks, explicit retry state, bounded chat-context replay before microphone frames, and transcription-only chat reconciliation. Old native builds cannot silently claim direct-voice persistence.
- Device-file attachments and searchable owned-Thing references. Binary media currently contributes metadata only; selected readable Things contribute bounded text.
- Searchable scheduled-task Things, protected execution controls, separate target-linked run Things, interval/time-zone cron schedules, saved messages or read-only AI updates, existing or fresh chats, and Lopu-message notifications.
- Discussion sections on Thing details and previews; comments are separate target-linked Things. Lopu comment proposals require confirmation bound to the exact target and full text.
- Updated origin-scoped capability versions, client requirements, API docs and fork-safe setup notes. No new index or migration is needed for these features.

## Verified locally, 2026-09-10

- Reconciled the later develop argument-media fixes through `497ddfda2`. Retained Lopu contracts plus attachment-content 1.6.0 and Things-update 1.2.3; patched the combined Things contract to 1.8.1 (legacy manifest 1.7.1) so clients can distinguish the corrected shared-media writes.
- Native voice/capture/upload simulator suites: 20 tests pass on iPhone 17 Pro, iOS 27 / Xcode 27 beta. The first expanded run caught a premature active-state event before microphone permission; the production code was fixed and the unchanged lifecycle test now passes. This simulator build is not a supported TestFlight upload or physical-device proof.
- Web voice and native-bridge suites: 127 tests pass; targeted lint has no errors and one pre-existing type-import warning. The new bridge requires 1.3.0 for durable direct voice. The local browser currently shows the signed-out gate, so authenticated retry-panel/old-build messaging and live provider checks remain open.
- Reconciled with develop `f184b4d59`, preserving native recording import, APNs collapse-ID repair, push diagnostics and authored/nested shared-media authorization. Combined notification-test capability is 1.2.0; lower versions cannot satisfy the new settings UI. The additive Things read contract also retains develop's 1.7.2 write correction and the separate Things-update patch assertions.
- Full Vercel build and output/CSP verification passed before the latest develop merge; typecheck ratchet remains at the existing 108-error baseline (not a clean full typecheck).
- Lopu UI: 124 tests pass. Focused scheduler/transcript persistence: 10 tests pass. Lopu, notifications and Messenger package suites pass. The 26 API-capability tests also pass after reconciling develop.
- API capability suites pass, and the running development server exposes the updated semantic feature versions.
- Public comments render at desktop 1440x1000 and mobile 390x844; refresh and top-to-bottom scrolling checked with no horizontal overflow.
- A new local-only QA account successfully logged in, created a private Thing, posted a comment through the UI, and reloaded the persisted comment. Database inspection confirmed the original crystal was unchanged and the comment exists as a separate target-linked document.
- Production credentials were not copied. The local loopback MongoDB replica set uses a separate identity store from production. The development footer still reports a global storage migration warning, although the fresh account's ready ledger supports these tested writes.

## Remaining acceptance work; not release-complete

- Direct web voice capture: real local HTTP checks with a fresh API-registered test account prove one chat, exact user/assistant retry IDs, changed assistant-text rejection (409), wrong-owner rejection (409), and discoverability in the chat list. The live origin manifest advertises capture 1.0.0. No production credentials or provider calls were used.
- Unit coverage includes recovery after reload/offline, chronological retries, bounded queues, account changes, collision-safe identities, stale message fetches, account-scoped caches, history filtering/bounds, WebSocket history-before-audio ordering, and cancellation while microphone permission is pending.
- Corrected the production CSP to permit the supported `wss://api.x.ai` voice host; it previously worked only with the development socket allowances. Arbitrary production WebSocket origins remain blocked. Hosted acceptance requires the new deployment headers, not just a hot-reloaded client.
- Native direct-voice persistence passes the simulator regression suites; finish actual provider acceptance/history recall and authenticated mode-switch/retry UI checks before claiming every voice mode shares durable history. Standard spoken-reply failures still retain recording files for recovery; automatic replay of failed inference is not claimed.
- Test authenticated attachment selection/upload, mode-switch continuity, preview discussions, pagination, account changes and denied-target behavior in the browser.
- Exercise real scheduled delivery and read-only AI updates with live provider access; mock-worker tests do not prove hosted scheduler/provider health.
- Review mobile floating-control overlap around the comment composer, and finish nested UI checks.
- Hosted preview, CI, deployment and physical Watch/iPhone acceptance are separate, pending gates. No new TestFlight build or production migration was performed for this branch.

Protocol reference: [xAI Voice API](https://docs.x.ai/developers/rest-api-reference/inference/voice)
supports `conversation.item.create` for history seeding. Only ordinary user and
assistant text is replayed; no `response.create` is issued by history loading.

## Local URLs

- http://localhost:11270 (API on 11272).
- No verified Tailscale/Funnel mapping for these ports. On 2026-09-10 the foreground server was replaced with the canonical PM2 worktree stack after the full build left its API stale. One matching entry, zero restarts, autorestart off and the live manifest were verified; the PM2 list was saved. Keep this local-development auth environment private.
