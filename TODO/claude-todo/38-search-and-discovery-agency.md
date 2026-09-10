# 38 — Search and discovery agency 🔎

**Status:** 🟣 Proposed · owner and qualified review needed

**Priority:** P1 trust/adoption infrastructure

**Proposed:** 2026-09-10, Australia/Melbourne

**Owner:** Unassigned; product owner coordinates privacy/security,
authorization, accessibility/language, relevance, abuse/safety, reliability,
and commercial-separation review

**Evidence:** [Search and discovery agency baseline](../../NOTES/search-and-discovery-agency-baseline.md)

**Plan:** [Search and discovery agency roadmap](../../PLAN/search-and-discovery-agency-roadmap.md)

## Goal

Make every search request, corpus, audience boundary, match, order,
approximation, explanation, and retention choice understandable and
controllable while keeping direct retrieval distinct from recommendation,
promotion, trust evidence, and truth.

## Problem

Thingtime already provides powerful ACL-aware ranked and structured search,
schema-guided filters, public people/subspace rails, and Commander/quick
switcher results. The mechanics are distributed across different surfaces and
policies. A query-relative number is visible, but there is no common search
receipt, deterministic “why matched” contract, registered influence boundary,
or approved query URL/cache/log lifecycle.

Without that contract, future public, personalized, creator, app, or commercial
discovery could accidentally make hidden assumptions look like relevance,
store sensitive intent, or let popularity/payment/trust context widen reach.
This epic stages one private synthetic pilot first. It authorizes no product
change by itself.

## Dependencies and boundaries

- [`FUNDAMENTALS.md`](../../FUNDAMENTALS.md) and
  [`DECISIONS.md`](../../DECISIONS.md) remain authoritative. Search uses the
  real API and versioned collection getters; accumulating history is relational.
- [TODO 22](./22-trustworthy-adoption-loop.md) owns product measurement and
  forbids raw search text in adoption signals.
- [TODO 20](./20-versioned-experience-history.md) owns explicit save/restore of
  search state. Submission alone never means save.
- [TODO 23](./23-data-portability-and-exit.md) owns export, deletion, endpoint
  migration, and account closure for any explicitly saved search state.
- [TODO 24](./24-attention-agency-and-calm-use.md) owns feed recommendation,
  learning, corrective feedback, and calm use. This epic owns explicit-query
  retrieval and discovery presentation.
- [TODO 25](./25-accessibility-and-language-readiness.md) owns complete-journey
  access, locale, translation, and multilingual release gates.
- [TODO 26](./26-community-safety-and-accountable-moderation.md) owns reports,
  cases, decisions, appeals, and remedies. Search relevance feedback cannot
  become shadow moderation.
- [TODO 27](./27-trusted-developer-ecosystem.md) owns app eligibility, releases,
  review, incident response, and fair app discovery.
- [TODO 29](./29-content-provenance-and-correction-integrity.md) owns content
  source, edit, correction, and evidence strength. Provenance is context, not a
  truth or rank badge.
- [TODO 31](./31-creator-sustainability-and-fair-value.md) owns creator roles,
  transactions, remedies, and commercial fairness. Payment never silently buys
  organic rank, trust, moderation, or access.
- [TODO 33](./33-ai-agency-and-accountable-assistance.md) owns AI context,
  authority, evidence, correction, and remedy. Generated answers or semantic
  retrieval require a separate approved slice.
- [TODO 35](./35-identity-agency-and-context-safe-presence.md) owns public
  profile projection, identity claims, context separation, enumeration, and
  correction.
- Open PRs are time-sensitive evidence, not shipped dependencies. Recheck
  exact heads, checks, deployment, and live behavior before implementation.

## Phase 0 — Approve the charter

- [ ] Approve definitions for query, corpus, audience, candidate, match, rank,
      presentation, recommendation, promotion, trust evidence, and answer.
- [ ] Choose one private adult synthetic corpus and fixed find tasks.
- [ ] Approve request/response fields, sort/tie rules, bounds, approximation,
      “why matched” evidence, and unknown/error states.
- [ ] Approve no server query history, no URL query, no analytics/training, and
      bounded account-scoped local-cache behavior for the pilot.
- [ ] Inventory browser, CDN/server logs, traces, support capture, test
      artifacts, backups, and deletion before stating the query is ephemeral.
- [ ] Assign product, authorization, privacy/security, accessibility/language,
      relevance, safety/abuse, reliability, and commercial-separation owners.
- [ ] Record durable architecture, storage, ranking, or retention decisions in
      [`DECISIONS.md`](../../DECISIONS.md).

**Gate:** no implementation begins until the decision packet and stop authority
are approved.

## Phase 1 — Freeze current truth

- [ ] Inventory full search, Commander, quick switcher, people, subspaces,
      schemas, components, apps, docs, and other discovery surfaces.
- [ ] Record for each: corpus, eligibility, projection, query grammar,
      candidate bounds, rank/sort/ties, cache/URL/log lifecycle, rate limits,
      approximation, failure states, API capability, and tests.
- [ ] Add real-API authorization fixtures for public, owner, granted, inherited,
      hidden, blocked, moderated, app-scoped, stale-membership, account-switch,
      and endpoint-switch cases.
- [ ] Verify open and merged PR claims against current deployed behavior.
- [ ] Turn contradictions or unknowns into named blockers; do not normalize
      labels until their meanings agree.

## Phase 2 — Implement one canonical private request

- [ ] Accept only the approved text/structured grammar through the canonical
      search API; keep every current size, depth, operator, result, rate, and
      authorization bound or justify a reviewed change.
- [ ] Return a server-derived request summary: private corpus/audience, accepted
      text/conditions, sort, policy version, bounds, approximation, and current
      state.
- [ ] Use POST; do not synchronize pilot queries into the URL or a server
      history. Make a future share action separate, explicit, and previewed.
- [ ] Bound the per-account local snapshot, clear it under the approved
      sign-out/account/endpoint rules, and provide an accessible clear control.
- [ ] Preserve last-known safe state during refresh and label stale/failure
      honestly without a blank loading flash.
- [ ] Update endpoint docs, manifest feature SemVer, client requirements,
      privacy/help copy, and contract tests in the same change.

## Phase 3 — Explain match and order

- [ ] Register `relevance` and `newest` inputs and deterministic tie-breakers.
- [ ] Derive per-result “why matched” only from the accepted query, active
      policy, and fields already visible to this viewer.
- [ ] Explain weighting/bounds in plain language and expose machine-readable
      policy metadata without leaking index internals that create an oracle.
- [ ] State that match/rank do not mean truth, trust, quality, safety,
      popularity, endorsement, or authority.
- [ ] Create one-factor fixtures proving order and explanation change together;
      unknown contribution renders unknown, never a generated guess.
- [ ] Provide revise, clear, and appropriate correction/report/support routes
      without treating relevance feedback as training or moderation.

## Phase 4 — Validate the private synthetic pilot

- [ ] Seed fixtures through the same real API as live creation and delete them
      through the real API after the approved window.
- [ ] Cover text, structured, relevance, newest, exact/no match, approximate,
      malformed, bounded, rate-limited, stale, offline, slow, cancelled,
      permission-changed, and deleted-result states.
- [ ] Exercise keyboard, screen reader, touch, narrow/wide viewport, 200% zoom,
      reduced motion, long text, emoji, mixed scripts, RTL, and target locales.
- [ ] Verify that query/result content appears in no forbidden URL, log, trace,
      analytic, support capture, training record, cache, backup, or account.
- [ ] Evaluate find-task, scope/order comprehension, revision, clearing,
      privacy fidelity, and recovery through structured sessions or local-only
      evidence.
- [ ] Exercise the stop switch and cleanup plan before accepting results.

## Phase 5 — Consider expansion separately

- [ ] Select only one next corpus and repeat projection, enumeration,
      moderation, provenance, language, abuse, support, and operating review.
- [ ] Keep unlike rails separate until eligibility and order semantics are
      genuinely comparable.
- [ ] Require separate proposals for personalization, behavior learning,
      semantic/vector retrieval, AI answers, sponsorship, public creator/app
      discovery, minors, institutions, or sensitive/high-impact domains.
- [ ] If promotion is approved, label and segregate it, preserve a directly
      accessible non-personalized organic option, and prevent payment from
      changing access, trust, safety, moderation, appeal, or support priority.
- [ ] Publish versioned eligibility/order declarations, change receipts,
      rollback, incident, correction, appeal, and retirement paths before scale.

## Security, privacy, fairness, and accessibility safeguards

- Search authorization is server-owned, fail-closed, and independent of every
  score, relationship, payment, popularity, trust, or AI signal.
- Query text, filters, result identifiers, clicks, revisions, and abandonment
  are sensitive by default and excluded from analytics/training.
- No response, count, timing, error, explanation, or cache reveals a hidden
  candidate, exclusion reason, private behavior, or sensitive inference.
- Direct retrieval, recommendation, promotion, moderation, provenance, and AI
  answers use distinct labels, policies, controls, and evaluation.
- The pilot is deterministic and non-personalized. Any later behavior,
  relationship, profile, or inferred-interest input needs explicit approval.
- Private result snippets and explanations use current authorized projections;
  deletion, block, moderation, permission change, and endpoint switch take
  effect without stale leakage.
- Scope, sort, status, approximation, errors, explanations, and controls are
  programmatically determinable and never color-, hover-, motion-, or
  pointer-only.
- Empty, exhausted, filtered, inaccessible, approximate, stale, offline,
  rate-limited, and failed states remain distinct and recoverable.
- Language and exact-match behavior is explicit. Do not infer a person's
  language, origin, identity, or vulnerability from query text.
- Unknown or incompatible clients fail safely under capability negotiation and
  never downgrade to a broader search contract.

## Acceptance criteria

- The approved vocabulary, corpus, request/response contract, cache/log policy,
  owners, thresholds, and stop authority are linked from this epic.
- A participant can state what was searched, what was excluded from scope, what
  determined order, whether it was approximate, and what persisted.
- Real-API tests prove every visibility/app lens before ranking and reveal no
  hidden match or exclusion oracle.
- `relevance` and `newest` order and explanations reproduce under registered
  policy/tie fixtures; a changed policy requires an explicit version change.
- The private pilot uses POST, creates no server history or product signal, and
  query/result content appears in no forbidden operational surface.
- Account/endpoint/sign-out/cache transitions cannot show another identity's
  query or result, and the explicit clear action removes the approved local
  state.
- Match/rank are never labeled as truth, trust, endorsement, safety, quality,
  popularity, recommendation, or promotion.
- Desktop/mobile and assistive profiles complete search, explanation,
  revision, clearing, and recovery without clipping, focus loss, hover-only
  meaning, duplicate announcement, or loading over safe last-known state.
- Cleanup removes synthetic fixtures and temporary state through real product
  paths, with no retained query history contrary to the approved contract.
- Current source, API docs, capability manifest, client requirements, tests,
  exact-head CI, preview, and deployed behavior agree before status moves to
  shipped.

## Stop conditions

Stop the affected pilot or surface on any hidden-result leak, forbidden query
retention, cross-account/endpoint cache, unexplained or non-reproducible order,
covert personalization/training, paid or popularity-based authority, severe
accessibility/language failure, stale result presented as current, or operating
load beyond the named owner's capacity.

## Concrete next action

Prepare one owner packet containing:

1. the fixed private fixture corpus and tasks;
2. canonical request-summary and ephemeral response fields;
3. URL, local cache, operational log, deletion, and no-history rules;
4. `relevance`/`newest` tie and explanation policy;
5. complete-journey profiles and success/stop thresholds; and
6. named accountable owners.

Do not implement or expand discovery until the packet is approved.
