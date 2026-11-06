# Notification agency and accountable-delivery baseline

**Status:** Evidence note; no implementation is authorized by this document

**Grounded:** 2026-09-09, Australia/Melbourne

**Plan:** [Notification agency and accountable-delivery roadmap](../PLAN/notification-agency-and-accountable-delivery-roadmap.md)

**Execution epic:** [TODO 37 — Notification agency and accountable delivery](../TODO/claude-todo/37-notification-agency-and-accountable-delivery.md)

## Why preserve this note

Thingtime now keeps an owner-private notification history independently of
delivery preferences. That is a meaningful foundation: quiet action runs,
successful sign-ins, and Lopu messages can remain findable even when a person
does not want another push or email. It does not yet prove that a notification
was sent, accepted by a provider, received by a device, displayed, perceived,
read, understood, acknowledged, acted on, or resolved.

Those distinctions matter whenever a message carries security, moderation,
collaboration, recovery, or action-outcome meaning. This note proposes a common
vocabulary and one low-risk pilot before Thingtime turns history into a claim
of communication.

This is product and engineering research, not legal advice or a claim that any
external notification channel is operational. [TODO 24](../TODO/claude-todo/24-attention-agency-and-calm-use.md)
owns whether and when Thingtime should interrupt; this chain owns what can be
truthfully said happened across the event, record, delivery, display, response,
and remedy lifecycle.

## Evidence ledger

| Claim | Current evidence | Confidence and refresh trigger |
| --- | --- | --- |
| Notification history is now stored independently of push preferences. | [`emitNotification()`](../remix/app/api/utils/notifications/notifications.ts) writes the protected notification Thing before checking push/email preferences, while `historyOnly` suppresses delivery. [`buildNotificationListFilters()`](../remix/app/api/utils/notifications/listQuery.ts) bypasses delivery preference filters when `history=1`. Merged PR [#705](https://github.com/lopugit/thingtime/pull/705) records the change and its real-API verification. | High for the inspected `develop` snapshot. Recheck after notification persistence, preference, or list-query changes. |
| The current record is owner-private and protected. | [`notificationDoc()`](../remix/app/api/utils/notifications/notifications.ts) stamps `ownerId` as the recipient, `ACL_OWNER`, a protected notification kind, bounded preview/title/link fields, and a server-created identifier. Notification collection access is home-pinned. | High for the current writer and registry. Recheck projections, collection routing, and indexes together. |
| History currently records creation and read state, not a complete delivery lifecycle. | `PublicNotification` exposes `createdAt` and `readAt`, plus type, actor snapshot, target, text, link, and an optional `ok`/`error` outcome. No provider-accepted, device-received, displayed, expired, superseded, acknowledged, action-started, or remedied state appears in that public shape. | High for the inspected types. Absence from this shape is not proof that an external provider has no separate telemetry. |
| Persistence failure cannot fail the underlying social or product action. | `emitNotification()` catches storage errors, and APNs/email work is fire-and-forget. This preserves the primary action but means successful action completion is not evidence that history or delivery succeeded. | High for the current path. Recheck after transaction or reliability changes. |
| History-only and read are not equivalent concepts. | `historyOnly` means “store without sending.” Client-recorded Lopu messages are written with `historyOnly: true` and an initial `readAt`, because they were already presented in-app. A stored row therefore cannot be interpreted as unseen, delivered externally, or acknowledged without additional evidence. | High for the current record-message path. Recheck after toast/history reconciliation changes. |
| Client messages cannot impersonate authoritative action or login events. | [`parseNotificationMessage()`](../remix/app/api/utils/notifications/recordMessage.ts) allowlists fields, binds the account and UUID, strips URL query/fragment material, redacts credential-like text, and always records the client path as `system-message`; server-owned writers create action/login types. | High for the current parser. Recheck every new producer and type-registration path. |
| Search and pagination are bounded but retention is undecided. | The [list query](../remix/app/api/utils/notifications/listQuery.ts) caps pages at 50, type filters at 32, and search at 100 characters; it supports a stable `before` cursor and date/type/category filters. PR #705 removed the former 10,000-row count trim, so no approved user-facing retention, expiry, archive, export, or deletion policy is established here. | High for current code and merged PR record. Storage policy and deployment behavior require separate confirmation. |
| Actor presentation can change after the original event. | Notification rows store an actor snapshot, but list enrichment prefers current profile data so renamed accounts and avatars stay fresh. That is useful presentation behavior, not an immutable claim about how the actor appeared when the event occurred. | High for the inspected reader. Decide historical-display semantics before calling the row an audit receipt. |
| The notification vocabulary mixes social events, security events, action outcomes, and already-presented Lopu messages. | [`NOTIFICATION_TYPE_META`](../remix/app/components/Notifications/notificationCore.ts) includes friend/follow/post/comment/reaction/share/mention, action-run, login-success, system-message, and subspace administration/moderation families. Their sensitivity, urgency, expiry, response, and remedy needs are not interchangeable. | High for the current registry. Re-run whenever a type is added or semantics change. |
| Current accessibility guidance distinguishes status from interruption. | W3C's [WCAG 2.2 status-message guidance](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) says important dynamic results should be programmatically determinable without taking focus and warns against unnecessarily chatty announcements. | High for the cited guidance. Whether Thingtime conforms requires complete-journey testing, not this note. |
| Platform guidance supports consent, relevance, sensitivity, and honest urgency. | Apple's [Notifications](https://developer.apple.com/design/human-interface-guidelines/notifications/) and [Managing notifications](https://developer.apple.com/design/human-interface-guidelines/managing-notifications) guidance recommends consent, concise high-value messages, avoiding duplicates and sensitive lock-screen content, and assigning interruption levels honestly. | High as design input, not a cross-platform compliance rule. Recheck when target platforms change. |
| Transport receipts still do not prove human attention or action. | IETF [RFC 8030](https://datatracker.ietf.org/doc/html/rfc8030) distinguishes push-service acceptance, TTL/expiry, user-agent acknowledgement, and delivery receipts. Its protocol receipt is transport evidence, not proof that a person saw, understood, or acted on content. | High for the protocol distinction. Confirm each actual provider's available semantics before integration. |
| Notification history can reveal sensitive behavior even without message bodies. | Event type, actor, target, timing, outcome, read state, and delivery channel can expose relationships, login patterns, moderation events, routines, or failed actions. The OAIC [PIA guide](https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/privacy-impact-assessments/guide-to-undertaking-privacy-impact-assessments) is a useful process reference, and current [APP 3 guidance](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-3-app-3-collection-of-solicited-personal-information) emphasizes data minimisation. | High for the risk class; legal applicability is deliberately undecided. Complete an approved privacy review before widening collection or retention. |
| The live tracker contains no open issues dedicated to this contract. | `gh issue list --repo lopugit/thingtime --state open` returned no issues on 2026-09-09. PR #611 remains open even though the narrower persistence correction in PR #705 merged, so branch presence must not be confused with the current contract. | High for the timestamp only. Refresh tracker and deployed behavior before implementation. |

## A truthful lifecycle vocabulary

These proposed meanings are deliberately narrower than everyday language.

| State | What it may prove | What it must not imply |
| --- | --- | --- |
| Event observed | An approved producer reported a versioned event. | The event is true outside that producer's authority. |
| History recorded | Thingtime durably stored an owner-authorized record. | A channel was attempted or a person was notified. |
| Delivery eligible | Policy and preferences allowed one channel attempt. | An attempt occurred or the channel accepted it. |
| Delivery requested | Thingtime handed a bounded payload to a channel adapter. | Provider acceptance, device receipt, or display. |
| Provider accepted | The channel returned its defined acceptance response. | Device delivery, timeliness, or human attention. |
| Device acknowledged | The provider/user agent supplied its defined transport receipt. | Visible display, comprehension, or user action. |
| Presented in app | Thingtime rendered or announced the message in an active experience. | The person perceived or read it. |
| Marked read | The account explicitly or automatically changed a UI state under a declared rule. | Understanding, agreement, acknowledgement, or outcome. |
| Acknowledged | The person deliberately confirmed receipt where acknowledgement is genuinely required. | Consent, agreement with the message, or completion of its action. |
| Action accepted | A separately authorized action request was accepted. | The action completed successfully. |
| Outcome verified | The canonical product state satisfies the declared completion predicate. | The person saw the notice or agrees with the result. |
| Remedied/closed | The approved correction, support, appeal, or recovery path reached a terminal state. | Earlier failures or records disappeared. |

Unknown, unavailable, expired, superseded, and failed are first-class states.
Never collapse them into success, unread, or silence.

## Strengths to preserve

- **History does not force interruption.** A person can retain useful records
  without enabling push or email.
- **The underlying action stays primary.** Notification failure does not roll
  back a successful social or product action.
- **Protected ownership is explicit.** History belongs to the recipient and is
  not a public activity feed.
- **Producer authority is partially separated.** Client-created messages
  cannot claim server-owned login or action event types.
- **Bounded input and safe links exist.** Text, search, pages, types, and
  internal click-through paths have explicit limits.
- **Stable pagination and filtering support recovery.** People can search and
  revisit records without delivery settings hiding them.

## Gaps that keep accountability implicit

1. **One row carries several meanings.** Event evidence, history, delivery,
   display, read state, action outcome, and remedy are not modeled separately.
2. **Channel attempts have no canonical receipt state.** Fire-and-forget work
   and console errors cannot support an owner-facing “sent” or “delivered”
   claim.
3. **Read semantics are producer-specific.** A Lopu message can begin read,
   while other rows begin unread; the UI contract is not versioned in data.
4. **Retention became open-ended.** Removing arbitrary count pruning prevents
   silent loss but creates unresolved privacy, storage, export, delete, archive,
   and expiry decisions.
5. **Event provenance is incomplete.** The public record lacks producer,
   policy, template, sensitivity, and semantic-version receipts.
6. **Expiry and supersession are absent.** A stale login, action, invitation,
   or moderation link can remain actionable-looking after its meaning changes.
7. **Sensitive presentation policy is not centralized.** A safe stored detail
   can still be unsuitable for a lock screen, email subject, shared device, or
   assistive announcement.
8. **Failures can disappear operationally.** Storage, provider, device, and
   application failures need bounded internal evidence without leaking message
   content or turning logs into another history store.
9. **No remedy contract follows consequential notices.** Some categories need
   correction, support, appeal, security review, or retry—not merely dismissal.
10. **No complete-journey acceptance suite exists.** Producer authorization,
    policy, persistence, channels, accessibility, expiry, action, and remedy
    have not been tested as one state machine.

## Candidate first pilot

Start with one synthetic, owner-triggered, non-sensitive action run in a private
test account. Record the server-observed event and owner-private history; show
one accessible in-app status; bind the result to the action's canonical outcome
predicate; and let the owner inspect, mark read, export, and delete the pilot
record under an approved temporary retention rule.

The pilot is in-app only. It excludes push, email, SMS, marketing, social
fan-out, login alerts, moderation/safety cases, scheduled recurrence, external
senders, minors, institutions, real secrets, and high-impact actions. It does
not add an acknowledgement step unless the selected action genuinely requires
one, and it never treats read state as completion.

## Measures without attention surveillance

| Measure | Candidate definition | Guardrail |
| --- | --- | --- |
| State comprehension | Participants correctly distinguish recorded, presented, read, action-complete, and failed. | No score based on opens, response speed, or time in history. |
| Receipt fidelity | Each displayed state matches deterministic server/provider evidence. | Unknown remains unknown; do not infer human attention. |
| Preference fidelity | History and delivery follow separate approved choices across sessions and account switches. | No silent preference reset or delivery side effect. |
| Recovery success | A person can find the event, inspect outcome, and use the approved remedy after reload. | Do not retain extra content merely to improve recovery. |
| Accessibility | Status, history, and controls work across approved assistive and viewport profiles. | Avoid focus theft and duplicate announcements. |
| Data minimisation | Stored fields, operational evidence, and retention match the approved purpose. | Message content and relationship graphs never enter analytics. |

## Privacy, security, abuse, and accessibility boundaries

- Treat notification metadata and history as private content, not engagement
  telemetry. Do not build person-level attention or response-latency profiles.
- Store the minimum event and receipt evidence needed for the approved purpose;
  keep payload content out of provider receipts, logs, metrics, traces, and
  analytics.
- Render lock-screen, email, push, and shared-device previews from distinct
  sensitivity-aware templates. Do not assume an owner-private database row is
  safe outside the app.
- Authenticate every producer, authorize every recipient and target, version
  every event type, and reject cross-account, cross-origin, replayed, forged,
  stale, or unknown events.
- Keep dismissal, read, acknowledgement, action, correction, report, appeal,
  unsubscribe, delete, and support as distinct intents.
- Do not let senders or administrators observe a recipient's read state unless
  a separately approved, necessary, reciprocal contract exists.
- Rate-limit and collapse duplicate interruptions without silently deleting
  truthful history; expose unknown/failure states without retry storms.
- Make status changes programmatically determinable without unnecessary focus
  changes. Test screen-reader verbosity, keyboard/touch order, zoom/reflow,
  reduced motion, sound-off, contrast, locale, long text, and slow networks.

## Open decisions

1. Which lifecycle states are necessary for the first in-app-only pilot?
2. What exactly sets `readAt`, and when may an already-presented message begin
   read without hiding it from the owner?
3. Which event fields are immutable snapshots and which may resolve to current
   profile, policy, or target state?
4. What retention, export, delete, legal-hold, backup, and expiry contract
   applies per category?
5. Which categories require a remedy or support link, and who owns it?
6. What provider evidence is available for each future channel, and what honest
   label maps to it?
7. How are stale links, expired invitations, superseded outcomes, deleted
   targets, and revoked access displayed?
8. Which content is safe for in-app detail but forbidden from lock-screen,
   push, email subject, logs, and assistive announcements?
9. Who can approve an urgency or acknowledgement requirement, and who can stop
   delivery when it is misclassified?

## Refresh checklist

- Re-read the notification registry, writers, list query, projections, history
  UI, settings, APNs/email adapters, action/login producers, indexes, API docs,
  and capability manifest.
- Verify real behavior in an authenticated desktop/mobile browser before
  promoting repository evidence to a usability claim.
- Re-query PR #611, PR #705, current open issues, and exact deployed behavior.
- Recheck external standards and provider semantics before adding any channel.
- Record owner-approved retention, state, urgency, and remedy decisions in
  [`DECISIONS.md`](../DECISIONS.md), not by editing this evidence ledger.
