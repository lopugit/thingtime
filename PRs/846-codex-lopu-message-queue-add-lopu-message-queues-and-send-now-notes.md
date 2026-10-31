# PR #846 — Lopu message queues and Send now notes

A busy Lopu conversation now keeps accepting messages. Queue captures the message and its context, with drag handles, move-up/down controls, removal and pause/resume. Send together defaults on; consecutive checked messages with matching context become one reply. Unchecked messages wait for their own reply.

Send now persists a text note immediately without cancelling the running task or starting a competing task. Claude and OpenAI receive saved notes at the next tool or response boundary. Notes arriving after completion remain in the transcript for the next reply. Task ownership, origin, chat membership and bounded note identity are checked server-side; repeat delivery uses the existing idempotent user-turn persistence.

Queues are account-scoped and tab-local, survive reload paused, and require the tab to remain open for automatic sending. Failed deliveries retain the same frozen request identity. Stop and approval boundaries pause remaining queue items. Attachments and Things use queue/normal sends; Send now is text-only.

## Validation (2026-09-18)

- 195 shared Lopu UI/store tests and 66 capability tests pass after integrating chat archiving from main.
- Controlled Claude/OpenAI streaming tests cover notes at tool and final-text boundaries; background task tests cover authorization, bounded input and non-cancellation.
- Full Lopu tests, client/embed build and Nitro server build pass before integration; release rerun recorded in the PR.
- Built-server manifest smoke verifies background tasks 1.2.0 and chat reply 1.13.0.
- Chrome desktop/mobile checks use the production queue and composer in a synthetic task fixture: default checkboxes, arrow and held-pointer drag reordering, grouped/separate sends, non-interrupting notes, settings, scroll and overflow.
- Local authenticated inference was unavailable because the test account is unverified. Synthetic transport is not proof of a real paid provider run.
- Typecheck ratchet reports existing errors outside changed files (116 versus baseline 108); focused lint passes.

Local preview: http://localhost:18900/lopu. PM2 uses the isolated worktree ports 18900–18902. Tailscale/Funnel is unavailable because its installed launcher targets a missing Tailscale application. No public mapping was changed.
