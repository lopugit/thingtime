# 46 — Evidence agency and accountable product claims

**Status:** 🟣 Proposed · owner and qualified review needed

**Priority:** P1 trust/adoption infrastructure

**Proposed:** 2026-09-14, Australia/Melbourne

**Owner:** Unassigned; product owner must name claim, evidence, review, correction, incident, and stop owners

**Evidence:** [Evidence agency and accountable product claims baseline](../../NOTES/evidence-agency-and-accountable-product-claims-baseline.md)

**Roadmap:** [Evidence agency and accountable product claims roadmap](../../PLAN/evidence-agency-and-accountable-product-claims-roadmap.md)

## Goal

Make every Thingtime product claim proportional to current evidence and easy to
understand, inspect, challenge, correct, and withdraw without exposing private
or security-sensitive material.

## Problem

Thingtime records careful evidence in planning documents, semantic API support
in capability manifests, and exact-commit delivery receipts. Those artifacts
answer different questions. They do not yet govern the overall impression made
by product copy, visuals, status, Lopu, support, releases, stores, documentation,
or third-party descriptions.

Without a shared contract, a green test can become “reliable,” a capability
version can become “available,” encryption of one field can become “private,” a
successful tool call can become “correct,” or one constrained-device sample can
become “sustainable.” Later fixes can leave stale copies and generated answers
behind. This epic creates a bounded responsibility and correction path before
Thingtime makes stronger trust claims.

## Dependencies and ownership boundaries

- [`FUNDAMENTALS.md`](../../FUNDAMENTALS.md) and
  [`DECISIONS.md`](../../DECISIONS.md) remain authoritative. Any accumulating
  claim history is relational, bounded, privacy-safe, and reached through the
  API and versioned collection helpers.
- [TODO 22](./22-trustworthy-adoption-loop.md) owns adoption sequencing and
  outcome measures. It may not treat a claim, evidence view, badge, or trust
  survey as proof of usefulness.
- [TODO 23](./23-data-portability-and-exit.md) owns the export, restore,
  deletion, and closure contract used by the first candidate claim.
- [TODO 25](./25-accessibility-and-language-readiness.md) owns complete-journey
  accessibility and locale quality. This epic owns whether Thingtime may claim
  those qualities and how limits remain visible.
- [TODO 26](./26-community-safety-and-accountable-moderation.md) owns reports,
  cases, appeals, and safety remedies for user/community conduct. Product-claim
  challenges must not become a parallel moderation system.
- [TODO 28](./28-service-continuity-and-recovery.md) owns journey objectives,
  incidents, recovery, and availability evidence. A health or deployment signal
  cannot silently widen into a reliability claim.
- [TODO 47](./47-support-agency-and-accountable-remedy.md) owns shared help
  discovery, consentful intake, acknowledgement, handoff, and case-status
  truth. This epic retains authority for product-claim challenges, evidence,
  corrections, withdrawals, and claim-specific remedies.
- [TODO 48](./48-change-agency-and-humane-product-evolution.md) owns what a
  product change affects, how it is previewed, and its compatibility, rollback,
  deprecation, and sunset journey. This epic retains authority for every claim
  Thingtime makes about that change and the correction of stale copies.
- [TODO 29](./29-content-provenance-and-correction-integrity.md) owns authorship,
  source, derivation, verification limits, and corrections for content
  artifacts. This epic owns Thingtime's own statements about the product.
- [TODO 30](./30-resource-conscious-reach.md), [TODO 32](./32-learning-agency-and-knowledge-stewardship.md), [TODO 33](./33-ai-agency-and-accountable-assistance.md), [TODO 35](./35-identity-agency-and-context-safe-presence.md), and [TODO 45](./45-youth-safety-and-age-appropriate-agency.md) remain the domain authorities for environmental, learning, AI, identity, and youth claims.
- API work must update route implementation, canonical docs registry, semantic
  capability version, client requirement map, and compatibility coverage
  together. A capability feature remains compatibility evidence only.
- ACCC, DTA, CMA, and NIST references are design inputs, not adopted
  certification, compliance, or legal conclusions.

## Phase 0 — Owner decision packet

- [ ] Approve the first surface inventory and canonical copy source.
- [ ] Approve definitions for product claim, instance, family, evidence object,
      profile, assurance case, contradiction, expiry, correction, withdrawal,
      and remedy.
- [ ] Approve risk tiers based on reliance, reach, reversibility, vulnerability,
      and consequence of error.
- [ ] Choose the first claim. Recommended: preservation of specified fields for
      one synthetic private text Thing across one exact export/restore build.
- [ ] Approve exact conditions, evidence method, negative cases, visible
      limitations, confidence language, expiry, and change triggers.
- [ ] Name product, evidence, domain-review, privacy/security, accessibility,
      correction, support, incident, retention, and manual-stop owners.
- [ ] Ban generic trust badges and unqualified safety, security, privacy,
      accessibility, sustainability, accuracy, reliability, learning, identity,
      youth, AI, and outcome claims.

**Gate:** no implementation, public copy, telemetry, or participant work.

## Phase 1 — Inventory and model the claim family

- [ ] Inventory the exact claim and its copies across docs, UI, visuals, Lopu,
      support, API descriptions, status, release notes, stores, caches,
      translations, and approved third-party channels.
- [ ] Record intended meaning, audience, owner, scope, exclusions, conditions,
      evidence, method, version, origin, confidence, reviewer, contradictions,
      publication, expiry, correction state, and retention.
- [ ] Separate intent, implemented code, configured deployment, observed
      operation, end-to-end outcome, and ongoing assurance.
- [ ] Specify draft, review, approve, publish, stale, contradict, narrow,
      correct, withdraw, and archive transitions with authorization and CAS.
- [ ] Define content-minimal relational history and bounded family membership;
      never embed an unbounded event or copy array.
- [ ] Threat-model unauthorized publication, evidence substitution, stale
      approval, copy injection, reviewer impersonation, sensitive evidence
      access, and correction suppression.

**Gate:** one reviewed profile accounts for every synthetic instance and no
unknown copy can be represented as controlled.

## Phase 2 — Bind evidence and freshness

- [ ] Capture evidence before publication against the exact version, origin,
      configuration, fixture, method, expected result, observed result, time,
      and limitations.
- [ ] Preserve failed, ambiguous, unavailable, and contradictory cases with the
      same integrity as supporting cases.
- [ ] Fail closed when evidence, review, scope, version, freshness, or authority
      is missing or mismatched.
- [ ] Invalidate on approved code, dependency, data, model, configuration,
      environment, policy, copy, visual, locale, incident, evidence, or owner
      changes.
- [ ] Redact or access-control private and security-sensitive evidence; expose a
      bounded explanation of the limitation without implying a pass.
- [ ] Add deterministic tests for replay, substitution, clock skew, stale cache,
      conflicting evidence, reviewer removal, dependency failure, and cleanup.

**Gate:** a pre-publication check cannot be bypassed by an old receipt, copied
profile, unavailable evidence, or later positive result.

## Phase 3 — Present, challenge, correct, and withdraw

- [ ] Render exact claim text, proximate material qualifications, last reviewed
      state, and a plain evidence-summary route.
- [ ] Do not block the underlying task, force trust, or use evidence viewing as
      a consent or engagement event.
- [ ] Support keyboard, screen reader, zoom, touch, reduced motion, narrow
      viewport, plain language, and target-locale parity.
- [ ] Provide a bounded challenge/remedy route with status and accountable owner
      while protecting reporters and sensitive evidence.
- [ ] Propagate narrow/correct/withdraw operations to every controlled family
      member and show unresolved external copies honestly.
- [ ] Preserve a content-minimal correction history and remove stale live
      impressions; do not silently rewrite the accountable record.

**Gate:** every synthetic instance converges, and the visible meaning remains
complete and understandable without opening hidden fine print.

## Phase 4 — Run the private synthetic pilot

- [ ] Use adult internal reviewers, one approved non-production build, one
      synthetic private text Thing, and deterministic export/restore fixtures.
- [ ] Exercise pass, fail, ambiguous, evidence-unavailable, stale, contradicted,
      narrowed, corrected, withdrawn, and archived states.
- [ ] Test direct/deep links, old caches, locale variants, assistant/support
      paraphrases, stale clients, account switch, interruption, retries, and
      deliberate overclaim attempts.
- [ ] Verify evidence summaries reveal no Thing content, identifiers, accounts,
      tokens, credentials, internal paths, unreleased details, or exploitable
      security information.
- [ ] Run the same journey twice against the exact build, then delete fixtures,
      local state, generated evidence, and temporary access as approved.

**Gate:** zero false pass, stale live copy, correction miss, private disclosure,
inaccessible qualification, overclaim, or cleanup failure.

## Acceptance criteria

- [ ] Every in-scope claim instance resolves to one approved profile and
      correction family.
- [ ] Meaning, scope, conditions, limitations, confidence, freshness, and owner
      are explicit and consistent across human and machine-readable surfaces.
- [ ] Evidence existed before publication and matches the exact claim, method,
      version, origin, environment, fixture/population, and review boundary.
- [ ] Negative, ambiguous, unavailable, and contradictory evidence cannot be
      hidden or converted to pass.
- [ ] Declared changes automatically stale or withdraw the affected claim.
- [ ] Corrections converge across every controlled copy; unresolved external
      copies are visible to owners and never described as corrected.
- [ ] Claim and limitation comprehension passes approved accessibility and
      locale profiles.
- [ ] Evidence and receipts remain content-minimal, access-controlled, bounded,
      exportable where approved, and deletable under the retention contract.
- [ ] Challenge, remedy, incident, and manual stop paths work without creating a
      content-moderation shortcut or exposing a reporter.
- [ ] No public or broader claim is made from the pilot result.

## Hard stop conditions

Stop for an ownerless, undefined, implied, or generic trust claim; post-hoc
evidence; wrong or stale version/environment; hidden limitation; inaccessible
qualification; cherry-picking; suppressed contradiction; unauthorized review;
copy or cache drift; misleading visual impression; private/security leakage;
missing correction or remedy; failed cleanup; or any wording stronger than the
approved evidence and qualified review.

## Non-goals

- Public production rollout, marketing rewrite, legal compliance program,
  certification, trust mark, generic score, or automated claim generator.
- User-submitted evidence, public voting on truth, comparative advertising,
  competitor scoring, or reputation ranking.
- New product telemetry, private-content inspection, sentiment inference,
  vulnerability targeting, or trust optimization.
- Security, privacy, accessibility, sustainability, health, safety, youth,
  identity, learning, AI, institutional, or high-impact claims.
- Replacing domain owners, incident repair, user research, external audit, or
  content-provenance responsibilities with a ledger.

## Concrete next action

Product, evidence, legal, privacy/security, accessibility, support, and
portability owners review a one-page packet containing:

1. the first surface inventory and correction family;
2. the exact export/restore claim and prohibited broader interpretations;
3. risk tier, method, fixture, build/origin, negative cases, evidence threshold,
   qualifications, confidence, expiry, and change triggers;
4. public-summary versus protected-evidence boundaries;
5. state, correction, challenge, incident, retention, cleanup, and stop rules;
6. named accountable owners and qualified reviewers; and
7. explicit approval, revision, or rejection of the private synthetic pilot.
