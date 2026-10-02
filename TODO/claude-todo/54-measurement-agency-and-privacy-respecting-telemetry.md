# 54 — Measurement agency and privacy-respecting telemetry

Status: 🟣 Proposed · owner and qualified review needed

Evidence: [baseline](../../NOTES/measurement-agency-and-privacy-respecting-telemetry-baseline.md)

Plan: [roadmap](../../PLAN/measurement-agency-and-privacy-respecting-telemetry-roadmap.md)

## Goal

Make every Thingtime measurement purpose-specific, minimal, separated,
inspectable, bounded, stoppable, and resistant to hidden secondary use while
preserving a useful baseline without optional analytics.

## Why this belongs in the garden

Thingtime currently mounts Vercel Web Analytics, automatically records public
post views with dwell/ratio/viewport metadata, trains user-owned feed algorithms
from engagement, and stores bounded redacted operational errors for seven days.
The privacy policy acknowledges analytics and providers, and several paths have
good redaction, access, deduplication, rate-limit, and aggregation primitives.

These pieces do not yet form one product contract for signal necessity,
measurement-plane separation, live provider configuration, user choice,
linkable observations, retention, deletion, aggregation thresholds, metric
definitions, secondary-use refusal, or a useful no-optional-measurement baseline.
This TODO creates that decision and rehearsal boundary without enabling new
collection, experiments, provider exports, or production analytics.

## Dependencies and boundaries

- [TODO 20](./20-versioned-experience-history.md) owns participant-visible
  event history and version provenance.
- [TODO 22](./22-trustworthy-adoption-loop.md) owns adoption experiments and
  learning loops; this TODO defines what evidence may enter them.
- [TODO 24](./24-attention-agency-and-calm-use.md) owns calm-use constraints.
- [TODO 26](./26-community-safety-and-accountable-moderation.md) owns safety
  and moderation decisions; measurement is not automatic decision authority.
- [TODO 28](./28-service-continuity-and-recovery.md) owns service reliability
  and incident recovery.
- [TODO 30](./30-resource-conscious-reach.md) owns resource budgets.
- [TODO 33](./33-ai-agency-and-accountable-assistance.md) owns model/tool
  authority and AI training/context choices.
- [TODO 38](./38-search-and-discovery-agency.md) owns ranking and discovery.
- [TODO 45](./45-youth-safety-and-age-appropriate-agency.md) owns child-specific
  safeguards; minors are excluded from the first rehearsal.
- [TODO 46](./46-evidence-agency-and-accountable-product-claims.md) owns public
  privacy, necessity, anonymity, fairness, safety, accuracy, and deletion claims.
- [TODO 49](./49-personalization-agency-and-accountable-memory.md) owns
  inspectable observations, derivatives, forgetting, and reset.
- `FUNDAMENTALS.md` and `DECISIONS.md` remain authoritative. This TODO approves
  no production measurement or provider configuration change.

## Phase 0 — establish the safe current posture

- [ ] Name product, privacy, security, data, safety, accessibility,
      child-safety, infrastructure, support, research, and legal owners plus
      stop authority.
- [ ] Inventory Vercel Analytics, post views, feed engagement, algorithm
      weights, error/console/platform logs, providers, dashboards, exports,
      drains, alerts, models, reports, backups, legal text, and deletion paths.
- [ ] Record exact environments, package/provider versions, fields, routes,
      redactions, processors, retention, consumers, and observed configuration;
      mark assumptions and provider defaults unverified.
- [ ] Freeze new signals, custom events, production experiments, exports,
      drains, dashboards, and public privacy claims until the contract is approved.

## Phase 1 — approve purposes, necessity, and separated planes

- [ ] Define reliability diagnosis, public count integrity, user-owned
      adaptation, optional aggregate product learning, and safety evidence as
      distinct purposes and authority planes.
- [ ] For every current field, document source, subject, resolution,
      linkability, necessity, processor, consumer, effect, retention, deletion,
      and prohibited uses.
- [ ] Replace any catch-all purpose or stream with the minimum purpose-specific
      event envelope and an explicit owner.
- [ ] Decide which processing is essential, optional, or prohibited and prove
      that refusal to optional processing causes no retaliation or unrelated loss.

## Phase 2 — specify choice, retention, cleanup, and metric truth

- [ ] Define in-context plain-language explanations and a machine-readable
      measurement catalog with purpose, fields, processors, retention, effects,
      choices, and contact/remedy.
- [ ] Define account, device, browser, environment, and deployment scopes for
      inspect, pause, reset, delete, and provider opt-out behavior.
- [ ] Specify field-specific raw, derived, aggregate, provider, export, cache,
      log, and backup retention plus one measurement-family cleanup graph.
- [ ] Define aggregation thresholds, anti-differencing, uncertainty, and a
      versioned metric contract with numerator, denominator, exclusions,
      missingness, environment, owner, and expiry.

## Phase 3 — prototype five synthetic measurement planes

- [ ] Use adult internal reviewers, three synthetic accounts, one fictional
      public post, one synthetic feed session, generated routes, a deterministic
      local fake collector, and one exact non-production build.
- [ ] Rehearse a bounded redacted reliability error, seven-day fake expiry,
      search, access, and cleanup without private values.
- [ ] Compare public-count designs using stable, rotating, and aggregate
      identity strategies; record manipulation resistance and privacy cost.
- [ ] Rehearse user-owned algorithm inspect/pause/reset/delete and optional
      product analytics refusal while preserving the useful baseline.
- [ ] Keep the mock safety envelope inert and hand its decision semantics to
      TODO 26; never combine planes for convenience.

## Phase 4 — rehearse failure, manipulation, and secondary-use pressure

- [ ] Exercise replay, bots, spoofing, duplicates, late/out-of-order events,
      offline/page-hide delivery, missing fields, clock skew, account switch,
      provider outage, and deletion during aggregation.
- [ ] Exercise small cohorts, differencing, dashboard/export leakage, stale
      provider settings, a route containing a synthetic identifier, and an
      attempted cross-environment join.
- [ ] Propose reusing the synthetic data for ranking, pricing, eligibility,
      moderation, AI, or staff/user scoring and prove it fails closed pending a
      separately approved contract.
- [ ] Prove measurement failure cannot break the feature, retry-loop, create a
      negative user signal, expose content, or silently broaden authority.

## Phase 5 — accessibility, evidence, and cleanup

- [ ] Test keyboard, touch, screen reader, 200% zoom, narrow screens, plain
      language, localization, low bandwidth, private browsing, blocked scripts,
      and no-JavaScript baseline.
- [ ] Measure purpose and choice comprehension, data footprint, refusal parity,
      retention convergence, secondary-use containment, metric reproducibility,
      manipulation resistance, and support burden using synthetic records only.
- [ ] Route every privacy, anonymity, necessity, fairness, accuracy, safety,
      retention, and deletion statement through TODO 46 with exact evidence.
- [ ] Delete all synthetic events, viewer keys, weights, logs, aggregates,
      provider copies, dashboards, exports, caches, and local fixtures; verify
      no active measurement authority remains.

## Acceptance criteria

- Every current and proposed signal has one approved primary purpose, necessity
  test, owner, plane, processor map, allowed consumers, retention, deletion,
  prohibited uses, and stop condition.
- Operational diagnostics, public counters, user-owned adaptation, optional
  product learning, and safety evidence have separate stores and authority.
- Optional-measurement refusal preserves core function, price, support, safety,
  accessibility, account standing, and remedy without dark patterns.
- Linkable observations and derived effects are inspectable, pausable,
  resettable, or deletable where appropriate, with honest residual-state text.
- Public counts resist ordinary manipulation without exposing viewer lists or
  retaining more identity, dwell, position, or history than necessary.
- Raw input expires first; aggregate, provider, export, log, and backup copies
  converge on the approved family-retention and cleanup contract.
- Every metric is reproducible from a versioned definition and reports
  exclusions, missingness, uncertainty, environment, and expiry.
- No current observation silently enters ranking, targeting, pricing,
  eligibility, moderation, AI training/context, research, advertising, or
  staff/user scoring.
- The rehearsal uses no real person, behavior, provider, production data,
  private content, identifier, location, vulnerable group, or public claim.

## Hard stops

- Real browsing, behavior, accounts, posts, identifiers, IP addresses,
  contacts, messages, queries, private content, precise location, or devices.
- Production analytics, provider settings, dashboards, exports, drains,
  experiments, advertising, targeting, or cross-context tracking.
- Device fingerprinting, vulnerable-trait inference, covert monitoring, small
  identifiable cohorts, minors, or high-risk safety/health/legal contexts.
- Silent ranking, pricing, eligibility, moderation, AI, research, staff/user
  scoring, or other secondary use.
- Unbounded raw events, stable identifiers without necessity, failed expiry or
  deletion, hidden provider copies, inaccessible controls, or retaliation.
- Privacy-preserving, anonymous, necessary, accurate, representative, fair,
  safe, or deleted claims without exact-version proof.
- Missing qualified owners, useful-baseline proof, cleanup verification, or
  manual stop authority.

## Concrete next action

Convene the named owners for a 60-minute decision review of the baseline and
roadmap. Approve or reject: (1) purpose and measurement-plane taxonomy,
(2) current signal/provider inventory, (3) field necessity and prohibited-use
matrix, (4) essential/optional boundary and useful baseline, (5) inspect/pause/
reset/delete scopes, (6) retention and family cleanup, (7) aggregation and
small-cohort rules, (8) versioned metric schema, (9) manipulation and
secondary-use threat model, and (10) accessible synthetic rehearsal, measures,
cleanup, and stop thresholds. If any owner or boundary is missing, keep the
proposal documented and do not prototype it.
