# Temporal agency and humane time-semantics baseline

Last grounded: 2026-09-21 21:04 AEST, Australia/Melbourne

Status: evidence note; not an approved scheduling architecture, retention
policy, legal interpretation, service-level promise, or authorization to
change production clocks, deadlines, expiry, reminders, or user data

Plan: [temporal agency and humane time-semantics roadmap](../PLAN/temporal-agency-and-humane-time-semantics-roadmap.md)

Execution epic: [TODO 55](../TODO/claude-todo/55-temporal-agency-and-humane-time-semantics.md)

## Question

How can Thingtime make “today,” “tomorrow,” “in an hour,” “daily at 9,”
“expires,” “last seen,” and “never” mean what a person reasonably expects
across travel, daylight-saving changes, locale differences, offline periods,
clock skew, and accessibility needs?

## Working vocabulary

| Term                 | Meaning in this note                                                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instant              | One point on the global timeline, stored and exchanged with an explicit offset or `Z`                                                                     |
| Civil time           | A calendar date and wall-clock time interpreted in a named time zone and its rule set                                                                     |
| Duration             | Elapsed time independent of calendar boundaries, such as five minutes                                                                                     |
| Calendar recurrence  | A rule such as 09:00 every day in `Australia/Melbourne`, whose UTC offset may change                                                                      |
| Viewer-local display | Presentation in the current viewer's locale and time zone; not a change to the stored instant                                                             |
| Authority time       | The trusted time source and comparison used for expiry, leases, ordering, or security decisions                                                           |
| Temporal receipt     | A record of the input meaning, zone, resolved instant, rule provenance, next occurrence, and later transition                                             |
| Time family          | Input, canonical instant, civil rule, cached projection, reminder, notification, log, export, backup, and deletion state derived from one temporal choice |

These are planning terms. They do not prove clock accuracy, legal validity,
delivery at an exact moment, timezone-database freshness, or accessibility.

## Repository evidence

### Scheduling has a strong civil-time core

- [`remindersCore.ts`](../remix/app/api/utils/lopu/remindersCore.ts) rejects
  ambiguous offset-free timestamps, validates IANA zone names, separates
  interval recurrence from five-field cron, and computes calendar recurrence
  in the named zone.
- Its downtime rule skips missed interval or calendar occurrences instead of
  flooding a person with a backlog. Tests cover Melbourne DST movement and
  preserve a 09:00 wall-clock recurrence across the offset change.
- The recording automation similarly stores an IANA zone and deduplicates
  reminder work by local calendar date.

This is valuable groundwork. It does not yet define tzdata provenance,
timezone-change behavior, ambiguous/nonexistent local times, delayed-run
explanations, or one shared schedule preview and receipt across all clients.

### Calendar-day semantics vary by surface

- [`MemoriesCard.tsx`](../remix/app/components/Feed/MemoriesCard.tsx) deliberately
  creates viewer-local midnight ranges and accounts for 23/25-hour DST days.
- [`notificationCore.ts`](../remix/app/components/Notifications/notificationCore.ts)
  also converts selected calendar dates to viewer-local start/end instants.
- [`NotificationsPage.tsx`](../remix/app/components/Notifications/NotificationsPage.tsx)
  sets the date input's maximum day with `new Date().toISOString().slice(0, 10)`,
  which is a UTC day. Near local midnight, that can disagree with the local-day
  bounds used by the filter.
- [`ActivityHeatmap.tsx`](../remix/app/components/Profile/ActivityHeatmap.tsx)
  intentionally uses UTC days, while other product surfaces use viewer-local
  days. The difference may be legitimate, but it is not expressed through a
  shared named semantic.

“Day” is therefore a domain decision, not a formatting detail. Each surface
needs to state whether it means UTC day, viewer-local day, account-home day,
event-origin day, or another approved calendar.

### Relative time and labels are implemented repeatedly

- [`lopuTurnCore.ts`](../remix/app/components/Lopu/lopuTurnCore.ts) labels
  messages Today/Yesterday using local `Date` fields, but derives yesterday by
  subtracting exactly 86,400,000 milliseconds. A local civil day is not always
  24 hours around daylight-saving transitions.
- [`DeviceCard.tsx`](../remix/app/components/Devices/DeviceCard.tsx) renders
  “Just now,” seconds, minutes, hours, and fixed 24-hour days from elapsed
  milliseconds.
- Notifications, messages, invites, tokens, tasks, deployments, settings,
  apps, devices, profiles, and admin surfaces independently call
  `toLocaleString()` or `toLocaleDateString()` with different detail and
  fallback behavior.

These helpers are not automatically wrong: elapsed device age and civil
calendar labels are different concepts. The gap is the absence of a shared
vocabulary, formatter registry, invalid/future-value policy, and accessible
exact-time disclosure.

### Expiry and deadlines are broad product authority

The current code applies time to session and token expiry, one-time grants,
pairing, uploads, invites, passkeys, app grants, connection state, device
presence, rate limits, worker leases, reminders, moderation, retention, and
supporting diagnostics. Some comparisons use server-side `Date` values; some
client countdowns use the browser clock.

An expired label can remove access, stop an action, hide a link, reclaim work,
or change a safety state. Those effects need an authoritative clock, grace and
skew policy, idempotent transition, exact explanation, and remedy. A client
countdown can inform but should not independently decide security authority.

## External design anchors

| Anchor                                                                                                                                                                                                             | Planning implication                                                                                                                    | Limit                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| The [IANA Time Zone Database](https://www.iana.org/time-zones) tracks civil-time changes made by political bodies.                                                                                                 | Persist named zones and record runtime/rule provenance; design for rule updates rather than assuming offsets are permanent.             | IANA data does not choose Thingtime's product semantics or promise governments will provide notice. |
| W3C's [Working with Time Zones](https://www.w3.org/TR/timezone/) distinguishes incremental time, wall time, and floating time, and recommends recording the information needed to recover intended meaning.        | Model instant, duration, civil time, and recurrence separately; do not overload one timestamp field.                                    | A Working Group Note is design guidance, not a Thingtime implementation or legal rule.              |
| [RFC 9557](https://www.rfc-editor.org/rfc/rfc9557.html) extends Internet timestamps with optional timezone and calendar annotations and explains why an offset alone cannot preserve all future civil-time intent. | A temporal receipt should preserve both the resolved instant and named-zone/calendar intent when future recalculation matters.          | Thingtime need not adopt its wire syntax before compatibility and ecosystem review.                 |
| ECMA-402's [`Intl.DateTimeFormat`](https://tc39.es/ecma402/#datetimeformat-objects) defines locale-sensitive date/time formatting.                                                                                 | Central formatters should use standards-based locale/zone options and expose stable semantic presets rather than scattered strings.     | Formatting does not settle storage, authority, recurrence, or accessibility.                        |
| WCAG 2.2 [Timing Adjustable](https://www.w3.org/WAI/WCAG22/Understanding/timing-adjustable.html) requires many user-facing time limits to be adjustable, extendable, or excepted for a justified reason.           | Inventory interactive time limits, warn before expiry, preserve work, and offer extension or recovery where the limit is not essential. | Applicability and conformance require qualified accessibility review.                               |

All five official pages returned HTTP 200 when checked on 2026-09-21.

## The product gap

Thingtime needs one temporal contract joining:

1. named semantics for instant, local day, duration, civil time, recurrence,
   deadline, expiry, retention, lease, freshness, and display;
2. an authority-clock policy for security, ordering, leases, and irreversible
   transitions;
3. preservation of both named-zone intent and resolved instant when future
   recalculation matters;
4. deterministic handling of ambiguous and nonexistent local times, tzdata
   changes, travel, account-zone changes, and clock skew;
5. shared locale-aware format presets with an accessible exact-time path;
6. adjustable/extendable user-facing limits, warning, draft preservation, and
   remedy where time is not essential;
7. honest late, skipped, superseded, expired, paused, interrupted, and unknown
   states rather than silently rewriting them as success;
8. family-wide retention and cleanup after a schedule or time-bound authority
   changes; and
9. test fixtures spanning DST gaps/folds, leap days, midnight boundaries,
   stale tzdata, offline recovery, and hostile clocks.

## Boundaries with adjacent garden work

- [TODO 24](../TODO/claude-todo/24-attention-agency-and-calm-use.md) owns quiet
  use, notification pressure, and stopping points.
- [TODO 28](../TODO/claude-todo/28-service-continuity-and-recovery.md) owns
  service objectives and recovery; this chain defines time meanings used by them.
- [TODO 37](../TODO/claude-todo/37-notification-agency-and-accountable-delivery.md)
  owns notification lifecycle and delivery truth.
- [TODO 43](../TODO/claude-todo/43-automation-agency-and-accountable-recurrence.md)
  owns automation authority and occurrence execution; this chain supplies the
  shared temporal primitives.
- [TODO 45](../TODO/claude-todo/45-youth-safety-and-age-appropriate-agency.md)
  owns age-appropriate safeguards, including timed interactions for children.
- [TODO 48](../TODO/claude-todo/48-change-agency-and-humane-product-evolution.md)
  owns deprecation and sunset transitions.
- [TODO 50](../TODO/claude-todo/50-legacy-agency-and-dignified-stewardship.md)
  owns future instructions and qualified stewardship.
- [TODO 54](../TODO/claude-todo/54-measurement-agency-and-privacy-respecting-telemetry.md)
  owns telemetry; timing evidence cannot silently become behavioral scoring.

## Candidate temporal contract

1. **Name the semantic.** Every field declares instant, civil time, duration,
   recurrence, deadline, expiry, retention, lease, freshness, or display.
2. **Store intent and resolution.** Future civil intent keeps zone/calendar,
   local fields, disambiguation choice, resolved instant, and rule provenance.
3. **Authority stays server-side.** Clients preview and count down; trusted
   server time decides access, security, leases, and irreversible transitions.
4. **Days are explicit domains.** UTC day, viewer day, account-home day, and
   event-origin day are different types with different tests.
5. **Formatting is shared and accessible.** Named presets provide locale-aware
   primary text, exact instant/zone on demand, and screen-reader-safe wording.
6. **Limits preserve agency.** Warn, extend, save drafts, retry safely, and
   provide remedy unless a documented essential exception applies.
7. **Late is not on-time.** Record due, claimed, started, completed, skipped,
   and observed times without turning missing evidence into success.
8. **Change is explainable.** Travel, zone changes, tzdata updates, edits,
   pause/resume, and clock correction produce previewable transitions.
9. **Cleanup follows the family.** Superseded schedules, caches, alerts,
   receipts, provider copies, and backups converge on approved retention.

## Bounded first rehearsal

Use adult internal reviewers, synthetic dates, a deterministic fake authority
clock, two named zones (`Australia/Melbourne` and `America/New_York`), one DST
gap, one DST fold, one leap day, one midnight boundary, one offline interval,
one simulated tzdata change, and one exact non-production build.

Prototype only inert previews and fixtures for:

- a one-time deadline with warning, extension, saved draft, expiry, and remedy;
- a 09:00 calendar recurrence that preserves or deliberately changes wall time;
- a viewer-local day filter and a deliberately UTC analytics day;
- a relative label with an exact instant and zone available; and
- a delayed occurrence receipt that says scheduled, late, skipped, or unknown.

Do not change production clocks, schedules, tokens, sessions, grants, retention,
invites, notifications, legal deadlines, or real user data.

## Evaluation questions

- Can a reviewer tell whether a value is an instant, duration, local day, civil
  time, recurrence, deadline, expiry, lease, freshness window, or display?
- Does a scheduled 09:00 remain 09:00 across DST when that is the chosen intent?
- Are gap/fold choices previewed rather than silently normalized?
- Do UTC-day and viewer-day surfaces remain internally consistent near midnight?
- Does an inaccurate browser clock affect presentation only, never authority?
- Can a person discover exact instant, named zone, and why a relative label changed?
- Are time limits warned, adjustable, draft-safe, and recoverable when nonessential?
- Do late, skipped, duplicate, interrupted, and unknown runs stay honest?
- Can locale, calendar, and time-zone changes occur without losing the original intent?

## Open owner decisions

- Which account-level home zone, locale, and calendar preferences should exist,
  and which surfaces must always follow the current viewer/device instead?
- Which schedules preserve wall time, which preserve elapsed duration, and how
  are existing occurrences recalculated after zone or tzdata change?
- How are ambiguous/nonexistent local times presented and resolved by default?
- Which clock is authoritative in each runtime and what skew/grace is safe?
- Which time limits are essential, extendable, pausable, or recoverable?
- Which exact presets and accessibility disclosures become shared primitives?
- What evidence supports any punctuality, expiry, retention, or deletion claim?

Refresh this note after changes to schedules, reminders, notifications, date
filters, relative-time labels, activity/memory days, zones/locales/calendars,
token/session/grant expiry, leases, retention, clock sources, or tzdata.
