# 24 — Attention agency and calm use 🌿

**Status:** 🟣 Proposed · planning only · added 2026-09-02

**Owner:** Unassigned; product owner coordinates accessibility,
privacy/security, abuse, notification/email, and reliability decisions

**Plan:** [`PLAN/attention-agency-roadmap.md`](../../PLAN/attention-agency-roadmap.md)

**Evidence:** [`NOTES/attention-agency-baseline.md`](../../NOTES/attention-agency-baseline.md)

## Goal

Make feed continuation, algorithm learning, corrective feedback, explanations,
and notification delivery understandable and controllable so Thingtime earns
useful return without optimizing compulsive engagement.

## Problem

Thingtime already exposes a chronological no-training feed, inspectable and
deletable personal algorithms, and granular notification settings. It also
auto-loads feed pages, trains active algorithms from passive views and dwell,
celebrates accumulating training moments, and defaults most email types—weekly
summary included—on when no preference is stored.

There is no approved contract for manual versus automatic continuation,
ranking-with-training-paused, negative/corrective feedback, per-post
explanations, calm notification defaults, or quiet windows. This TODO turns
those decisions into a gated implementation epic. It does not authorize a
default change, new signal, or telemetry collection by itself.

## Dependencies and boundaries

- [`FUNDAMENTALS.md`](../../FUNDAMENTALS.md) and
  [`DECISIONS.md`](../../DECISIONS.md) remain authoritative.
- [TODO 22](./22-trustworthy-adoption-loop.md) owns useful-return measurement
  and any approved product-signal contract. This TODO may not create a parallel
  analytics path.
- [TODO 20](./20-versioned-experience-history.md) owns feed/search context
  restoration after a person stops.
- [TODO 23](./23-data-portability-and-exit.md) owns export/deletion treatment
  for algorithms and preferences.
- Ranking, training, reporting, blocking, moderation, and account-security
  notifications remain distinct capabilities and user intents.
- Calm controls and chronological/no-training mode apply to every account tier.

## Phase 0 — Approve defaults and meanings

- [ ] Decide new-account feed continuation: manual pages, finite catch-up, or
      automatic loading. Recommended start: manual pages with easy opt-in
      automatic loading.
- [ ] Decide whether ranking may remain active while training is paused and how
      queued/current-session events behave on pause.
- [ ] Select the v1 corrective signal and exact scope: post, author, tag, type,
      or whole algorithm.
- [ ] Define deterministic “why this?” fields from the canonical scorer.
- [ ] Classify every notification type by purpose, urgency, default channel,
      batching, quiet-window eligibility, bypass, unsubscribe/mute behavior,
      retention, and owner.
- [ ] Decide preference migration rules that preserve every explicit existing
      choice.
- [ ] Define structured-usability and local-only evaluation before requesting
      server instrumentation.
- [ ] Record approved architecture, defaults, and retention in
      [`DECISIONS.md`](../../DECISIONS.md).

**Gate:** no product or API implementation until the owner approves the shared
decision packet and assigns guardrail owners.

## Phase 1 — Separate ordering from learning

- [ ] Keep `Latest` one direct action from every ranked feed state.
- [ ] Show ranked/chronological and training active/paused as separate states
      with plain-language labels and no learning pulse when paused.
- [ ] Add a per-algorithm training control whose optimistic cached state
      reconciles through the canonical API and cannot cross account or endpoint
      boundaries.
- [ ] Define pause-at-once behavior for queued events, eight-second flushes,
      page-hide beacons, concurrent tabs, offline state, and account switching.
- [ ] Explain passive view/dwell and explicit signals before first activation;
      do not hide the explanation behind terms or a settings-only path.
- [ ] Add deterministic tests proving Latest and paused states never mutate
      weights, including page-hide and retry races.

## Phase 2 — Correct and explain recommendations

- [ ] Extend the canonical signal registry with the approved correction; reject
      unknown signal kinds and out-of-scope targets.
- [ ] Preview the correction scope and provide undo. Keep it private to the
      viewer's algorithm and separate from report/block actions.
- [ ] Make scorer updates, algorithm utilities, endpoint registration, API docs,
      capability features, client requirements, and tests one change set.
- [ ] Derive “why this?” from the same type/tag/author/recency contributions
      used by the request's score. No generated rationale or unrelated social
      proof.
- [ ] Add approved reset-by-scope/whole-algorithm controls with preview,
      branch/share consequence copy, concurrency handling, and accessible
      confirmation.
- [ ] Threat-model author harassment, sensitive-trait inference, feedback
      poisoning, identifier leakage, and correction-oracle abuse.

## Phase 3 — Add chosen stopping points

- [ ] Implement the approved manual/finite/automatic continuation preference
      with a safe default and durable, documented migration.
- [ ] Preserve a functioning manual “Load more” path and prevent observer
      requests when manual mode is active.
- [ ] If finite catch-up ships, define an authoritative cut and distinguish
      caught-up, filtered, unavailable, new, and older content honestly.
- [ ] Preserve scroll, keyboard focus, selected filters, algorithm state, and
      unsaved work when a person pauses or leaves, reusing TODO 20.
- [ ] Give continue, switch task, and leave equal non-shaming copy and focus
      order; never use a streak, countdown, loss warning, or obstructive modal.
- [ ] Keep reminders local, optional, adjustable, reduced-motion aware, and
      non-blocking if the owner approves them at all.

## Phase 4 — Version calm notification behavior

- [ ] Apply the approved new-account default matrix. Recommended posture:
      security/account and direct-person in-app notices on; optional social and
      summary email explicit opt-in.
- [ ] Preserve existing explicit choices through versioned normalization and
      migration; old, missing, malformed, cached, client, and server states
      resolve identically.
- [ ] Add quiet windows only with timezone, daylight-saving, delayed queue,
      multi-device, bypass, retry, and accessibility semantics covered.
- [ ] Keep master and per-type controls optimistic; reconcile through the real
      settings API and explain security/account exceptions separately.
- [ ] Verify weekly-summary eligibility, no-activity suppression,
      idempotency, scheduler state, unsubscribe, and delivery before describing
      it as operational.
- [ ] Add a registry/coverage test that fails when a new notification type lacks
      the required default, urgency, batching, retention, and control metadata.

## Security, privacy, accessibility, and abuse checklist

- [ ] Do not store raw scroll/dwell histories, session goals, vulnerable
      moments, sleep schedules, health inference, or age inference.
- [ ] Explanations reveal only the current user's bounded ranking factors and
      never another person's private behavior or sensitive trait.
- [ ] Corrective feedback is private and cannot become a public dislike count,
      retaliation signal, moderation bypass, or author-facing oracle.
- [ ] Pause, reset, and quiet-window writes are owner-authorized, size-capped,
      rate-limited where appropriate, idempotent, and protected from stale-tab
      overwrite.
- [ ] Security/recovery notices retain a reviewed reliable path when optional
      social/email channels or quiet windows are off.
- [ ] All controls work with keyboard, screen reader, touch, narrow viewports,
      zoom, reduced motion, slow input, and interrupted network requests.
- [ ] Leaving or selecting no-training mode never loses content, drafts,
      context, export, deletion, or account functionality.

## Acceptance criteria

- The owner-approved continuation, training, correction, explanation,
  notification, quiet-window, and migration contracts are linked from this
  epic and recorded where durable.
- A person can identify chronological/ranked and training active/paused states,
  change either, and return to Latest without reading implementation docs.
- Paused and Latest sessions produce zero applied training events across normal,
  page-hide, retry, offline, concurrent-tab, and account-switch paths.
- A correction changes exactly the previewed private scope, can be undone in the
  stated window, and never becomes public moderation or author feedback.
- Each “why this?” fixture matches the canonical score contribution and changes
  deterministically when the relevant factor changes.
- Manual mode makes zero observer-triggered page requests; the manual control,
  finite boundary if any, focus, scroll, filters, and restore behavior pass live
  desktop/mobile QA.
- New-account notification defaults match the approved matrix; every explicit
  old preference survives migration; quiet windows and required bypasses pass
  real-API and failure-injection tests.
- Structured usability demonstrates agency comprehension and intended-task
  completion without rewarding more minutes, pages, training events, streaks,
  or notification opens.
- Current API docs, capability manifest, client requirements, settings/help
  copy, CI, preview, and live behavior agree before status moves to shipped.

## Concrete next action

Prepare one owner decision packet containing:

1. recommended continuation default;
2. ranking/training pause semantics;
3. v1 corrective signal and scope;
4. allowed explanation fields;
5. new-account notification/email defaults;
6. quiet-window urgency and bypass rules;
7. preference migration behavior;
8. no-server-analytics evaluation; and
9. named owners and stop thresholds.

Do not implement defaults, signals, quiet windows, or measurement until that
packet is approved.
