# 43 — Automation agency and accountable recurrence

**Status:** 🟣 Proposed · owner and qualified review needed

**Evidence:** [Automation agency and accountable-recurrence baseline](../../NOTES/automation-agency-and-accountable-recurrence-baseline.md)

**Plan:** [Automation agency and accountable-recurrence roadmap](../../PLAN/automation-agency-and-accountable-recurrence-roadmap.md)

## Goal

Turn Thingtime's durable scheduling primitives into an explicit agency
contract: a person can preview exactly what will recur, keep output in one
approved conversation by default, inspect every occurrence, distinguish
schedule/run/output/delivery truth, and stop or repair future work safely.

The first implementation candidate is one recurring synthetic `message` task
in one existing Lopu conversation. This TODO does not authorize engineering,
production rollout, participant recruitment, assistant automation, or tools.

## Why now

- Chat-mode schedules already default to the current conversation or a saved
  `destinationChatId`; only explicit `newChatEachRun` creates a new chat.
- Deterministic occurrence IDs, leases, separate run Things, pause fences,
  skipped backlog, and ambiguity stopping already exist.
- Owner-visible preview, edit, cancel/delete, time-zone provenance, queue health,
  full run-state, retention, and complete-journey continuity proof do not.
- Without one contract, safe backend choices can still appear as duplicate
  chats, unclear timing, hidden cost, silent failure, or recurrence that is
  difficult to stop.

## Dependencies and boundaries

- [ ] Preserve `FUNDAMENTALS.md` §3: protected writers, versioned collection
      getters, relational children, bounded aggregation, and safe projections.
- [ ] [TODO 23](./23-data-portability-and-exit.md) owns complete inventory,
      export, deletion, closure, restore, and verified exit.
- [ ] [TODO 24](./24-attention-agency-and-calm-use.md) owns quiet windows,
      urgency, interruption, batching, and non-coercive return.
- [ ] [TODO 25](./25-accessibility-and-language-readiness.md) owns shared time,
      input, status, error, locale, and complete-journey access foundations.
- [ ] [TODO 28](./28-service-continuity-and-recovery.md) owns scheduler service
      objectives, dependencies, degradation, restore, and incident response.
- [ ] [TODO 33](./33-ai-agency-and-accountable-assistance.md) owns model,
      provider, context, tool authority, confirmations, receipts, and remedies.
      This TODO owns the separate recurrence and occurrence envelope.
- [ ] [TODO 37](./37-notification-agency-and-accountable-delivery.md) owns event,
      channel, presentation, read, outcome, and remedy evidence. A completed
      run is not proof of notification delivery or attention.
- [ ] Record every approved persistence, retention, deletion, capability, or
      compatibility fork in `DECISIONS.md` before implementation.

## Phase 0 — Approve the contract

- [ ] Approve intent, schedule, occurrence, claim/lease, run, output,
      destination, pause, cancel, delete, retry, missed, ambiguous, and receipt
      vocabulary.
- [ ] Approve one persistent conversation as the default for every chat-mode
      schedule; require informed opt-in for a new chat each occurrence.
- [ ] Choose schedule-edit semantics: immutable new version, replacement, or a
      fresh schedule for authority-changing fields.
- [ ] Define start/end/count, missed-run, overlap, DST fold/gap, tzdata update,
      travel, and occurrence service-window behavior.
- [ ] Define per-mode context, authority, confirmation, cost, concurrency,
      retry, and budget limits.
- [ ] Define pause, resume, cancel, delete, source completion, destination loss,
      retention, pagination, export, restore, and account-closure behavior.
- [ ] Name product, automation, Lopu, privacy/security, accessibility/language,
      reliability, operations, support, and incident owners.
- [ ] Approve the synthetic message-only pilot, evidence fields, hard-zero stop
      thresholds, participant criteria, and cleanup plan.

No unchecked item above is permission to engineer or recruit participants.

## Phase 1 — Preview and confirm exact intent

- [ ] Define one normalized preview returned by Lopu, the API, Settings, and
      any future scheduler surface.
- [ ] Show purpose, local date/time, IANA zone, next occurrences, end condition,
      missed-run policy, mode, persistent destination, context, authority,
      notification delivery, cost/budget, overlap, and stop/delete effects.
- [ ] Ask rather than guess when natural-language date, time, zone, recurrence,
      destination, or end condition is ambiguous.
- [ ] Show that `newChatEachRun` creates multiple conversations and require a
      separate explicit choice; never inherit it from stale client state.
- [ ] Cancel at preview with zero writes, claims, notifications, or chats.
- [ ] Negotiate the selected origin's capability before persisting.
- [ ] Validate preview, confirmation, errors, and cancellation with keyboard,
      touch, screen reader, zoom, reduced motion, supported locale, desktop,
      and narrow viewport.

## Phase 2 — Model schedule and occurrence truth

- [ ] Persist an immutable schedule version and change receipt; do not let
      editing the display Thing silently reprogram protected control state.
- [ ] Derive a stable occurrence ID from schedule version plus calculated due
      instant and use it for claims, runs, requests, and deduplication.
- [ ] Record named time zone and bounded calculation provenance; define how a
      runtime tzdata update changes unstarted future occurrences.
- [ ] Model eligible, claimed, running, done, skipped, cancelled, failed,
      ambiguous, expired, and superseded without collapsing unknown into done.
- [ ] Keep schedules and bounded run children relational. Add cursor-based
      inspection rather than relying on hidden list limits.
- [ ] Version the API feature and update canonical route/docs/manifest/client
      requirements together for every contract change.

## Phase 3 — Execute once and stop reliably

- [ ] Recheck current owner/account, schedule version, enabled state, lease,
      source, destination, linked Things, completion, capabilities, and
      authority immediately before each irreversible step.
- [ ] Preserve current-chat/default-destination behavior across duplicate tick,
      reload, scheduler restart, deployment, pause/resume, stale client, and
      account switch.
- [ ] Assert one logical run and output per occurrence under concurrent claims,
      lease expiry, timeout, and lost responses.
- [ ] Skip missed backlog under the approved policy and show the next future
      occurrence; never burst delayed output.
- [ ] Keep ambiguous assistant/external effects `needs-attention` and disabled;
      require fresh owner authorization for any repair or replacement.
- [ ] Add explicit cancel and delete operations with consequence previews,
      narrow receipts, source/run cascade, and in-flight boundaries.
- [ ] Reject recursive schedules, scope/frequency/urgency escalation,
      cross-account context, and notification-preference bypass.

## Phase 4 — Inspect, repair, export, and delete

- [ ] Show schedule version, normalized rule, destination, next run, last run,
      source/context references, run state, output, notification state, and
      bounded safe failure reason.
- [ ] Provide accessible pause, resume, cancel, delete, and approved repair
      actions with current-state revalidation and post-action receipts.
- [ ] Expose bounded scheduler-health and queue-age state without leaking
      another account, content, prompt, credential, host, or deployment detail.
- [ ] Define support/incident remedies for late, missing, duplicate,
      unauthorized, destination-lost, or ambiguous work.
- [ ] Include schedules and declared run/output records in export, selective
      deletion, account closure, backup, restore, and legacy migration drills.
- [ ] Prove no orphan schedule, restored ghost recurrence, undeclared receipt,
      or second destination survives cleanup.

## Phase 5 — Run the bounded pilot

- [ ] Use one approved adult test account, one synthetic private Thing, one
      existing Lopu chat, one short recurring `message` schedule, and one named
      IANA zone. Use no real personal content.
- [ ] Exercise preview, create, first run, duplicate tick, pause, resume,
      downtime skip, DST fixtures, source completion, account switch,
      destination loss, notification failure, cancel, delete, and cleanup.
- [ ] Assert every successful occurrence appears exactly once in the approved
      persistent conversation and that zero new chats are created.
- [ ] Validate actual capability negotiation, API, scheduler, database, Lopu,
      Settings, notification separation, and accessible owner controls.
- [ ] Inventory and delete every pilot fixture and prove declared cascades and
      absence after cleanup.
- [ ] Publish only bounded, redacted evidence and an explicit list of what the
      pilot did not prove.

## Acceptance criteria

- [ ] A participant can restate what, when, zone, recurrence, end condition,
      destination, context, authority, cost, missed-run rule, and stop behavior
      before confirming.
- [ ] Chat-mode schedules use one approved persistent destination unless the
      owner explicitly selects and confirms new-chat-per-run.
- [ ] Duplicate ticks, workers, retries, restarts, and lease expiry create one
      occurrence, run, output, and destination effect.
- [ ] Pause, cancel, delete, source completion, account switch, and dependency
      loss prevent every not-yet-committed step within the approved objective.
- [ ] DST folds/gaps, tzdata changes, downtime, and edits produce the displayed
      next occurrence and an inspectable calculation receipt.
- [ ] Ambiguous effects are never automatically replayed; repair is deliberate,
      bounded, and freshly authorized.
- [ ] Schedule, run, output, notification, read, and canonical outcome states
      stay distinct, including unknown and unavailable.
- [ ] Schedule/run history is bounded, pageable, exportable, deletable, and
      restorable under approved policies.
- [ ] The full pilot works accessibly at desktop and narrow widths and leaves no
      fixture, orphan, ghost schedule, or surprise conversation behind.
- [ ] API route, docs, capability manifest, tests, operations evidence, and live
      selected-origin behavior agree at the exact release under evaluation.

## Stop conditions

Stop immediately if duplicate output appears; a second chat is created without
explicit opt-in; recurrence changes silently; a paused, cancelled, completed,
or deleted task starts new work; an ambiguous effect is replayed; a backlog
floods; context crosses accounts or destinations; time-zone drift is hidden;
run state is called delivery or attention; queue health hides starvation; a
participant cannot inspect/stop accessibly; or cleanup is incomplete.

## Explicit non-goals

- No hidden, inferred, viral, self-replicating, or growth-triggered recurrence.
- No new-chat-per-run default and no schedule-created schedules.
- No arbitrary tools, purchases, external communication, public/bulk action,
  money, health, legal, education, employment, housing, safety, minors, or
  other sensitive/high-impact automation in the first pilot.
- No engagement, retention, schedule volume, run volume, message count,
  notification count, open, response, streak, or return objective.
- No assumption that a test, deployment, schedule row, run row, saved output,
  provider receipt, or notification proves a human outcome.

## First decision packet

Approve or revise:

1. persistent-chat continuity as the default;
2. vocabulary and schedule edit/version policy;
3. recurrence, time-zone, missed-run, overlap, and service-window behavior;
4. pause/cancel/delete/retention/export/restore/repair semantics;
5. the one-account, one-Thing, one-chat, message-only pilot; and
6. hard-zero thresholds and the separately gated assistant/tool expansions.
