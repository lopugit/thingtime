# 19 — Anonymous participants in group chats 🕶️

**Status:** 🔴 Not started · requested 2026-08-22.

## Goal

Extend Thingtime Messenger's existing group-chat creation so the creator can
add friends or any discoverable users and toggle anonymity per participant,
including themselves. Add a **Make everyone anonymous** shortcut for the core
use case: friends can talk together without the chat revealing which account
wrote which messages.

The invitation must still tell each recipient the real username of the person
who invited them. If the creator made themselves anonymous, that one
`Invited by @username` disclosure remains visible in the invite/acceptance
context, while their messages and in-chat participant representation remain
anonymous.

## Required experience

### Create and invite

- Reuse the current `chatType: "group"` flow. The creator can search eligible
  users or pick friends, then set **Anonymous in this chat** independently for
  each selected person and for themselves.
- The confirmation screen summarises who will appear normally, who will appear
  anonymously, and offers **Make everyone anonymous**.
- Each recipient sees the group name, the real inviter username, their own
  anonymity setting, and a plain-language explanation before accepting or
  declining. Existing block/invite privacy rules must still win.

### Inside the chat

- An anonymous member appears as `Anonymous` everywhere another ordinary
  participant would otherwise see their identity. A chat-local, non-identifying
  number/colour/avatar may distinguish speakers if usability testing needs it,
  but it must never be reused across chats or map back to the account.
- The viewer may see their own messages as `You`; that must not reveal them to
  anyone else.
- Anonymous presentation covers the member list, message rows, grouped
  messages, quoted replies, threads, last-message previews, typing indicators,
  mentions, reactions, seen/read receipts, system messages, search results,
  attachment attribution, notifications, email/push previews, exports, and
  deep links. Profile links and real avatars/banners are unavailable.
- Non-anonymous members continue to use their normal public profile projection.
- An anonymity choice is fixed for the history it protects. Do not let an admin
  flip an existing anonymous author to a real identity and retroactively
  deanonymise messages. A later self-reveal needs explicit participant consent
  and a design that leaves historical messages anonymous; otherwise start a
  new chat.

## Honest anonymity boundary

This feature hides account-to-message and account-to-member mappings from other
ordinary chat participants in Thingtime's UI and API. It is not anonymity from:

- Thingtime's server and authorised abuse/moderation operators;
- the inviter, who already knows which accounts they selected;
- a recipient's required knowledge of the real inviter username;
- identity clues a person voluntarily writes or uploads in their messages; or
- people who already know one another outside Thingtime.

The UI must state this boundary without claiming end-to-end anonymity or
encryption. In particular, a creator cannot be made to forget whom they added;
the guarantee is that Thingtime does not expose the mapping through chat
surfaces or client payloads.

## Architecture and projection rules

Keep the existing relational Messenger model:

- `chat` — bounded group metadata;
- `chat-member` — one membership per `(chatId, userId)`;
- `chat-message` — atomic messages linked to the chat by `targetId`.

Add the anonymity choice to the protected membership record, not to every
message. Real `ownerId`/user relationships stay server-side for authorization,
rate limiting, moderation, blocks, reports, and account deletion. The public
projection becomes the privacy boundary:

- Return an opaque chat-local member identifier for an anonymous participant,
  never their global `userId` or a stable hash of it.
- Return a synthetic anonymous profile with no username, real display name,
  avatar URL, banner URL, profile route, or globally correlatable value.
- Project `PublicChat.createdBy`, `PublicChatMember.userId`, message
  `authorId`/`author`, `lastMessage`, `replyTo`, `systemMeta.subjectId(s)`,
  reactions, and read-receipt/seen-by data through the same mapper. The real id
  must not survive in unused JSON fields, websocket events, client caches, DOM
  attributes, analytics, logs sent to the browser, or error messages.
- Give the creator/invitee disclosure its own narrow invite projection. Do not
  reuse that real inviter identity inside message/system-event projections.
- Model create input as bounded member objects such as
  `{ userId, anonymous }`, dedupe by real user id on the server, validate every
  account, and enforce current group-size, relationship, block, and invitation
  limits.
- Keep every read/write behind the dedicated Messenger membership gate; the
  generic Things API must continue to refuse Messenger kinds.

## Safety and moderation

- Anonymous users remain blockable and reportable from a message. The client
  sends the opaque message/member reference and the server resolves the real
  actor without disclosing it to the reporter.
- Rate limits, bans, upload permissions, and moderation apply to the real
  account, so anonymity is never an abuse bypass.
- Strip or normalise attachment metadata and filenames that could identify an
  anonymous author. Notifications must not substitute the real profile after a
  cache miss.
- Joining is opt-in. A recipient can decline, block the inviter, leave later,
  and report the group without learning anonymous identities.
- Membership and anonymity changes produce privacy-safe system events. Audit
  records available to authorised operators remain private control-plane data.

## Done when

- A creator can make themselves, selected invitees, or everyone anonymous while
  creating a group from friends and/or user search.
- Every invitee sees the real `Invited by @username` label before joining, even
  when that inviter is anonymous inside the chat.
- With at least three test users, each participant sees only the permitted
  normal profiles plus anonymous representations; messages remain attributable
  enough to follow the conversation without revealing account identities.
- Automated projection tests assert that real usernames, profile media, global
  user ids, and stable cross-chat identifiers are absent from all anonymous
  chat/list/message/thread/reaction/receipt/notification responses.
- Authorization tests prove an opaque member id cannot be used to fetch a
  profile, enumerate another chat, forge authorship, or bypass blocks,
  moderation, rate limits, or membership.
- Changing/leaving/removing members does not retroactively reveal anonymous
  history, and deletion/moderation can still resolve and act on the real
  server-side actor.
- Desktop and mobile browser checks cover mixed-identity and everyone-anonymous
  groups, invite accept/decline, messages, replies, reactions, receipts,
  notifications, member details, block/report, and leave/remove flows.

## Existing anchors

- `remix/app/api/utils/messenger/messenger.ts` — current group creation,
  membership, messages, public projections, previews, reactions, and receipts.
- `remix/app/api/utils/messenger/shared.ts` — protected Messenger Things and
  membership lookup rules.
- `remix/app/components/Messenger/messengerTypes.ts` — client chat/member/message
  shapes and display-name resolution.
- `remix/app/components/Messenger/MessageRow.tsx` — every visible author,
  reply, reaction, and seen-by surface that needs the privacy projection.
