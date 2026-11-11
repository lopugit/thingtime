# 49 — Personalization agency and accountable memory

Status: 🟣 Proposed · owner and qualified review needed

Evidence: [baseline](../../NOTES/personalization-agency-and-accountable-memory-baseline.md)

Plan: [roadmap](../../PLAN/personalization-agency-and-accountable-memory-roadmap.md)

## Goal

Make every retained choice, observation, or derivative that can alter a
person's future Thingtime experience inspectable, explainable, correctable,
excludable, expirable, forgettable, and resettable, with a useful
non-personalized baseline.

## Why this belongs in the garden

Thingtime already has explicit settings, device-local caches, account-backed
saved AI configurations, and private feed-interest algorithms. Those pieces do
not yet provide one contract for what is remembered, why, where, for how long,
with which effects, or how a person's correction or forgetting request reaches
derivatives and caches. Local convenience must not quietly become an opaque
profile.

## Dependencies and boundaries

- [TODO 20](./20-versioned-experience-history.md) owns historical state; this
  item owns retained inputs that affect the future.
- [TODO 23](./23-data-portability-and-exit.md) owns export, restore, deletion,
  and exit mechanics.
- [TODO 24](./24-attention-agency-and-calm-use.md) and
  [TODO 38](./38-search-and-discovery-agency.md) own feed and search behavior.
- [TODO 25](./25-accessibility-and-language-readiness.md) owns accessibility and
  language; explicit access settings are not permission to infer sensitive
  traits.
- [TODO 29](./29-content-provenance-and-correction-integrity.md) owns provenance
  for content; this item owns provenance for personal memory items and
  derivatives.
- [TODO 33](./33-ai-agency-and-accountable-assistance.md) owns AI context and
  tool authority; conversation history is not durable-memory consent.
- [TODO 35](./35-identity-agency-and-context-safe-presence.md) owns identity and
  presence; a profile does not establish identity or authority.
- [TODO 44](./44-local-first-agency-and-accountable-synchronization.md) owns
  synchronization and conflict behavior.
- [TODO 45](./45-youth-safety-and-age-appropriate-agency.md) qualifies all youth
  scope.
- [TODO 46](./46-evidence-agency-and-accountable-product-claims.md) owns claims
  made about the resulting behavior.
- [TODO 47](./47-support-agency-and-accountable-remedy.md) owns shared support
  coordination, not domain decisions.
- [TODO 48](./48-change-agency-and-humane-product-evolution.md) owns rollout,
  migration, rollback, and retirement of memory-policy changes.

## Phase 0 — owner approval and evidence refresh

- [ ] Name accountable product, privacy, accessibility, safety, security, data,
      and affected domain owners.
- [ ] Refresh the repository evidence and list every pilot store and effect.
- [ ] Approve definitions for choice, observation, derivative, effect,
      correction, exclusion, expiry, forgetting, reset, and baseline.
- [ ] Approve the four synthetic items, measures, exclusions, cleanup, and stop
      authority.
- [ ] Freeze new collection and inference in this pilot.

## Phase 1 — versioned memory contract

- [ ] Define the minimum record: owner, identifier, kind, source, purpose,
      prohibited purpose, scope, stores, sync state, age, expiry, policy,
      inputs, derivatives, effects, controls, exceptions, and cleanup state.
- [ ] Define correction so future behavior changes without falsifying history.
- [ ] Define purpose-specific exclusion separately from deletion.
- [ ] Define forgetting and derivative/cache propagation.
- [ ] Define exact domain-reset and global-reset scopes.
- [ ] Define a useful non-personalized baseline.
- [ ] Define import quarantine and account/device-origin separation.

## Phase 2 — bounded inspect-and-explain pilot

- [ ] Use one approved adult synthetic account, one synthetic private text
      Thing, one exact non-production build, and deterministic fixtures only.
- [ ] Create exactly one explicit non-sensitive display preference, one
      device-local last-view value, one synthetic observation, and one manually
      seeded low-stakes derivative.
- [ ] Show source, purpose, scope, store, age, expiry, policy, effect, kind, and
      available controls for every item.
- [ ] Explain the derivative from fixed inputs without a model/provider call.
- [ ] Keep the inventory private to the authorized synthetic subject.

## Phase 3 — controls, receipts, and failure proof

- [ ] Exercise inspect, explain, edit, exclude, expire, forget, domain reset,
      and global personalization reset.
- [ ] Preview exact reset scope and distinguish it from content deletion.
- [ ] Emit bounded private receipts for accepted scope, affected items,
      derivative/cache cleanup, exceptions, completion, and remedy.
- [ ] Test offline, stale, interrupted, duplicate, partial-failure,
      account-switch, and device-origin-change states.
- [ ] Prove a forgotten or reset input cannot silently reactivate through a
      derivative, cache, import, background task, or old client.

## Phase 4 — evaluate and clean up

- [ ] Compare the active, excluded, forgotten, domain-reset, and global-reset
      states without engagement optimization or new behavioral collection.
- [ ] Verify keyboard, screen-reader, zoom, reduced-motion, narrow viewport,
      plain-language, and non-personalized journeys.
- [ ] Have reviewers predict each control's effect before observing it.
- [ ] Record positive, negative, contradictory, and incomplete results.
- [ ] Delete all synthetic accounts, Things, memories, derivatives, caches,
      exports, receipts, and fixtures; prove cleanup.

## Acceptance criteria

- [ ] Every pilot item exposes its kind, source, purpose, scope, store, age,
      expiry, policy, effects, and controls.
- [ ] Every derivative identifies its declared inputs and downstream effects.
- [ ] Choice, observation, derivative, and historical event remain distinct.
- [ ] Correction changes future behavior without rewriting event history.
- [ ] Exclusion stops only the named use; unrelated approved uses are explicit.
- [ ] Completed forgetting and reset leave zero declared active derivatives or
      bounded cache copies.
- [ ] No item, explanation, receipt, or cache crosses an account or audience.
- [ ] The interface never claims completion during a partial cleanup failure.
- [ ] A useful and accessible non-personalized baseline remains available.
- [ ] Import does not activate foreign preferences without current review.
- [ ] Evaluation uses no real personal data or production telemetry.
- [ ] Cleanup is verified and no production behavior changes through this TODO.

## Hard stops

Stop for missing owner, source, purpose, store, or effect; hidden collection;
choice/observation/derivative collapse; crossed account or audience boundaries;
sensitive-trait inference; unbounded retention; unknown derivative propagation;
inaccessible controls; unusable non-personalized mode; false completion; or
cleanup that cannot be proven.

Also stop before real personal data, production telemetry, public feeds,
advertising, provider/model calls, training, minors, institutions, or health,
safety, employment, education, housing, credit, legal, identity, or other
high-impact use. Any expansion requires a separate owner-approved decision.

## Non-goals

This TODO does not authorize a universal profile, recommendation system,
tracking SDK, analytics pipeline, ad targeting, sensitive-trait inference,
cross-account graph, autonomous assistant memory, production experiment,
compliance claim, or migration of existing state.

## Next action

Present the baseline, four-item fixture, memory-record schema, control/effect
matrix, derivative cleanup diagram, non-personalized baseline, accessibility
matrix, failure cases, measures, exclusions, and cleanup plan to the named
owners. Do not implement until they approve the vocabulary and pilot boundary.
