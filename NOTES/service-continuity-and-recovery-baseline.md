# Service continuity and recovery baseline

**Evidence snapshot:** 2026-09-04, Australia/Melbourne

**Repository baseline:** automation PR #557 after merging `origin/develop` at
`0452c7e8e`

**Scope:** the web frontend, Nitro API, MongoDB data plane, private object
storage, email, deployment control plane, connected providers, and the user
journeys that cross them. This is a repository and public-health-endpoint
review, not a production availability audit, penetration test, contractual SLA,
or claim that provider-side backups and incident processes do not exist.

## Why preserve this note

Thingtime already exposes several honest component-health signals and has
strong work in progress around migration compatibility, exact deployment
identity, bounded retries, and provider-specific fallback. Those pieces do not
yet answer the question a person actually cares about during failure:

> Can I still reach, understand, protect, and continue my important work—and if
> not, what is affected, what should I do, and how will Thingtime prove recovery?

The missing layer is a capability-level continuity contract joining user
outcomes, service objectives, safe degradation, data recovery, incident roles,
accessible communication, and learning. The related
[service continuity and recovery roadmap](../PLAN/service-continuity-and-recovery-roadmap.md)
sequences that work. The proposed execution backlog is
[TODO 28](../TODO/claude-todo/28-service-continuity-and-recovery.md).

## Evidence ledger

| Claim | Repository or live evidence | Confidence and refresh trigger |
| --- | --- | --- |
| Thingtime has separate frontend, Nitro, MongoDB, and Vercel health endpoints. | The routes under [`remix/app/routes/api/v1/health/`](../remix/app/routes/api/v1/health/) and their entries in [`apiDocs.ts`](../remix/app/docs/apiDocs.ts) expose component-specific checks rather than one undifferentiated ping. | High for this source snapshot. Re-read after health-route or API-doc changes. |
| Health checks are bounded and their remote target is constrained. | [`statusTarget.ts`](../remix/app/api/utils/health/statusTarget.ts) normalizes an allowlisted set of Thingtime, Vercel, and local origins and aborts remote checks after 3.5 seconds. | High for the current implementation. Re-test origin, redirect, DNS, timeout, and error-projection behavior before expanding targets. |
| Frontend health proves a reachable shell, not a complete user journey. | [`health/frontend`](../remix/app/routes/api/v1/health/frontend/_frontend.tsx) checks HTTP success plus a root-shell marker or Thingtime text. It does not authenticate, read a Thing, perform a write, fetch an attachment, or verify another dependency. | High for the code. Do not interpret `ready` as end-to-end availability. |
| MongoDB health is a fresh, sanitized connectivity probe. | [`mongodb/status.ts`](../remix/app/api/utils/mongodb/status.ts) opens a bounded client, pings, counts collections, reports replica-set presence, strips credentials from the host, and closes the client. | High for the code. It proves reachability at one moment, not transaction correctness, durability, restore readiness, or all user operations. |
| Nitro health now carries one critical readiness dependency. | [`health/nitro`](../remix/app/routes/api/v1/health/nitro/_nitro.tsx) reports `degraded` when account storage ledgers require migration. [`PR #601`](../PRs/601-codex-fix-image-upload-migrations--storage-migration-readiness.md) records the production upload incident that motivated the change. | High for the current branch. Re-run after storage-accounting or health-contract changes. |
| Migration safety has a strong, narrower invariant. | [`24-migration-safe-continuous-availability.md`](../TODO/claude-todo/24-migration-safe-continuous-availability.md) requires expand/coexist/migrate/verify/contract rollouts and forbids pending migrations from breaking established writes. | High for the owner-authored requirement. It does not replace broader outage, dependency, backup, incident, or communication planning. |
| Deployment automation preserves unusually precise receipts. | [`VERCEL_DEPLOYMENTS.md`](../VERCEL_DEPLOYMENTS.md) documents exact branch/environment routing, health probes, preview fences, webhook status, and separate production/develop data planes. CI records exact SHAs and terminal checks. | High for repository intent; every URL and check is time-sensitive. Verify exact refs and live endpoints for each release. |
| Geo-distribution is researched but not a shipped continuity layer. | [`geo-distribution.md`](../docs/architecture/geo-distribution.md) explicitly remains a proposal, recommends one logical source of truth, and stages replica and region work with rollback. | High for document status. Recheck topology, pricing, data residence, and provider capabilities before purchase or implementation. |
| Email contains a domain-specific continuity plan. | [`email-owned-architecture.md`](../docs/email-owned-architecture.md) proposes provider fallback, queue visibility, rollback, redundant MTAs, and backup recovery drills. | High for the plan, not proof of deployed redundancy. Keep email recovery within that stream-specific architecture. |
| User-controlled restore is already separated from platform recovery. | The [data portability and graceful-exit roadmap](../PLAN/data-portability-and-exit-roadmap.md) owns deterministic user archives, semantic restore, selective deletion, and closure, and explicitly distinguishes experience replay from account backup. | High for planning boundaries. Infrastructure restore must not silently become a user export contract or vice versa. |
| The reviewed public endpoints were healthy at the snapshot time. | At 09:06 AEST, `thingtime.com` and `dev.thingtime.com` returned ready frontend, Nitro, MongoDB, and Vercel bodies. MongoDB reported 2 ms in production and 1 ms in develop; develop exposed storage-accounting version 2 as ready. | High only for that instant. These samples are not an SLO, historical availability series, transaction proof, or backup test. |
| Recent `develop` automation was green for exact commits. | The latest visible `develop` runs for Web CI, Lopu CodeQL, preview publication, and PR management completed successfully through `0452c7e8e`. | High only for the queried run set. Re-query GitHub before any current-health claim. |
| No general continuity contract was found. | A scoped Graphify query plus searches across Markdown, health routes, deployment docs, migration planning, geo research, email architecture, and open issues found no canonical user-journey tiering, SLI/SLO registry, error-budget policy, RTO/RPO decision, general backup/restore runbook, incident severity/roles, public status contract, or post-incident action tracker. | High for this repository snapshot, not proof that no off-repository practice or provider feature exists. Ask the owner and infrastructure providers before implementation. |
| GitHub issues are not the reliability backlog. | GitHub returned zero open issues at the snapshot while the repository contains substantial TODOs and open PRs. | High only for the timestamp. Never infer the absence of user impact, operational debt, or external incidents from an empty issue list. |

## External design references

These are vocabulary and process inputs, not compliance claims and not a reason
to copy another organization's targets.

- [Google SRE service-level objective resources](https://sre.google/resources/book-update/slos/)
  connect user-relevant service indicators, objectives, and alerting. Thingtime
  should choose a small set of capability-level indicators and consequences,
  not publish aspirational percentages without measurement and ownership.
- [Google SRE postmortem practices](https://sre.google/workbook/postmortem-culture/)
  emphasize factual impact, recovery detail, ownership, actionable follow-up,
  and learning without personal blame. A template is useful only if actions are
  tracked to completion.
- [NIST SP 800-34 Rev. 1](https://csrc.nist.gov/pubs/sp/800/34/r1/upd1/final)
  provides a contingency-planning vocabulary spanning business impact,
  recovery priorities, strategies, testing, and maintenance. Use it as a risk
  checklist, not as a claim that a consumer web app must adopt federal process.

## The user-journey map to define

Component health is useful for diagnosis. Reliability gates should start with
the outcomes those components serve.

| Journey | Minimum continuity outcome | Candidate degraded behavior | Data-safety invariant |
| --- | --- | --- | --- |
| Sign in and recover access | Existing sessions remain valid where safe; a person can understand an auth outage and recover later. | Preserve local context, stop retry loops, offer a factual retry path; never bypass auth. | No token, session, OTP, passkey, email, or account-enumeration leak. |
| Open and search owned Things | Previously available, authorized content remains distinguishable from stale, unavailable, deleted, or forbidden. | Read-only cached state may remain visible with timestamp and origin if its privacy boundary is still valid. | Never cross account, endpoint, ACL, app namespace, or deletion boundaries. |
| Create, edit, comment, react, or save | Accepted writes are durable, idempotent, and visibly reconciled; rejected writes are explicit. | Queue only operations whose replay contract is approved; otherwise preserve the draft locally and explain the failure. | Never claim success before authoritative commit; retries cannot duplicate or orphan data. |
| Upload and retrieve private media | A person knows whether bytes were accepted, pending, failed, or unavailable. | Preserve local draft and bounded retry intent; existing safe metadata/text remains usable. | No cross-account object access, unbilled orphan, false deletion, or silent byte loss. |
| Message and receive notifications | Core conversation remains readable/writable when optional delivery channels fail. | In-app state remains authoritative while push/email becomes delayed or unavailable. | Never weaken membership, mute, block, privacy, or safety controls to improve delivery. |
| Export, restore, and close an account | User-controlled operations remain safe and their exact scope/status is inspectable. | Pause destructive continuation when authoritative dependencies are uncertain. | No partial closure presented as complete; no backup artifact becomes an access bypass. |
| Use apps, actions, AI, and external providers | First-party data remains usable when optional providers fail. | Disable or clearly mark only the dependent capability; preserve drafts and deterministic fallbacks where honest. | Never widen scopes, execute unconfirmed effects, expose secrets, or present canned/old output as fresh provider success. |

## Current strengths to preserve

- Separate health contracts make partial failure representable.
- Remote status checks are origin-scoped, time-bounded, and safely projected.
- Health payloads avoid credentials and private user content.
- Critical storage readiness now affects Nitro state instead of hiding behind a
  process-level `200`.
- Migration work favors idempotence, leases, censuses, explicit confirmation,
  and post-run verification.
- Preview and CI automation bind evidence to exact commits and environments.
- Data-plane and home-control-plane boundaries are explicit.
- Several write paths already use idempotency, transactional ledgers, bounded
  retries, reconciliation, and optimistic local state.
- The email and geo documents model gradual rollout, fallback, rollback, and
  evidence gates instead of one irreversible infrastructure switch.

## Gaps that block a trustworthy continuity claim

1. **No capability inventory or criticality decision.** Component names do not
   say which user outcomes are tier zero, which may degrade, and which optional
   dependency can fail independently.
2. **No owned SLI/SLO registry.** Ready bodies and green CI are snapshots; the
   repository does not define valid events, windows, exclusions, objectives,
   error-budget consequences, or accountable owners.
3. **No approved degraded-mode matrix.** Offline cache, local drafts, queued
   writes, read-only views, provider fallback, and feature disablement exist as
   local patterns, not one security-reviewed contract.
4. **No recovery-objective decision.** There is no repository-owned RTO/RPO or
   maximum-staleness decision by data/capability class. Invented numbers would
   be worse than an explicit owner decision gate.
5. **Backups are not restore evidence.** No general runbook proves a clean
   environment can restore data, rebuild indexes, reconcile ledgers, recover
   private objects, and pass semantic API invariants within an approved target.
6. **No general incident lifecycle.** Severity, incident command, technical and
   communication ownership, declaration, containment, update cadence, recovery,
   closure, security handoff, and action tracking are not one documented loop.
7. **No user-facing status contract.** The health APIs are developer surfaces;
   the repository does not define accessible, localized, capability-specific
   public updates or how to correct a mistaken status.
8. **Dependencies can hide correlated failure.** Vercel, Atlas, S3, email,
   DNS, GitHub, AI providers, and connected services need distinct ownership,
   failure modes, quotas, region assumptions, and fallback limits.
9. **Reliability cost is not tied to sustainable scope.** Multi-region compute,
   replicas, longer retention, restore environments, and staffed response have
   real cost. Reliability promises must be fundable and capacity-backed.
10. **No learning closure.** Repository PR notes capture many incidents well,
    but there is no common threshold, template, action owner, due date, repeat-
    incident check, or explicit decision to accept residual risk.

## Candidate reliability objects

Names and storage remain provisional until the owner decides. Most can begin as
versioned Markdown and CI configuration; no new database kind is implied.

| Object | Purpose | Boundary |
| --- | --- | --- |
| Capability catalog | User journey, dependencies, owner, criticality, allowed degradation, and data-safety invariants. | Generated from or cross-checked against canonical routes/capabilities; never hand-wave hidden dependencies. |
| SLO definition | Indicator, valid-event rules, target window, objective, exclusions, owner, and consequences. | No SLA language or public promise until measured, staffed, and explicitly approved. |
| Recovery profile | Data class, authoritative source, backup method, retention, RPO/RTO decision, restore sequence, and verification suite. | Contains no credentials, private payloads, provider secrets, or destructive command shortcuts. |
| Incident record | Impact, timeline, detection, decisions, recovery, communication, evidence limits, and action items. | Factual and blameless; public projection excludes exploit detail, private users, credentials, and sensitive provider evidence. |
| Exercise receipt | Exact scenario, environment, source version, start/end, observations, failures, actions, and approver. | A tabletop is not a restore; a component ping is not a journey; stale receipts expire. |

## Failure and abuse map

| Risk | Design implication |
| --- | --- |
| Health endpoint is green while writes fail | Measure complete user journeys and authoritative post-write reads; keep component probes for diagnosis only. |
| Retry storm deepens an outage | Bound retries, add jitter/backoff and budgets, respect idempotency, and shed optional work before critical paths. |
| Offline queue replays stale authority | Reauthorize and revalidate account, endpoint, ACL, app scope, version, and confirmation at replay time. |
| Cached private data crosses identity boundaries | Partition cache by account, endpoint, namespace, and permission state; purge on logout/revoke/delete where required. |
| Backup exists but restore is unusable | Restore into an isolated environment and verify semantic API invariants, indexes, ledgers, objects, and deletions on a schedule. |
| Recovery overwrites newer valid writes | Fence authority, compare source/version/time, rehearse point-in-time selection, and require an explicit destructive approval. |
| Status communication leaks security detail | Publish affected capability, impact, workaround, and safe cadence; keep exploit and private evidence in the approved restricted process. |
| Optimistic UI claims a lost write succeeded | Distinguish provisional, committed, failed, and reconciled states; never silently discard a local draft. |
| Automation becomes a dangerous recovery actor | Use least privilege, exact targets, dry runs, immutable receipts, two-person approval for destructive production steps, and tested rollback. |
| One operator becomes the continuity plan | Prefer automation and documented handoff, but do not promise 24/7 response until rotations and backups are genuinely staffed. |
| Public reliability percentage hides vulnerable cohorts | Report journey and region/device/accessibility/provider slices above privacy-safe minimums; do not average away a severe class. |
| Reliability investment becomes surveillance | Use bounded aggregate operational events; exclude Thing content, search text, messages, contact graphs, tokens, full URLs, and private identifiers. |

## Candidate measures

Definitions, targets, cohorts, and consequences require approval before
collection or publication.

| Measure | Candidate definition | Guardrail |
| --- | --- | --- |
| Journey success | Eligible attempts that complete the authoritative user outcome within its approved latency bound. | Keep availability, correctness, durability, and latency separately visible. |
| Durable write confirmation | Accepted writes that remain readable through the same authorized API after the verification interval. | No payload content in metrics; retries and reconciliation count once. |
| Safe degradation coverage | Critical failure scenarios with an approved, tested user-visible degraded state. | A bypass of auth, consent, quota, moderation, or deletion is always a failure. |
| Detection quality | User-affecting incidents detected by owned signals before support/manual discovery. | Avoid paging on internal noise that has no user impact; preserve human reports as evidence. |
| Recovery performance | Incidents or exercises restored and semantically verified within the approved profile. | Do not publish an RTO/RPO result without exact scope, timestamp, source, and limitations. |
| Communication quality | Incidents with timely, accessible, capability-specific updates and an explicit recovery confirmation. | No private identifiers, blame, uncertain attribution, or unsafe security detail. |
| Repeat-incident rate | Material incidents recurring after a completed prevention action. | Track systemic class and evidence, not individual blame. |
| Exercise freshness | Critical capabilities whose failover/restore receipt is within the approved interval. | A tabletop, backup job, and real restore remain distinct receipt types. |

## Open questions

1. Which three user journeys are truly critical for the first continuity slice?
2. What can safely remain readable when auth, MongoDB, S3, email, or an external
   provider is partially unavailable?
3. Which writes may queue, which must remain local drafts, and which must fail
   closed because replay could violate authority or safety?
4. What evidence and staffing are required before naming an SLO, support window,
   update cadence, RTO, or RPO?
5. Are provider backups enabled, retained, encrypted, isolated, and restorable?
   What important state sits outside their scope?
6. How are MongoDB data, S3 object versions, identity/control-plane state,
   external provider state, secrets, DNS, and deployment configuration aligned
   to one safe recovery point?
7. Which incident states and fields may be public, account-only, operator-only,
   security-restricted, or legal-restricted?
8. Who may declare, command, communicate, approve destructive recovery, close,
   and accept residual risk for an incident?
9. How will status and recovery paths work for keyboard, screen-reader, reduced-
   motion, low-bandwidth, offline, and supported-language users?
10. What monthly reliability cost and response load can the current product
    honestly sustain before broader adoption?

## Refresh checklist

Before changing any continuity milestone to validated or shipped:

1. fetch the current integration branch and inspect exact health, capability,
   data, storage, deployment, and migration contracts;
2. verify exact-head CI, deployment, and public health endpoints without
   equating them with historical SLO attainment;
3. ask the owner for off-repository provider backup, monitoring, support,
   incident, and staffing evidence without copying secrets or private data;
4. execute the approved failure, degraded-mode, restore, and rollback scenarios
   in isolated environments through the real APIs and user journeys;
5. verify security, privacy, accessibility, localization, data-integrity, and
   cost evidence beside availability; and
6. date every receipt, limitation, open action, and accepted residual risk.
