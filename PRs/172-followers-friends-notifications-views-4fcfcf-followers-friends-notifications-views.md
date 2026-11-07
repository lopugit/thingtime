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
- [x] Commit, push, PR open, verify checks (PR #172; Vercel preview green)
- [x] Vercel preview verified (see log). Optional future ideas: consider connections list modals on profile counts; consider /notifications full page + drawer entry

## Verification log

- 2026-08-03, local dev (worktree trio 15590/15591/15592, real Mongo, real API — no direct DB writes):
  - curl end-to-end (users viewsa78512/viewsb78512/viewsc78512): register → post → follow (count 1, new-follower notif) → 2nd post (post-from-followed fan-out w/ preview) → friend request (pending-outgoing; recipient incomingRequests=1; requests list) → accept (friends; friend-accepted notif) → relationships viewer state → connections lists → friends-only post readable by friend (permalink + FEED + after-unfriend 404; anon 404) → views (unique dedup on replay, anon UA counted, UA-less dropped, self-view dropped; viewCount 2 / impressions 3 / avgDwell 3600ms public) → reaction pref off suppresses reaction notif → multi-emoji react stored whole → comment notif → mark-all-read (3→0) → unfollow/unfriend clean.
  - Browser UI (desktop 1280 + mobile 375): full multi-emoji token on react button; 👁 counts on cards (live client tracking confirmed — browsing alone minted real views); bell badge 1→popover→0 with correct items/copy/previews; profile counts + Follow→Following ✓ (optimistic, POST 200) + Add friend→Requested ⏳ + inbox Accept (2 friends); Settings Notifications section (Reactions switch reflected server OFF state, UI flip persisted server-side); /tests battery 249 passed / 1 failed (the anonymous-current-user test — browser was logged in; environmental).
  - Visual: settings/profile/feed/popover clean at desktop + 375px, no overflow/overlap. FIXED a real mobile defect: bell + username sat under the commander search pill (untappable) — nav-right z-index + pill reservation. Ghost-transparent popover in one screenshot = hidden-pane rAF freeze (tool artifact, opacity completed to 1).

- 2026-08-03, Vercel preview (https://thingtime-git-claude-followers-friends-44ca70-lopugits-projects.vercel.app):
  all 8 new -docs routes 200 (Nitro route table registration proven in the production build); anon
  relationships 404 json; anon views POST accepted (unknown ids dropped, counted 0); notifications 401
  anon; anon feed payload carries viewCount + viewStats. PR #172 checks: Vercel SUCCESS, CodeQL/actions
  green, GitGuardian pass, mergeable. Loop task complete — cron job deleted.

---

## Addendum: per-channel toggles (push + email) & SES notification emails (2026-08-03)

Second feature drop on this PR: every notification type now has SEPARATE push
(bell/in-app) and email switches plus a master switch per channel, and the
notification system emails via the existing AWS SES layer.

- [x] Prefs model: stored `meta.notificationPrefs` keeps the original flat keys as the PUSH channel (zero migration); new nested `email` + `masters` keys; `normalizeNotificationPrefs` in `schemas/registry.ts` is the one shared defaults brain (absent=ON, post types email-opt-in; accepts stored AND wire shape — idempotent).
- [x] Settings API: GET/POST `/api/v1/notifications/settings` now speaks the channel matrix `{ prefs: { push, email, masters } }`; flat legacy POST body still patches push; unknown keys 400; nested one-level merge in `setUserNotificationPrefs` (secure-blob CAS + legacy dot-path `$set`).
- [x] Email sends: new `notification` EmailStream (from = `THINGTIME_EMAIL_NOTIFICATIONS_FROM` → transactional fallback), `api/utils/notifications/emails.ts` rides emitNotification/emitNotificationsBulk fire-and-forget — verified addresses only, master+type gates, ≤10/recipient/hour outbox throttle, per-type subjects/copy in `email/templates.ts`, manage + one-click unsubscribe links in every footer.
- [x] One-click unsubscribe: `GET /api/v1/notifications/email/unsubscribe?uid&token` (HMAC over userId, secret = `THINGTIME_EMAIL_UNSUB_SECRET` → JWT secret fallback; timing-safe compare) flips ONLY `masters.email` off, tiny HTML confirmation page, IP rate-limited, idempotent.
- [x] Weekly summary digest: email-only type `weekly-summary`; `api/utils/notifications/weeklySummary.ts` (one notification aggregation for all recipients + per-user posts/views counts, zero-activity skip, 6-day outbox idempotency lookback); route `GET|POST /api/v1/notifications/email/weekly-summary` (admin session OR `CRON_SECRET` bearer; dryRun mode); Vercel cron Sun 21:37 UTC (= Mon 07:37 AEST) in `remix/vercel.json`.
- [x] UI: `NotificationSettings.tsx` rebuilt as a switch matrix — Push|Email column headers, master row, per-type rows (weekly-summary shows — in the push column), master-off dims+disables its column, optimistic + revert, cache key bumped to `tt-notif-prefs-v2-<id>`.
- [x] Read-side: push master OFF empties bell list + badge; per-type read filtering unchanged (now channel-aware).
- [x] Registration: 2 new routes in `server/routes/api/[...].ts` + apiDocs entries (auto Nitro registration + -docs tests); rate-limit bucket `notifications.emailUnsubscribe`; email_messages indexes for throttle + digest lookback; apiTests updated (settings matrix shape) + 2 new tests (unsubscribe bad-token, weekly-summary gate w/ dryRun so admin /tests runs never send).
- [x] Docs: README "Notification emails" env setup, TESTING.md checklist additions, CHANGELOG entry.
- [ ] Verification log (below) — local API battery + browser visual (desktop/375px) + outbox evidence.

### Verification log (addendum, 2026-08-03)

- Local dev (worktree trio 19030/19031/19032, real Mongo localhost, real API, THINGTIME_EMAIL_PROVIDER=console so outbox rows are written but no real SES sends):
  - curl battery **37/37 PASS** (fresh users nta/ntb + env-admin ntadmin2): matrix defaults (email post types OFF, weekly-summary ON), legacy flat POST patches push, weekly-summary rejected in push map, unknown email type 400; follow → bell + `notification.new-follower` outbox row; reaction + comment emails; email master OFF blocks emails while the bell keeps receiving; per-type email OFF blocks just that type; friend-request email; unsubscribe link from email text (200 page, master flipped off, idempotent, tampered token 400); throttle capped at exactly 10/recipient/hour; weekly summary anon 401 / non-admin 403 / admin dryRun / CRON_SECRET bearer run (digest row for A) / second run idempotent via alreadySent / wrong secret 401.
  - Push master OFF → GET /notifications returns 0 items + unreadCount 0; back ON → all 18 restored (read-time filter, nothing deleted).
  - /tests in-browser battery: **269 passed / 1 failed** — the failure is the known environmental "Current user anonymous" test (browser session logged in), same as the original PR run. All 3 new notification tests PASS.
  - Browser UI (1280 desktop + 375 mobile): settings matrix renders with PUSH|EMAIL column headers, "All notifications" master row, weekly-summary email-only row (— in push column); flipping the email master instantly dims + disables the whole email column (screenshot-verified) and persists (masters.email=false server-side); per-type email flip (post-from-friend) persists + reverts; mobile 375px shows no overflow/misalignment/collisions; unsubscribe confirmation page clean at 375px.
  - Gotchas for future runs: env-admin usernames can't self-register (register first, then restart with ADMIN_USERNAMES); killing vite leaves nitro on :19032 (kill the whole port trio); outbox evidence lives in email_messages_v2 on the LOCALHOST connection line (the other MONGODB_CONNECTION_STRING line is Atlas prod — read-only, never write).
