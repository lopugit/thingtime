# Automation agency and accountable-recurrence roadmap

**Status:** Proposed

**Prepared:** 2026-09-13, Australia/Melbourne

**Evidence:** [Automation agency and accountable-recurrence baseline](../NOTES/automation-agency-and-accountable-recurrence-baseline.md)

**Execution epic:** [TODO 43 — Automation agency and accountable recurrence](../TODO/claude-todo/43-automation-agency-and-accountable-recurrence.md)

## Outcome

Make scheduled work understandable, bounded, inspectable, and stoppable. Before
confirming, a person can tell what will run, when and under which time-zone
rules, where results will go, what context and authority apply, what it may
cost, how missed or ambiguous occurrences behave, and how to pause, cancel,
delete, repair, or export it.

The first proof keeps one synthetic recurring message in one existing Lopu
conversation. A separate chat per occurrence remains explicit opt-in and is not
part of the pilot.

## Boundaries with adjacent roadmaps

- [AI agency and accountable assistance](./ai-agency-and-accountable-assistance-roadmap.md)
  owns model/provider disclosure, context selection, tool authority,
  confirmations, and AI-output limitations. This roadmap owns when a bounded
  authorized task may recur and how each occurrence is controlled.
- [Notification agency and accountable delivery](./notification-agency-and-accountable-delivery-roadmap.md)
  owns event, history, channel, presentation, read, outcome, and remedy
  evidence. This roadmap owns schedule and run state; neither may call the
  other proof of human attention.
- [Attention agency and calm use](./attention-agency-roadmap.md) owns quiet
  windows, urgency, batching, interruption, and non-coercive return.
- [Service continuity and recovery](./service-continuity-and-recovery-roadmap.md)
  owns scheduler dependencies, objectives, degraded operation, restore, and
  incident response.
- [Data portability and graceful exit](./data-portability-and-exit-roadmap.md)
  owns account-wide inventory, export, deletion, closure, and verified exit.
- [Accessibility and language readiness](./accessibility-and-language-readiness-roadmap.md)
  owns shared input, status, error, time, locale, and complete-journey access.

## Non-goals

- Maximizing schedules, runs, notifications, messages, return, or engagement.
- Hidden recurrence, default new-chat-per-run, self-replicating schedules, or
  schedule-created schedules.
- Blind retry after an ambiguous assistant or external side effect.
- Replaying an outage backlog or escalating urgency without a fresh request.
- Shipping arbitrary tool actions, purchases, external messaging, bulk work,
  sensitive domains, minors, institutions, or high-impact decisions in the
  first pilot.
- Treating a schedule receipt, run row, saved message, provider receipt, or
  notification as proof of truth, usefulness, delivery, attention, or outcome.
- Claiming calendar interoperability, accessibility conformance, reliability,
  or production readiness from repository tests alone.

## Principles

1. **One authorization, one bounded rule.** Recurrence cannot enlarge content,
   context, destination, authority, frequency, duration, cost, or audience.
2. **Continuity by default.** Chat output stays in one approved conversation;
   each-run chat creation requires explicit informed opt-in.
3. **Preview before persistence.** The exact normalized rule and consequences
   are visible before confirmation.
4. **Occurrence identity before execution.** Every run binds to one schedule
   version and calculated due instant.
5. **At-most-once beats silent replay.** Ambiguous side effects stop for owner
   review; a safe deterministic no-op may be retried only under declared rules.
6. **Missed is not queued.** Downtime cannot turn recurrence into a flood.
7. **Stop is a product operation.** Pause, cancel, delete, dependency loss, and
   account changes are checked near every irreversible step.
8. **Time is data with provenance.** Zone, recurrence grammar, rule version,
   calculation, and next occurrence remain inspectable.
9. **Receipts stay narrow.** Schedule, claim, run, output, notification, and
   outcome states are separate and admit unknown.
10. **No recurrence-as-growth metric.** Evaluation measures comprehension,
    uniqueness, timing truth, stopping, recovery, access, and cleanup.

## Candidate contract

Each automation family should declare:

- owner and source; normalized purpose; creation and schedule version;
- one-time or recurrence rule, start, end/count, named time zone, time-zone rule
  version, DST ambiguity/nonexistence behavior, and next occurrence preview;
- mode, destination policy, persistent destination ID, context references,
  authority tier, confirmation tier, per-run cost class, and hard budget;
- occurrence ID, eligibility/service window, claim/lease, deduplication key,
  missed-run policy, concurrency, retry policy, and overlap behavior;
- run/output/notification state, start and finish times, narrow error class,
  repair path, and canonical outcome reference where one exists;
- pause, resume, cancel, delete, completion, dependency loss, export, retention,
  backup/restore, and source-cascade behavior; and
- capability version, accessibility/locale profile, operations objective,
  accountable owners, stop threshold, and incident path.

Schedules, occurrences/runs, outputs, and delivery evidence stay separate.
Bounded relational children prevent an unbounded history array on the source.
Public/API projections expose only owner-authorized fields.

## Milestone A0 — Approve the charter

**Outcome:** product labels and controls have one meaning before schema or UI
work.

- Approve intent, schedule, occurrence, claim, run, output, destination, pause,
  cancel, delete, retry, missed, ambiguous, and receipt vocabulary.
- Affirm one persistent destination as the chat default. Define the exact
  disclosure and confirmation for `newChatEachRun`.
- Decide whether edits version in place, replace the schedule, or require a new
  schedule for authority-changing fields.
- Decide start/end/count, missed-run, overlap, DST, travel, and tzdata-update
  policies.
- Decide retention, pagination, export, delete, restore, and legacy-state
  semantics for schedules and runs.
- Name product, automation, Lopu, privacy/security, accessibility/language,
  reliability, operations, support, and incident owners.

**Gate:** no engineering or participant recruitment until the product owner
approves the charter and qualified owners accept the pilot boundaries.

## Milestone A1 — Make authorization previewable

**Outcome:** the owner can understand the normalized future behavior before a
durable schedule exists.

- Build one preview shape shared by Lopu, Settings, API docs, and receipts.
- Show local date/time and zone, next several occurrences, recurrence end,
  mode, persistent destination, context list, notification delivery, authority,
  cost class, missed-run behavior, and stop/delete consequences.
- Reject relative or ambiguous natural-language time until the owner resolves
  it. Do not silently infer a zone or end condition.
- Mark each-run chat creation as an explicit destination change with an example
  of the resulting conversation count.
- Make confirmation accessible by keyboard, touch, screen reader, zoom,
  reduced motion, and supported locales; status does not steal focus.
- Negotiate `api.lopu-reminders` on the selected origin before mutation.

**Gate:** structured participants can accurately restate all material fields,
and cancellation at preview writes nothing.

## Milestone A2 — Version schedule and occurrence truth

**Outcome:** every due instant is reproducible and every duplicate converges.

- Persist an immutable schedule version and owner-visible change receipt.
- Derive a stable occurrence ID from schedule version plus due instant; never
  from worker time alone.
- Record time-zone identifier and calculation provenance without copying
  sensitive environment state.
- Define DST gap/fold fixtures, tzdata-upgrade fixtures, leap/calendar
  boundaries, and explicit owner-zone changes.
- Separate eligible, claimed, running, done, skipped, cancelled, failed,
  ambiguous, expired, and superseded states.
- Fence overlaps and duplicate scheduler ticks transactionally; preserve the
  existing deterministic request identity and relational run model.

**Gate:** property and integration tests prove one logical occurrence across
duplicate ticks, restart, lease expiry, clock boundaries, and schedule changes.

## Milestone A3 — Make execution and stopping dependable

**Outcome:** recurrence never gains authority and owner stop decisions take
effect before not-yet-committed work.

- Recheck owner, account, source, destination, linked Things, completion,
  capability, schedule version, enabled state, and lease immediately before
  each irreversible step.
- Preserve persistent-chat reuse across worker restart, deployment, pause/
  resume, duplicate tick, and old-client upgrade.
- Keep missed occurrences skipped under a bounded, owner-visible policy.
- Add explicit cancel and delete operations rather than overloading pause or
  source mutation. Define what an in-flight run can and cannot stop.
- Keep ambiguous assistant/tool effects disabled for owner review. Any repair
  shows prior evidence and requires fresh authorization.
- Prevent recursion, scope growth, urgency escalation, cross-account context,
  and notification-preference bypass.

**Gate:** adversarial races create no duplicate output, surprise chat,
cross-account disclosure, hidden replay, or post-stop new work.

## Milestone A4 — Make state inspectable and repairable

**Outcome:** the owner can answer “what will happen next, what happened, and
what can I do now?” without reading logs.

- Provide cursor-based schedule and run history with bounded fields and honest
  legacy/unknown states.
- Show schedule version, destination, next occurrence, last occurrence, skip/
  failure state, output link, notification state, and source dependencies.
- Provide accessible pause, resume, cancel, delete, and approved repair actions
  with consequence previews and post-action receipts.
- Add queue-age and scheduler-health evidence without exposing other accounts,
  prompts, content, hosts, credentials, or deployment secrets.
- Define retention/archive/export/delete and verify cascade, backup, restore,
  account closure, and cleanup.
- Document support and incident remedies for late, missing, duplicate,
  ambiguous, or unauthorized work.

**Gate:** owners can diagnose and resolve every pilot state; support does not
need private-content access or direct database edits.

## Milestone A5 — Run one bounded pilot

**Outcome:** one recurring synthetic message proves the contract end to end.

- Use one approved adult test account, one synthetic private Thing, one
  existing Lopu chat, one short recurrence, and one named IANA zone.
- Exercise preview, create, first occurrence, duplicate tick, pause/resume,
  skipped downtime, DST fixture, source completion, account switch,
  destination loss, notification failure, cancel, delete, and cleanup.
- Assert every successful output remains in the selected chat. Zero additional
  chats is a hard gate.
- Validate the actual API, capability, worker, database, chat, Settings, and
  notification boundaries; repository tests alone are insufficient.
- Capture only bounded test receipts. Delete all fixtures and verify their
  declared cascade and absence.

**Gate:** all acceptance criteria pass with zero severe privacy, security,
accessibility, duplication, time-truth, stopping, or cleanup failure.

## Continuous release gates

- Contract tests keep the route map, docs registry, capability feature, and
  clients aligned for every request/response/permission change.
- Unit/property tests cover parser bounds, recurrence, DST folds/gaps, tzdata
  changes, and next-run calculation.
- Integration tests cover deterministic occurrence claims, leases, restart,
  overlap, duplicate ticks, ambiguity, source/destination changes, and stop
  races.
- Complete-journey tests cover current-chat defaulting and saved-destination
  reuse across browser reload, scheduler restart, deployment, and account
  switch.
- Accessibility checks cover preview, errors, time choices, next-run status,
  history, pause/cancel/delete, and repair at narrow and desktop widths.
- Operations evidence covers cadence, oldest due age, failure classes,
  bounded drain behavior, and incident response without content telemetry.
- Export/deletion drills inventory schedules and run children and prove no
  orphan, restored ghost schedule, or undeclared retained receipt.

## Measures and thresholds

Track preview comprehension, destination continuity, occurrence uniqueness,
next-run calculation accuracy, stop latency, queue age, failure legibility,
accessible task success, and cleanup completeness. Define numerator,
denominator, exclusions, retention, access, and deletion for each before
collection.

Hard pilot thresholds are zero duplicate output, zero surprise chats, zero
post-stop new starts, zero cross-account/context disclosures, zero blind
ambiguous retries, and complete fixture cleanup. Scheduling volume, run count,
messages, opens, responses, streaks, or return are prohibited success metrics.

## Expansion gates

After the message-only pilot, separately approve each expansion:

1. read-only assistant output with provider/context/cost and ambiguity review;
2. external notification channels under TODO 37;
3. low-risk reversible tools under TODO 33's authority tiers;
4. team/shared schedules under collaboration and identity contracts; and
5. interoperability/import/export under a versioned calendar contract.

No tier inherits approval from the prior tier. Tool-bearing, financial,
external-communication, public, bulk, sensitive, or high-impact automation
requires a new threat model, stronger review, and explicit owner authorization.

## First owner decision packet

Approve or revise:

1. one persistent Lopu conversation as the default destination;
2. the A0 vocabulary and edit/version policy;
3. missed-run, overlap, DST, tzdata, travel, and service-window rules;
4. pause, cancel, delete, retention, export, restore, and repair semantics;
5. the message-only synthetic pilot and its hard-zero thresholds; and
6. the explicit exclusion of assistant inference, tools, external messaging,
   production telemetry, minors, and sensitive/high-impact contexts.
