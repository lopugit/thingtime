# PR #705: Save system events and retain user history

Date: 2026-09-09. Branch: `codex/system-notification-history`. Base: `develop`.

## Cause and correction

Push preferences previously gated single-event persistence and filtered the history page. Successful component actions were skipped, shared Lopu messages were ephemeral, and retention deleted records after 10,000 entries.

Notifications now persist before delivery preferences. History explicitly bypasses delivery filtering and no longer has count-based pruning. Quiet component runs and repeated fan-out events remain logged without extra delivery. Sign-in, signup, and sign-out paths emit system records; the shared Lopu hooks save signed-in messages and terminal stream messages through an authenticated, account-fenced, idempotent endpoint. Client-supplied messages cannot impersonate authoritative action/login event types. Text is credential-redacted and bounded; JSON byte limits also cover emoji and escaped characters.

History uses stable cursors, separate bell/history unread counts, full bounded detail, and refresh-on-save. Delivery switches do not hide or delete history; quiet Lopu messages do not offer misleading delivery switches.

## Verification

- Notification suite: 36 tests plus 4 persistence tests passed. Lopu UI: 109 passed. Passkeys: 13 passed. API capability coverage and compatibility tests passed.
- Production Vercel build and output verifier passed. Built-server smoke returned the advertised history/record features and rejected anonymous recording with 401.
- Typecheck ratchet passed against 108 pre-existing errors; this is not a clean full typecheck.
- Dedicated QA account through real APIs: disabled both delivery masters; confirmed login, component action, and actual Lopu toast records in history; retry stored once; 32 paginated records had unique IDs; mark-all-read remained zero after its confirmation toast.
- Chrome desktop and 390px mobile: history top/bottom, filters, older pages, read controls, and settings inspected. No history/settings horizontal overflow. Existing mobile header crowding is unrelated and unchanged.
- Local URL: http://localhost:13550/notifications?category=system. Worktree PM2 ports: 13550/13551/13552. Tailscale/Funnel could not be verified because its configured application executable is absent.

## Boundaries

Previously unsaved or deleted notifications cannot be reconstructed. Anonymous popups are not attributed to an account. Client transport retries three times, but does not provide a durable offline outbox. Large text is explicitly truncated, and credential-like content is redacted. Notification storage failures do not fail the underlying social/auth action. Graphify is refreshed through the repository CAS wrapper, including semantic documentation caches. Parent sharing work, its branch, and its server are untouched. This PR does not authorize a merge.
