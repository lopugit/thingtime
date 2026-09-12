# Service continuity and recovery roadmap

**Status:** Proposed · owner decision required

**Prepared:** 2026-09-04, Australia/Melbourne

**Evidence:**
[Service continuity and recovery baseline](../NOTES/service-continuity-and-recovery-baseline.md)

**Execution backlog:**
[TODO 28 — Service continuity and recovery](../TODO/claude-todo/28-service-continuity-and-recovery.md)

**Related:** [Trustworthy adoption](./trustworthy-adoption-roadmap.md),
[data portability and graceful exit](./data-portability-and-exit-roadmap.md),
[accessibility and language readiness](./accessibility-and-language-readiness-roadmap.md),
[community safety and accountable moderation](./community-safety-and-accountable-moderation-roadmap.md),
[trusted developer ecosystem](./trusted-developer-ecosystem-roadmap.md),
[migration-safe continuous availability](../TODO/claude-todo/24-migration-safe-continuous-availability.md),
[geo-distribution research](../docs/architecture/geo-distribution.md), and the
[owned email architecture](../docs/email-owned-architecture.md)

## Outcome

People can keep doing the safest useful thing during partial failure, understand
what is affected, preserve local work without false success, and trust that
Thingtime can restore authoritative service and data from tested procedures.
Operators can detect user impact, coordinate recovery, communicate factually,
learn without blame, and fund honest reliability targets without collecting
private product behavior.

## Non-goals

- Publishing an SLA, uptime percentage, support promise, recovery time, or data-
  loss target before it is measured, staffed, affordable, and owner-approved.
- Treating HTTP 200, a green deployment, a successful backup job, a replicated
  database, or a passing tabletop as end-to-end continuity proof.
- Weakening authentication, authorization, consent, storage accounting,
  moderation, deletion, or capability checks to make an outage look smaller.
- Building a second telemetry data plane or collecting Thing content, search
  text, messages, contacts, credentials, tokens, full URLs, or person-level
  activity for reliability reporting.
- Duplicating the storage-migration invariant, user-controlled export/restore,
  community-safety process, app incident lifecycle, email architecture, or geo-
  distribution design owned by adjacent documents.
- Promising a 24/7 human response until a sustainable rotation and backup
  coverage genuinely exist.

## Operating principles

1. **User outcomes define reliability.** Component health diagnoses; a complete
   authorized journey decides whether the service worked.
2. **Safety outranks availability theater.** Fail closed when authority,
   durability, deletion, or destructive intent is uncertain.
3. **Degrade narrowly.** Keep unaffected first-party capabilities useful while
   isolating the failed dependency and clearly marking stale or provisional
   state.
4. **Never lose the draft silently.** Preserve local work where safe and state
   whether it is local, queued, committed, failed, or reconciled.
5. **Restore is a tested semantic outcome.** Backup presence is not success;
   real APIs must prove identities, permissions, data, objects, indexes,
   ledgers, deletion, and capability contracts after recovery.
6. **Communicate facts, not certainty theater.** Name affected capabilities,
   known impact, safe workarounds, update cadence, and verified recovery while
   protecting sensitive evidence.
7. **Learn systemically.** Incident actions change automation, architecture,
   tests, or process; they do not blame the person nearest the trigger.
8. **Promise only funded capacity.** Objectives, redundancy, retention,
   environments, and response coverage have explicit owners and cost.

## Capability tiers to decide

These tiers are proposed discussion anchors, not approved priority or SLA.

| Tier | Candidate capabilities | Continuity posture |
| --- | --- | --- |
| Data safety | Authorization, accepted-write durability, deletion/closure fences, session revocation, storage accounting | Never trade correctness or authority for availability; recovery evidence is mandatory. |
| Core use | Sign in, open/search owned Things, create/edit basic Things, core messaging | Prefer narrow read-only/local-draft degradation; preserve exact state and recovery guidance. |
| Rich media and delivery | Attachments, thumbnails, push, email, previews | Core text/data remains usable where safe; show precise pending/delayed/unavailable state. |
| Optional intelligence and integrations | AI, external providers, app ecosystems, background ranking/sync | Isolate dependency failure; deterministic fallback only when honest and clearly labeled. |
| Operator and developer surfaces | Admin, migrations, deployment, diagnostics, sandbox | Fail closed, retain receipts, and never expose privileged recovery paths to ordinary clients. |

## Milestones

### M0 — Approve the continuity contract

**Outcome:** one small, honest scope with named owners and no invented targets.

- Choose the first three user journeys and map every authoritative dependency,
  data class, side effect, and user-visible state.
- Assign product, service, data-recovery, incident-command, communication,
  security/privacy, accessibility/language, and cost owners plus backups.
- Approve capability tiers and the distinction between unavailable, degraded,
  stale, local-only, queued, committed, reconciled, and recovered.
- Decide which operations may degrade, queue, preserve drafts, retry, or fail
  closed. Require replay-time authorization and idempotency for any queue.
- Inventory current provider monitoring, backup, retention, region, support,
  and incident features without copying secrets into the repository.
- Define the first decision method for SLOs and recovery objectives. Leave
  targets explicitly unset until baseline evidence exists.
- Record accepted architectural or policy forks in `DECISIONS.md`.

**Gate:** no public reliability promise, new telemetry store, destructive
exercise, or infrastructure purchase until the packet is approved.

### M1 — Measure complete journeys

**Outcome:** operators can distinguish component reachability from real user
success and page only on actionable impact.

- Create one versioned capability catalog generated from or cross-checked
  against canonical routes, feature manifests, dependencies, and public docs.
- Define a small SLI set per selected journey: availability, correctness,
  durability, and latency only where each changes a decision.
- Specify valid events, exclusions, windows, minimum cohorts, data source,
  aggregation, retention, deletion, access, and owner for every signal.
- Reuse health endpoints and existing control-plane receipts for diagnostics;
  add synthetic real-API journeys only where they can use isolated accounts and
  non-sensitive fixtures.
- Add multi-window alerts and ticket thresholds tied to user impact and a named
  response. Avoid alerts that cannot change an action.
- Establish a baseline before proposing objectives. Review region, device,
  accessibility, endpoint, and dependency slices above privacy-safe minimums.
- Keep reliability events bounded, aggregate, redacted, purpose-limited, and
  outside customer content. Decide storage in `DECISIONS.md` before code.

**Gate:** each alert maps to a user impact, an owner, a playbook, and a tested
safe action; the selected journeys have enough baseline data to propose targets.

### M2 — Make partial failure safe and understandable

**Outcome:** a dependency outage removes the smallest possible capability and
never creates false success or a security bypass.

- Write the degradation matrix for auth, MongoDB, S3, email, DNS/Vercel, AI,
  GitHub, and external connections across the selected journeys.
- Partition cached state by account, active endpoint, app namespace, ACL, and
  permission generation. Test logout, switch, revoke, delete, and endpoint
  changes while offline or stale.
- Give writes explicit local-draft, queued, committed, failed, and reconciled
  states. Preserve drafts where safe; never acknowledge an authoritative write
  before commit.
- Queue only approved idempotent operations. Revalidate auth, scope, target,
  version, confirmation, quota, and moderation at replay time.
- Bound timeout, retry, backoff, jitter, concurrency, and circuit behavior by
  dependency and request budget. Shed optional work before core paths.
- Keep first-party data and basic composition useful when optional media,
  email, AI, integration, ranking, or preview services fail.
- Use Lopu for actionable user-facing errors, with accessible non-color state,
  keyboard and screen-reader paths, low-bandwidth copy, and approved languages.
- Add deterministic failure injection and real browser/API checks for every
  supported state before promotion.

**Gate:** the selected journey matrix passes without cross-account disclosure,
duplicate/lost writes, false success, retry storms, inaccessible recovery, or a
weakened safety boundary.

### M3 — Prove backup, restore, and rollback

**Outcome:** Thingtime can recover authoritative state in an isolated
environment and demonstrate semantic correctness within approved objectives.

- Inventory MongoDB generations, point-in-time history, private S3 objects and
  versions, identity/control-plane state, email queues/templates/suppressions,
  configuration, DNS/deployment metadata, and external irrecoverable state.
- Define per-class authority, backup method, encryption, access, retention,
  location/region, legal/deletion interaction, RPO/RTO candidate, and owner.
- Reconcile cross-system recovery points so database rows, object versions,
  quota ledgers, deletion intents, and external side effects cannot silently
  disagree.
- Restore into a clean isolated account/environment. Never use production as a
  destructive rehearsal target.
- Verify through the real API: authentication, authorization, canonical Things,
  relationships, searches, transactions, indexes, ledgers, attachments,
  deletion/closure fences, capability manifest, and critical journeys.
- Exercise incomplete backup, corrupt artifact, missing object, wrong point in
  time, partial migration, interrupted restore, and rollback. Fail closed and
  preserve evidence.
- Keep user-controlled export and semantic import within the portability
  roadmap; cross-test boundaries without pretending one mechanism replaces the
  other.
- Produce an expiring exercise receipt with exact source, target, versions,
  timings, limitations, unresolved gaps, and approvals.

**Gate:** the first critical recovery profile meets owner-approved semantic,
security, deletion, and timing criteria twice from clean environments.

### M4 — Operate and communicate incidents

**Outcome:** a small team can coordinate real incidents without heroics,
conflicting authority, silence, or unsafe disclosure.

- Define severity from user/data/safety impact, not provider labels or raw
  error count.
- Assign one incident commander, technical lead, communications lead, scribe,
  and security/privacy escalation, with named backups and handoff rules.
- Create concise playbooks for auth, data, object storage, deployment/DNS,
  delivery, integration/AI, security, and restore incidents.
- Define declaration, containment, update, escalation, recovery, verification,
  closure, and residual-risk acceptance states.
- Establish an accessible public/account status contract naming affected
  capabilities, impact, safe workaround, next update, and verified recovery.
  Keep private-user, credential, exploit, and unverified-cause detail out.
- Preserve an immutable internal timeline of decisions and evidence with least-
  privilege access and bounded retention.
- Use a factual, blameless learning review with one owner and prioritized,
  testable actions. Link every action to TODO/issue/PR and verify completion.
- Run tabletop and communication exercises separately from technical restore
  drills; receipt type must make the distinction obvious.

**Gate:** two exercises complete with clear command, accessible communication,
safe escalation, exact recovery verification, and tracked actions; no target is
published beyond staffed coverage.

### M5 — Add dependency and regional resilience by evidence

**Outcome:** redundancy addresses measured user risk instead of adding
unverified cost and correlated complexity.

- Build a dependency register with contract, owner, quota, region, data class,
  timeout, retry, fallback, support path, failure modes, and exit strategy.
- Test provider quota exhaustion, latency, partial response, stale webhook,
  duplicate delivery, regional failure, credential revocation, and full outage.
- Use the existing email architecture for queue/fallback/redundancy and the geo
  proposal for database/function topology; do not fork either design here.
- Recheck data residence, replication lag, transaction authority, uniqueness,
  cache behavior, cost, and provider plan gates before regional expansion.
- Canary one reversible change, verify from each relevant region, and rehearse
  removal/failback before expanding.
- Preserve one logical source of truth and explicit write authority. Redundancy
  that can split identity, permissions, ledgers, or deletion is not resilience.

**Gate:** each added dependency or replica measurably reduces an approved risk,
passes failover and failback, stays within cost, and does not create a new
unowned data or authority boundary.

### M6 — Make reliability a sustainable release gate

**Outcome:** continuity evidence stays current as features, traffic, people,
and providers change.

- Schedule bounded synthetic journeys, restore drills, failover/failback,
  access reviews, alert reviews, and status exercises by capability tier.
- Expire stale receipts and objectives automatically; absence of a fresh proof
  is visible, not silently treated as green.
- Track error-budget consequences: pause risky rollout, repair the failing
  journey, reduce scope, or explicitly accept residual risk with owner/date.
- Review incident actions and repeat classes in release planning. An unresolved
  P0/P1 data-safety action blocks broader adoption or the dependent release.
- Report reliability, correctness, durability, accessibility, privacy,
  security, safety, support load, and cost together. No aggregate score hides a
  failed class.
- Fund objectives through aligned hosting/support value; baseline safety,
  truthful status, export/delete, and recovery are never premium-only.

**Gate:** two review cycles show current exercises, closed critical actions,
objectives within approved bounds, sustainable response load, and no hidden
cohort or dependency regression.

## Proposed decision and measure registry

| Decision or measure | Required fields | Consequence |
| --- | --- | --- |
| Capability tier | Journey, dependency graph, owner, data class, allowed degradation | Determines test, alert, communication, and exercise depth. |
| SLI/SLO | Indicator, valid/invalid event, window, baseline, objective, owner, exclusions, privacy, consequence | A breach changes rollout or repair priority; it is not decorative reporting. |
| Recovery profile | Authority, backup scope, retention, RPO/RTO, restore steps, semantic checks, approvers | An expired or failed receipt blocks claims and the dependent expansion. |
| Incident severity | User/data/safety impact, scope, duration, workaround, escalation | Determines roles, cadence, evidence handling, review, and action priority. |
| Error budget | SLO, measurement window, remaining budget, exception owner/date | Exhaustion pauses the approved risky work or requires an explicit residual-risk decision. |

## Security, privacy, accessibility, and abuse requirements

- Health, SLI, incident, and exercise records never contain credentials,
  tokens, cookies, secret names with values, Thing content, search text,
  messages, contacts, raw private identifiers, full sensitive URLs, or broadly
  reusable recovery instructions.
- Public status is a narrow projection. Security evidence, exploit detail,
  vulnerable versions, private users, provider case data, and legal material
  stay in separately authorized channels.
- Recovery automation has least privilege, exact targets, dry-run/preflight,
  idempotency, bounded work, immutable receipts, and explicit approval for
  destructive production actions.
- Backup and restore access is audited and tested; restored environments are
  isolated, credential-rotated where required, and securely disposed after the
  approved evidence window.
- Cached and queued state is partitioned and reauthorized. Offline convenience
  never becomes an ACL, app-scope, account, endpoint, quota, confirmation, or
  deletion bypass.
- All new external endpoints remain route-registered, API-documented,
  semantically versioned in the capability manifest, and negotiated by clients.
- Status, outage, stale, local-only, queue, conflict, and recovery states are
  understandable without color, motion, hover, jargon, or a single language.
- Reliability metrics use the minimum detail needed for an operational
  decision, aggregate above approved cohort bounds, expire, and support tested
  deletion. Product surveillance is not resilience.
- Incident culture is factual and blameless while retaining explicit decision
  and action ownership. Harassment, public speculation, and blame are not
  transparency.

## Acceptance criteria

- The first journeys, tiers, owners/backups, degradation states, evidence
  boundary, and target-setting process are approved and linked from the
  roadmap and decision log.
- A versioned capability catalog maps every selected journey to canonical API
  features, dependencies, owners, failure states, and data-safety invariants.
- Each SLI has exact valid-event logic, window, exclusions, data source,
  retention, access, privacy, owner, and consequence; objectives use measured
  baselines and are not mislabeled as SLAs.
- Component probes and full synthetic journeys remain separate. A green shell,
  process, database ping, deployment, or CI run cannot mark a failed journey
  healthy.
- Every approved degraded mode passes real-API and live desktop/mobile checks,
  including offline/stale, account switch, custom endpoint, keyboard, screen
  reader, reduced motion, low bandwidth, and supported locales.
- Accepted writes are never silently lost or duplicated; provisional, local,
  queued, committed, failed, reconciled, and recovered states are exact.
- Backup scope and gaps are inventoried. A clean isolated restore passes
  authorization, data, relation, search, index, ledger, attachment, deletion,
  capability, migration, and critical-journey checks within approved targets.
- Restore, rollback, failover, and failback receipts bind exact source/target,
  versions, times, results, limitations, actions, and approvers and expire on an
  approved schedule.
- Incident severity, roles, handoff, escalation, communication, security
  boundary, closure, learning review, action ownership, and residual-risk
  acceptance work in exercises and a real incident when one occurs.
- Public/account status is capability-specific, accessible, correctable, and
  free of private or security-sensitive detail.
- Dependency and regional work proves measured risk reduction, one source of
  truth, write authority, data residence, failover/failback, and sustainable
  cost before expansion.
- Metrics exclude private content and person-level behavior, keep failure
  classes separate, and can be disabled/deleted without breaking core use.
- Reliability work never weakens auth, consent, quota, moderation, privacy,
  deletion, portability, accessibility, or capability negotiation.

## Risks and contingency paths

| Risk | Early signal | Response |
| --- | --- | --- |
| Objectives become marketing promises | Percentages appear before baseline, owner, consequence, or staffed response | Remove the claim; return to internal candidate objectives and evidence gathering. |
| Monitoring optimizes components, not users | Green probes coexist with failed writes, attachments, auth, or search | Promote journey checks; keep component probes diagnostic. |
| Retry/degradation weakens correctness | Duplicate writes, stale authority, false success, cross-account cache, or hidden failure | Disable the path, preserve drafts, fail closed, and repair the contract before re-enable. |
| Restore exercise threatens production | Broad target, ambiguous source, missing fence, or unreviewed destructive step | Stop; move to a clean isolated environment and require exact approval. |
| Incident work depends on heroics | One person holds credentials/context or updates indefinitely | Reduce promises, document and automate, assign backups, and fund coverage before growth. |
| Redundancy adds correlated complexity | Failover cannot fail back, replicas drift, or costs obscure benefit | Roll back the reversible stage and fix the single-region path first. |
| Public transparency becomes unsafe | Unverified cause, private detail, or exploit path enters status copy | Retract/correct quickly; move sensitive evidence to the approved restricted channel. |
| Metrics become surveillance | Requests for payloads, queries, full URLs, contacts, or person-level timelines | Stop collection and answer with bounded synthetic, aggregate, or sampled evidence. |

## Concrete next action

Prepare one owner decision packet containing:

1. the first three user journeys and proposed capability tiers;
2. owners and backups for service, data recovery, incident command,
   communication, security/privacy, accessibility/language, and cost;
3. the state vocabulary and degradation/queue/fail-closed matrix;
4. current provider monitoring/backup/retention/support evidence and known gaps;
5. candidate SLIs plus a baseline period, with targets deliberately unset;
6. the first isolated restore exercise and semantic verification checklist;
7. incident severity, roles, public/private communication projections, and
   learning-action lifecycle; and
8. staffing, monthly cost ceiling, stop conditions, and decisions to record.

Do not begin M1, publish targets, or run a destructive recovery exercise until
that packet is approved.
