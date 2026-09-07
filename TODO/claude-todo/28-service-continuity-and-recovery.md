# 28 — Service continuity and recovery

**Status:** 🟣 Proposed · owner decision needed

**Added:** 2026-09-04, Australia/Melbourne

**Owner:** Unassigned; product owner must appoint service, recovery, incident,
communication, security/privacy, accessibility/language, and cost owners plus
backups

**Evidence:**
[`NOTES/service-continuity-and-recovery-baseline.md`](../../NOTES/service-continuity-and-recovery-baseline.md)

**Plan:**
[`PLAN/service-continuity-and-recovery-roadmap.md`](../../PLAN/service-continuity-and-recovery-roadmap.md)

## Goal

Make Thingtime's critical user journeys measurable, safely degradable, and
recoverable. During partial failure, people keep the narrowest safe useful
capability, understand the state of their work, and never receive false success.
After failure, operators restore authoritative service and data from tested
procedures, communicate factually, and close prevention actions.

## Problem

Thingtime has component health endpoints, exact deployment/CI receipts,
migration-safety rules, transactional/idempotent paths, and stream-specific
fallback plans. It does not yet have one owner-approved contract for:

- critical user journeys and dependency tiers;
- SLI/SLO definitions and consequences;
- safe degraded, stale, local-only, queued, failed, and reconciled states;
- recovery objectives and cross-system backup scope;
- isolated semantic restore drills;
- incident severity, command, communication, security boundaries, and closure;
- action tracking, repeat-incident prevention, staffing, and cost.

This epic creates that contract. It does not authorize telemetry, public
availability promises, destructive production drills, infrastructure purchases,
or new database kinds by itself.

## Dependencies and boundaries

- [`FUNDAMENTALS.md`](../../FUNDAMENTALS.md) and
  [`DECISIONS.md`](../../DECISIONS.md) remain authoritative: one API gateway,
  one logical source of truth, versioned collections, relational child data,
  revocable auth, and Lopu notifications.
- [Migration-safe continuous availability](./24-migration-safe-continuous-availability.md)
  owns expand/coexist/migrate/verify/contract behavior and the rule that pending
  migrations cannot break established capabilities. This epic tests that rule
  inside broader journey and recovery exercises.
- [Data portability and graceful exit](./23-data-portability-and-exit.md) owns
  user-controlled deterministic export, semantic import, selective deletion,
  and account closure. Provider backup/restore is not a substitute.
- [Accessibility and language readiness](./25-accessibility-and-language-readiness.md)
  owns the shared journey matrix, locale semantics, and release-quality gates
  used by status and recovery surfaces.
- [Community safety and accountable moderation](./26-community-safety-and-accountable-moderation.md)
  owns personal boundaries, reports, moderation cases, appeals, remedies, and
  public safety transparency. Service incidents do not create a parallel
  sanction process.
- [Trusted developer ecosystem](./27-trusted-developer-ecosystem.md) owns app
  release, review, consent-update, quarantine, vulnerability, abandonment, and
  ecosystem incident states. This epic owns shared service dependencies and
  coordinates rather than replaces that lifecycle.
- [`geo-distribution.md`](../../docs/architecture/geo-distribution.md) owns
  proposed multi-region database/function topology. Reliability requirements
  may gate it but must not invent another regional architecture.
- [`email-owned-architecture.md`](../../docs/email-owned-architecture.md) owns
  delivery queues, provider fallback, MTA redundancy, and mail recovery.
- Open PRs, public health results, provider dashboards, backups, and CI runs are
  time-sensitive evidence. Recheck exact source, scope, and limitations before
  using them in a decision.

## Phase 0 — Owner decision packet

- [ ] Select the first three critical journeys. Recommended: sign in and open
      an owned Thing; create/edit then authoritative reread; upload then retrieve
      one private attachment.
- [ ] Map frontend, Nitro, home/data MongoDB, S3, email, DNS/Vercel, auth,
      optional AI/integration, and operator dependencies for each journey.
- [ ] Assign primary and backup owners for product, service, data recovery,
      incident command, communication, security/privacy, accessibility/language,
      and cost.
- [ ] Approve capability tiers and state vocabulary: unavailable, degraded,
      stale, local-only, queued, committed, failed, reconciled, and recovered.
- [ ] Decide which operations may read stale state, preserve drafts, queue,
      retry, fall back, or fail closed. Queueing requires replay-time authority,
      version, idempotency, quota, confirmation, and safety checks.
- [ ] Inventory provider monitoring, backups, retention, regions, support, and
      current continuity procedures. Record gaps, not credentials or private
      dashboard payloads.
- [ ] Approve the SLI baseline method and recovery-objective decision process.
      Leave objective values unset until evidence supports them.
- [ ] Choose a non-production restore target and require explicit approval for
      every destructive step.
- [ ] Set staffing and monthly cost ceilings plus automatic stop conditions.
- [ ] Record accepted forks in `DECISIONS.md`.

**Gate:** no new telemetry, public promise, destructive drill, or reliability
purchase before approval.

## Phase 1 — Capability catalog and journey evidence

- [ ] Define one versioned capability catalog: journey, canonical routes and
      semantic feature ids, dependencies, owner, tier, data class, failure
      states, allowed degradation, and safety invariants.
- [ ] Generate or mechanically cross-check catalog route/feature references
      against the API docs registry, runtime route map, and capability manifest.
- [ ] Define the minimum SLI set for each selected journey, including exact
      numerator, denominator, valid/invalid events, window, exclusions,
      aggregation, retention, access, deletion, owner, and consequence.
- [ ] Keep component probes separate from full journey checks. A shell fetch,
      process health, database ping, deployment state, or green CI run cannot
      prove a complete outcome.
- [ ] Run synthetic journeys through the real API with isolated accounts and
      non-sensitive fixtures. No direct MongoDB seeding or test-only bypass.
- [ ] Add actionable page/ticket thresholds tied to user impact, an owner, and
      a tested playbook. Bound cardinality and never include private payloads.
- [ ] Collect a baseline before proposing SLO percentages, RTO, RPO, update
      cadence, or external promise.

## Phase 2 — Safe degradation and write truth

- [ ] Create the failure/degradation matrix for every selected journey and
      dependency, including timeout, quota, partial response, stale webhook,
      credential revocation, regional failure, and outage.
- [ ] Partition cached and local-draft state by account, active data endpoint,
      app namespace, ACL/permission generation, and schema/version boundary.
- [ ] Test logout, account switch, endpoint switch, revoke, delete, and closure
      while offline, stale, or recovering.
- [ ] Represent local-only, queued, committed, failed, reconciled, and recovered
      writes explicitly. Never discard a draft or report a commit silently.
- [ ] Reauthorize and revalidate every queued replay. Prove retries cannot
      duplicate, reorder, overwrite newer work, exceed quota, bypass
      confirmation, or resurrect deleted/revoked state.
- [ ] Bound timeout, retry, exponential backoff/jitter, concurrency, and circuit
      budgets. Shed optional provider work before critical first-party paths.
- [ ] Keep safe core data/text paths available when attachments, email, AI,
      previews, ranking, or external integrations fail independently.
- [ ] Surface actionable states through Lopu and pass desktop/mobile, keyboard,
      screen-reader, reduced-motion, low-bandwidth, and approved-locale checks.

## Phase 3 — Recovery profiles and clean restore

- [ ] Inventory all authoritative and derived state: current and stale MongoDB
      generations, private objects/versions, quota ledgers, deletion intents,
      email state, configuration, DNS/deployment metadata, and external state.
- [ ] For each class record authority, backup scope/method, encryption, access,
      retention, region, deletion/legal behavior, owner, and candidate RPO/RTO.
- [ ] Identify irrecoverable or asynchronously replicated state and design
      explicit reconciliation or safe loss behavior.
- [ ] Restore into a clean isolated environment from an exact approved point.
      Production is never the destructive rehearsal target.
- [ ] Verify through canonical APIs: auth/revocation, ACLs, Things, relational
      children, search, transactions, indexes, ledgers, attachments, deletion
      and closure, migrations, capability manifest, and selected journeys.
- [ ] Exercise incomplete/corrupt backup, missing object, wrong point-in-time,
      partial migration, interrupted restore, and rollback/failback.
- [ ] Produce an expiring receipt with exact source/target, versions, timing,
      results, limitations, unresolved actions, and approvers.
- [ ] Repeat the critical restore from another clean environment before
      declaring the profile validated.

## Phase 4 — Incident command, communication, and learning

- [ ] Define severities from user, data, security, safety, accessibility, and
      geographic impact rather than provider status or raw error count.
- [ ] Define commander, technical lead, communications lead, scribe, security/
      privacy escalation, backups, handoff, and residual-risk approval.
- [ ] Write bounded playbooks for auth, MongoDB/data, attachments/S3,
      deployment/DNS, email/push, external/AI, security, and restore incidents.
- [ ] Define declaration, containment, update, escalation, recovery,
      verification, closure, correction, and post-incident states.
- [ ] Define public, account-only, operator-only, security-restricted, and
      legal-restricted projections. Public copy names capabilities, impact,
      safe workarounds, next update, and verified recovery—never private users,
      credentials, unverified blame, or unsafe exploit detail.
- [ ] Make status and recovery guidance accessible, low-bandwidth, and
      translatable without color, icon, motion, hover, or jargon alone.
- [ ] Preserve a bounded least-privilege incident timeline and a factual,
      blameless review with one owner and prioritized testable actions.
- [ ] Link actions to tracked TODOs/issues/PRs with owner/date/evidence. A review
      without completed prevention or an explicit residual-risk decision is not
      closed.
- [ ] Run tabletop, communication, degradation, restore, and failover exercises
      as distinct receipt types.

## Phase 5 — Dependency, regional, and release gates

- [ ] Maintain a dependency register with owner, contract, quota, region, data
      class, timeout, retry, fallback, support, incident route, and exit plan.
- [ ] Reuse and validate the email and geo plans rather than duplicating their
      topology. Recheck provider features, data residence, pricing, and support
      before each purchase.
- [ ] Canary each resilience change, prove exact source/version, measure from
      affected regions, and test failover plus failback before expanding.
- [ ] Preserve one logical source of truth and explicit write authority across
      every replica, region, deployment, endpoint, and recovery mode.
- [ ] Add continuity gates to release review: selected journey health, current
      exercise receipts, no unresolved P0/P1 data-safety action, and error-
      budget consequence.
- [ ] Review objectives, receipts, owners, provider assumptions, support load,
      and cost on an approved cadence; expire stale evidence visibly.
- [ ] Keep truthful status, baseline safety, export/delete, and tested recovery
      available regardless of paid tier.

## Security, privacy, accessibility, and abuse safeguards

- [ ] Reliability records use strict schemas, bounded values, least-privilege
      access, retention, tested deletion, and redacted public projections.
- [ ] Exclude credentials, tokens, cookies, private keys, secret values, Thing
      content, search text, messages, contacts, raw private identifiers, full
      sensitive URLs, and reusable destructive instructions.
- [ ] Recovery tooling uses exact targets, preflight/dry-run, idempotency,
      bounded work, immutable receipts, and explicit current approval for
      destructive production actions.
- [ ] Restored environments are isolated, access-audited, credential-rotated
      where needed, and securely disposed after the evidence window.
- [ ] Cached/queued state never crosses account, endpoint, ACL, app scope,
      schema, quota, moderation, confirmation, revoke, or delete boundaries.
- [ ] New/changed external endpoints receive route registration, API docs,
      deliberate semantic feature-version changes, manifest coverage, client
      requirement maps, and real built-server smoke checks.
- [ ] Status and recovery paths pass the canonical accessibility/language
      journey matrix before any public reliability claim.
- [ ] Aggregate failure classes remain separate. No score or broad percentage
      may hide data loss, security, privacy, accessibility, or cohort harm.
- [ ] Incident review is blameless but owned. Public transparency never becomes
      harassment, speculation, disclosure of private users, or unsafe security
      detail.

## Acceptance criteria

- [ ] The owner approves selected journeys, tiers, state vocabulary, owners and
      backups, target-setting process, recovery exercise, evidence boundary,
      staffing, cost, and stop conditions.
- [ ] The capability catalog is versioned and mechanically complete for the
      selected journeys against routes, docs, and semantic capabilities.
- [ ] Candidate SLIs have exact definitions and measured baselines before any
      SLO, RTO, RPO, cadence, or public promise is approved.
- [ ] Component probes and journey checks can disagree visibly; a failed journey
      is never averaged or relabeled healthy because components are green.
- [ ] Every supported degraded state passes real API and live desktop/mobile
      tests without false success, silent draft loss, retry storm, duplicate/
      lost write, stale authority, or boundary bypass.
- [ ] A clean isolated restore passes the full semantic verification checklist
      twice within approved targets, including deletion and private-object
      integrity, and leaves an exact expiring receipt.
- [ ] Rollback, failover, and failback preserve write authority, user data,
      indexes, ledgers, ACLs, revocation, deletion, and capability contracts.
- [ ] Two incident exercises prove command, handoff, accessible communication,
      security escalation, recovery verification, closure, and action tracking.
- [ ] Public/account status is capability-specific, timely within staffed
      targets, correctable, accessible, localized as approved, and free of
      private or unsafe detail.
- [ ] Provider/regional changes show measured risk reduction, tested failure,
      sustainable cost, and no new unowned data or authority boundary.
- [ ] Metrics are bounded, aggregate, privacy-safe, retention-limited, and
      deletable; disabling them does not break core functionality.
- [ ] Reliability cannot be purchased as a way around baseline security,
      privacy, safety, accessibility, export, deletion, or recovery rights.

## Stop conditions

Pause the dependent rollout or exercise when any of these occurs:

- the target, authority, recovery point, owner, approval, or rollback is
  ambiguous;
- a degraded or queued path can cross identity/permission boundaries, report
  false success, lose a draft, duplicate effects, or overwrite newer work;
- monitoring requires private content or person-level behavior not approved for
  the exact operational decision;
- public status would expose private users, credentials, vulnerable detail,
  unverified attribution, or a dangerous workaround;
- a restore cannot prove deletion, ACL, session, ledger, index, or object
  integrity through the canonical API;
- response coverage or provider/redundancy cost exceeds the approved capacity;
  or
- an unresolved critical incident action recurs or remains unowned.

## Concrete next action

Prepare and review the Phase 0 decision packet. Do not implement instrumentation
or publish reliability targets until it is accepted and the accepted forks are
recorded in `DECISIONS.md`.
