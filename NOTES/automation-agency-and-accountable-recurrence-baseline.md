# Automation agency and accountable-recurrence baseline

**Status:** Evidence note; no implementation is authorized by this document

**Grounded:** 2026-09-13, Australia/Melbourne

**Plan:** [Automation agency and accountable-recurrence roadmap](../PLAN/automation-agency-and-accountable-recurrence-roadmap.md)

**Execution epic:** [TODO 43 — Automation agency and accountable recurrence](../TODO/claude-todo/43-automation-agency-and-accountable-recurrence.md)

## Why preserve this note

Thingtime now has durable one-time and repeating Lopu schedules. A scheduled
message can stay in one selected conversation, each occurrence has a separate
run Thing, duplicate occurrence claims are fenced, and an ambiguous assistant
run stops for owner attention instead of being replayed blindly. Those are
strong foundations.

They do not yet form a complete automation-agency contract. A person still
needs one place to preview exactly what will recur, where it will appear, what
happens across time-zone changes and downtime, how to edit or delete it, what a
run receipt proves, and how to stop an in-flight or unhealthy schedule. This
note freezes the current evidence and proposes one bounded pilot before
scheduled work expands.

This is product and engineering research, not a claim that scheduled delivery
is operational in every deployment. [TODO 33](../TODO/claude-todo/33-ai-agency-and-accountable-assistance.md)
owns model context and tool authority. [TODO 37](../TODO/claude-todo/37-notification-agency-and-accountable-delivery.md)
owns event-to-delivery evidence. This chain owns the separate intent, schedule,
occurrence, execution, destination, stopping, and recurrence contract.

## Evidence ledger

| Claim                                                                                           | Current evidence                                                                                                                                                                                                                                                                                                                                                                 | Confidence and refresh trigger                                                                                          |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| A scheduled chat task defaults to continuity, not chat proliferation.                           | [`chatTools.ts`](../remix/app/api/utils/lopu/chatTools.ts) binds a chat-mode reminder to the current `chatId` when no destination option is supplied. [`scheduledMessages.ts`](../remix/app/api/utils/lopu/scheduledMessages.ts) otherwise reuses the saved `destinationChatId`; only explicit `newChatEachRun` creates a conversation per occurrence.                           | High for the inspected `develop` snapshot. Recheck after tool schema, chat creation, or destination resolution changes. |
| Schedule input is bounded and calendar-aware.                                                   | [`remindersCore.ts`](../remix/app/api/utils/lopu/remindersCore.ts) accepts an absolute offset-bearing time or a five-field cron expression, validates an IANA time zone, rejects cron plus interval, limits recurring intervals to 5–525,600 minutes, and caps related Things at ten.                                                                                            | High for current parsing. Recheck after schedule grammar or limits change.                                              |
| Missed recurring runs are skipped rather than replayed as a backlog.                            | `nextReminderTime()` advances from the current time for interval and cron recurrence. API docs and Lopu's tool description say the five-minute scheduler skips missed backlogs.                                                                                                                                                                                                  | High for current calculation; deployment cadence and starvation still need live proof.                                  |
| Each chat occurrence has a durable identity and relational run record.                          | `deliverScheduledLopuMessage()` derives `requestId` from schedule ID plus scheduled occurrence and creates an owner-private, quota-billed `scheduled-task-run` child linked to the source Thing.                                                                                                                                                                                 | High for the writer. A run Thing is product history, not an immutable security audit.                                   |
| Duplicate and ambiguous execution are intentionally different.                                  | A repeated completed occurrence no-ops, while a pre-existing non-terminal claim disables the schedule as `needs-attention`. Tests cover duplicate-occurrence suppression and ambiguous-claim stopping.                                                                                                                                                                           | High for covered paths. Recheck every retry, lease, worker, or message-persistence change.                              |
| Assistant-mode recurrence remains authority-bounded.                                            | The scheduled prompt forbids creating further schedules, preserves confirmation requirements, uses linked Things selected at creation, and runs through the normal billing/provider path. Related Things and source ownership/completion are checked again at execution.                                                                                                         | High for code intent; actual provider interruption and tool-side-effect behavior need end-to-end proof.                 |
| Pausing is owner-scoped and checked during execution.                                           | `setLopuReminderEnabled()` filters by owner and clears the lease. The message path rechecks `enabled` before saving the destination and run. Tests cover account isolation and pause/lost-lease stopping.                                                                                                                                                                        | High for inspected operations. “Already started” remains a boundary that needs an owner-facing explanation.             |
| Source completion or deletion stops later starts.                                               | The worker requires an owner-private source data Thing that is not completed. The API contract says completing or deleting the source stops future starts; schema registration cascades scheduled-task-run children.                                                                                                                                                             | High for current source fence. Verify deletion, backup, restore, and orphan cleanup as one lifecycle.                   |
| Notification preferences do not erase a saved chat output.                                      | A message or assistant result is persisted first. Best-effort notification failure is stored as `notificationStatus: unavailable` on the run without deleting the chat message.                                                                                                                                                                                                  | High for the current ordering. Notification lifecycle truth belongs to TODO 37.                                         |
| Owner inspection is bounded but incomplete.                                                     | GET lists at most 100 schedules; a task receipt includes at most 30 recent runs and readable related Things. POST supports create and `set-enabled`, but no distinct edit, cancel, or delete operation is exposed by this route.                                                                                                                                                 | High for current docs and route. Recheck after API version or settings UI changes.                                      |
| Worker capacity is bounded but no owner-facing service objective is established.                | `runLopuReminders()` claims earliest due work for at most 100 iterations or 20 seconds, with five-minute leases and a later lease-expiry write. This prevents an unbounded invocation but does not prove fairness, timeliness, or drain capacity.                                                                                                                                | High for code limits; measure real scheduler cadence and queue age before any reliability claim.                        |
| The capability contract is registered.                                                          | The route import map contains `v1/lopu/reminders`; `apiDocs.ts` registers `api.lopu-reminders` 1.1.0 and describes message, assistant, stable-destination, run-history, pause, backlog, and ambiguity semantics.                                                                                                                                                                 | High for repository state. Negotiate the actual selected origin before use.                                             |
| Calendar standards separate recurrence rules, local time, occurrence identity, and task status. | IETF [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.html) defines `DTSTART`, `TZID`, `RRULE`, `RECURRENCE-ID`, `STATUS`, and related scheduling vocabulary. It is design input, not a decision to adopt iCalendar storage.                                                                                                                                                    | High for the cited standard; interoperability scope remains undecided.                                                  |
| Civil-time rules are mutable operational data.                                                  | The [IANA Time Zone Database](https://www.iana.org/time-zones) is updated when governments change offsets, boundaries, or daylight-saving rules. A stored zone name therefore needs a named rule-version and recalculation policy.                                                                                                                                               | High for the risk class. Recheck runtime tzdata during implementation and release.                                      |
| Timed and auto-updating experiences require user control.                                       | W3C guidance for [Timing Adjustable](https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html), [Pause, Stop, Hide](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html), and [Interruptions](https://www.w3.org/WAI/WCAG22/Understanding/interruptions.html) supports visible ways to adjust, pause, suppress, or otherwise control time-based behavior. | High as accessibility input. Conformance needs complete-journey testing.                                                |
| AI scheduling needs explicit oversight roles and safe decommissioning.                          | NIST's [AI RMF Core](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/) calls for differentiated human-AI roles, documented oversight, ongoing review, and safe decommissioning.                                                                                                                                                                                           | High as governance input, not a certification or product requirement by itself.                                         |

## A narrow vocabulary

| Term              | Proposed meaning                                                                               | Must not imply                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Intent            | The owner's current purpose in asking for future work.                                         | A schedule already exists.                                                   |
| Schedule          | The durable, versioned rule authorized by the owner.                                           | Any occurrence ran or succeeded.                                             |
| Occurrence        | One calculated due instant under one schedule version and time-zone rule set.                  | A worker claimed or executed it.                                             |
| Claim/lease       | Temporary exclusive permission for one worker to consider an occurrence.                       | The requested work happened.                                                 |
| Run               | A bounded execution attempt linked to one occurrence.                                          | Success, delivery, or human attention.                                       |
| Output            | The durable message or assistant result created by a run.                                      | Truth, usefulness, notification delivery, or completion.                     |
| Destination       | The owner-approved conversation or surface receiving output.                                   | Permission to create a fresh destination later.                              |
| Pause             | Prevent new occurrences from starting while preserving schedule state.                         | Cancellation, deletion, or interruption of an already-committed side effect. |
| Cancel            | End future recurrence under a declared retention rule.                                         | Source deletion or erasure of run history.                                   |
| Delete            | Remove the schedule and declared relational artifacts through the canonical deletion contract. | Undo of external or already-presented effects.                               |
| Retry             | A deliberate repeat under an occurrence and side-effect policy.                                | Blind replay after an ambiguous outcome.                                     |
| Missed occurrence | A due instant not started inside its service window.                                           | Permission to flood a backlog later.                                         |
| Receipt           | Bounded evidence of schedule, occurrence, run, output, and notification states.                | An immutable audit record or proof the owner saw the result.                 |

## Strengths to preserve

- **One persistent conversation is the default.** New-chat-per-run is an
  explicit opt-in, not an incidental worker behavior.
- **Schedule and run are relational.** Run history does not grow as an
  unbounded array on the task.
- **Occurrence identity is deterministic.** Duplicate scheduler ticks can
  converge without duplicate messages.
- **Ambiguity fails closed.** An uncertain assistant run stops for human
  review instead of automatically repeating possible side effects.
- **Authority is rechecked.** Owner, source, related Things, completion, lease,
  and pause state are checked near execution.
- **Downtime does not create a notification storm.** Missed intervals advance
  from now instead of replaying every gap.
- **Output survives alert failure.** A saved result and its best-effort alert
  remain separate evidence.

## Gaps that keep agency implicit

1. **No canonical preview.** The owner cannot yet inspect one stable summary of
   rule, zone, next occurrences, destination, mode, context, cost, and stop
   semantics before confirming.
2. **Edit semantics are undefined.** There is no versioned answer for whether
   changing time, destination, context, or mode edits future occurrences or
   creates a replacement schedule.
3. **Cancel and delete are conflated with source lifecycle.** Pause exists, but
   the API lacks separately named cancel/delete operations and receipts.
4. **Time-zone rule drift is invisible.** A zone name is stored, but rule data,
   DST ambiguity, tzdata upgrades, and owner travel need a policy.
5. **Run history is not a complete state machine.** Claimed, skipped, cancelled,
   expired, superseded, retry-authorized, and notification states need explicit
   meanings and bounded retention.
6. **Capacity truth is absent.** A 100-item/20-second scan is bounded, but queue
   age, starvation, fairness, scheduler outages, and service windows have no
   approved objectives or owner-visible state.
7. **Failure remedy is coarse.** `needs-attention` stops safely, but the owner
   needs a precise reason, safe inspection path, and deliberate repair or
   replacement action.
8. **Destination continuity needs regression proof.** Existing tests cover the
   main path; complete-journey tests must prove no second chat across restart,
   account switch, stale state, duplicate tick, pause/resume, and upgrade.
9. **Pagination and retention are undecided.** Limits of 100 schedules and 30
   runs avoid unbounded reads but can hide older state without an archive,
   cursor, export, or deletion policy.
10. **Automation expansion lacks a tier gate.** Message, read-only assistant,
    and future tool-bearing automation must not inherit equal authority.

## Threat and failure sketch

| Scenario                                              | Required response                                                                                 |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Natural-language time is ambiguous                    | Ask for exact date, local time, zone, recurrence, and end condition; do not guess.                |
| Duplicate worker tick                                 | Reuse the occurrence claim and produce no duplicate output.                                       |
| Worker dies after an uncertain external effect        | Stop for owner attention; never replay automatically.                                             |
| Destination was deleted or belongs to another account | Fail closed without creating a surprise chat or leaking context.                                  |
| Tzdata changes future civil time                      | Recalculate visibly under an approved policy and show old/new next occurrences before acceptance. |
| Long outage creates many due instants                 | Record bounded skipped state and calculate the next future occurrence; never flood.               |
| Owner pauses while a run is leasing                   | Prevent every not-yet-committed step; report any step already completed narrowly.                 |
| Source or linked Thing becomes unreadable/completed   | Stop future work and show the exact unavailable dependency without content leakage.               |
| Schedule recursively creates another schedule         | Reject it; recurrence cannot self-replicate.                                                      |
| Notification is muted or fails                        | Preserve the output/run state and label delivery unknown or unavailable.                          |

## Candidate first pilot

Use one approved adult test account, one synthetic private Thing, and one
existing Lopu conversation. Create a short recurring schedule in `message`
mode with a named IANA zone and explicit end/cleanup plan. Exercise preview,
confirm, first run, duplicate scheduler tick, pause, resume, skipped downtime,
DST calculation, source completion, account switch, destination unavailability,
notification failure, cancel, and deletion.

The pilot must keep all occurrences in the selected persistent conversation.
It must not use assistant inference, arbitrary tools, external messaging,
purchases, real personal content, minors, sensitive or high-impact domains, or
production telemetry. Minutes-scale local timing is acceptable when it follows
the production-shaped API, worker, persistence, and capability path.

## Measures worth collecting

- Preview comprehension: participants can restate what, when, zone,
  destination, recurrence, end condition, context, and cost will apply.
- Destination continuity: every successful occurrence resolves to exactly the
  approved chat unless the owner explicitly changes it.
- Occurrence uniqueness: duplicate claims create zero duplicate runs or output.
- Stop latency: no not-yet-committed work begins after pause, cancel, source
  completion, destination loss, account switch, or deletion is canonical.
- Next-run truth: displayed next occurrence matches the approved calculation
  across DST and simulated downtime.
- Failure legibility: the owner can distinguish skipped, failed, ambiguous,
  notification-unavailable, paused, cancelled, and complete states.
- Cleanup completeness: all pilot schedules, runs, source data, and local
  artifacts are inventoried and removed under the approved policy.

Do not measure task count, run count, notification volume, messages created,
response rate, continued use, streaks, or engagement. Those reward recurrence
itself instead of agency or correctness.

## Stop conditions

Stop the pilot immediately if any duplicate output appears; a second chat is
created without explicit opt-in; a paused/cancelled/deleted schedule starts new
work; context crosses an account or destination boundary; an ambiguous run is
retried automatically; a backlog floods; a time-zone change is hidden; a
notification is called delivery proof; cleanup is incomplete; or any
participant cannot inspect and stop the schedule accessibly.

## Owner decisions before implementation

1. Approve the vocabulary and the persistent-conversation default.
2. Choose replace-versus-version semantics for edits.
3. Define pause, cancel, delete, completion, retention, export, and restore.
4. Choose missed-run, DST ambiguity, time-zone update, and travel behavior.
5. Define occurrence service windows, queue-age objectives, and remedies.
6. Approve the pilot, evidence, stop thresholds, and accountable owners.
7. Keep assistant mode and all tool-bearing automation separately gated.
