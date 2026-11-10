# Notification email/push toggles + SES email notifications — loop status

STATUS: IN_PROGRESS
STARTED: 2026-08-03
BRANCH: claude/followers-friends-notifications-views-4fcfcf (PR #172)
WORKTREE: .claude/worktrees/notification-toggles-email-push-3fdf6e (branch reset onto origin/claude/followers-friends-notifications-views-4fcfcf; push via HEAD:claude/followers-friends-notifications-views-4fcfcf)

## Task
- Per-notification-type toggles for BOTH push and email channels, plus top-level master toggles for each channel.
- SES-backed email notification system: likes/reactions, friend requests, weekly summaries, etc.
- Test thoroughly incl. browser visual checks (no overlaps/overflows/glitches), push to PR #172.

## Progress log
- 2026-08-03: Session started, cron loop armed (a54baa5e), branch reset to a4546c6.

## Design (decided 2026-08-03)
- Prefs storage (user blob, backward compat): { push?: {type:bool}, email?: {type:bool}, masters?: {push,email} }; legacy top-level {type:bool} folds into push map on read. Absent = ON, except email defaults OFF for post-from-followed/post-from-friend (high volume).
- EMAIL_NOTIFICATION_TYPES = NOTIFICATION_TYPES + weekly-summary (email-only).
- Wire: GET/POST /api/v1/notifications/settings → prefs { push, email, masters }; POST accepts legacy flat shape → push channel.
- Bell read filter + write-side emit skip use push channel (master+type). Email sent at emit time when email master+type on: new utils notifications/emails.ts + per-type templates, stream 'notification' (new EmailStream member, from = THINGTIME_EMAIL_NOTIFICATIONS_FROM || transactionalFrom), throttle ~10/recipient/hour via email_messages outbox count, metadata {notificationType, recipientId}.
- Bulk fan-out: doc writes stay pref-agnostic; emails batch-read prefs, only opted-in recipients.
- Weekly summary: sendWeeklySummaryEmails() digest from notification things + postViews last 7d; skip empty; idempotent via outbox lookback (6d); POST /api/v1/notifications/email/weekly-summary (admin/cron). One-click unsubscribe route flips email master (tokenized) if newsletter pattern supports it.
- UI: NotificationSettings matrix — master switches (Push/Email) + per-type two-switch columns, weekly-summary email-only; disabled+dimmed when master off; cache key tt-notif-prefs-v2-<id>.
- New routes need 3-place registration (route file, [...].ts import map, apiDocs) + tests in apiTests.ts + README env docs + CHANGELOG + PR note + TESTING.md.

## 2026-08-03 progress
- Implementation COMPLETE (server + routes + UI + docs + tests). Client vite build green.
- API battery: 37/37 PASS (scratchpad/battery.sh vs foreground stack :19030, console provider,
  ADMIN_USERNAMES=ntadmin2, CRON_SECRET set). Covers defaults/legacy/validation/gating/unsub/throttle/digest.
- Gotchas hit: env-admin usernames can't self-register (login ntadmin2 + restart stack);
  vite kill leaves nitro on :19032 (kill all three ports); outbox reads = email_messages_v2
  on LOCALHOST line of MONGODB_CONNECTION_STRING (line 4 is Atlas prod — do not touch).
- NEXT: browser visual checks (settings matrix desktop+375, unsub page, /tests run), then
  graphify update, commit, push to origin claude/followers-friends-notifications-views-4fcfcf (PR #172).

## 2026-08-03 push
- Commit 21c5cb7 pushed to origin/claude/followers-friends-notifications-views-4fcfcf (PR #172, head 21c5cb70).
- Remaining before COMPLETE: Vercel preview green + spot-check preview URL, then delete cron a54baa5e and stop dev stack.

## STATUS: COMPLETE (2026-08-03)
- Pushed 21c5cb7 to origin/claude/followers-friends-notifications-views-4fcfcf (PR #172 head 21c5cb70).
- Vercel preview deployment PASS; new endpoints verified live on preview (settings 401 anon, weekly-summary 401 anon, unsubscribe bad-token 400, all three -docs routes 200).
- Local: curl battery 37/37, /tests 269 passed / 1 known environmental fail, browser visual desktop+375px clean (matrix, master dimming, unsubscribe page — no overlaps/overflows).
- Cron a54baa5e deleted; dev stack stopped. Nothing left to do.
