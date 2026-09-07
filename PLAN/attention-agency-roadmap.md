# Attention agency and calm-use roadmap

**Status:** Proposed

**Prepared:** 2026-09-02, Australia/Melbourne

**Evidence:** [Attention agency and calm-use baseline](../NOTES/attention-agency-baseline.md)

**Execution epic:** [TODO 24 — Attention agency and calm use](../TODO/claude-todo/24-attention-agency-and-calm-use.md)

## Outcome

Make Thingtime a place people can enter with intent, understand while using,
correct when it learns the wrong thing, and leave without pressure. Ranked
feeds and notifications may be useful and joyful, but the person remains in
control of continuation, training, explanation, interruption, and delivery.

The plan complements the [trustworthy adoption roadmap](./trustworthy-adoption-roadmap.md):
useful return can improve, but never by making attention harder to reclaim.

## Non-goals

- Diagnosing wellbeing, addiction, age, vulnerability, or mental state.
- Maximizing time-on-site, scroll depth, daily streaks, training events, or
  notification opens.
- Removing ranking, delight, sharing, or automatic loading for everyone.
- Treating every long session as harmful or every short session as successful.
- Uploading raw scroll/dwell timelines or session intentions for analytics.
- Sending shame, countdown pressure, or moralizing reminders.
- Hiding security/account notices behind optional quiet-hour settings.
- Claiming legal compliance from a planning document.

## Principles

1. **Leaving is a valid success.** A calm boundary gives equal visual weight to
   continue, change task, and leave.
2. **Ranking and learning are separate choices.** A person can keep useful
   ordering without silently contributing another session to training.
3. **Corrections beat inferred certainty.** Explicit feedback is scoped,
   reversible, private, and stronger than passive exposure.
4. **Explanations use the real scoring path.** “Why this?” describes
   deterministic factors, not generated persuasion.
5. **Defaults are part of the product.** New feed and notification defaults need
   the same privacy, accessibility, abuse, and migration review as endpoints.
6. **Measure completion and control.** Do not reward the proxy behavior this
   plan is meant to bound.
7. **Calm controls are baseline rights.** They are never paywalled or weakened
   to improve a growth metric.

## Success measures

| Measure | Proposed definition | Required guardrail |
| --- | --- | --- |
| Agency comprehension | People who can correctly identify feed mode, training state, and both controls | Keyboard, screen-reader, touch, reduced-motion, and plain-language task success stay within the approved bound. |
| Corrective-feedback completion | Corrections that change exactly the previewed scope and remain undoable during the stated window | No public feedback exposure, author retaliation signal, or sensitive-trait inference. |
| Intent completion | Structured-session participants who finish the journey they selected | Leaving after completion is counted as success; longer use earns no bonus. |
| Calm boundary choice quality | People who understand all boundary choices and select one without accidental continuation | No deceptive prominence, focus trap, content loss, or shaming copy. |
| Notification control fidelity | Saved channel/type/quiet-window choices reproduced across supported sessions and migrations | Security and account-recovery delivery remains tested separately. |
| Useful return | A later meaningful create/find/edit/compose outcome | No approved regression in unwanted notifications, self-reported control, accessibility, or support burden. |

## Milestone A0 — Decide the agency contract

**Outcome:** defaults and meanings are approved before UI or telemetry work.

- Decide the default continuation mode for new accounts: manual pages, finite
  catch-up, or automatic loading.
- Decide whether ranking can stay on while training is paused and whether a
  whole session may be excluded retroactively before it flushes.
- Choose the smallest corrective-feedback vocabulary and scope.
- Define the deterministic fields allowed in a per-post explanation.
- Classify every notification type by urgency, default channel, batching,
  quiet-window eligibility, and bypass rule.
- Decide the migration posture for existing preferences. Preserve explicit
  user choices; never reinterpret an existing `false` as consent.
- Assign product, accessibility, privacy/security, abuse, notification/email,
  and reliability owners.

**Gate:** the owner approves one decision packet and durable architectural or
retention choices are recorded in `DECISIONS.md` before code.

## Milestone A1 — Make mode and learning understandable

**Outcome:** a person can answer “what is ordering this feed?” and “is this
session training it?” without opening documentation.

- Keep `Latest` directly accessible from the feed.
- Show ranking state and training state separately, including a clear paused
  state with no pulsing “learning” animation.
- Add a concise explanation of passive and explicit signals before the first
  algorithm is activated, with a link to inspect interests and controls.
- Preserve optimistic state and reconcile failures through Lopu; do not flash a
  spinner over a known preference.
- Cover account switching, custom endpoints, stale caches, offline changes, and
  concurrent tabs without crossing identity boundaries.

**Gate:** the comprehension task passes on desktop/mobile with keyboard, screen
reader, touch, reduced motion, and one simulated save failure.

## Milestone A2 — Add correction and truthful explanation

**Outcome:** people can understand and repair mistaken ranking without deleting
their whole profile.

- Add one explicit correction surface with a previewed scope and undo.
- Keep correction private to the viewer's algorithm. Reporting, blocking, and
  moderation remain distinct deliberate actions.
- Extend the canonical signal vocabulary and all affected API/capability docs
  together; unknown signal kinds fail closed.
- Explain one ranked result from the actual types/tags/authors/recency scoring
  contribution without exposing private ids or raw weights unnecessarily.
- Add reset-by-scope and whole-algorithm reset only after preview, accessibility,
  concurrency, and branch/share consequences are decided.
- Test that deleted, unshared, paused, Latest, and custom-endpoint states cannot
  continue training by mistake.

**Gate:** deterministic tests prove explanation parity and correction scope;
live QA proves a person can correct, undo, pause, and switch to Latest.

## Milestone A3 — Introduce chosen stopping points

**Outcome:** feed continuation is an explicit, accessible preference rather
than an invisible product assumption.

- Implement the owner-approved default. Recommended first experiment: manual
  page continuation for new accounts with an easy persistent opt-in to current
  auto-load behavior.
- If finite catch-up is chosen, define its data cut honestly and label older,
  filtered, unavailable, and newly arriving content without false completion.
- Preserve scroll/focus state and versioned experience history when a person
  pauses or leaves; do not punish stopping with lost context.
- Give continue, switch task, and leave equal, non-shaming treatment.
- Avoid timers. If a reminder is tested, make it local, optional, adjustable,
  non-blocking, and silent to server analytics by default.
- Keep the manual “Load more” path functional when observers, JavaScript
  capabilities, reduced motion, or network conditions differ.

**Gate:** no accidental extra page request in manual mode; history and focus
restore correctly; the boundary passes accessible interaction and copy review.

## Milestone A4 — Make notifications calm by contract

**Outcome:** notifications serve explicit value without becoming the return
mechanism that growth metrics optimize.

- Apply the approved default matrix. Recommended posture for new accounts:
  security/account and direct-person in-app notices on; optional social and
  summary email explicit opt-in; preserve all existing stored preferences.
- Add quiet windows only with timezone, daylight-saving, multi-device, delayed
  queue, bypass, failure, and accessibility semantics specified.
- Keep master switches and per-type controls; explain which security/account
  messages are outside optional marketing/social channels.
- Version normalization and migration tests so missing, old, cached, and
  malformed preferences produce the same documented result on client/server.
- Add every future type to a registry that requires purpose, owner, channels,
  default, urgency, batching, retention, unsubscribe/mute behavior, and abuse
  review.
- Validate the weekly summary scheduler and unsubscribe path before any copy
  says the digest is active.

**Gate:** new-account defaults, migrated choices, quiet-window delivery, bypass,
unsubscribe, master switches, and failure recovery pass the same real APIs used
in production.

## Milestone A5 — Evaluate without surveillance

**Outcome:** Thingtime can decide whether calm controls help without collecting
the raw attention exhaust they are meant to govern.

- Start with structured usability sessions and local-only prototypes.
- Reuse TODO 22's approved useful-return outcome; do not create a second
  analytics vocabulary.
- If server measurement is still necessary, approve each aggregate signal,
  purpose, retention, minimum cohort, opt-out, access, and deletion behavior
  through the trustworthy-adoption signal contract.
- Report agency, accessibility, reliability, abuse, notification, and support
  guardrails beside useful return.
- Treat lower scroll depth, training volume, or notification opens as neutral or
  positive when intended work and agency improve.
- Remove experiments, flags, temporary copy, and approved temporary data at the
  precommitted decision date.

**Gate:** the owner can accept, iterate, or remove each experiment without using
person-level scroll/dwell histories or a deploy rollback.

## Dependency map

- [Trustworthy adoption roadmap](./trustworthy-adoption-roadmap.md): owns the
  outcome and any product-signal contract; this plan owns feed and notification
  agency guardrails.
- [TODO 10](../TODO/claude-todo/10-delight-and-growth-ideas.md): algorithm-growth
  celebrations must not ship as a retention tactic ahead of this contract.
- [TODO 20](../TODO/claude-todo/20-versioned-experience-history.md): owns durable
  restoration of feed/search context after a person chooses to stop.
- [TODO 23](../TODO/claude-todo/23-data-portability-and-exit.md): owns export,
  deletion, and graceful exit; algorithm and preference treatment must appear
  in its data-class matrix.
- Current feed, ranking, algorithm, notification, settings, email, and
  capability code is evidence to re-verify, not an approved implementation
  shape for these milestones.

## Stop conditions

Pause or remove an experiment if any of these occurs:

- ranked content trains while the UI says paused or Latest;
- a correction affects a broader scope than previewed, becomes public, or
  exposes a protected/sensitive inference;
- a “why this?” explanation diverges from the actual scoring path;
- the stopping surface shames leaving, hides continue alternatives, traps
  focus, loses work/context, or disproportionately blocks assistive technology;
- existing notification choices are reset, optional email is enabled without
  the approved consent posture, or quiet hours suppress a required security
  notice;
- useful-return gains depend on more minutes, auto-loaded pages, training
  events, streaks, or notification opens while agency guardrails worsen;
- evaluation requires raw content, raw scroll/dwell timelines, session goals,
  sensitive inference, or person-level dashboards;
- a calm control is paywalled or disabled for a lower tier.

## First decision packet

The next owner session should decide:

1. the new-account continuation default;
2. ranking-versus-training pause semantics;
3. the v1 corrective signal and scope;
4. the allowed “why this?” explanation fields;
5. the new-account notification/email default matrix;
6. quiet-window urgency and bypass rules;
7. the no-server-analytics evaluation option; and
8. accountable owners and stop thresholds.

No feed-default, training, or notification-default change should be implemented
until that packet is approved.
