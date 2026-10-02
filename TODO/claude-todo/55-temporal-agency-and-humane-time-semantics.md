# 55 — Temporal agency and humane time semantics

Status: 🟣 Proposed · owner and qualified review needed

Evidence: [baseline](../../NOTES/temporal-agency-and-humane-time-semantics-baseline.md)

Plan: [roadmap](../../PLAN/temporal-agency-and-humane-time-semantics-roadmap.md)

## Goal

Make Thingtime's dates, days, durations, schedules, deadlines, expiry, relative
labels, leases, and retention explicit, predictable, accessible, and honest
across time zones, locale, DST, travel, offline recovery, and clock skew.

## Why this belongs in the garden

Thingtime already rejects ambiguous offset-free reminder timestamps, validates
IANA zones, preserves 09:00 calendar recurrence across DST, skips missed
backlogs, and builds DST-safe local-day ranges for memories. Elsewhere, day and
label semantics are fragmented: notification input max uses UTC while its query
bounds use viewer-local days; activity intentionally uses UTC; “Yesterday” is
derived by subtracting a fixed 24 hours; and many surfaces independently format
or compare time.

This TODO creates a shared decision and rehearsal boundary. It does not approve
a date-library migration, production clock change, or altered expiry authority.

## Dependencies and boundaries

- [TODO 24](./24-attention-agency-and-calm-use.md) owns calm use and quiet windows.
- [TODO 28](./28-service-continuity-and-recovery.md) owns service objectives.
- [TODO 37](./37-notification-agency-and-accountable-delivery.md) owns
  notification lifecycle and delivery truth.
- [TODO 43](./43-automation-agency-and-accountable-recurrence.md) owns
  occurrence authority and recurring execution.
- [TODO 45](./45-youth-safety-and-age-appropriate-agency.md) owns child-specific safeguards.
- [TODO 48](./48-change-agency-and-humane-product-evolution.md) owns sunset transitions.
- [TODO 50](./50-legacy-agency-and-dignified-stewardship.md) owns future stewardship.
- [TODO 54](./54-measurement-agency-and-privacy-respecting-telemetry.md) owns telemetry.
- `FUNDAMENTALS.md` and `DECISIONS.md` remain authoritative. This TODO changes no
  production schedule, expiry, time source, retention, or user data.

## Phase 0 — inventory temporal authority

- [ ] Name product, platform, security, privacy, accessibility,
      internationalization, operations, support, data-retention, and legal
      owners plus manual stop authority.
- [ ] Inventory every instant, civil time, duration, local day, recurrence,
      deadline, expiry, retention, lease, freshness, relative label, clock,
      zone, locale, calendar, provider, cache, export, and test.
- [ ] Record source of truth, reader/writer, effect, authority, fallback,
      precision, rule provenance, retention, and evidence confidence.
- [ ] Freeze new ambiguous offset-free inputs and one-off formatters while the
      shared vocabulary is reviewed.

## Phase 1 — approve time meanings and clocks

- [ ] Define typed semantics for instant, duration, civil time, recurrence,
      UTC day, viewer-local day, account-home day, deadline, expiry, retention,
      lease, freshness, and presentation.
- [ ] Decide server/runtime authority clocks, client presentation clocks,
      allowed skew/grace, ordering, idempotence, and irreversible transitions.
- [ ] Define when records preserve named zone/calendar, local fields,
      disambiguation, resolved instant, rule version, and recalculation policy.
- [ ] Approve deterministic DST gap/fold, leap-day, month-end, travel,
      account-zone, tzdata-change, pause/resume, and edit behavior.

## Phase 2 — design shared formatting and receipts

- [ ] Specify named locale-aware presets for compact date, exact date-time,
      relative age, schedule preview, deadline/expiry, and machine output.
- [ ] Make every relative label expose the exact instant and named zone through
      adjacent text, details, tooltip, or another keyboard/screen-reader path.
- [ ] Specify schedule previews showing wall-time versus instant intent, next
      occurrences, DST effect, zone, rule provenance, change behavior, and stop.
- [ ] Specify receipts for due, claimed, started, completed, displayed, late,
      skipped, superseded, expired, interrupted, and unknown.
- [ ] Define invalid, missing, future, stale, and hostile timestamp fallbacks
      without leaking internal data or inventing certainty.

## Phase 3 — rehearse a deterministic temporal laboratory

- [ ] Use adult internal reviewers, synthetic dates, a fake authority clock,
      Melbourne/New York zones, one DST gap, one fold, one leap day, one local
      midnight, one offline interval, one tzdata change, and one exact
      non-production build.
- [ ] Rehearse a one-time deadline with warning, extension, saved draft,
      expiry, recovery, and remedy without changing live authority.
- [ ] Rehearse a 09:00 calendar recurrence under preserve-wall-time and
      preserve-instant policies and explain the difference before save.
- [ ] Rehearse viewer-local and deliberately UTC day surfaces near midnight.
- [ ] Rehearse relative labels, exact disclosure, delayed/skipped receipts,
      browser clock skew, duplicate workers, retry, and restart.

## Phase 4 — accessibility, privacy, and abuse review

- [ ] Inventory user-facing time limits under WCAG Timing Adjustable and mark
      each essential, adjustable, extendable, pausable, warning-bearing,
      draft-safe, or recoverable with qualified rationale.
- [ ] Test keyboard, touch, screen reader, 200% zoom, narrow screens, reduced
      cognitive load, locale expansion, RTL readiness, and plain language.
- [ ] Threat-model countdown pressure, deadline dark patterns, clock rollback/
      fast-forward, replay, future timestamps, stale tzdata, client/server skew,
      timestamp probing, and schedule amplification.
- [ ] Prohibit zone/locale/routine/travel inference and silent reuse for
      targeting, ranking, pricing, eligibility, moderation, or AI profiling.

## Phase 5 — migrate one low-risk slice

- [ ] Start with notification date filters only after Phases 0–4 pass.
- [ ] Replace the UTC-derived input max and local query bounds with one named
      viewer-local-day primitive while preserving URL compatibility.
- [ ] Add positive/negative-offset, UTC/local-midnight, DST, invalid-input,
      reload, cached-client, and server-query fixtures.
- [ ] Show exact resolved bounds to reviewers and preserve a rollback switch.
- [ ] Do not change notification retention, expiry, stored records, or delivery.

## Phase 6 — evidence, migration, and cleanup

- [ ] Measure semantic coverage, boundary correctness, comprehension,
      accessibility, authority integrity, delivery truth, privacy, runtime cost,
      support burden, and cleanup using synthetic records only.
- [ ] Expand from display-only helpers to calendar surfaces, schedules, and
      finally security authority only through separate approved gates.
- [ ] Migrate source, tests, caches, receipts, exports, docs, monitoring,
      backups, and cleanup as one family; never bulk-rewrite silently.
- [ ] Delete synthetic schedules, receipts, notifications, caches, fixtures,
      exports, and local state and verify no authority remains.

## Acceptance criteria

- Every inventoried field/helper has one explicit temporal semantic, authority
  source, precision, owner, fallback, effect, evidence level, and retention.
- Future civil intent preserves enough zone/calendar/rule information to
  explain and intentionally recalculate it.
- UTC, viewer-local, account-home, and event-origin days are distinct and tested.
- Client clocks can influence presentation but cannot grant access, extend
  security authority, erase expiry, or decide irreversible transitions.
- Gap/fold, leap-day, midnight, tzdata, travel, skew, offline, retry, and
  duplicate-worker fixtures converge deterministically.
- Relative/simple labels offer an accessible exact instant and named zone.
- Nonessential time limits warn and can extend, pause, preserve work, or recover.
- Due, claim, start, completion, display, late, skipped, and unknown remain
  separate evidence; no delivery or punctuality claim exceeds proof.
- Timezone, locale, calendar, and timing data are not reused to infer sensitive
  routines, location, work, religion, health, travel, or vulnerability.
- The first slice changes no production retention or authority and has a tested rollback.

## Hard stops

- Production clock, tzdata, session, token, grant, lease, retention, legal
  deadline, schedule, reminder, or notification mutation.
- Real user timing data, schedules, travel, location, routine, calendars,
  messages, contacts, accounts, providers, or production exports.
- Hidden timezone capture, sensitive inference, profiling, advertising,
  ranking, pricing, eligibility, moderation, AI reuse, or staff/user scoring.
- Dark-pattern countdowns, inaccessible nonessential limits, lost drafts,
  pointer-only exact time, or unqualified WCAG claims.
- Silent DST gap/fold normalization, offset-only future intent, fixed-24-hour
  civil-day assumptions, client-clock authority, or erased late/skipped state.
- Bulk migration, incompatible wire change, public punctuality/expiry/deletion
  claim, or missing owners, fixtures, rollback, cleanup, and stop authority.

## Concrete next action

Convene the named owners for a 60-minute review. Approve or reject: (1) temporal
type vocabulary, (2) current field/helper inventory, (3) authority-clock and
skew map, (4) zone/calendar/day scopes, (5) DST gap/fold and tzdata-change
policy, (6) formatter and exact-disclosure presets, (7) schedule/transition
receipt vocabulary, (8) WCAG time-limit classifications, (9) synthetic fixture
matrix, (10) notification-filter slice, measures, rollback, cleanup, and stop
thresholds. If any authority or owner is missing, keep the work documented and
do not prototype it.
