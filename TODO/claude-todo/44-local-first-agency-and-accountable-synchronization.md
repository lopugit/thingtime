# 44 — Local-first agency and accountable synchronization

**Status:** 🟣 Proposed · owner and qualified review needed

**Evidence:** [Local-first agency and accountable-synchronization baseline](../../NOTES/local-first-agency-and-accountable-synchronization-baseline.md)

**Plan:** [Local-first agency and accountable-synchronization roadmap](../../PLAN/local-first-agency-and-accountable-synchronization-roadmap.md)

## Goal

Turn Thingtime's optimistic local-state foundations into one honest contract: a
person can preserve a bounded private draft offline, distinguish it from
canonical truth, reconnect through fresh authority, resolve a version conflict
without losing either intention, and remove every local artifact.

The first candidate uses one synthetic private text Thing, one browser profile,
two same-origin tabs, and deterministic network fixtures. This TODO does not
authorize engineering, production, a general offline queue, or a user-facing
local-first claim.

## Dependencies and boundaries

- [ ] Preserve [`FUNDAMENTALS.md`](../../FUNDAMENTALS.md): authenticated API,
      protected writers, versioned collections, ACLs, quota, and authoritative
      reread remain canonical.
- [ ] [TODO 7](./07-cross-tab-thingtime-sync.md) owns same-origin propagation
      and current tab-local/same-path limits.
- [ ] [TODO 20](./20-versioned-experience-history.md) owns historical snapshots;
      a draft is not history.
- [ ] [TODO 23](./23-data-portability-and-exit.md) owns full export, import,
      deletion, closure, and exit.
- [ ] [TODO 25](./25-accessibility-and-language-readiness.md) owns shared status,
      comparison, input, error, locale, and complete-journey access patterns.
- [ ] [TODO 28](./28-service-continuity-and-recovery.md) owns outages, recovery,
      incidents, and service-wide degradation.
- [ ] [TODO 30](./30-resource-conscious-reach.md) owns profiles, budgets, data
      saver, and offline expansion.
- [ ] [TODO 34](./34-collaboration-agency-and-shared-stewardship.md) owns shared
      proposals; this pilot is single-owner and synthetic.
- [ ] Record approved persistence, schema, capability, retention, deletion, or
      compatibility forks in `DECISIONS.md`.

## Phase 0 — Approve the contract

- [ ] Approve canonical, projection, draft, intent, pending, committed,
      conflicted, reconciled, device-scope, and receipt vocabulary.
- [ ] Decide whether “local-first” stays internal or becomes a narrow promise.
- [ ] Select one private synthetic field and maximum bytes/items/age.
- [ ] Approve browser, network, quota, corruption, restart, and durability cases.
- [ ] Approve scope, expected-version, reauthentication, conflict, retry,
      retention, export, purge, evidence, and stop rules.
- [ ] Name accountable product, API/data, storage, privacy/security,
      accessibility/language, reliability, support, and incident owners.

No unchecked item above is permission to engineer or recruit participants.

## Phase 1 — Inventory and classify

- [ ] Inventory every local store and `tt-*` key touched by the pilot.
- [ ] Classify projection, preference, draft, pending intent, durable copy,
      receipt, and legacy/unknown state.
- [ ] Record envelope version, scope, readers/writers, bounds, migration,
      eviction, and purge triggers.
- [ ] Identify cache-silent failures that are unsafe for promised drafts.
- [ ] Fail checks on undeclared or unbounded pilot storage.

## Phase 2 — Preserve one truthful draft

- [ ] Define an inert versioned envelope with scope, target, expected version,
      stable intent, timestamps, size, and state.
- [ ] Store transactionally within approved bounds and retain the last known-good
      draft across crash or interruption.
- [ ] Label local-only, durability-unavailable, corrupt, expired, and discarded
      without claiming server save or device sync.
- [ ] Handle storage denial, quota, eviction simulation, migration, and corrupt
      envelopes without executing stored code or crossing scope.
- [ ] Provide accessible inspect, copy/export, and discard actions.

## Phase 3 — Synchronize through fresh authority

- [ ] Negotiate the selected origin's semantic capability.
- [ ] Recheck account, origin, namespace, ACL, deletion, closure, quota,
      capability, schema, target, and expected version on reconnect.
- [ ] Submit one stable intent through the normal API writer and distinguish not
      sent, sending, accepted, reread-confirmed, rejected, conflicted,
      cancelled, expired, and unknown.
- [ ] Retry only unambiguously safe failures inside approved bounds.
- [ ] Call committed only after a fresh authoritative reread matches.
- [ ] Purge only after confirmed commit or deliberate discard.

## Phase 4 — Preserve both intentions

- [ ] Change the canonical version in a second tab before reconnect.
- [ ] Show authorized server value and local draft with exact versions and safe
      text difference.
- [ ] Offer **keep server**, **replace with my draft**, and **edit a new draft**
      as separate fresh actions; never silently pick or merge.
- [ ] Exercise same-path races, duplicate/reordered messages, lost responses,
      reload/restart, expiry, revoke/delete, and scope switches.
- [ ] Show scope, last confirmed sync, pending/conflict count, footprint, and
      purge state without a device fingerprint.

## Phase 5 — Prove and clean the pilot

- [ ] Run with one approved adult test account, one synthetic private text
      Thing, one browser profile, two tabs, and no real content.
- [ ] Verify each commit through the real API and authoritative reread.
- [ ] Validate keyboard, screen reader, zoom, reduced motion, narrow/desktop,
      locale, offline, stale, error, compare, and cleanup states.
- [ ] Exercise all conflict choices plus quota, corruption, ambiguity, logout,
      revoke/delete, and scope-switch failures.
- [ ] Delete the Thing, drafts, intents, projections, receipts, and fixtures;
      prove no cross-account key, orphan, or restored ghost remains.

## Acceptance criteria

- [ ] People can distinguish projection, draft, pending, API acceptance,
      authoritative confirmation, conflict, and device convergence.
- [ ] Offline reload preserves the known-good draft without false status.
- [ ] Every authority and scope boundary is rechecked on reconnect.
- [ ] Same-path races and conflicts preserve both intentions and apply neither
      silently.
- [ ] Duplicate, reordered, stale, lost-response, restart, and retry cases
      create no duplicate or resurrected effect.
- [ ] Storage failure, quota, corruption, migration, expiry, and eviction are
      truthful and preserve or explain the last known-good state.
- [ ] Every state and resolution works accessibly at desktop and narrow widths.
- [ ] Storage stays bounded and cleanup is complete.
- [ ] API, docs, capability, tests, browser state, and authoritative reread agree
      at the exact release.

## Stop conditions

Stop for silent draft loss; false saved/committed/synced state; cross-scope
disclosure; stale-authority replay; duplicate/resurrected effects; silent
conflict resolution; unbounded state; inaccessible recovery; incomplete purge;
or a claim broader than evidence.

## Explicit non-goals

- No service worker, background sync, general offline queue, CRDT, automatic
  merge, collaborative editor, or multi-device protocol.
- No attachments, sharing, public/third-party state, money, safety actions, AI,
  real personal data, minors, institutions, or sensitive/high-impact work.
- No device fingerprint, cross-account device graph, content telemetry, draft
  analytics, productivity score, streak, engagement, or retention objective.
- No assumption that connectivity, local write, request/response, channel
  message, timestamp, or green test proves canonical durability.

## First decision packet

Approve or revise vocabulary and claim boundary; pilot field and bounds;
envelope scope/durability/migration/purge; conflict, reauthentication, and retry
rules; accessible inspection and cleanup; owners, evidence, thresholds, and stop
authority.
