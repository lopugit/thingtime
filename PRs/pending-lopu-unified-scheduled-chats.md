# Lopu unified conversations, scheduled Things, attachments and discussions

## Scope

- One mounted chat composer across standard voice and text, with transcript turns persisted into the selected conversation.
- Device-file attachments and searchable owned-Thing references. Binary media currently contributes metadata only; selected readable Things contribute bounded text.
- Searchable scheduled-task Things, protected execution controls, separate target-linked run Things, interval/time-zone cron schedules, saved messages or read-only AI updates, existing or fresh chats, and Lopu-message notifications.
- Discussion sections on Thing details and previews; comments are separate target-linked Things. Lopu comment proposals require confirmation bound to the exact target and full text.
- Updated origin-scoped capability versions, client requirements, API docs and fork-safe setup notes. No new index or migration is needed for these features.

## Verified locally, 2026-09-10

- Client build passes; typecheck ratchet remains at the existing 108-error baseline (not a clean full typecheck).
- Lopu UI: 111 tests pass. Focused scheduler/transcript persistence: 10 tests pass. Lopu, notifications and Messenger package suites pass.
- API capability suites pass, and the running development server exposes the updated semantic feature versions.
- Public comments render at desktop 1440x1000 and mobile 390x844; refresh and top-to-bottom scrolling checked with no horizontal overflow.
- A new local-only QA account successfully logged in, created a private Thing, posted a comment through the UI, and reloaded the persisted comment. Database inspection confirmed the original crystal was unchanged and the comment exists as a separate target-linked document.
- Production credentials were not copied. The local loopback MongoDB replica set uses a separate identity store from production. The development footer still reports a global storage migration warning, although the fresh account's ready ledger supports these tested writes.

## Remaining acceptance work; not release-complete

- Direct provider WebSocket voice turns are still local-only. Persist them and reconcile the native voice paths before claiming every voice mode shares durable history.
- Test authenticated attachment selection/upload, mode-switch continuity, preview discussions, pagination, account changes and denied-target behavior in the browser.
- Exercise real scheduled delivery and read-only AI updates with live provider access; mock-worker tests do not prove hosted scheduler/provider health.
- Review mobile floating-control overlap around the comment composer, and finish nested UI checks.
- Hosted preview, CI, deployment and physical Watch/iPhone acceptance are separate, pending gates. No new TestFlight build or production migration was performed for this branch.

## Local URLs

- http://localhost:11270 (API on 11272).
- No verified Tailscale/Funnel mapping for these ports. The temporary foreground server is not a durable PM2 setup; the shared PM2 daemon was unresponsive during validation.
