# Search and discovery agency roadmap

**Status:** Proposed

**Prepared:** 2026-09-10, Australia/Melbourne

**Evidence:** [Search and discovery agency baseline](../NOTES/search-and-discovery-agency-baseline.md)

**Execution epic:** [TODO 38 — Search and discovery agency](../TODO/claude-todo/38-search-and-discovery-agency.md)

## Outcome

People can deliberately search a named corpus, understand the audience and
ordering boundary, see why a visible item matched, revise or clear the request,
and know whether any query or result state was retained. Match, rank,
recommendation, promotion, trust, and truth remain distinct.

The first proof is one private synthetic corpus, explicit search actions,
non-personalized deterministic ordering, no server query history, no public or
commercial discovery, and no AI-generated answer.

## Boundaries with adjacent roadmaps

- [Attention agency and calm use](./attention-agency-roadmap.md) owns feed
  continuation, recommender training, correction, and notification timing.
  This roadmap owns explicit-query retrieval and discovery presentation.
- [Content provenance and correction](./content-provenance-and-correction-roadmap.md)
  owns authorship, edits, source assertions, and content correction. Search may
  present that evidence but cannot convert it into truth or ranking privilege.
- [Identity agency and context-safe presence](./identity-agency-and-context-safe-presence-roadmap.md)
  owns public profile fields, context separation, identity claims, and
  enumeration boundaries. Search cannot broaden them.
- [Trusted developer ecosystem](./trusted-developer-ecosystem-roadmap.md) and
  [creator fair value](./creator-sustainability-and-fair-value-roadmap.md) own
  app/creator eligibility, review, commerce, and fair marketplace discovery.
  This roadmap supplies shared retrieval and ordering semantics, not a second
  trust or payment system.
- [Versioned experience history](../TODO/claude-todo/20-versioned-experience-history.md)
  owns explicit save/restore of search state. A query is not saved merely
  because it was submitted.
- [Accessibility and language readiness](./accessibility-and-language-readiness-roadmap.md)
  owns complete-journey access and locale foundations.
- [Trustworthy adoption](./trustworthy-adoption-roadmap.md) owns product-signal
  decisions. Search success cannot be optimized through raw query, click, or
  dwell surveillance.

## Non-goals

- Replacing current search implementation through this planning document.
- Public people/content discovery, web crawling, semantic/vector retrieval,
  personalized ranking, social recommendations, trending expansion, or AI
  answers in the first pilot.
- Advertising, sponsorship, auctions, pay-to-rank, trust scores, creator
  payouts, or marketplace eligibility.
- Inferring intent, language, identity, age, vulnerability, beliefs, health,
  finances, location, or relationships from queries or result behavior.
- Claiming completeness, neutrality, fairness, truth, safety, accessibility,
  privacy, or compliance from a passing test or a displayed score.
- Creating server analytics, search history, a new data kind, or retention
  policy before owner approval.

## Operating principles

1. **Authorization before retrieval; retrieval before ranking.** No later
   stage can restore an ineligible record or reveal that it existed.
2. **The request is visible.** Corpus, filters, scope, sort, bounds, and state
   are understandable and revisable without reading API documentation.
3. **Explanations share one source with ordering.** No generated rationale,
   inferred motive, or stale copy may contradict the active policy.
4. **Queries are private by default.** Submission does not imply saving,
   sharing, analytics, personalization, or model training.
5. **Non-personalized direct search is the baseline.** Any relationship,
   behavior, popularity, payment, or profile input is separately approved and
   disclosed.
6. **Approximation is first-class.** Bounded, capped, stale, partial, unknown,
   and unavailable states remain visible.
7. **Control is not labor.** Safe defaults minimize repeated privacy decisions;
   clearing, changing, and opting out stay easy.
8. **Meaning survives access needs and language.** Scope, status, order, and
   corrections work without color, hover, animation, or English-only phrasing.

## Candidate search contract

Approve exact fields and versions before implementation. A response may need:

- request version, explicit corpus and audience label, text/conditions, sort,
  and whether the request is shareable, saved, or ephemeral;
- ordering-policy identifier/version, deterministic tie-break rule, candidate
  bound, count precision, and current/stale status;
- per-visible-result match basis limited to fields already safe for that
  viewer, plus any recency or other approved ordering contribution;
- a clear declaration that no personalization or promotion applied, or a
  separately approved description and control when either does;
- safe empty, filtered, unavailable, rate-limited, expired, and error states;
  and
- one action to revise, clear, report a result, or inspect the owning trust,
  correction, safety, and support context without conflating those actions.

The first pilot should return this as ephemeral response metadata. It should
not persist query text or result identifiers server-side.

## Milestone D0 — Approve the discovery charter

**Outcome:** scope, vocabulary, ownership, and forbidden shortcuts are decided.

- Approve the vocabulary in the evidence note and the first private corpus.
- Name product, privacy/security, accessibility/language, authorization,
  relevance, abuse/safety, reliability, and commercial-separation owners.
- Approve the no-server-history pilot rule and inventory browser, CDN, server,
  database, observability, support, and test-artifact exposure.
- Decide permitted request/response fields and the minimum search receipt.
- Register stop authority and escalation for leakage, hidden-result oracles,
  discriminatory ordering, paid influence, and inaccessible recovery.
- Record architecture, storage, or retention decisions in `DECISIONS.md`.

**Gate:** no product change until the owner and qualified reviewers accept the
charter and every guardrail has an accountable owner.

## Milestone D1 — Characterize current search truth

**Outcome:** every current surface has one evidence-backed behavior card.

- Inventory full search, Commander, quick switcher, people, subspaces, schemas,
  components, apps, docs, and any other discovery surface.
- For each, record corpus, eligibility, authorization, query grammar, candidate
  bounds, rank/sort/ties, caching, URL state, rate limits, approximation,
  failure behavior, tests, and active API capability.
- Trace query text and result identifiers through browser history, referrers,
  CDN/server logs, traces, analytics, support capture, local cache, backups,
  and deletion.
- Verify exact ACL and app-namespace behavior through the real API, including
  inherited audiences, blocks, moderation, stale membership, hidden links,
  account switching, and endpoint changes.
- Reconcile active PR descriptions with merged and deployed behavior.

**Gate:** contradictions become named defects or unknowns; no surface is
described as complete, private, or fair from repository presence alone.

## Milestone D2 — Make request, retention, and scope legible

**Outcome:** the person can predict where a query goes and what persists.

- Implement one canonical request-summary projection from the server-accepted
  query rather than echoing unchecked client state.
- Make corpus, audience, structured filters, sort, bounds, and approximation
  visible before and after submission.
- Use POST and no URL query for the private pilot. Add shareable URLs only as a
  separate deliberate action whose scope and exposure are previewed.
- Keep no server search history. Bound account-scoped local cache, clear it on
  approved sign-out/endpoint/account transitions, and provide an explicit
  clear action.
- Preserve safe prior state during background refresh while labeling stale or
  failed state honestly.
- Update API docs, capability SemVer, client requirements, privacy/help copy,
  and tests together for any contract change.

**Gate:** exposure and lifecycle tests prove the approved query cannot enter a
forbidden store or cross account, endpoint, audience, or browser-profile
boundaries.

## Milestone D3 — Explain match and ordering

**Outcome:** visible explanations are deterministic, bounded, and correct.

- Register every eligibility, matching, weighting, tie, recency, popularity,
  relationship, moderation, provenance, personalization, and commercial input
  used by each pilot surface.
- Start with `relevance` and `newest`; show the chosen policy and deterministic
  tie behavior.
- Derive “why matched” only from the accepted query, active policy, and fields
  already visible to the viewer. Never reveal hidden candidates or another
  person's behavior.
- State explicitly that match and rank do not prove accuracy, quality, safety,
  endorsement, identity, authority, or truth.
- Add fixtures where one factor changes at a time and explanation/order move
  together. Treat any divergence as a release blocker.
- Provide equal access to non-personalized ordering. No essential findability
  or privacy control is premium-only.

**Gate:** deterministic tests and structured sessions show people can
distinguish corpus, match, order, approximation, recommendation, promotion, and
trust evidence.

## Milestone D4 — Run one private synthetic pilot

**Outcome:** one complete find-and-revise journey works without surveillance.

- Create a fixed synthetic schema and small fixture corpus through the real
  API in a private adult test account.
- Test text and structured queries, `relevance` and `newest`, no-result,
  approximate, invalid, rate-limited, stale-cache, offline, slow, and
  permission-change states.
- Include keyboard, screen reader, touch, narrow/wide viewport, 200% zoom,
  reduced motion, mixed-script, RTL, emoji, and long-text profiles.
- Evaluate task success, scope/order comprehension, revision, clearing, and
  privacy fidelity through structured research or local-only measures.
- Delete fixtures and local state after the approved window and prove no
  server search history or product-signal record remains.

**Gate:** the pilot meets approved success and guardrail thresholds; a single
severe privacy, authorization, accessibility, explanation, or deletion failure
stops expansion.

## Milestone D5 — Expand one corpus at a time

**Outcome:** each new discovery family earns inclusion under its own contract.

- Choose exactly one next corpus—public Things, people, subspaces, schemas,
  components, apps, or creators—based on owner need and guardrail capacity.
- Re-run authorization, projection, enumeration, moderation, provenance,
  language, ranking, support, and abuse review for that corpus.
- Keep multiple rails visibly separate until shared semantics are proven;
  never compare unrelated scores as if they shared a scale.
- Gate recommendations, personalization, semantic retrieval, AI answers,
  minors, institutions, sensitive domains, and cross-origin search as separate
  proposals with qualified review.
- Route result reports, source corrections, identity problems, app incidents,
  and moderation cases to their owning contracts rather than hiding them in a
  relevance feedback button.

**Gate:** the new corpus improves approved find-task outcomes without crossing
any privacy, safety, fairness, access, reliability, or operating threshold.

## Milestone D6 — Govern public and commercial discovery

**Outcome:** growth cannot quietly buy access, trust, or organic rank.

- Publish plain-language and machine-readable declarations of eligibility,
  ranking parameters, available controls, change history, and commercial
  influence for every public surface.
- Segregate and label any approved promotion. Preserve a directly accessible
  non-personalized organic option and never let payment alter authorization,
  moderation, provenance, safety, appeal, or support priority.
- Add versioned rollout, rollback, incident, appeal, correction, and retirement
  procedures for discovery policies and indexes.
- Audit outcomes using approved aggregate or sampled research; do not create
  person-level query, click, conversion, or inferred-interest dossiers.
- Review moderation/support capacity, index freshness, accessibility,
  localization, reliability, compute, and creator impact before each expansion.

**Gate:** public/commercial discovery remains understandable, contestable, and
operable under the approved capacity and stop contract.

## Measure contract

Every measure needs purpose, owner, numerator, denominator, exclusions,
collection method, retention, access, deletion, and a guardrail pair before use.

| Measure                | Candidate definition                                                                                                      | Never substitute                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Find-task success      | Eligible tasks reaching the known target or correct outside-scope conclusion.                                             | Clicks, queries, sessions, or time spent.    |
| Scope comprehension    | Participants accurately identify corpus and audience.                                                                     | Acceptance of terms or absence of complaint. |
| Ordering comprehension | Participants accurately explain the active sort and its limits.                                                           | A displayed score or explanation open.       |
| Result fidelity        | Visible eligibility, ordering, count, and explanations match the active contract.                                         | Endpoint 200, CI green, or index existence.  |
| Recovery success       | People revise/clear/retry and retain intended context after safe failures.                                                | More repeated queries.                       |
| Harm guardrails        | Authorization, privacy, accessibility, abuse, unfair influence, and reliability remain within separately approved bounds. | One blended trust or fairness score.         |

## Stop conditions

Pause the affected surface or pilot when:

- a result or explanation reveals hidden content, private behavior, sensitive
  inference, access-control reasons, or cross-account/endpoint data;
- query text or result identifiers enter an unapproved URL, log, analytic,
  trace, support artifact, training set, cache, backup, or retention path;
- a rank/explanation differs from the registered policy, or stale state is
  presented as current without warning;
- payment, popularity, identity, relationship, provenance, or moderation state
  silently changes organic rank or access;
- empty, approximate, offline, rate-limited, inaccessible, and failed states
  become indistinguishable;
- accessibility or language failures prevent search, revision, explanation,
  clearing, reporting, or recovery;
- a public-corpus expansion outpaces moderation, correction, support,
  reliability, localization, or incident capacity; or
- evaluation starts rewarding attention, query volume, clicks, conversion, or
  inferred interests instead of useful find outcomes.

## First owner decision packet

Decide only:

1. the private synthetic corpus and find tasks;
2. the request-summary and ephemeral response fields;
3. the no-server-history, no-URL, and local-cache lifecycle;
4. the first two orderings and their deterministic explanations;
5. the complete-journey profiles and pilot thresholds; and
6. named owners and stop authority.

Everything public, personalized, semantic, commercial, AI-generated,
institutional, child-directed, or high-impact remains separately gated.
