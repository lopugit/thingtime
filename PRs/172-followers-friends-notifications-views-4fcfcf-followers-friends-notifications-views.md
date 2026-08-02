# Followers/friends + notifications + post views + multi-emoji fix

Branch: `claude/followers-friends-notifications-views-4fcfcf` · PR: [#172](https://github.com/lopugit/thingtime/pull/172)

Loop task state file. Each /loop firing: read this, continue the first unchecked item, keep it current.

## Scope (from the ask)

1. Follower system (one-way, no approval) + friend system (request → approve), separate types.
2. Notification settings section (per-type enable/disable: friend requests, new followers, posts from followed/friends, reactions, comments, shares, groups[future]).
3. Post views counter: views/impressions + view time (dwell/linger) + screen position, anti-bot/anti-manipulation.
4. Public view stats on each post.
5. Fix: multi-emoji reaction tokens truncated to first glyph in the react button on posts + comments.

## Design (locked)

- `follow` thing: ownerId=follower, targetId=followee, `crystal.follow: true`; unique partial idx (targetId, ownerId) where crystal.follow exists. Counts on read.
- `friend` thing: ONE doc per unordered pair; ownerId=requester, targetId=recipient, `crystal.status: 'pending'|'accepted'`, `crystal.friendKey: '<minId>~<maxId>'` (unique partial idx). Decline/cancel/unfriend = delete.
- `notification` thing (PROTECTED, server-minted): ownerId=recipient, targetId=subject thing, `crystal.{type, actorId, actorName, postId, preview}`, `readAt`. Home-pinned like users. Prefs = `meta.notificationPrefs` in user secure blob; single-recipient writes check prefs, reads ALWAYS filter by prefs (fan-out is pref-agnostic at write). Fan-out for post-from-followed/friends capped at 200 most recent.
- `postViews` collection (home-pinned, physical postViews_v1): one doc per (postId, viewerKey); viewerKey `user:<id>` | `anon:<sha256(salt|ip|ua)>`; fields impressions, dwellMs (clamped), maxRatio, lastPos, createdAt/lastAt; unique idx (postId, viewerKey). Public viewCount = unique viewers; impressions + avg dwell secondary. Self-views (owner) dropped server-side. Anonymous allowed, rate-limited `things.views`, batch ≤50 events, posts validated via canView.
- Friends ACL: wire real friend graph into `tt:userFriends` visibility (circles plumbing in things.ts) — friends-only posts become real. Family stays owner-only stub.
- Emoji fix: PostCard `reactionDisplayEmojis` renders full tokens (done).

## New endpoints (each needs: route file + [...].ts import map + apiDocs entry + rate-limit default + useApi method)

- POST /api/v1/users/follow — toggle/explicit follow. → notif `new-follower`
- POST /api/v1/users/friend — intent: request|cancel|accept|decline|unfriend. → notifs `friend-request`, `friend-accepted`
- GET /api/v1/users/relationships?username|userId — counts + viewer state (anon ok)
- GET /api/v1/users/connections?userId&type=followers|following|friends — public lists
- GET /api/v1/notifications — list + unreadCount (pref-filtered)
- POST /api/v1/notifications/read — { ids? | all }
- GET+POST /api/v1/notifications/settings — prefs
- POST /api/v1/things/views — anonymous batch view events

## Progress

- [x] Explore + design
- [x] Emoji fix: PostCard.tsx reactionDisplayEmojis full tokens (+ comment, drop unused splitEmojis import)
- [x] registry.ts: follow/friend/notification schemas; all three → PROTECTED_THINGTIME (forged friend doc would fake acl); NOTIFICATION_TYPES; AclViewer.friendIds + real tt:userFriends evaluation
- [x] collections: postViews registration + home getter + unique (postId, viewerKey) idx; follow/friend unique partial idx in createThingsDataIndexes
- [x] utils: users/social.ts (setFollow, friendAction state machine, relationshipSummary, listConnections, friendIdsOf, followerIdsOf) — home-pinned
- [x] utils: notifications (emit/emitBulk/list/markRead + per-recipient trim @500) + users.ts get/setUserNotificationPrefs (secure blob, dual-era)
- [x] utils: views (recordPostViews + resolveViewStats) + exported getRequestIp from rateLimit/enforce
- [x] things.ts: viewCount/viewStats in toPublicPosts (parallel resolve); emitCreationNotifications in createThing (covers react/comment/reply/share/post fan-out — single funnel); withFriendIds plumbing in getFeed/getThing/listUserPosts/listThings/findViewableThing; visibilityQueryFor friends clause; listUserPosts widened for friends
- [x] routes ×8 + [...].ts import map + apiDocs ×8 (group social/notifications/things) + rate limits ×8 + useApi social/notifications methods
- [x] UI: RelationshipControls (counts + follow/friend buttons + unfriend confirm + requests inbox) in ProfilePage
- [x] UI: SettingsPage Notifications section (NotificationSettings.tsx, optimistic + per-user localCache)
- [x] UI: Nav NotificationsBell (badge + popover + mark-all-read + click-through) + mobile overlap fix (nav-right z-index above commander host; commander mobile reservation 160→200px)
- [x] UI: PostCard views stat (Eye + compact count + tooltip: uniques/impressions/avg dwell)
- [x] UI: useViewTracking (1s qualify @50%, dwell/ratio/pos, 10s flush + beacon, webdriver skip) wired in PostList (feed+profile) + PostPage
- [x] apiTests additions (7) + TESTING.md sections (3) + remix/CHANGELOG.md entry
- [x] Live browser verification (see log)
- [ ] Commit, push, PR open, verify checks
- [ ] (later loops) Vercel preview check; consider connections list modals on profile counts; consider /notifications full page + drawer entry

## Verification log

- 2026-08-03, local dev (worktree trio 15590/15591/15592, real Mongo, real API — no direct DB writes):
  - curl end-to-end (users viewsa78512/viewsb78512/viewsc78512): register → post → follow (count 1, new-follower notif) → 2nd post (post-from-followed fan-out w/ preview) → friend request (pending-outgoing; recipient incomingRequests=1; requests list) → accept (friends; friend-accepted notif) → relationships viewer state → connections lists → friends-only post readable by friend (permalink + FEED + after-unfriend 404; anon 404) → views (unique dedup on replay, anon UA counted, UA-less dropped, self-view dropped; viewCount 2 / impressions 3 / avgDwell 3600ms public) → reaction pref off suppresses reaction notif → multi-emoji react stored whole → comment notif → mark-all-read (3→0) → unfollow/unfriend clean.
  - Browser UI (desktop 1280 + mobile 375): full multi-emoji token on react button; 👁 counts on cards (live client tracking confirmed — browsing alone minted real views); bell badge 1→popover→0 with correct items/copy/previews; profile counts + Follow→Following ✓ (optimistic, POST 200) + Add friend→Requested ⏳ + inbox Accept (2 friends); Settings Notifications section (Reactions switch reflected server OFF state, UI flip persisted server-side); /tests battery 249 passed / 1 failed (the anonymous-current-user test — browser was logged in; environmental).
  - Visual: settings/profile/feed/popover clean at desktop + 375px, no overflow/overlap. FIXED a real mobile defect: bell + username sat under the commander search pill (untappable) — nav-right z-index + pill reservation. Ghost-transparent popover in one screenshot = hidden-pane rAF freeze (tool artifact, opacity completed to 1).
