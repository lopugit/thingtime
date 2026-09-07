# Resource-conscious reach roadmap

Status: **Proposed — owner decision required before execution**

Evidence: [resource-conscious reach baseline](../NOTES/resource-conscious-reach-baseline.md)

Execution epic: [TODO 30 — Resource-conscious reach](../TODO/claude-todo/30-resource-conscious-reach.md)

## Outcome

Make approved Thingtime journeys complete, understandable, and recoverable on
constrained devices and networks while reducing unnecessary transfer, compute,
memory, storage, and support work. Keep the result useful across tiers and make
any environmental statement no stronger than its measured boundary.

This roadmap owns resource budgets, low-bandwidth behavior, explicit data-saver
semantics, resource-aware media delivery, local-footprint controls, and honest
impact evidence. It complements rather than replaces:

- the [accessibility and language roadmap](./accessibility-and-language-readiness-roadmap.md),
  which owns complete-journey access and locale gates;
- the [service continuity roadmap](./service-continuity-and-recovery-roadmap.md),
  which owns availability, acknowledged writes, degraded service, restore, and
  incidents;
- the [data portability roadmap](./data-portability-and-exit-roadmap.md), which
  owns export, deletion, and graceful exit;
- the [attention-agency roadmap](./attention-agency-roadmap.md), which owns calm
  continuation and notification defaults; and
- the [trustworthy adoption roadmap](./trustworthy-adoption-roadmap.md), which
  owns first value, useful return, consentful growth, and aligned economics.

## Non-goals

- A universal “fast,” “offline,” “green,” “carbon neutral,” or low-impact claim.
- Removing meaning, access, safety controls, or error truth to hit a byte score.
- A service worker or offline mutation queue before authority, conflict, and
  purge semantics are approved.
- Inferring constrained users from identity, location, carrier, hardware, plan,
  disability, or income.
- Sending private content to a third-party optimizer, performance vendor, or
  model without a separately approved data contract.
- Buying multi-region infrastructure before the critical journey, consistency,
  residence, recovery, cost, and rollback gates are proven.
- Treating logical storage billing bytes as energy or emissions measurements.

## Principles

1. **Complete work is the unit.** Optimize useful, correct outcomes rather than
   page-weight vanity metrics.
2. **Meaning survives adaptation.** Text, labels, permissions, provenance,
   safety, and primary actions remain available when rich media is deferred.
3. **Cold and warm are separate contracts.** First use, repeat use, deploy
   recovery, and stale-permission recovery each have distinct evidence.
4. **User choice beats hidden inference.** Start with an explicit data-saver
   control and deterministic defaults; do not profile people into a mode.
5. **Local bytes remain private.** Cache ownership and deletion follow account,
   endpoint, namespace, purpose, and current authority.
6. **Optimization cannot fork truth.** API validation, permissions,
   idempotency, storage accounting, and capability negotiation stay canonical.
7. **Measure before marketing.** Publish resource facts with scope; publish an
   environmental result only when physical inputs, method, uncertainty, and
   functional unit support it.
8. **Access is not a premium feature.** Essential low-bandwidth, calm,
   accessibility, export, delete, and safety controls are never paywalled.

## Proposed contract layers

| Layer           | Required artifact                                                                                 | Gate                                                               |
| --------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Journey         | Versioned steps, content fixture, expected durable outcome, cold/warm state                       | Task completes correctly on every approved profile.                |
| Client delivery | Request/byte, loading, interaction, visual stability, long-task, memory, and cache envelope       | No blocker and no unapproved budget regression.                    |
| Media           | Original/derivative rules, dimensions, quality, alternatives, preload, consent, deletion, billing | Meaning remains available; private derivatives preserve authority. |
| Network state   | Slow, lossy, offline, reconnect, deploy-stale, and permission-stale behavior                      | Every state is truthful and recoverable.                           |
| Backend work    | Query/scan, compute, object transfer, cache, retry, and concurrency envelope                      | Work is bounded and does not hide correctness loss.                |
| Local footprint | Account-scoped cache budget, expiry, eviction, revalidation, purge, and user controls             | No cross-account reuse or undeletable private bytes.               |
| Evidence        | Tool versions, environment, run receipts, variance, exclusions, owner, expiry                     | Another contributor can reproduce the result.                      |
| Impact claims   | System boundary, physical inputs, method, functional unit, uncertainty, review                    | No public claim before independent owner approval.                 |

## M0 — Decide the reach contract

**Outcome:** the team knows what must work, for whom, under which constraints.

- Select three initial journeys from understand, create-and-return, read-and-
  respond, consentful share, hosted-audio playback, and export/recovery.
- Approve one low-spec desktop profile and one low-spec mobile profile using
  reproducible browser/CPU/memory settings rather than stereotypes about real
  people.
- Approve at least two network fixtures: slow/lossy online and offline/reconnect.
- Define cold, warm, repeat-after-deploy, and stale-permission states.
- Set candidate resource envelopes for requests, compressed transfer, eager
  media, long tasks, peak memory where measurable, local cache, backend work,
  and task completion.
- Define the tier-neutral meaning baseline and the exact information/actions
  that may be deferred only by explicit choice.
- Approve the no-collection baseline and signal denylist. Record any later
  field-signal proposal in `DECISIONS.md` before implementation.
- Assign owners for product, accessibility/language, privacy/security,
  reliability, media, infrastructure cost, and external claims.

**Gate:** no resource release gate, data-saver behavior, offline expansion,
media derivative pipeline, or environmental claim begins without this packet.

## M1 — Build a reproducible lab baseline

**Outcome:** regressions are observable without tracking real people.

- Create versioned synthetic content fixtures: short text, long structured
  Thing, image gallery, audio, video/poster where supported, comments, and
  permission transitions. Never copy user data into fixtures.
- Run each approved journey under the exact browser, viewport, CPU, memory,
  network, cache, and authentication state.
- Capture request count, compressed transfer, eager media bytes, task timing,
  interaction/visual-stability evidence, long tasks, console/network failures,
  and durable API outcome.
- Record warm-cache and cold-cache results separately. Test one redeploy/stale-
  chunk path and one account or endpoint switch.
- Instrument the test harness, not the production user. Store bounded receipts
  without cookies, tokens, private identifiers, or content.
- Rebuild the exact release and preserve tool versions, content hashes, run
  variance, and known measurement limitations.

**Gate:** another contributor can reproduce the baseline, and every failure is
classified as client, network, backend, permission, data, or harness—not hidden
inside one score.

## M2 — Bound the core path

**Outcome:** the selected journeys stay within an approved delivery and device
envelope without losing meaning.

- Preserve the intentional eager/lazy route boundary and add a build assertion
  for the approved eager graph rather than freezing arbitrary chunk filenames.
- Set journey-level request and compressed-transfer budgets for cold and warm
  runs. Treat redirects, fonts, images, and API responses as part of the task.
- Keep hashed assets immutable and the current shell/deploy freshness behavior
  explicit; verify back/forward, reload, and a superseded asset graph.
- Audit eager dependencies, module preloads, duplicated libraries, unused
  icons/styles, long tasks, and main-thread hydration/render work.
- Bound API response fields, pagination, related-child aggregation, retries,
  and caller-keyed caches. Never trade a complete projection or authorization
  check for a smaller payload.
- Preserve last-known/cached state while background refresh runs. A constrained
  path must not introduce spinner loops or blank useful state.
- Add expiring, owner-approved exceptions with a reason, affected journey,
  measured delta, mitigation, and removal date.

**Gate:** all selected journeys meet the approved envelope on both device
profiles; any exception is narrow and no accessibility, correctness, privacy,
security, or continuity gate regresses.

## M3 — Make media and offline behavior intentional

**Outcome:** people control costly representation and local storage.

- Define one explicit data-saver preference with system-default, on, and off
  semantics. Keep it private and out of ranking, profiles, analytics, and tier
  eligibility.
- Preserve text, alt text, captions/transcripts where applicable, dimensions,
  labels, provenance, moderation state, and primary actions when rich media is
  deferred.
- Define responsive image derivative sizes, formats, quality, fallback,
  animation policy, and selection rules for the approved surfaces.
- Reuse the protected attachment pipeline for derivatives. Bind every derived
  object to the same purpose/authority, account for its bytes once, include it
  in delete/export behavior, and never expose a private transform URL publicly.
- Keep audio `preload="metadata"`; make full offline copies explicit. Add local
  quota, progress, interruption, insufficient-space, eviction, remove, and
  account-switch evidence before widening offline support.
- Define video poster, preload, autoplay, caption/transcript, and data-saver
  behavior before enabling automatic playback or background download.
- Start offline expansion with bounded reads. Propose mutation replay only
  after queue identity, idempotency, conflict, permission recheck, encryption/
  storage boundary, expiry, cancellation, and durable-acceptance UX are decided.

**Gate:** data-saver and offline modes retain complete core meaning; private
bytes cannot cross account/endpoint/permission boundaries; interrupted work is
truthful and recoverable.

## M4 — Reduce backend and infrastructure work per useful outcome

**Outcome:** growth does not multiply hidden compute, database, object-transfer,
or support cost faster than useful work.

- Attach query, scanned/returned-row, response-byte, object-transfer, compute,
  cache-hit, and retry evidence to the selected journeys.
- Finish or revalidate still-relevant findings from merged PR #299 against the
  current source; never copy historical severity or line numbers blindly.
- Use bounded projections and batch aggregation while preserving era
  discriminators, permissions, storage stamps, and complete relational reads.
- Make cache keys, maxima, expiry, invalidation, and caller-controlled input
  explicit. A cache must not turn arbitrary hosts, identities, or queries into
  unbounded memory.
- Treat data residence, replication, failover, consistency, write latency,
  recovery, price, and support load as first-class gates before any regional
  topology change.
- Report direct cost per useful outcome beside reliability and support burden;
  do not optimize by rejecting difficult users or offloading work invisibly to
  their devices.

**Gate:** backend work is bounded and explainable, service objectives remain
inside the continuity contract, and no optimization weakens authorization,
durability, data residence, or deletion.

## M5 — Establish honest environmental evidence

**Outcome:** Thingtime can discuss resource reductions without greenwashing.

- Inventory hosting, database, object storage, CDN/transfer, build, background
  jobs, and an explicitly bounded client-device contribution only where credible
  physical data exists.
- Select a functional unit tied to useful work, such as one successful create-
  and-return journey, not one page view detached from outcome.
- Document provider data sources, allocation, geography/time matching,
  renewable/market instruments, embodied inputs, exclusions, uncertainty, and
  data expiry.
- Pilot an SCI-style calculation only if inputs meet the approved quality bar.
  Keep resource measures visible even when an emissions estimate is impossible.
- Separate measured reduction, modeled estimate, purchased compensation, and
  avoided-impact hypothesis. Never collapse them into a single badge.
- Require claims review, source links, method version, comparison baseline, and
  correction path before publication.

**Gate:** the evidence owner approves the boundary and uncertainty. Otherwise
publish only scoped technical resource facts and explicitly say emissions are
not measured.

## M6 — Make reach a continuous, equitable release gate

**Outcome:** resource-conscious access survives product growth.

- Run the approved cold/warm journey matrix on relevant release candidates and
  after dependency, bundler, media, caching, or infrastructure changes.
- Surface regressions by journey and resource class, with exact artifacts and
  an owner. Do not block unrelated docs-only work on an unowned flaky score.
- Review budgets on a fixed cadence and after material architecture changes;
  tighten through measured improvements rather than silently loosening them.
- Test keyboard, screen reader, reduced motion, approved locales, narrow view,
  low bandwidth, offline/reconnect, stale state, and permission changes as one
  complete journey matrix with TODO 25 and TODO 28.
- Keep data-saver, accessibility, calm-use, safety, export, and delete controls
  available to every tier.
- Publish a bounded changelog of verified resource improvements, regressions,
  exceptions, and corrected claims.

**Gate:** selected journeys meet approved budgets and guardrails for two
consecutive release candidates, exceptions are within policy, and the operating
load is staffed and affordable.

## Measures and guardrails

| Measure                                    | Decision use                                  | Guardrail                                                                         |
| ------------------------------------------ | --------------------------------------------- | --------------------------------------------------------------------------------- |
| Constrained-journey completion             | Whether selected work remains possible        | Report accessibility, permission, reliability, and error classes separately.      |
| Cold/warm request and transfer envelope    | Detect eager delivery regressions             | Preserve meaning and durable outcomes; never game by omitting necessary state.    |
| Low-end interaction and long-task evidence | Find device-exclusion regressions             | Include keyboard/touch/assistive states and correct input result.                 |
| Media bytes deferred or avoided by choice  | Evaluate data-saver value                     | No hidden content loss, coercive reload, or lower-tier punishment.                |
| Local cache footprint and purge success    | Bound offline cost and privacy                | Zero cross-account/endpoint reuse and complete remove behavior.                   |
| Backend work per useful outcome            | Control compute/database/object amplification | No authorization, projection, consistency, or recovery regression.                |
| Direct service cost per useful outcome     | Test sustainable operating scope              | Do not exclude costly users, sell attention/data, or hide support load.           |
| Environmental intensity, if approved       | Track measured physical improvement           | Current system boundary, functional unit, method, uncertainty, and claims review. |

## Stop conditions

Pause rollout or revert the affected change when:

- a selected journey loses meaning, primary action, accessible alternative, or
  durable correctness to meet a budget;
- private cached or derived media crosses account, endpoint, namespace,
  permission, or deletion boundaries;
- offline UI reports durable success before the canonical API accepts it;
- a data-saver mode is inferred from identity/location or affects ranking,
  safety, support, or tier access;
- a resource optimization increases severe errors, data loss, unrecoverable
  writes, moderation bypass, or support burden beyond its approved bound;
- the release budget is loosened without an owner, evidence, expiry, and
  mitigation;
- field signals exceed the approved property, retention, aggregation, or cohort
  contract; or
- an environmental or comparative statement lacks a current method, boundary,
  physical inputs, uncertainty, source, and correction owner.

## Owner decision packet

Before M1, approve exactly:

1. three core journeys and their durable outcomes;
2. one desktop and one mobile constrained device profile;
3. slow/lossy and offline/reconnect network fixtures;
4. cold, warm, deploy-stale, and permission-stale states;
5. candidate request, transfer, interaction, memory, cache, and backend envelopes;
6. tier-neutral meaning and actions that data saver may defer;
7. offline read/mutation boundary and private-cache purge policy;
8. signal allowlist/denylist and production-telemetry decision;
9. evidence-expiry and exception policy; and
10. accountable owners for product, access, privacy/security, continuity,
    media, infrastructure cost, and external claims.

Record architectural decisions in [`DECISIONS.md`](../DECISIONS.md). Keep
rejected options and dated evidence in the baseline rather than presenting them
as shipped behavior.
