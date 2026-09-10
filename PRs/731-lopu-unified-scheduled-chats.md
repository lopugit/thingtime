# PR #731: Lopu unified conversations, scheduled Things, attachments and discussions

## Scope

- One mounted chat composer across standard voice and text, with transcript turns persisted into the selected conversation.
- Direct web voice capture saves final user/assistant transcripts without a second inference call. A bounded account-scoped outbox retries failed saves; recent selected-chat text seeds the provider session before microphone frames.
- Device-file attachments and searchable owned-Thing references. Binary media currently contributes metadata only; selected readable Things contribute bounded text.
- Searchable scheduled-task Things, protected execution controls, separate target-linked run Things, interval/time-zone cron schedules, saved messages or read-only AI updates, existing or fresh chats, and Lopu-message notifications.
- Discussion sections on Thing details and previews; comments are separate target-linked Things. Lopu comment proposals require confirmation bound to the exact target and full text.
- Updated origin-scoped capability versions, client requirements, API docs and fork-safe setup notes. No new index or migration is needed for these features.

## Verified locally, 2026-09-10

- Reconciled with develop `d0a4344d9`, preserving native recording import, APNs collapse-ID repair, push diagnostics and shared-media authorization. Combined notification-test capability is 1.2.0; lower versions cannot satisfy the new settings UI.
- Client build passes; typecheck ratchet remains at the existing 108-error baseline (not a clean full typecheck).
- Lopu UI: 111 tests pass. Focused scheduler/transcript persistence: 10 tests pass. Lopu, notifications and Messenger package suites pass.
- API capability suites pass, and the running development server exposes the updated semantic feature versions.
- Public comments render at desktop 1440x1000 and mobile 390x844; refresh and top-to-bottom scrolling checked with no horizontal overflow.
- A new local-only QA account successfully logged in, created a private Thing, posted a comment through the UI, and reloaded the persisted comment. Database inspection confirmed the original crystal was unchanged and the comment exists as a separate target-linked document.
- Production credentials were not copied. The local loopback MongoDB replica set uses a separate identity store from production. The development footer still reports a global storage migration warning, although the fresh account's ready ledger supports these tested writes.

## Remaining acceptance work; not release-complete

- Direct web voice capture: real local HTTP checks with a fresh API-registered test account prove one chat, exact user/assistant retry IDs, changed assistant-text rejection (409), wrong-owner rejection (409), and discoverability in the chat list. The live origin manifest advertises capture 1.0.0. No production credentials or provider calls were used.
- Unit coverage includes recovery after reload/offline, chronological retries, bounded queues, account changes, collision-safe identities, stale message fetches, account-scoped caches, history filtering/bounds, WebSocket history-before-audio ordering, and cancellation while microphone permission is pending.
- Corrected the production CSP to permit the supported `wss://api.x.ai` voice host; it previously worked only with the development socket allowances. Arbitrary production WebSocket origins remain blocked. Hosted acceptance requires the new deployment headers, not just a hot-reloaded client.
- Reconcile native direct-voice persistence, test actual provider acceptance/history recall and finish authenticated mode-switch/retry UI checks before claiming every voice mode shares durable history.
- Test authenticated attachment selection/upload, mode-switch continuity, preview discussions, pagination, account changes and denied-target behavior in the browser.
- Exercise real scheduled delivery and read-only AI updates with live provider access; mock-worker tests do not prove hosted scheduler/provider health.
- Review mobile floating-control overlap around the comment composer, and finish nested UI checks.
- Hosted preview, CI, deployment and physical Watch/iPhone acceptance are separate, pending gates. No new TestFlight build or production migration was performed for this branch.

Protocol reference: [xAI Voice API](https://docs.x.ai/developers/rest-api-reference/inference/voice)
supports `conversation.item.create` for history seeding. Only ordinary user and
assistant text is replayed; no `response.create` is issued by history loading.

## Local URLs

- http://localhost:11270 (API on 11272).
- No verified Tailscale/Funnel mapping for these ports. The temporary foreground server is not a durable PM2 setup; the shared PM2 daemon was unresponsive during validation.
