# Attention agency and calm-use baseline

**Status:** Evidence note; no implementation is authorized by this document

**Grounded:** 2026-09-02, Australia/Melbourne

**Plan:** [Attention agency and calm-use roadmap](../PLAN/attention-agency-roadmap.md)

**Execution epic:** [TODO 24 — Attention agency and calm use](../TODO/claude-todo/24-attention-agency-and-calm-use.md)

## Why preserve this note

Thingtime should be delightful enough to return to without being engineered to
be difficult to leave. The repository already says time-on-site is not a north
star and provides unusually strong user controls: a chronological feed that
does not train, inspectable personal algorithms, deletion, and granular
notification switches. The same product also auto-loads feed pages, learns from
passive views and dwell, and celebrates a growing training count.

Those facts are not proof of harm. They are evidence that attention agency
deserves an explicit product contract before growth work treats more scrolling,
training, notifications, or return frequency as success.

This note is a product and engineering baseline, not medical advice or a legal
determination. The [trustworthy adoption roadmap](../PLAN/trustworthy-adoption-roadmap.md)
owns the wider adoption outcome; this chain owns the narrower feed,
recommendation, notification, and session-boundary contract.

## Evidence ledger

| Claim | Current evidence | Confidence and refresh trigger |
| --- | --- | --- |
| The feed automatically requests another page before the reader reaches the end. | [`PostList.tsx`](../remix/app/components/Feed/PostList.tsx) mounts an `IntersectionObserver` sentinel with a `600px` root margin and calls `onLoadMore`; it also keeps a visible “Load more” fallback. | High for this branch. Recheck when feed pagination or virtualization changes. |
| Passive exposure trains an active personal algorithm. | [`useFeedEngagement.ts`](../remix/app/components/Feed/useFeedEngagement.ts) records one view and dwell per post per session after 50% visibility, caps dwell at 60 seconds, and flushes batches every eight seconds or on page hide. | High for repository behavior, not a claim about production volume. Recheck the hook and track endpoint together. |
| Ranking rewards only positive inferred or explicit signals. | [`feedRanking.ts`](../remix/app/api/utils/things/feedRanking.ts) assigns positive weight to view, dwell, expand, react, comment, and share. The inspected ranking path has no “less like this”, hide, or negative-weight signal. | High for the current ranking module. Search again if the signal vocabulary changes. |
| A no-training alternative is already directly available. | [`AlgorithmManager.tsx`](../remix/app/components/Settings/AlgorithmManager.tsx) describes “Latest” as newest-first with no training. It also lets an owner inspect top interests, switch algorithms, branch, unshare, and delete. | High for repository presence. Live discoverability and comprehension were not tested in this docs-only run. |
| The feed makes training visible, but frames accumulation as progress. | [`AlgorithmMenu.tsx`](../remix/app/components/Feed/AlgorithmMenu.tsx) shows a pulsing learning indicator and a growth stage based on accumulated session/server events; the idea bank describes algorithm maturation as a reason to return and “raise” a feed. | High for current copy and mechanics. Whether people experience this as helpful or pressuring is an untested hypothesis. |
| Notification controls are granular and optimistic. | [`NotificationSettings.tsx`](../remix/app/components/Settings/NotificationSettings.tsx) provides master push/email switches and per-type controls, paints cached preferences first, and reverts failed optimistic changes. | High for repository behavior. Recheck keyboard, screen-reader, and mobile behavior live before claiming accessibility. |
| Most email notification types, including the weekly summary, currently default on when no preference is stored. | [`normalizeNotificationPrefs`](../remix/app/schemas/registry.ts) defaults both channel masters on and defaults email on except `post-from-followed` and `post-from-friend`. `weekly-summary` is not in that default-off list. | High for the current normalization contract. This is a default analysis, not evidence that emails are enabled in every deployment or delivered to any person. |
| The weekly summary has useful anti-spam bounds. | [`weeklySummary.ts`](../remix/app/api/utils/notifications/weeklySummary.ts) sends only to verified eligible addresses, skips people with no activity, avoids another digest within six days, and caps a run at 2,000 candidates. | High for repository behavior. Recheck scheduler, email configuration, and live delivery before calling it operational. |
| Existing adoption policy rejects compulsive engagement as success. | The [ethical adoption baseline](./ethical-adoption-baseline.md) and [trustworthy adoption roadmap](../PLAN/trustworthy-adoption-roadmap.md) explicitly reject time-on-site, notification opens, and dark patterns as north-star outcomes. | High for planning intent. It is not yet a feed/notification acceptance test. |
| External standards support user control and recommender transparency as useful design targets. | W3C's [Timing Adjustable guidance](https://www.w3.org/WAI/WCAG21/Understanding/timing-adjustable) emphasizes control over timed, scrolling, or auto-updating experiences. [EU Digital Services Act](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=celex:32022R2065) Articles 25 and 27 describe free and informed interface choices plus plain-language recommender parameters and controls in the relevant regulated context. | High for the source text. Applicability to Thingtime is intentionally undecided; use these as design references, not a compliance claim. |

## Strengths to preserve

- **Latest is a real exit from ranking.** It is chronological, easy to explain,
  and does not train.
- **Algorithms belong to the user.** They can be named, inspected at a useful
  summary level, branched, unshared, selected, and deleted.
- **Sharing is explicit.** The UI warns that a branched copy carries learned
  interests and survives later unsharing.
- **Notifications are controllable.** Master and per-type switches exist for
  both in-app and email channels, and high-volume post emails default off.
- **The weekly summary is bounded.** Empty summaries and duplicate weekly sends
  are suppressed.
- **The adoption plan has the right north-star posture.** Useful completed work,
  not minutes consumed, is the intended outcome.

## Gaps that keep agency implicit

1. **Continuation is automatic.** The visible “Load more” control is a fallback,
   not the normal boundary. A person has no durable setting for manual pages,
   finite catch-up, or automatic continuation.
2. **Passive signals have no per-algorithm pause.** A person can switch to
   Latest or delete an algorithm, but cannot keep ranked results while pausing
   training or exclude one browsing session from learning.
3. **The feedback vocabulary is one-sided.** Every supported training signal is
   positive. There is no explicit “less like this”, “not relevant”, undo, or
   inspect-and-correct path for a mistaken inference.
4. **Why-this explanations are incomplete.** Top interests explain the learned
   profile globally, but a person cannot see why one post was ranked or which
   signal most influenced it.
5. **Accumulation is celebrated without a completion boundary.** Training
   stages reward more observed moments. There is no equally visible “caught
   up”, “pause here”, or “you came to do X and it is done” state.
6. **Calm notification defaults are not decided as a policy.** Per-type controls
   exist, but most email categories and the weekly summary are on by absence.
   There is no documented quiet window, batching rule, urgency taxonomy, or
   default review for new notification types.
7. **No attention-safety acceptance suite exists.** Current plans reject dark
   patterns in prose, but feed and notification changes do not yet have a
   repeatable agency checklist or stop condition.

## Candidate agency contract

These are proposals for owner review, not locked decisions.

### Feed and session controls

- Keep `Latest` one direct action away anywhere ranking is active.
- Offer a durable continuation preference: manual pages, finite catch-up, or
  automatic loading. Recommend **manual pages for new accounts**, while
  preserving opt-in automatic loading for people who prefer it.
- Make any finite catch-up boundary deterministic and explain what it means; do
  not invent “all caught up” when older or filtered content still exists.
- Allow a session intention such as browse, catch up, find, or create to stay
  local to the device. Do not upload goals or turn them into a productivity
  score.
- A reminder or boundary must be dismissible, keyboard and screen-reader
  accessible, non-shaming, and never block saving, messaging, or safety work.

### Recommendation controls

- Separate **ranking on/off** from **training on/off**. Pausing training should
  not force a person to delete their algorithm or abandon ranked results.
- Add explicit corrective signals with undo and predictable scope: one post,
  author, tag, type, or algorithm. Never infer a sensitive trait label.
- Explain “why this?” from the same deterministic feature/weight path used to
  score the post. Do not generate a persuasive story after the fact.
- Let people reset selected interests or a whole algorithm with a preview and
  clear consequence; deletion remains available.
- Preserve `Latest` as a first-class no-profile mode, not a degraded or hidden
  choice.

### Notification controls

- Define urgency classes before adding channels: security/account, direct
  person-to-person, social activity, and summaries.
- Recommend security/account notices remain reliable while optional social and
  summary email is explicit opt-in for new accounts. Existing choices must be
  preserved through a versioned migration, never silently reset.
- Add quiet windows and batching only after timezone, delay, emergency bypass,
  accessibility, and multi-device semantics are decided.
- Every new notification type declares default per channel, purpose, batching,
  retention, unsubscribe/mute behavior, abuse risk, and test coverage.
- Never optimize delivery frequency from a person's response latency or
  inferred vulnerability.

## Measurement without rewarding compulsion

Candidate measures should answer whether people felt in control and completed
useful work. They must not become targets for increasing minutes, scroll depth,
training events, notification opens, or daily streaks.

| Measure | Candidate definition | Guardrail |
| --- | --- | --- |
| Intended-task completion | People who finish the self-selected journey in a structured session | The intention remains local/research-only and is never a server profile field. |
| Agency comprehension | Participants who can identify feed mode, training state, and how to change both | Test keyboard, touch, screen reader, reduced motion, and plain-language comprehension. |
| Corrective-feedback success | Explicit corrections that visibly change the intended scope and can be undone | Never reveal private weights or broaden the correction beyond what was shown. |
| Calm boundary usefulness | Participants who understand and choose continue, switch task, or leave at a boundary | Leaving is a successful choice; do not score continuation higher. |
| Notification preference stability | Preferences preserved correctly across sessions, devices, and migrations | A lower open rate is not a failure if unwanted delivery and opt-outs fall. |
| Useful return | A later meaningful create/find/edit/compose outcome | Pair with no increase in unwanted notifications, reported pressure, or accessibility failures. |

Start with structured usability sessions and local-only prototypes. The owner
must approve any server signal through TODO 22's measurement contract before
implementation.

## Privacy, safety, and abuse boundaries

- Do not store raw session goals, scroll histories, dwell timelines, vulnerable
  moments, sleep schedules, or inferred mental/health states.
- A “why this?” surface must reveal only the current user's own bounded
  algorithm explanation, never another person's activity or protected traits.
- Negative feedback can become a harassment or censorship primitive if exposed
  publicly. Keep it private to the viewer's ranking unless a separate report or
  block action is deliberately chosen.
- Quiet hours must not suppress security alerts, account recovery, direct safety
  notices, or user-requested transaction receipts without a reviewed fallback.
- Avoid age inference. If minors require a different product posture, decide it
  from an explicit lawful product policy rather than covert profiling.
- Do not make calm controls paid features. Baseline agency belongs to every
  account tier.

## Open decisions

1. Should manual pagination be the default for new accounts, or should a finite
   catch-up boundary precede the current auto-load behavior?
2. Can ranked results remain active while training is paused, and how is that
   state displayed in the feed trigger?
3. Which corrective scopes are safe and understandable for v1: post, author,
   tag, type, or whole algorithm?
4. What deterministic explanation can `scorePost` expose without leaking raw
   identifiers or overwhelming the reader?
5. Should weekly summaries and all optional social email become explicit
   opt-in for new accounts while preserving existing stored preferences?
6. Which messages may bypass quiet windows, and who reviews that urgency list?
7. What evidence is enough to say a calm boundary helps rather than annoys or
   patronizes people?
8. Who owns the go/no-go call when useful return improves but agency
   comprehension, unwanted delivery, accessibility, or self-reported control
   worsens?

## Refresh checklist

- Re-read feed pagination, engagement collection, ranking weights, algorithm
  settings, notification defaults, digest scheduling, and current API docs.
- Verify controls in a live desktop and mobile browser before changing a
  repository-presence claim into a usability claim.
- Recheck the capability manifest if a feed, algorithm, preference, or
  notification API changes.
- Revisit the standards references when compliance scope or target markets are
  decided; do not let this note become stale legal guidance.
- Record owner-approved defaults and retention choices in
  [`DECISIONS.md`](../DECISIONS.md), not in this evidence note.
