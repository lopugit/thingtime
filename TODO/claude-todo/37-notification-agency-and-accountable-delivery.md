# 37 — Notification agency and accountable delivery

**Status:** Proposed · owner and qualified review needed

**Evidence:**
[Notification agency and accountable-delivery baseline](../../NOTES/notification-agency-and-accountable-delivery-baseline.md)

**Plan:**
[Notification agency and accountable-delivery roadmap](../../PLAN/notification-agency-and-accountable-delivery-roadmap.md)

## Objective

Turn Thingtime's owner-private notification history into one truthful,
bounded event-to-remedy lifecycle without claiming human attention from
transport or UI evidence. Start with one synthetic, owner-triggered,
non-sensitive action result in a private adult test account and in-app delivery
only.

## Required owner decisions before implementation

- [ ] Approve the vocabulary for event observed, history recorded, delivery
      eligible/requested/provider-accepted/device-acknowledged, presented,
      read, acknowledged, action accepted, outcome verified, remedied, unknown,
      failed, expired, and superseded.
- [ ] Approve the exact synthetic action, canonical outcome predicate,
      reversible/no-op effect, cohort, environments, and exclusions.
- [ ] Approve producer authority, recipient/target rules, event/type versions,
      immutable snapshots, current projections, and legacy-row labels.
- [ ] Approve history, presentation, read, expiry, supersession, correction,
      support, retry, and remedy semantics.
- [ ] Approve temporary retention, export, deletion, backup, restore, and pilot-
      data destruction behavior.
- [ ] Approve sensitivity classes and distinct in-app, assistive, log, metric,
      provider, lock-screen, push, and email disclosure rules.
- [ ] Approve a no-attention-analytics evaluation, accessibility/language
      profiles, stop thresholds, and incident response.
- [ ] Name product, notification, action-domain, privacy/security,
      accessibility/language, reliability, operations, support, and incident
      owners.
- [ ] Explicitly exclude external channels, social fan-out, login/security,
      marketing, moderation/safety, money, elections, health, legal, education,
      minors, institutions, and high-impact actions from the first pilot.

No unchecked item above is permission to engineer or recruit participants.

## Dependencies and boundaries

- [ ] Preserve [`FUNDAMENTALS.md` §3](../../FUNDAMENTALS.md): protected writers,
      relational children, versioned getters, bounded aggregation, and safe
      projections.
- [ ] [TODO 23](./23-data-portability-and-exit.md) owns account-wide inventory,
      export, deletion, closure, and verified exit.
- [ ] [TODO 24](./24-attention-agency-and-calm-use.md) owns delivery defaults,
      quiet windows, batching, urgency, interruption, and attention guardrails.
      This TODO owns evidence semantics after an event exists.
- [ ] [TODO 25](./25-accessibility-and-language-readiness.md) owns shared
      interaction, announcement, locale, and complete-journey access foundations.
- [ ] [TODO 28](./28-service-continuity-and-recovery.md) owns canonical journey
      truth, degradation, objectives, restore, and incident operations.
- [ ] [TODO 29](./29-content-provenance-and-correction-integrity.md) owns content
      authorship, revisions, sources, corrections, and disputes. A delivery
      receipt is not content verification.
- [ ] [TODO 43](./43-automation-agency-and-accountable-recurrence.md) owns why
      and when a task recurs, occurrence/run identity, destination continuity,
      missed-run behavior, and stopping. This TODO owns the separate event,
      channel, presentation, read, outcome, and remedy evidence after a run
      requests notification.
- [ ] Domain TODOs retain authority for moderation, collaboration, identity,
      governance, commerce, learning, and AI remedies. Notification state must
      never decide those outcomes.

## Phase A — Freeze current evidence

- [ ] Characterize every registered producer, recipient, actor, target,
      category, preference, `historyOnly`, `createdAt`, `readAt`, outcome,
      template, safe link, retention, and deletion behavior.
- [ ] Trace storage, history queries, caches, read controls, APNs/email calls,
      action/login producers, Lopu record messages, logs, metrics, errors, API
      docs, capability features, and client requirements.
- [ ] Reproduce persistence failure, provider failure, delivery masters off,
      type off, history-only, already-presented/read, duplicate/retry, account
      switch, stale target, and concurrent paths.
- [ ] Mark old rows as legacy evidence; do not backfill delivery, display,
      attention, action, or remedy claims that were never observed.
- [ ] Document which current actor fields are event-time snapshots versus live
      enriched presentation.

**Gate:** tests and an owner-reviewed matrix state exactly what current rows
prove, do not prove, and cannot reconstruct.

## Phase B — Register a protected lifecycle

- [ ] Define the canonical event/receipt registry with semantic versions,
      producer authority, recipient/subject rules, templates, sensitivity,
      transitions, retention, expiry, supersession, remedies, and required tests.
- [ ] Model attempts and receipts as bounded relational Things linked by opaque
      IDs. Never append an unbounded array to a notification or subject.
- [ ] Add protected writers, versioned collection getters, indexes, idempotency,
      quotas, batch aggregation, field allowlists, and owner-only projections.
- [ ] Preserve event time, persistence time, attempt time, receipt time, and
      canonical outcome time separately; define safe clock-skew handling.
- [ ] Reject unknown producers/types/states, forged or replayed evidence,
      cross-account/origin/subject transitions, late success that erases expiry,
      and client claims of server/provider authority.
- [ ] Register each API change in route source, Nitro import map, API docs,
      capability registry/manifest, and explicit client requirements with a
      deliberate feature SemVer.
- [ ] Use expand/coexist/migrate/verify/contract rollout so current history
      remains readable through deployment and rollback.

## Phase C — Build the truthful owner view

- [ ] Display only evidence-backed labels for recorded, presented, read,
      action outcome, failed, expired, superseded, unknown, and remedied states.
- [ ] Keep unread as a private navigation aid. Never expose it to the sender or
      treat it as obligation, consent, agreement, attention, or completion.
- [ ] Explain producer, purpose, event time, current target state, sensitivity-
      safe detail, expiry, and the approved remedy without leaking internal IDs,
      provider data, secrets, or another account's activity.
- [ ] Resolve every action/link against current authorization and canonical
      state. Show safe unavailable/recovery paths for deleted, private, revoked,
      stale, failed, or superseded targets.
- [ ] Preserve optimistic cached history while refetching and fence cache,
      filters, unread state, mutations, and retries by account and endpoint.
- [ ] Add owner-facing pilot export/delete under the approved temporary
      retention contract and coordinate account-wide behavior with TODO 23.
- [ ] Make status updates programmatically determinable without focus theft,
      duplicate live announcements, hidden state, or color/sound-only meaning.

## Phase D — Prove one in-app-only action pilot

- [ ] Use consenting adults, synthetic accounts/content, and one owner-triggered
      non-sensitive action with a reversible or no-op effect.
- [ ] Record the server-authorized event, protected owner history, accessible
      in-app presentation, canonical action outcome, and approved remedy.
- [ ] Exercise accepted, complete, failed, timeout, cancelled, retried,
      duplicated, reordered, offline, reloaded, deleted, expired, superseded,
      stale target, account switch, and custom-endpoint cases.
- [ ] Prove the underlying action can succeed when notification storage or
      presentation fails, while the notification accurately reports its own
      unknown/failure state when evidence exists.
- [ ] Run desktop/mobile, keyboard/touch/screen-reader, zoom/reflow, reduced-
      motion, locale, long-text, slow-network, cache, and recovery journeys.
- [ ] Evaluate comprehension, receipt fidelity, recovery, accessibility, and
      minimisation through structured sessions only; do not collect opens,
      response speed, dwell, attention, or person-level history analytics.
- [ ] Delete pilot data on schedule and publish aggregate conditions,
      denominators, failures, incidents, remedies, limitations, and owners.

## Phase E — Gate any external channel separately

- [ ] First decide whether in-app history already satisfies the useful outcome.
      “No external channel” is a valid result.
- [ ] If justified, approve one event family and one channel with purpose,
      consent/default, urgency, TTL, payload template, sensitivity,
      deduplication/grouping, retry, receipt semantics, failure, unsubscribe,
      expiry, support, and cost.
- [ ] Preserve TODO 24's quiet/default rules and platform controls; never use
      higher urgency to improve opens or response speed.
- [ ] Label requested, provider accepted, device acknowledged, unknown, expired,
      and failed exactly. Never relabel transport evidence as seen, read,
      understood, agreed, or completed.
- [ ] Test revoked permission/token, provider outage, late/out-of-order receipt,
      offline and multiple devices, duplicate collapse, stale notification,
      target authorization change, and recovery without retry storms.
- [ ] Keep sensitive content out of lock-screen previews, subjects, provider
      metadata, logs, metrics, and analytics according to the approved class.

## Security, privacy, accessibility, and abuse checklist

- [ ] Notification metadata/history is private content, never an engagement
      feed, sender oracle, public profile field, or targeting dataset.
- [ ] Every event and transition is authenticated, authorized, bounded,
      idempotent where needed, rate-limited, origin/account/subject fenced, and
      safe under concurrency, retry, clock skew, and stale clients.
- [ ] Provider tokens, subscription endpoints, bearer links, credentials,
      payloads, private target IDs, raw content, and infrastructure detail never
      enter owner projections, logs, metrics, receipts, or analytics.
- [ ] Dismiss, read, acknowledge, act, correct, appeal, retry, support,
      unsubscribe, export, and delete remain separate accessible intents.
- [ ] Duplicate interruptions collapse without deleting truthful history;
      hostile producers cannot flood storage, attention, live regions, email,
      push, or support.
- [ ] Retention, deletion, expiry, backup, restore, legal hold if applicable,
      and account closure follow approved data-class rules and preserve honest
      evidence limits.
- [ ] Keyboard, touch, screen reader, zoom/reflow, reduced motion, contrast,
      sound-off, locale, cognitive load, long text, slow input, and failed
      network states pass complete-journey testing.

## Acceptance criteria

- [ ] A person can distinguish event observed, history recorded, presented,
      read, action accepted, outcome verified, failed, expired, superseded,
      unknown, and remedied without reading implementation docs.
- [ ] Every displayed state reproduces deterministic evidence; missing
      provider/display/attention evidence remains unknown.
- [ ] Current and legacy rows remain readable and cannot acquire retroactive
      claims through migration or live actor enrichment.
- [ ] Forged, replayed, cross-account/origin/subject, stale, unknown, oversized,
      out-of-order, and unauthorized lifecycle writes fail closed.
- [ ] History persistence and channel delivery follow separately approved
      preferences across account, endpoint, cache, retry, and migration paths.
- [ ] Read state never changes action state, consent, authority, content truth,
      or sender-visible analytics.
- [ ] Stale, deleted, revoked, expired, failed, and superseded targets expose
      safe current state and the approved remedy without unsafe side effects.
- [ ] Pilot retention, export, delete, backup/restore, and scheduled destruction
      match the approved contract with no shadow copy in logs or analytics.
- [ ] Exact API docs, capability manifest, client requirements, tests, UI copy,
      and live behavior agree before any state moves to shipped.

## Stop conditions

Pause intake and disable the narrowest affected producer or channel if a label
overstates evidence; unauthorized lifecycle data crosses an account/origin;
history or delivery ignores preferences; read becomes consent/outcome; sensitive
content leaks; a stale notification triggers an unsafe action; duplicates or
retries flood; retention/export/delete diverges; accessibility announcements
fail or coerce attention; remedies are unavailable; or evaluation requires
attention surveillance.

Resume only after containment, affected-person communication where appropriate,
root-cause evidence, correction/remedy, regression proof, cleanup, and owner
approval.

## Explicit non-goals

- No push, email, SMS, marketing, social fan-out, login/security, moderation,
  safety, money, election, health, legal, education, child, institutional, or
  high-impact notification in the first pilot.
- No sender-visible read receipt, presence, response-time score, attention
  inference, behavioral targeting, streak, pressure, or engagement KPI.
- No claim that history, provider acceptance, device acknowledgement, display,
  read state, acknowledgement, click, or action request proves attention,
  understanding, consent, agreement, truth, authority, or successful outcome.
