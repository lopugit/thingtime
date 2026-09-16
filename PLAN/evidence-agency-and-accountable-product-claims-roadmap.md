# Evidence agency and accountable product claims roadmap

**Status:** Proposed; owner and qualified product, evidence, legal, privacy, security, accessibility, safety, and domain review required before implementation or publication

**Grounded:** 2026-09-14, Australia/Melbourne

**Evidence:** [Evidence agency and accountable product claims baseline](../NOTES/evidence-agency-and-accountable-product-claims-baseline.md)

**Execution epic:** [TODO 46 — Evidence agency and accountable product claims](../TODO/claude-todo/46-evidence-agency-and-accountable-product-claims.md)

## Outcome

Give people a clear, current, inspectable account of what Thingtime claims about
itself, what the claim actually covers, why there is justified confidence, what
remains unknown, and how a stale or wrong statement is corrected. The strength
and visibility of each claim must stay proportional to its evidence and the
consequences of misplaced trust.

## Non-negotiable boundaries

- A commit, passing test, route, capability version, health response, accepted
  provider request, deployment, receipt, badge, review, or disclosure is evidence
  of only what it directly observed.
- Authored-content provenance stays under
  [TODO 29](../TODO/claude-todo/29-content-provenance-and-correction-integrity.md);
  this roadmap governs Thingtime's own product speech.
- Do not publish private content, participant data, raw security findings,
  credentials, internal paths, unreleased work, or exploitable fixtures to make
  an evidence surface look transparent.
- A qualification must be clear, proximate, accessible, and available before a
  consequential choice; buried evidence does not repair a misleading impression.
- Higher-risk claims require qualified reviewers and domain-specific evidence.
  This roadmap does not authorize legal, medical, safety, accessibility,
  environmental, child-safety, identity, learning, or AI-performance claims.
- No generic “verified,” “safe,” “secure,” “private,” “accessible,” “green,”
  “accurate,” “reliable,” or “trustworthy” badge is permitted.

## E0 — Assign ownership and inventory claims

- Name accountable owners for product claims, evidence methods, qualified
  review, copy propagation, incidents, correction, retirement, and manual stop.
- Inventory express, implied, visual, generated, machine-readable, translated,
  cached, store, release, status, support, and third-party-controlled claim
  instances.
- Group copies into correction families and record which source is canonical.
- Classify claim risk by likely reliance, reversibility, affected people,
  vulnerability, reach, and consequence of error.
- Freeze new high-risk and unsupported claims while the inventory is incomplete.

**Gate:** no implementation, public registry, badge, or experiment begins.

## E1 — Approve the claim-profile contract

- Define a bounded, versioned profile for meaning, audience, surface, owner,
  scope, conditions, exclusions, evidence, method, confidence, reviewer,
  contradictions, approval, publication, expiry, correction, and withdrawal.
- Separate repository intent, implementation, configured deployment, observed
  operation, end-to-end outcome, and durable assurance.
- Define deterministic state transitions: draft, under review, approved,
  published, stale, contradicted, narrowed, corrected, withdrawn, and archived.
- Make absence, ambiguity, failed evidence, and unavailable evidence explicit;
  never coerce them into pass.
- Specify content-minimal history as relational child records if implementation
  later accumulates events; do not embed an unbounded ledger.

**Gate:** owners approve semantics, access, retention, correction, deletion,
security, portability, and capability-manifest consequences before schema work.

## E2 — Bind evidence before publication

- Define claim-type-specific methods and minimum evidence; record the exact
  system version, origin, configuration, fixture/sample, procedure, expected
  result, observed result, time, and limitations.
- Preserve negative, ambiguous, unavailable, and contradictory results with the
  same integrity as supporting results.
- Require evidence and review before a claim becomes visible. Later evidence may
  correct the record but does not retroactively justify premature publication.
- Derive freshness from explicit change triggers as well as time: code, model,
  data, dependency, environment, configuration, policy, copy, locale, incident,
  evidence, and owner changes.
- Use access-controlled summaries where full evidence would expose private or
  security-sensitive material; state the limitation without implying assurance.

**Gate:** the selected claim cannot publish when evidence is absent, mismatched,
stale, contradicted, inaccessible, or outside the approved review boundary.

## E3 — Make meaning and correction visible

- Present the exact claim, meaningful qualifications, freshness, and a plain
  route to its evidence summary at every approved instance.
- Keep the primary task usable without a trust badge or forced evidence reading.
- Provide keyboard, screen-reader, touch, zoom, reduced-motion, narrow-viewport,
  plain-language, and target-locale parity for claim and limitation surfaces.
- Propagate narrowing, correction, and withdrawal across every known family
  member; preserve a content-minimal accountable history rather than silently
  rewriting what was previously shown.
- Provide a bounded challenge and remedy route without turning product-claim
  disputes into content moderation or exposing reporters.

**Gate:** a reviewer can find, understand, challenge, and leave the claim surface,
and every synthetic copy converges on a correction within the approved bound.

## E4 — Run one bounded private pilot

- Use one approved build, one local or protected preview, adult internal
  reviewers, and synthetic private text fixtures only.
- Validate the claim that the tested export-and-restore journey preserves its
  specified fields under exact conditions; include deliberate pass, fail, stale,
  evidence-unavailable, narrowed, corrected, and withdrawn cases.
- Test old links, cached copies, locale variants, assistant/support paraphrases,
  stale clients, dependency failure, account switch, cancellation, cleanup, and
  an attempted over-broad claim.
- Confirm the evidence summary contains no Thing content, identifiers, tokens,
  credentials, internal paths, personal data, or exploitable details.
- Delete every fixture and remove or retain the preview exactly as approved.

**Gate:** all acceptance criteria pass twice against the exact build, with zero
false pass, stale live claim, missing qualification, inaccessible state, private
leak, correction miss, or cleanup failure.

## E5 — Govern ongoing use and expansion

- Revalidate on every declared change trigger and before reuse in another
  surface, audience, locale, environment, version, or decision context.
- Monitor only content-minimal operational state: counts of due, stale,
  contradicted, corrected, or withdrawn profiles and correction-family misses.
- Review samples for implied meaning and overall impression, not keyword
  compliance alone.
- Publish bounded corrections and limitations where appropriate; do not publish
  raw private evidence or turn transparency into reputation theatre.
- Retire claims, profiles, evidence, access, caches, and instrumentation under
  approved retention and deletion rules.

**Gate:** continuous governance has named capacity, independent challenge,
incident response, stop authority, and periodic qualified review.

## Measures and stop conditions

Measure inventory completeness, evidence-to-claim match, pre-publication review,
freshness, qualification comprehension, accessible task success, contradiction
handling, correction-family convergence, challenge/remedy completion, sensitive
evidence protection, and cleanup. Do not optimize claim count, badge count,
positive-result ratio, clicks on evidence, time on the claim surface, or trust
survey scores detached from observed understanding.

Stop for an undefined or implied claim; missing owner; evidence collected after
publication; wrong version, origin, population, environment, or method; hidden
material limitation; inaccessible qualification; cherry-picked or suppressed
result; unsupported superlative; generic trust badge; stale or contradicted live
copy; correction drift; private or security-sensitive leakage; misleading visual
impression; missing remedy; or a claim stronger than qualified reviewers approve.

## Expansion gates

Approve separately for public production, marketing, app stores, generated Lopu
answers, third-party channels, another locale, another origin, automated claim
generation, user-submitted evidence, comparative or superlative claims, and each
security, privacy, accessibility, sustainability, AI, learning, identity,
health, safety, youth, institutional, or high-impact claim family. Passing one
synthetic capability pilot grants no authority to expand.

## First owner decision packet

Approve or revise the initial surface inventory, claim-risk tiers, claim-profile
vocabulary, selected export/restore claim, exact test conditions, evidence and
review threshold, visible qualifications, sensitive-evidence boundary,
correction family, retention, expiry and change triggers, named owners, hard-zero
failures, cleanup, and manual stop authority.
