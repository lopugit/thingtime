# Emoji picker combinations, draft recovery and recent shortcuts

[PR #1290](https://github.com/lopugit/thingtime/pull/1290).

2026-10-29. Branch: `codex/emoji-picker-drafts-recents`.
Started from freshly fetched `origin/main` at
`710f97fa26f4bf66d9f1587b5075b61a2929247d` in an isolated worktree. The user
explicitly authorized this task's merge into `lopugit/thingtime` main.

## Result and decisions

The shared validator rejected more than 12 emoji graphemes or 80 code points,
which hid Add. Remove those arbitrary limits in validation and the reaction
schema, and update the affected semantic API versions and client requirements.
Emoji grammar, authorization and storage/transport accounting remain enforced.

Keep unfinished custom input above lazy popup content, scoped by account,
origin, database and post/comment/message/chat/thread target. Dismissal preserves
it; committing clears it. This is in-memory picker recovery, not a promise to
restore unfinished input after a full reload or card unmount.

Keep the six default quick reactions and append up to nine distinct recent
tokens, skipping duplicates already among the defaults. Preserve full tokens
and current server ordering while fencing stale reads and late mutation replies.
Keep the decorative emoji burst bounded by its existing particle budget.

Use the shared popup layer on both Chakra content and positioning wrappers.
Wrap long tokens in pickers, shortcuts and post/comment/message reaction
summaries. Messenger uses the same picker, so its narrower container, draft
lifetime and message-row height are covered too.

## Verification

- Feed 101/101, Messenger 66/66 and capability 120/120 tests passed; focused
  reaction/schema/compatibility regressions passed. Typecheck ratchet: zero
  errors. Changed UI lint and whitespace checks passed.
- Schema suite: 289/290 on the first run. The unrelated expression timing test
  exceeded its 10ms threshold under load; that exact test passed on isolated
  retry. No baseline or timing threshold was changed.
- Built client and Nitro server: disposable replica set, isolated Chromium,
  verified database identity, API-only fixture creation and only loopback
  mutation requests. 200-emoji post/comment/chat tokens survived mutation and
  exact-ID readback; invalid text was rejected.
- Browser: Add/Enter, click-away/Escape, independent retained drafts, nine recent
  shortcuts, reload, desktop/mobile page scrolling, popup hit-testing, short
  viewport, Messenger Chats/Spaces chips and composer insertion passed.
- Mobile testing exposed and repaired popup positioning-wrapper overlap with
  fixed navigation, clipped long summaries and insufficient emoji line height.
- The local node-server does not host Vercel Analytics. The harness records
  that exact script's HTML-response parse warning and rejects all other browser
  exceptions. This is separate from the verified emoji behavior.

Acceptance evidence is retained locally under `/tmp/emoji-picker-evidence/`;
`result.json` records checks, changed-source SHA-256 hashes and mutation origins.
Test server, browser and database were cleaned up. No physical iPhone test was
performed. Production deployment evidence is reported separately on the PR.

Graphify semantic extraction hit a five-minute deadline after repeated hollow
responses. The structural graph, report and HTML are refreshed, retaining
available prior semantic data. Changed Markdown is not claimed as freshly
semantically indexed. Existing extractor warnings for unrelated native files
remain separate from TypeScript/build results.
