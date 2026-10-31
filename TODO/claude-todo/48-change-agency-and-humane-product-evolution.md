# 48 — Change agency and humane product evolution

**Status:** 🟣 Proposed · owner and qualified review needed

**Priority:** P1 trust/adoption infrastructure

**Proposed:** 2026-09-15 evening, Australia/Melbourne

**Owner:** Unassigned; product owner must name product-contract, research,
accessibility/language, privacy/security, data/API, client, reliability,
rollout, support, evidence, communications, and manual-stop owners

**Evidence:** [Change agency and humane product evolution baseline](../../NOTES/change-agency-and-humane-product-evolution-baseline.md)

**Roadmap:** [Change agency and humane product evolution roadmap](../../PLAN/change-agency-and-humane-product-evolution-roadmap.md)

## Goal

Make material Thingtime changes understandable, previewable, compatible,
accessible, and recoverable so people can keep completing established tasks,
preserve deliberate choices and data, adopt or defer where genuinely possible,
and reach the correct remedy or exit when a change fails them.

## Problem

Thingtime has internal changelogs, exact-commit previews, origin-scoped API
capability versions, P0 storage migration rules, notification plans, support
plans, and future historical-state restoration. No shared contract yet governs
person-facing changes to navigation, terminology, defaults, behavior, policy,
availability, or meaning.

Without that contract, an implementation can be well documented and technically
compatible while people still meet a surprise, lose a learned path, have a
deliberate setting reset, receive false choice, or discover too late that an old
client or integration is being retired. This epic owns that human transition
layer without freezing responsible improvement.

## Dependencies and ownership boundaries

- [`FUNDAMENTALS.md`](../../FUNDAMENTALS.md) and
  [`DECISIONS.md`](../../DECISIONS.md) remain authoritative. Data access is
  API-only; accumulating events are relational and bounded.
- [TODO 20](./20-versioned-experience-history.md) owns durable historical view
  checkpoints. History may help recovery but is not a change notice, supported
  compatibility path, or rollback authority.
- [TODO 22](./22-trustworthy-adoption-loop.md) owns value and adoption outcomes.
  Adoption of a change is not proof of benefit, consent to future changes, or
  trustworthy growth.
- [TODO 23](./23-data-portability-and-exit.md) owns full export, restore,
  deletion, closure, and exit. This epic must keep those paths reachable.
- [TODO 24](./24-migration-safe-continuous-availability.md) owns the P0
  expand/coexist/migrate/verify/contract storage invariant. No notice or flag
  may excuse a broken established read or write.
- [TODO 25](./25-accessibility-and-language-readiness.md) owns the complete-
  journey accessibility and language release matrix.
- [TODO 27](./27-trusted-developer-ecosystem.md) owns third-party app release,
  permission diff, re-consent, quarantine, transfer, and retirement.
- [TODO 28](./28-service-continuity-and-recovery.md) owns incidents, degraded
  service, recovery, rollback operations, and availability communication.
- [TODO 37](./37-notification-agency-and-accountable-delivery.md) owns event,
  delivery, display, read, expiry, and notification-remedy truth.
- [TODO 44](./44-local-first-agency-and-accountable-synchronization.md) owns
  local drafts, canonical confirmation, conflict choices, and cleanup.
- [TODO 46](./46-evidence-agency-and-accountable-product-claims.md) owns what
  Thingtime may claim about a change and its evidence.
- [TODO 47](./47-support-agency-and-accountable-remedy.md) owns shared help and
  accountable routing; each qualified domain retains remedy authority.
- [TODO 49](./49-personalization-agency-and-accountable-memory.md) owns what is
  remembered about a person and the effect of that memory. This epic owns how
  a changed memory policy preserves choices, migrates, rolls back, or retires.
- W3C, GOV.UK, and IETF references are design inputs, not adopted compliance,
  legal duties, service promises, or proof that a change is safe.

## Phase 0 — Approve ownership and the first change class

- [ ] Name accountable owners and backups for every role listed above.
- [ ] Approve vocabulary for proposal, affected contract, impact, preview,
      choice, compatibility, adoption, deferral, rollback, deprecation, sunset,
      retirement, remedy, and exit.
- [ ] Classify change families by meaning, reach, reversibility, established
      task, prior choice, authority, data, accessibility, urgency, and harm.
- [ ] Approve the first pilot: rename and relocate one non-sensitive display
      preference while preserving its stored value and effect.
- [ ] Define which changes require release notes, notice, preview, choice,
      re-consent, compatibility, qualified review, or prohibition.
- [ ] Define emergency/security/legal exceptions without pretending mandatory
      changes are optional or exempting them from accessibility and remedy.

**Gate:** no implementation, real participant, production flag, telemetry,
notice, deprecation, or sunset.

## Phase 1 — Specify a versioned change packet

- [ ] Define old/new/preserved behavior, affected people/tasks/data/clients,
      risks, unknowns, owner, evidence, choices, compatibility, support,
      rollout, rollback, retirement, and refresh triggers.
- [ ] Bind each packet to exact source, build, origin, feature/data/client
      versions, policy/copy, dependencies, reviewers, and approval state.
- [ ] Define authorized state transitions from proposal through archive,
      including pause, rollback, correction, deprecation, and sunset.
- [ ] Specify field-level public, affected-person, reviewer, operator, support,
      and audit projections without leaking private or security-sensitive detail.
- [ ] Keep decisions and events content-minimal, bounded, relational, versioned,
      idempotent, and protected if implementation is later approved.
- [ ] Threat-model forged/stale/crossed packets, flag tampering, hidden widening,
      downgrade abuse, rollback replay, cache drift, and insider manipulation.

**Gate:** unknown scope, authority, consequence, compatibility, data effect,
evidence, or stop rule fails closed.

## Phase 2 — Build truthful preview, notice, and choice

- [ ] Show what changes and stays the same, why, when, affected tasks and data,
      required action, compatibility window, unknowns, support, and exit.
- [ ] Compare complete old/new task states at the exact build, including empty,
      error, stale, offline, narrow, and assistive states.
- [ ] Offer adopt, keep-current, schedule, defer, or leave only when the selected
      choice has real, tested semantics and visible limits.
- [ ] Preserve prior settings and cached state while rechecking fresh authority
      before adoption, migration, rollback, or destruction.
- [ ] Avoid dark patterns: no preselected adoption, degraded old path, urgency,
      repeated interruption, dismissal friction, guilt, scarcity, or hidden
      consequence.
- [ ] Prove keyboard, screen reader, touch, 200% zoom, reduced motion, narrow
      viewport, approved language, low-bandwidth, interruption, and recovery.

**Gate:** no surprise context change, inaccessible meaning, false choice,
notice-only consent, or silent override of a deliberate preference.

## Phase 3 — Prove coexistence and transition

- [ ] Define supported old/new clients, paths, adapters, redirects, data
      versions, source of truth, capability requirements, and end conditions.
- [ ] Recheck account, origin, ACL, permissions, schema, data version, client,
      dependency, and selected choice at state-changing boundaries.
- [ ] Keep established tasks and prior settings working throughout declared
      support; do not worsen an old path to force adoption.
- [ ] Distinguish offered, previewed, selected, submitted, accepted,
      authoritative-confirmed, failed, ambiguous, rolled back, and cleaned.
- [ ] Exercise stale/offline clients, direct/old links, custom origins, duplicate
      and reordered actions, interrupted migration, lost responses, account
      switch, expiry, and dependency failure.
- [ ] Update API routes, docs, capability versions, client requirement maps,
      compatibility tests, and smoke coverage together for any API change.

**Gate:** both paths satisfy approved privacy, security, accessibility,
authority, data, and task-continuity boundaries.

## Phase 4 — Make rollback and retirement accountable

- [ ] Define rollback across code, data, queued work, caches, clients,
      permissions, notifications, integrations, and external effects.
- [ ] Prove rollback never reverses user data, resurrects revoked authority,
      replays an effect, or erases accountable history.
- [ ] Announce deprecation while the path still works, with policy, replacement,
      migration guide, support, evidence, review date, and compatible window.
- [ ] Approve sunset separately with measured need/dependency evidence,
      meaningful lead time, accessible reminders, exit/export, redirects or
      durable read-only access, and exception/remedy rules.
- [ ] Preserve only the content-minimal records needed to explain old behavior;
      retire private data, access, flags, caches, and instrumentation on time.
- [ ] Route harms to the proper data, accessibility, incident, security/privacy,
      support, portability, claim-correction, or other qualified owner.

**Gate:** no stranded need, data, task, assistive path, valid grant, client,
origin, integration, or record.

## Phase 5 — Run the bounded private pilot

- [ ] Use adult internal reviewers, one synthetic account, one non-sensitive
      display preference, and one exact non-production build.
- [ ] Preserve the preference value and effect across its rename/relocation;
      present an accessible packet, impact map, and old/new comparison.
- [ ] Exercise approved adopt/keep/defer choices, old/stale links and clients,
      offline return, account switch, duplicate action, interruption,
      incompatible version, rollback, re-entry, and sunset simulation.
- [ ] Validate desktop/narrow, keyboard, screen reader, zoom, reduced motion,
      language, low-bandwidth, error, support, export, and exit states.
- [ ] Delete every fixture, packet, flag, choice, notice, cache, receipt,
      redirect, and generated artifact; retain only approved minimal evidence.
- [ ] Repeat the complete journey twice against the exact build.

**Gate:** zero surprise, lost choice, task break, data drift, widened authority,
inaccessible state, false status, orphan, rollback residue, or cleanup failure.

## Acceptance criteria

- [ ] Every material change names its affected contract, exact version/origin,
      owner, evidence, unknowns, choices, compatibility, rollout, rollback,
      retirement, support, remedy, and stop conditions.
- [ ] Affected people can discover and understand the change before effect when
      notice is appropriate; critical meaning is accessible and language-ready.
- [ ] Choices are real, scoped, reversible where claimed, and never inferred
      from dismissal, inactivity, continued use, or an unrelated action.
- [ ] Prior deliberate settings, data, permissions, and established tasks remain
      intact except through an approved, explicit, freshly authorized contract.
- [ ] Old/new paths and stale clients preserve declared semantics throughout the
      compatibility window and fail honestly outside it.
- [ ] Rollback is tested across all affected state and leaves no resurrected,
      duplicated, orphaned, replayed, or falsely successful effect.
- [ ] Deprecation precedes sunset; sunset has evidence, lead time, accessible
      reminders, preserved need or exit, and an accountable remedy path.
- [ ] API changes remain manifest-covered and compatible under the repository's
      semantic capability requirements.
- [ ] Measures prove task continuity, comprehension, compatibility, remedy, and
      cleanup without content telemetry, profiling, or adoption coercion.
- [ ] The pilot cleans every synthetic and local artifact and authorizes no
      production, real-person, or higher-risk expansion.

## Hard stop conditions

Stop for missing owner or affected contract; hidden or retroactive change;
false urgency or optionality; inaccessible material meaning; silent default,
permission, policy, or data change; established capability loss; forced adoption
through degradation; indefinite flag split; stale/crossed choice; incompatible
or unbounded migration; unknown rollback; resurrected authority/data/effect;
premature sunset; stranded need; private evidence leakage; coercive metrics;
missing support/remedy/exit; or claims stronger than exact evidence.

## Non-goals

- No production rollout, real user research, public telemetry, personalized
  experiments, feature-flag platform, public change centre, or release process.
- No policy/terms, permission, data-model, external API, security, legal,
  accessibility, youth, money, safety, health, identity, institutional, or
  high-impact change.
- No promise that every change is optional, every old interface is permanent,
  one notice is consent, or rollback can reverse data and external effects.
- No adoption funnel, dismissal reduction, engagement target, productivity
  score, sentiment/vulnerability inference, or support-deflection objective.

## Concrete next action

Product, research, accessibility/language, privacy/security, data/API, client,
reliability, support, evidence, communications, and qualified domain owners
review one decision packet containing:

1. the change taxonomy, accountable owners, and manual-stop authority;
2. the affected-contract, impact-map, and versioned packet vocabulary;
3. the synthetic preference rename/relocation and prohibited broader meanings;
4. preview, notice, choice, prior-setting, accessibility, and language rules;
5. compatibility, stale-client, rollout, rollback, deprecation, sunset, and
   exit contracts;
6. evidence, measures, retention, cleanup, remedies, and hard-zero failures; and
7. explicit approval, revision, or rejection of the private pilot.
