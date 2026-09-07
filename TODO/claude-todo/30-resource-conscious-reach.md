# 30 — Resource-conscious reach 🌱

Status: **🟣 Proposed — owner decision needed**

Evidence: [resource-conscious reach baseline](../../NOTES/resource-conscious-reach-baseline.md)

Roadmap: [resource-conscious reach roadmap](../../PLAN/resource-conscious-reach-roadmap.md)

## What it is for

Make selected Thingtime journeys useful and truthful on constrained devices and
networks, then keep their transfer, compute, memory, storage, and support work
inside explicit budgets. Give people control over costly media and local copies.
Only make environmental statements supported by a current, reviewable boundary.

This epic is a release contract and sequence, not permission to add telemetry,
buy infrastructure, transcode private content, queue offline writes, or market
Thingtime as sustainable.

## Current evidence to preserve

- [`remix/app/routes.tsx`](../../remix/app/routes.tsx) keeps the primary path
  eager and code-splits secondary routes.
- Hashed `/assets/**` receive immutable caching and the Vercel output has a
  repository verifier.
- Feed images use native lazy loading.
- Hosted audio uses metadata preload and an explicit account-scoped offline
  save/remove path.
- Storage and attachment bytes are accounted exactly for quotas, with protected
  purpose binding and deletion rules.
- Merged PR [#299](https://github.com/lopugit/thingtime/pull/299) preserves a
  historical performance audit, measured improvements, unresolved findings,
  and refuted leads.
- [`docs/architecture/geo-distribution.md`](../../docs/architecture/geo-distribution.md)
  is a proposal, not shipped multi-region behavior.

These facts do not prove a current journey budget, general offline capability,
or environmental impact.

## Dependencies and ownership boundaries

- [`FUNDAMENTALS.md`](../../FUNDAMENTALS.md) and
  [`DECISIONS.md`](../../DECISIONS.md) remain the architecture constraints.
- [TODO 22 — Trustworthy adoption](./22-trustworthy-adoption-loop.md) owns first
  value, useful return, consentful sharing, signal governance, and aligned
  economics. Resource metrics may not become an unreviewed analytics path.
- [TODO 23 — Data portability and exit](./23-data-portability-and-exit.md) owns
  account inventory, export, deletion, and closure. Derived/offline bytes must
  participate in those semantics where applicable.
- [TODO 24 — Attention agency](./24-attention-agency-and-calm-use.md) owns
  autoplay/continuation and notification calm. Data saver cannot silently alter
  those choices.
- [TODO 25 — Accessibility and language](./25-accessibility-and-language-readiness.md)
  owns complete-journey accessibility and locale gates. Smaller/faster is not a
  substitute for accessible meaning.
- [TODO 26 — Community safety](./26-community-safety-and-accountable-moderation.md)
  owns moderation and personal safety. A constrained mode must retain report,
  block, warning, and remedy paths.
- [TODO 28 — Service continuity](./28-service-continuity-and-recovery.md) owns
  availability, degraded operation, acknowledged writes, recovery, and
  incidents. Offline-local and durable-server state must stay distinct.
- [TODO 29 — Content provenance](./29-content-provenance-and-correction-integrity.md)
  owns source, edit, derivation, correction, and credential semantics. Media
  adaptation must preserve them.
- The protected attachment pipeline owns media purpose, authorization,
  moderation, storage accounting, object versions, and deletion. Do not create
  a parallel transformer store.
- Open PRs and historical measurements are evidence to refresh, not behavior to
  assume shipped.

## Phase 0 — Approve the contract

- [ ] Select three initial journeys and define their useful, durable outcomes.
- [ ] Approve one reproducible low-spec desktop and one low-spec mobile profile.
- [ ] Approve slow/lossy-online and offline/reconnect network fixtures.
- [ ] Define cold, warm, repeat-after-deploy, and stale-permission states.
- [ ] Approve candidate request, compressed-transfer, eager-media, long-task,
      memory, local-cache, backend-work, and task-completion envelopes.
- [ ] Define the tier-neutral meaning baseline and essential actions that no
      constrained mode may remove.
- [ ] Choose explicit data-saver semantics. Recommended starting point: one
      private user control with system-default/on/off; no identity or location
      inference.
- [ ] Approve the offline boundary. Recommended starting point: bounded reads
      and the existing explicit audio copy only; no offline mutation queue yet.
- [ ] Approve a signal denylist and no-production-telemetry baseline.
- [ ] Assign product, accessibility/language, privacy/security, reliability,
      media, infrastructure-cost, and external-claims owners.
- [ ] Record any architecture, production-signal, or impact-method decision in
      `DECISIONS.md`.

**Phase gate:** do not implement a release budget, media derivative pipeline,
offline expansion, field measurement, regional topology, or public impact claim
until the owner packet is approved.

## Phase 1 — Reproducible constrained-journey harness

- [ ] Create versioned synthetic fixtures for text, structured Things, images,
      hosted audio, video/poster where supported, comments, and permission
      changes. Include no real user content or identifiers.
- [ ] Pin browser, viewport, CPU, memory where supported, network latency,
      throughput, packet loss/offline state, cache state, and authentication.
- [ ] Capture request count, compressed transfer, eager media, task timing,
      current user-centric browser metrics, long tasks, console/network errors,
      and final durable API state.
- [ ] Run cold and warm states separately; include deploy-stale recovery,
      account or endpoint switch, permission loss, interrupted request, and
      reconnect.
- [ ] Validate desktop and mobile from top to bottom and interact with every
      affected drawer, menu, modal, player, data-saver control, and error state.
- [ ] Store only bounded lab receipts with tool versions, fixture version,
      hashes, variance, exclusions, and timestamps.
- [ ] Prove the harness catches a deliberate request/byte regression and a
      deliberate durable-outcome failure, then restore the fixture.

## Phase 2 — Client and delivery budgets

- [ ] Assert the approved eager route/dependency boundary without pinning
      unstable content-hash filenames.
- [ ] Enforce cold and warm journey request/transfer budgets, including fonts,
      redirects, media, API payloads, and failed retries.
- [ ] Verify immutable hashed assets, non-cacheable current-state surfaces,
      back/forward, hard reload, and stale-chunk recovery on built Vercel output.
- [ ] Audit route preloads, duplicated packages, unused icons/styles, large
      dependencies, long tasks, and render cascades.
- [ ] Bound API fields, pages, child aggregation, retries, and caches while
      retaining era discriminators, authorization, exact projections, and
      storage stamps.
- [ ] Render last-known state immediately when valid; never introduce a spinner
      or blank-screen loop to simplify constrained tests.
- [ ] Add an expiring exception format with journey, resource class, measured
      delta, owner, rationale, mitigation, and removal date.

## Phase 3 — Data saver, media, and local copies

- [ ] Keep the data-saver preference private, local/account-scoped as approved,
      and absent from profiles, feeds, ranking, ads, public APIs, and tier
      eligibility.
- [ ] Preserve text, labels, alt text, captions/transcripts, dimensions,
      provenance, moderation state, errors, and primary actions when media is
      deferred.
- [ ] Define responsive image derivatives by approved widths, formats, quality,
      fallback, animation policy, and selection rules. Do not infer sensitive
      user traits.
- [ ] Generate private derivatives only through protected attachment utilities;
      bind purpose and authority, account bytes exactly once, moderate where
      required, and include delete/export behavior.
- [ ] Keep audio metadata-only preload and explicit full-copy consent. Add
      progress, cancellation, interruption, quota/space failure, expiry,
      eviction, revalidation, remove, logout, revoke, delete, account-switch,
      endpoint-switch, and corrupt-copy tests.
- [ ] Define video poster, preload, autoplay, caption/transcript, and data-saver
      behavior before automatic video delivery or offline save.
- [ ] Keep “available locally,” “queued,” “sending,” “accepted,” “conflicted,”
      and “failed” distinct. Never claim durable success before the API accepts
      the operation.
- [ ] If offline mutations are later approved, require bounded queues,
      idempotency keys, current permission checks, conflict UX, expiry,
      cancellation, and safe cross-version behavior.

## Phase 4 — Backend and infrastructure budgets

- [ ] Measure query count, scanned/returned rows, response bytes, compute,
      object transfer, cache hit/miss, retry, and concurrency per selected
      useful outcome.
- [ ] Revalidate unresolved PR #299 findings against current source before
      promoting them; update stale line numbers, topology, severity, and
      mitigations.
- [ ] Batch relational reads and project bounded fields without breaking full
      authorization, legacy-era handling, or response contracts.
- [ ] Give every caller-keyed cache a bounded keyspace or maximum, expiry,
      invalidation, and hostile-input test.
- [ ] Preserve API-only data access, versioned physical collection helpers,
      transactional storage ledgers, and capability-manifest coverage for every
      new or changed remote endpoint.
- [ ] For a new/changed `/api/v1` route, update the route file, Nitro import map,
      API docs/route registry, semantic feature version, client requirement map,
      compatibility tests, and built-server manifest smoke together.
- [ ] Re-evaluate region topology only with current latency, consistency, data
      residence, failover/failback, recovery, price, and support evidence.
- [ ] Report cost per useful outcome beside reliability and access guardrails.

## Phase 5 — Honest environmental evidence

- [ ] Choose an explicit system boundary and useful functional unit before
      calculating impact.
- [ ] Inventory hosting, database, object storage, CDN/transfer, builds,
      background jobs, and only defensible client-device inputs.
- [ ] Record physical data sources, allocation, geography/time matching,
      embodied inputs, exclusions, uncertainty, method version, and expiry.
- [ ] Evaluate the Green Software Foundation SCI method; do not claim adoption
      or a result until the inputs and owner review pass.
- [ ] Separate measured reduction, modeled estimate, compensation, and avoided-
      impact hypothesis in every report.
- [ ] Require external-claims approval, linked evidence, comparison baseline,
      and correction/retraction path.
- [ ] When physical inputs are insufficient, publish only scoped resource facts
      and state plainly that emissions were not measured.

## Phase 6 — Continuous release gate

- [ ] Run the approved cold/warm matrix after changes to routing, dependencies,
      media, caches, payloads, database queries, bundling, or infrastructure.
- [ ] Report exact release SHA, fixtures, profiles, receipts, regressions,
      exceptions, and expired evidence.
- [ ] Keep every resource class separately visible; one green aggregate score
      cannot conceal a blocker.
- [ ] Integrate keyboard, screen reader, reduced motion, narrow view, locale,
      low-bandwidth, offline/reconnect, stale state, and permission tests with
      TODO 25 and TODO 28.
- [ ] Keep data-saver, accessibility, calm-use, safety, export, and deletion
      behavior available on every tier.
- [ ] Require two consecutive release-candidate passes before calling the first
      selected journey contract validated.

## Security and privacy invariants

- No raw IP, precise location, SSID, carrier, device model, battery state,
  storage inventory, installed-font/plugin inventory, Thing content, search
  text, message text, attachment name, credential, private identifier, or full
  URL enters a performance or resource signal.
- Prefer lab fixtures. Any later field signal requires a versioned property
  allowlist, coarse dimensions, minimum cohorts, bounded retention, access
  control, deletion tests, and a written necessity decision.
- Network, memory, timing, language, and accessibility attributes can combine
  into a fingerprint; do not expose person-level traces or dashboards.
- Data-saver state cannot affect ranking, moderation, support priority,
  advertising, public identity, or price.
- Private cache and derivative keys include the approved account, endpoint,
  namespace, purpose, and permission boundary. Authorization is rechecked where
  stale access could expose bytes.
- Derived objects cannot bypass upload caps, purpose binding, moderation,
  object-version deletion, storage reservation, or export/closure semantics.
- Local/offline state never widens canonical API authority.

## Acceptance criteria

- The owner packet names three journeys, two device profiles, two network
  fixtures, four cache/authority states, budgets, tier-neutral meaning, offline
  scope, evidence expiry, exception policy, and accountable owners.
- A deterministic lab command reproduces each journey without production user
  data or production behavioral tracking.
- Cold and warm receipts include requests, compressed bytes, eager media,
  timing/interaction evidence, long tasks, errors, and verified durable state.
- Every selected journey completes on both device profiles in slow/lossy and
  offline/reconnect states as specified, with no severe accessibility,
  security, privacy, permission, or data-integrity failure.
- Data saver preserves core meaning and actions, is explicit/private, and never
  changes tier, ranking, safety, support, or public identity.
- Offline/private bytes are bounded, visible, removable, correctly partitioned,
  and purged or revalidated across logout, revoke, delete, account switch, and
  endpoint switch.
- Media derivatives, if approved, preserve authorization, purpose,
  moderation, storage accounting, object-version deletion, export, and
  provenance.
- Build and journey budgets catch intentional regressions and support narrow,
  expiring exceptions.
- Any changed remote API has registry-derived capability-manifest coverage and
  compatible client negotiation tests.
- Environmental reports state boundary, functional unit, method, sources,
  uncertainty, exclusions, evidence date, owner, and correction path—or state
  that emissions were not measured.
- CI, preview, exact release SHA, and live constrained-journey evidence are
  checked before the item is marked validated or shipped.

## Stop conditions

Stop or roll back when:

- a budget causes missing meaning, primary action, accessible alternative,
  truthful state, or durable correctness;
- private cached/derived bytes cross an authority or deletion boundary;
- offline UI reports server acceptance before it exists;
- data saver is inferred from identity/location or becomes a punitive tier;
- field collection exceeds the approved schema, purpose, cohort, retention, or
  access boundary;
- severe errors, unrecoverable writes, moderation bypasses, or support burden
  cross the approved threshold;
- a budget exception expires or is loosened without evidence and approval; or
- an environmental/comparative claim lacks current physical inputs, boundary,
  method, uncertainty, source, and correction ownership.

## Concrete next action

Schedule one owner decision packet containing exactly:

1. three core journeys and durable outcomes;
2. one desktop and one mobile constrained profile;
3. slow/lossy and offline/reconnect fixtures;
4. cold, warm, deploy-stale, and permission-stale states;
5. candidate client, cache, backend, and task-completion envelopes;
6. tier-neutral meaning and data-saver semantics;
7. offline boundary and purge/revalidation policy;
8. signal denylist and production-telemetry decision;
9. evidence-expiry and budget-exception policy; and
10. named owners for product, access, privacy/security, continuity, media,
    infrastructure cost, and external claims.

Do not start Phase 1 until the packet is decided.
