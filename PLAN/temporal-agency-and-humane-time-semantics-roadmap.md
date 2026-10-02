# Temporal agency and humane time-semantics roadmap

Status: Proposed

Evidence: [temporal agency and humane time-semantics baseline](../NOTES/temporal-agency-and-humane-time-semantics-baseline.md)

Execution epic: [TODO 55](../TODO/claude-todo/55-temporal-agency-and-humane-time-semantics.md)

## Outcome

Thingtime treats time as explicit product meaning rather than scattered date
formatting: schedules preserve approved civil intent, authority uses trusted
clocks, day boundaries are named, time limits preserve agency, late/expired
states stay honest, and every person can understand exact time across locale,
zone, DST, travel, offline recovery, and accessibility needs.

## Non-goals

- Do not replace JavaScript `Date`, adopt Temporal, or change wire syntax before
  an approved compatibility decision.
- Do not promise exact delivery, real-time execution, legal deadline validity,
  current tzdata, or clock accuracy without measured evidence.
- Do not change production expiry, sessions, tokens, grants, retention,
  schedules, notification delivery, or legal policy in this roadmap.
- Do not infer locale, zone, religion, routine, travel, work pattern, or location
  for personalization, ranking, eligibility, advertising, or safety scoring.

## Milestone 0 — freeze semantics and assign owners

**Status:** planned

- Name product, platform, security, privacy, accessibility, internationalization,
  operations, support, data-retention, and legal owners plus stop authority.
- Inventory temporal fields, helpers, UI labels, zones, locales, clocks,
  deadlines, expiry, leases, retention, schedules, providers, and tests.
- Classify each value as instant, civil time, duration, recurrence, local day,
  deadline, expiry, retention, lease, freshness, or display.
- Freeze new one-off date helpers and ambiguous offset-free inputs until the
  shared vocabulary and migration rule are approved.

**Gate:** every high-authority temporal path has a named semantic, source of
truth, owner, effect, evidence level, and safe fallback.

## Milestone 1 — approve the temporal contract

**Status:** planned

- Decide account-home, viewer/device, event-origin, and UTC calendar scopes.
- Define authority-clock, clock-skew, grace, ordering, idempotence, and
  irreversible-transition rules for every runtime.
- Define future civil-time records: zone/calendar, local fields,
  disambiguation, resolved instant, rule provenance, and recalculation policy.
- Define deterministic gap/fold, leap-day, end-of-month, timezone change,
  tzdata change, pause/resume, edit, and travel behavior.
- Decide which limits are essential, extendable, pausable, warning-bearing,
  draft-safe, or recoverable under WCAG review.

**Gate:** owners approve the type matrix, authority map, change semantics,
accessibility exceptions, and migration posture.

## Milestone 2 — design shared primitives and receipts

**Status:** planned

- Specify typed constructors/parsers for instants, durations, local days,
  civil time, recurrence, deadlines, expiry, leases, and freshness.
- Specify named format presets for compact date, exact date-time, relative age,
  schedule preview, deadline/expiry, and machine-readable output.
- Every relative label exposes an exact instant and named zone through adjacent
  text, tooltip, details, or an accessible control.
- Specify a schedule preview/receipt showing input meaning, current zone,
  resolved next instants, DST behavior, tzdata provenance, change policy, and
  stop/remedy path.
- Specify event evidence for due, claimed, started, completed, skipped, late,
  superseded, expired, interrupted, and unknown.

**Gate:** keyboard, touch, screen reader, zoom, narrow-screen, locale, and plain-
language prototypes communicate both primary and exact time without ambiguity.

## Milestone 3 — run the synthetic temporal laboratory

**Status:** planned

- Use a deterministic fake authority clock and inject viewer zone/locale rather
  than changing the host clock.
- Exercise Melbourne and New York DST gap/fold, leap day, month/year boundary,
  UTC/local midnight, future/past browser skew, offline recovery, and tzdata
  revision fixtures.
- Rehearse one-time deadlines, interval timers, calendar recurrences, date
  filters, relative labels, expiry, warning/extension, and delayed receipts.
- Compare preserve-wall-time versus preserve-instant behavior and record why a
  product family chooses one.
- Prove repeated workers or client retries converge on one authority outcome.

**Gate:** fixtures are deterministic; no real schedules or authorities change;
every outcome has a reproducible receipt and an understandable explanation.

## Milestone 4 — migrate one low-risk vertical slice

**Status:** blocked on owner approval and Milestones 0–3

Recommended slice: notification date filters and their displayed exact bounds.

- Use one named viewer-local-day primitive for input max, URL state, query
  bounds, empty state, and tests.
- Add boundary fixtures for positive/negative UTC offsets and local midnight.
- Preserve URL compatibility and avoid changing notification retention or data.
- Measure comprehension, regressions, bundle/runtime cost, and support burden.
- Roll back on any missing/duplicate day, inaccessible exact time, or stale-
  client mismatch.

**Gate:** the exact production candidate passes the synthetic matrix and an
explicit human review before any rollout request.

## Milestone 5 — expand by authority and risk

**Status:** future

Expand only after the low-risk slice is validated:

1. shared display-only formatters and relative labels;
2. calendar surfaces such as memories and activity;
3. reminders and scheduled messages;
4. non-security deadlines and invitations;
5. leases, retention, grants, tokens, sessions, and other security authority
   only with separate security/data/legal approval.

For each family, migrate source, tests, caches, receipts, exports, docs,
monitoring, backup/restore, and cleanup together. Never bulk-rewrite semantics.

## Success measures

| Measure              | Proposed gate                                                                                            | Anti-metric                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Semantic coverage    | Every inventoried field/helper has one declared temporal type and authority                              | Counting annotations without checking behavior is not coverage |
| Boundary correctness | Synthetic gap/fold/leap/midnight/skew/offline fixtures converge deterministically                        | A UTC-only happy path is not proof                             |
| Comprehension        | Reviewers can predict wall-time/instant behavior and explain changes before saving                       | Faster completion cannot excuse misunderstanding               |
| Accessibility        | Nonessential limits warn and extend or recover; exact time is available without pointer-only interaction | No increase in completion through pressure                     |
| Authority integrity  | Client clock cannot grant access, extend security authority, or erase expiry                             | Smooth countdown animation is not authority proof              |
| Delivery truth       | Due/start/finish/late/skipped/unknown reconcile within the approved envelope                             | Do not call provider acceptance or worker claim “on time”      |
| Privacy              | No new inference of location, routine, work, religion, health, or travel                                 | Zone choice is not profiling permission                        |
| Cleanup              | Superseded temporal families converge to approved retention in rehearsal                                 | Hiding a row is not deletion                                   |

## Risks and mitigations

| Risk                                          | Mitigation                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| A shared helper silently changes old behavior | Inventory semantics first; migrate one surface; compatibility fixtures and rollback               |
| Offset is mistaken for future zone intent     | Preserve named zone and rule provenance when recurrence/future intent matters                     |
| DST gap/fold is silently normalized           | Preview both interpretation and disambiguation; require deterministic approved default            |
| Client clock controls authority               | Server comparison and receipts; clients remain presentation-only                                  |
| “Yesterday” assumes 24 hours                  | Use calendar comparison for civil labels and elapsed duration for ages                            |
| Timezone reveals location/routine             | User choice, minimum scope, private storage, no unrelated inference or reuse                      |
| Exact time overwhelms the UI                  | Layer simple primary text with accessible exact disclosure and consistent presets                 |
| Time limits coerce or lose work               | Warning, extension, draft persistence, retry, and remedy unless essential exception is documented |
| Tzdata changes rewrite history                | Keep original receipt/provenance; distinguish historical display from future recalculation        |
| Late work is reported as success              | Separate due, claim, start, completion, delivery, and observation evidence                        |

## Hard stops

Stop for production clock or tzdata mutation; changing live security/session/
token/grant/retention/legal authority; real user schedules or notifications;
location or routine inference; hidden timezone capture; dark-pattern countdowns;
nonessential inaccessible time limits; silent gap/fold normalization; bulk
semantic migration; client-clock authority; erased late/skipped evidence;
public punctuality/expiry/deletion claims without exact proof; or missing owners,
rollback, test fixtures, cleanup, and manual stop authority.

## Dependencies and boundaries

- TODO 24 owns calm-use and notification pressure.
- TODO 28 owns service objectives and recovery.
- TODO 37 owns notification lifecycle and delivery evidence.
- TODO 43 owns automation authority and occurrence execution.
- TODO 45 owns child-specific timing safeguards.
- TODO 48 owns deprecation and sunset transitions.
- TODO 50 owns qualified future stewardship.
- TODO 54 owns telemetry and measurement purpose.
- `FUNDAMENTALS.md` and `DECISIONS.md` remain authoritative.

## Next owner packet

Present the evidence baseline, temporal inventory, semantic type matrix,
authority-clock map, zone/calendar scope decision, gap/fold and recalculation
rules, shared formatter/receipt vocabulary, WCAG time-limit review, synthetic
fixture matrix, low-risk notification-filter slice, measures, migration and
rollback plan, family cleanup, stop conditions, and named owner decisions.
