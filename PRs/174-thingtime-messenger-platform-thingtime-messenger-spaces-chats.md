# PR #174 — Thingtime Messenger platform (`claude/thingtime-messenger-platform-c9c2b5`)

One-branch build of the full messenger: Slack-style Spaces + Messenger-style Chats behind a mode toggle at `/messages`, on the everything-is-a-thing model.

## Data model

Nine kinds in `things_v2`, all **dedicated-endpoint-managed** (registered in `app/schemas/registry.ts` WITHOUT crystal sanitizers → generic `/api/v1/things` CRUD 403s them; acl `['tt:user']` hides them from generic reads; membership checked in `api/utils/messenger/` is the only door):

| kind | link | crystal highlights |
| --- | --- | --- |
| `community` | — | name, description |
| `community-member` | targetId → community | `memberKey` (unique), role owner/admin/member |
| `community-invite` | targetId → community | `inviteCode` (unique), uses/maxUses/expiresAt, atomic redemption via guarded `$inc` |
| `chat-section` | targetId → community | name, order |
| `chat` | targetId → community (channels) | chatType channel/group/dm, name/topic, channelVisibility, `dmKey` (unique — DM dedupe) |
| `chat-member` | targetId → chat | `memberKey` (unique), role, nickname, state active/pending/left/declined, requestOrigin follower/unknown, **lastReadMessageId/lastReadAt (read receipt)**, muted |
| `chat-message` | targetId → chat | text ≤4000, threadRootId (one level), replyToId, editedAt, deletedAt (soft), systemType/systemMeta |
| `custom-emoji` | targetId → community or null (personal) | name, `emojiKey` (unique per scope), image data URI ≤~512KB, animated |
| `follow` | ownerId follower → targetId followee | `followKey` (unique) |

Reactions are the EXISTING `reaction` kind + `things_reaction_unique` index, written by the membership-gated `POST /api/v1/chats/react`; `custom:<emoji shareId>` is a parallel token namespace (`sanitizeChatReactionToken` in `app/utils/reactionTokens.ts`) that the post react path rejects, and custom tokens never enter unicode recents (messenger-local recents in localStorage instead).

Messages are NOT posts (no `post` schema id) → `postMatch()` can never surface them in feeds; the wildcard text index can only show your OWN messages to you (acl tt:user).

## Key decisions

- **No generic-ACL integration**: acl entries cap at 16, so per-member grants can't model rooms. Membership lookups (single indexed query on `crystal.memberKey`) gate every endpoint instead.
- **Request classification** (FB semantics): recipient follows sender → lands normally; else pending with bucket = sender-follows-recipient ? follower : unknown. Reply = implicit accept; decline is silent and locks the decliner out (sender keeps a one-way wall).
- **Receipts parity**: `meta.readReceiptsEnabled` (secure-blob, 2FA-flag pattern, batch reader `getUsersReadReceiptsMap`); off = neither share nor see; unread math always uses real values server-side. Forward-only high-water mark (`markChatRead` compares message createdAt ISO).
- **Unread**: one `$facet` aggregate per list call (per-chat `$or` clauses vs lastReadAt + newest-message `$group`); system messages and own messages never count; muted chats keep counts but leave `totalUnread`.
- **Realtime = visibility-aware polling** (no websockets on Vercel serverless): 4s open chat, 15s page list, 25s global notifier (`MessengerNotifications` in root; Lopu toast ≤1/chat/30s with Open chat link; `MessengerUnreadBadge` on the drawer item). Pauses when hidden, fires on visibilitychange.
- **Emoji storage** = avatar pattern (inline data URIs on their own thing docs; no upload infra). Rendering bypasses `safeUrl` deliberately via `CustomEmojiImage` with its own strict `data:image/(gif|webp|png|apng|jpeg)` allowlist.
- **Owner-leave succession**: earliest active admin, else earliest active member.
- `Main.tsx` suppresses the footer on `/messages` (full-bleed route list) so the chat owns the viewport.

## Endpoints (23; each = route file + `[...].ts` map + apiDocs entry — the docs entry IS the Nitro registration)

`/api/v1/chats` (GET list / POST create) · `chats/get` · `chats/update` · `chats/members` (join/add/remove/role/nickname/mute) · `chats/leave` · `chats/messages` (GET page+members+emoji map / POST send) · `chats/messages/edit` · `chats/messages/delete` · `chats/react` · `chats/read` · `chats/requests` (GET buckets / POST respond) · `chats/updates` (poll) · `chats/settings` (read receipts) · `/api/v1/communities` (GET/POST) · `communities/get` (+channel directory) · `communities/update` · `communities/members` · `communities/invites` (GET/POST) · `communities/join` · `communities/sections` · `/api/v1/emojis` (GET/POST) · `emojis/delete` · `/api/v1/users/follow` (GET/POST)

Rate-limit buckets added: `chats.message` 120/min, `chats.write` 60/min, `chats.react` 120/min, `chats.read` 240/min, `emojis.write` 30/hr, `users.follow` 60/min.

Indexes added to `createThingsDataIndexes` (home + custom-endpoint DBs): partial-unique `crystal.memberKey` / `dmKey` / `inviteCode` / `emojiKey` / `followKey` + `crystal.threadRootId` listing index. Message pages ride the existing `{ targetId, thingtime, createdAt, shareId }` compound.

## UI

`remix/app/components/Messenger/` — `MessengerPage` (mode toggle persisted per account, two-pane desktop / push-nav mobile, `?chat=` deep links), `SlackSidebar` (community rail, sections, channels, right-click rename), `InboxSidebar` (search-to-DM typeahead, requests folder), `ChatView` (4s poll, optimistic send with pending swap, optimistic per-token reaction reconcile, mark-read), `MessageRow` (bubbles vs flat rows, reaction chips, hover toolbar, long-press via existing `ReactionControl`), `ThreadPanel`, `ChatDetailsDrawer` (rename, roles, nicknames, mute, receipts toggle, leave), `MessengerEmojiPicker` (existing `EmojiPicker` + Custom tab), `EmojiUploadModal` (FileReader → data URI), `RequestsView`, `MessengerModals`, `MessengerNotifications`, `messengerCache` (tt-messenger-* localStorage first-paint tier). All styling via `--tt-*` vars with fallbacks; Lopu-only toasts; z-ladder respected.

## Debugging log (what bit us and how it ended)

1. **System messages counted as unread** → every join bolded channels forever for non-readers. Fix: `'crystal.systemType': null` in the unread facet. (Caught by the 86-check suite: "muted chat keeps its unread but leaves totalUnread".)
2. **Vite stale transform** of `DrawerContent.tsx` (badge import landed a beat after the usage edit; watcher served the old module even after hard reload) → `MessengerUnreadBadge is not defined` error boundary. `touch` re-transform fixed it; no code change needed.
3. **`Main.tsx` footer + 900px spacer under the chat** → body scrolled, composer floated mid-page. Fix: full-bleed route list suppresses the footer.
4. **Short conversations hugged the top** of the scroll pane → wrapped the list in a `justify-end` min-height column so chats pin to the bottom like every messenger.
5. **Automation pane reports `visibilityState: 'hidden'`** → all pollers correctly paused; verified the notification path by overriding visibility in-page (product behavior right, test environment quirk).
6. **`findUserById` returns a doc (`_id`)**, not a projection — follows.ts briefly compared `target.id` (undefined). Caught pre-commit.

## Verification

- `node scripts/verify-messenger.mjs` (from `remix/`, targets the worktree nitro port or `TT_VERIFY_BASE`): **86 passed, 0 failed** — sections A–K cover auth walls, follow graph, communities/invites/sections/roles, channel permissions + directory, message paging/threads/edit/delete, reactions incl. custom scope rules + caps, DM requests (both buckets, implicit accept, decline lockout, dedupe), groups (rename-by-anyone, nicknames, promote/remove/revive, succession), receipts (forward-only, parity, unread unaffected), mute vs totals, and generic-things escape hatches.
- Browser (desktop + 375px mobile): both modes, thread panel, custom emoji upload → inline `:party-parrot:` render → custom reaction chip, requests accept flow, unread badge + Lopu toast, details drawer, no overflow/clipping; footer suppressed only on `/messages`.
- Multi-agent adversarial review (security/correctness/perf/conventions), confirmed findings fixed pre-merge.
