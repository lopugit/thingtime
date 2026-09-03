# Community safety and accountable moderation roadmap

**Status:** Proposed · owner decision required

**Prepared:** 2026-09-03, Australia/Melbourne

**Evidence:**
[Community safety and accountable moderation baseline](../NOTES/community-safety-and-accountable-moderation-baseline.md)

**Execution backlog:**
[TODO 26 — Community safety and accountable moderation](../TODO/claude-todo/26-community-safety-and-accountable-moderation.md)

**Related:** [Trustworthy adoption](./trustworthy-adoption-roadmap.md),
[attention agency](./attention-agency-roadmap.md),
[accessibility and language readiness](./accessibility-and-language-readiness-roadmap.md),
[anti-abuse storage hardening](../TODO/claude-todo/15-anti-abuse-storage-hardening.md),
and [anonymous group chats](../TODO/claude-todo/19-anonymous-group-chats.md)

## Outcome

People can reduce unwanted exposure immediately, report a specific safety
problem without surrendering unnecessary private data, understand what happens
next, and challenge a material decision. Community moderators and site admins
operate within explicit scopes, reasons, review boundaries, response targets,
and audit trails. Thingtime can learn from aggregate safety outcomes without
building a surveillance or retaliation system.

## Non-goals

- Claiming a legal-compliance, child-safety, or universally safe platform from a
  feature checklist.
- Sending all private messages or attachments to an external classifier.
- Letting report counts, reputation scores, or model verdicts automatically
  impose durable account sanctions.
- Publishing reporter, target, moderator, message, contact-graph, or
  small-community histories.
- Making baseline block, mute, report, appeal, or safety help a paid feature.
- Promising emergency response, law-enforcement coordination, or response times
  Thingtime cannot staff and verify.
- Combining product feedback, copyright/legal notices, security vulnerability
  reports, and interpersonal safety reports into one ambiguous queue.

## Layered safety contract

| Layer | Purpose | Authority boundary |
| --- | --- | --- |
| Personal controls | Mute, block, leave, revoke invitations, and restrict contact immediately. | The person controls their own experience; no misconduct finding is implied. |
| Community governance | Enforce published community rules within one community or channel. | Scoped moderators act only inside assigned communities; site-wide actions require escalation. |
| Platform policy | Decide visibility and account actions under Thingtime-wide rules. | Trained site moderators/admins with reasoned, audited decisions. |
| Automated assistance | Detect, prioritize, or temporarily quarantine supported content. | Models never define policy and cannot be the sole basis for durable high-impact sanctions. |
| Legal/urgent process | Route credible urgent or legally defined notices. | Separately approved workflow with qualified counsel/safety input and honest staffing. |

## Architecture direction to approve

Do not implement these names until the owner approves the contract. Whatever
names are chosen must follow [`FUNDAMENTALS.md`](../FUNDAMENTALS.md): protected
API writers, versioned physical collections through named getters, and
relational children rather than growing embedded arrays.

- **Safety boundary:** one protected relation per blocker/blocked account, with
  deterministic uniqueness, server-enforced semantics, and no target
  notification. Muting remains separate and reversible.
- **Report:** one protected record pointing at the exact target kind/id and
  target revision or fingerprint, reason version, reporter, community context,
  bounded free text, urgency choice, source surface, and idempotency key.
- **Case:** a protected case groups related reports without exposing report
  count as guilt. It carries policy version, jurisdiction/scope, priority,
  assignee, current state, response target, and access classification.
- **Case events:** assignments, evidence-access records, actions, reasons,
  communications, appeals, reversals, and closure are separate append-only
  child Things linked by `parentId`, batch-loaded by kind.
- **Appeal:** a protected relation to one decision, with a bounded statement,
  eligibility/window, independent reviewer where feasible, outcome, and remedy.
- **Evidence:** references and content fingerprints by default. Any copied
  public/private content needs a separately approved purpose, encryption,
  access log, retention, deletion/hold behavior, and redaction contract.
- **Projections:** reporter, target, community moderator, and site admin each
  receive explicit allowlisted views. Generic Thing reads never expose cases,
  evidence, identities, or internal notes.
- **Capabilities:** every new or changed external endpoint registers a semantic
  feature/version and compatibility tests in the origin-scoped capability
  manifest.

## Measures and release policy

Approve definitions, minimum sample sizes, suppression rules, and owners before
collection. Raw content and person-level safety histories are never product
analytics.

| Measure | Candidate definition | Guardrail |
| --- | --- | --- |
| Immediate-control success | Eligible block/mute/leave actions that take effect across the approved surface matrix without further unwanted exposure. | No target notification, identity leak, or cross-account cache bleed. |
| Report completion | Started eligible reports that receive a stable acknowledgement and safe status path. | Accessibility task success and abandonment are studied without capturing report text. |
| Time to first human disposition | Median and high-percentile time from actionable case creation to a reasoned human decision. | Publish only over minimum cohorts; urgent classes remain separately owned. |
| Decision quality | Sampled decisions that match the current policy and evidence after quality review. | A high agreement rate cannot hide severe misses or reviewer conflicts. |
| Appeal correction | Eligible appeals resulting in upheld, changed, or reversed decisions and the time to remedy. | Reversals improve policy/model/training; they are not used to punish reporters. |
| Repeat-harm rate | Approved aggregate recurrence after a completed intervention. | No public person/community ranking and no opaque “risk score.” |
| Queue health | Open actionable cases by age, class, and staffed capacity. | Launch gates respond to backlog; moderators are not incentivized to close without review. |
| Automation contribution | Share of suggestions accepted, changed, rejected, or unavailable by category/version. | Models are evaluated separately; one score cannot authorize broader scanning. |

## Milestones

### M0 — Approve policy, scope, and capacity

**Outcome:** safety terms mean the same thing before data or UI is added.

- Define personal control semantics across profiles, feeds, follows, message
  requests, invites, existing chats, shared communities, and APIs.
- Approve a short versioned community/platform rule taxonomy and distinguish
  interpersonal safety, illegal-content notices, security reports, product
  feedback, and intellectual-property processes.
- Choose initial reportable targets and which surfaces are explicitly out of
  scope. Recommend starting with public post/comment/profile and active chat
  message references, without automatic private-message scanning.
- Name policy, trust/safety, community operations, privacy/security,
  accessibility, legal, engineering, and incident owners.
- Set honest service hours, response targets, urgent escalation boundaries,
  appeal eligibility, and launch capacity.
- Approve evidence, access, retention, deletion, legal-hold, and transparency
  contracts before creating new data kinds.
- Record durable forks in [`DECISIONS.md`](../DECISIONS.md).

**Gate:** no report storage, automated expansion, or public safety promise until
the owner approves policy, roles, capacity, evidence boundaries, and stop
conditions.

### M1 — Give people immediate, quiet control

**Outcome:** a person can reduce exposure without waiting for adjudication.

- Implement one canonical account-level block relation and define effects on
  future DMs, requests, invitations, mentions, notifications, recommendations,
  profile visibility, existing conversations, and shared communities.
- Preserve per-chat mute as a separate, non-punitive control; explain the
  difference between mute, block, leave, remove, and report.
- Make block/mute/leave/revoke optimistic from last-known state, reconcile in
  the background, and surface failures through Lopu without revealing the
  other person's state.
- Add one safety/help entry point that remains usable when the target content is
  gone, pending, blocked, or inaccessible.
- Test account switching, custom endpoints, stale clients, revoked sessions,
  deep links, and mobile/keyboard/screen-reader paths.

**Gate:** the approved surface matrix blocks new unwanted contact with no target
notification, privilege change, hidden unblock, or cross-account leak.

### M2 — Build report intake and case integrity

**Outcome:** an acknowledged report becomes one bounded, traceable case.

- Add report endpoints and allowlisted projections for the selected targets.
  Enforce auth/eligibility, body caps, rate limits, idempotency, exact target
  resolution, and safe behavior after target edits/deletion.
- Use a small reason taxonomy with examples, an “other” route, optional bounded
  context, and a separate urgent-safety explanation. Do not force a person to
  diagnose law or policy.
- Store references/fingerprints rather than copying content by default. Log
  authorized evidence access as case events.
- Acknowledge receipt with a case reference, safe next steps, status vocabulary,
  and an honest response target. Do not expose enforcement details about other
  people.
- Deduplicate accidental retries while preserving distinct reporters and
  coordinated-harm evidence. Report count never decides the outcome.
- Integrate existing automated moderation flags as one evidence source without
  rewriting their original provider/model/verdict record.

**Gate:** concurrent retries converge, private evidence is least-privilege,
every state transition is attributable, and a reporter can retrieve an
allowlisted status.

### M3 — Add scoped community governance

**Outcome:** communities can apply their rules without gaining site-wide power.

- Decide whether `admin` remains both operator and moderator or whether a new
  scoped role is required. Prefer explicit least privilege over role inflation.
- Route community cases only to authorized moderators; hide unrelated DMs,
  communities, contact graphs, and platform-only evidence.
- Support reversible community actions such as content hide, channel removal,
  member timeout, invite freeze, member removal, and escalation, each with a
  policy reason and expiry where applicable.
- Define owner conflicts, moderator self-recusal, appeals against an owner,
  community abandonment/transfer, and site-admin intervention.
- Protect against raid bursts and compromised invite links using existing
  expiry/revoke primitives plus approved velocity controls and a kill switch.
- Provide calm moderator queues, workload limits, handoff, and high-risk
  escalation. Do not use gamified closure counts.

**Gate:** permission tests prove no community action crosses jurisdiction, every
high-impact action is reversible/escalatable, and queue capacity meets the
approved launch bound.

### M4 — Close the decision and appeal loop

**Outcome:** decisions are understandable, challengeable, and correctable.

- Communicate the action, policy basis, scope, duration, effective time,
  consequences, and appeal route in plain language and supported locales.
- Give reporters safe coarse outcomes such as reviewed/action taken/no action/
  more information needed without exposing private target details.
- Allow eligible appeals during a defined window, preserve the challenged
  decision, assign a reviewer with suitable independence, and append the result.
- Reverse or narrow incorrect sanctions atomically and repair derived state,
  notifications, visibility, and access where feasible.
- Feed upheld/reversed samples into policy and model evaluation using redacted,
  access-controlled datasets with bounded retention.

**Gate:** every eligible adverse decision has a tested status/appeal/remedy path,
and reversals do not require direct database edits.

### M5 — Make safety observable and sustainable

**Outcome:** Thingtime can prove process health without exposing people.

- Add a privacy-safe operational dashboard for queue age, capacity, severe
  misses, reversals, model disagreement, failed notifications, and stale cases.
- Define alerting, incident command, audit sampling, reviewer training, policy
  change review, rollback, and provider-outage behavior.
- Publish dated, aggregate transparency only above approved cohort thresholds,
  with definitions, limitations, automation share, response times, and
  reversals. Do not publish tiny community slices.
- Run abuse simulations for false reports, raid bursts, moderator misuse,
  evidence leakage, target deletion/edit races, provider outage, and replay.
- Make the complete safety journey part of release checks and
  [`TESTING.md`](../TESTING.md).
- Re-evaluate applicable obligations and public promises with qualified owners
  before each major jurisdiction or audience expansion.

**Gate:** two release cycles meet queue, quality, appeal, privacy, accessibility,
and incident thresholds without heroic manual cleanup.

## Risks and contingency paths

| Risk | Early signal | Response |
| --- | --- | --- |
| Report tool becomes a weapon | Bursts against one target/community or decisions track volume rather than evidence | Slow coordinated bursts, group related reports for triage, preserve independent reporters, and require evidence-led disposition. |
| Private evidence leaks | Broad admin payloads, content copied into logs/analytics, or moderators browse unrelated cases | Disable the affected projection, preserve minimal incident evidence, rotate access where needed, and complete privacy/security response. |
| Automation silently becomes judge | Durable sanctions lack human actor/reason or reversal rate rises | Stop automated sanctions, quarantine only where approved, and return cases to human review. |
| Community moderator overreach | Cross-community actions, owner conflicts, unexplained removals | Revoke scoped capability, restore reversible state, audit events, and escalate to the site policy owner. |
| Queue outruns staffing | Oldest-case age or urgent backlog exceeds the approved bound | Pause public-community/invite growth, narrow report scope honestly, and add trained capacity before resuming. |
| Reporter feedback exposes target details | Status text reveals identity, content, or exact sanction | Reduce to allowlisted coarse outcomes and review every projection/notification. |
| Retention becomes indefinite | Closed cases and copied evidence exceed their approved expiry | Stop new copying, run tested expiry/deletion, and require explicit hold authority for exceptions. |
| Safety UX excludes people under stress | Report/block flow fails keyboard, screen reader, language, low bandwidth, or content-gone paths | Hold release and repair the complete journey through the accessibility/language contract. |

## Stop conditions

Pause the affected launch, experiment, or automated action when:

- immediate block semantics can be bypassed on an approved surface;
- reporter identity or private evidence reaches the target or an unauthorized
  moderator;
- a durable high-impact sanction has no human actor, policy basis, or appeal;
- severe report backlog exceeds the staffed threshold;
- report volume alone changes a decision;
- evidence retention/deletion cannot meet the approved contract;
- a provider outage strands content/cases without a bounded fallback;
- the safety journey is inaccessible in an approved mode or locale; or
- public claims, response promises, or legal workflows outrun verified capacity.

## First decision packet

The next owner review should decide only:

1. account-block semantics across the initial surface matrix;
2. first reportable targets and explicitly excluded/private surfaces;
3. policy/reason taxonomy and community-versus-platform jurisdiction;
4. reporter/target/moderator/site-admin projections;
5. evidence, access, retention, deletion, and hold rules;
6. response targets, urgent escalation, staffing, and launch capacity;
7. appeal eligibility, reviewer independence, and remedy; and
8. automation limits, transparency thresholds, and stop conditions.

Everything remains proposed until that packet is approved.
