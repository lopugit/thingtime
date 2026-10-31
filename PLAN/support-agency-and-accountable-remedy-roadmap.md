# Support agency and accountable remedy roadmap

**Status:** Proposed; owner and qualified product, support, privacy, security,
accessibility, language, safety, legal, operations, and domain review required
before implementation or any service promise

**Grounded:** 2026-09-15, Australia/Melbourne

**Evidence:** [Support agency and accountable remedy baseline](../NOTES/support-agency-and-accountable-remedy-baseline.md)

**Execution epic:** [TODO 47 — Support agency and accountable remedy](../TODO/claude-todo/47-support-agency-and-accountable-remedy.md)

## Outcome

Give every person a consistent, accessible way to ask for help, understand what
will be shared, receive an accountable acknowledgement, follow responsibility
across handoffs, and reach the correct domain outcome without repeatedly
disclosing private context. Make delay, uncertainty, closure, correction,
reopening, retention, and escalation truthful rather than hidden behind “ticket
created” or “contact support.”

## Non-negotiable boundaries

- The relevant domain owner retains remedy authority. General support routes and
  explains; it does not decide moderation appeals, service recovery, refunds,
  export/deletion exceptions, security disclosures, or product-claim truth.
- A case, acknowledgement, assignment, response, macro, AI summary, service
  objective, or closure label is not proof that the problem was understood or
  resolved.
- Intake is minimum-necessary and private by default. Never request passwords,
  tokens, passkeys, recovery codes, raw credentials, or unrelated Thing content.
- Urgent safety, security, privacy, legal, crisis, and emergency routes remain
  distinct and visible. Thingtime must not imply it provides emergency services.
- Paid status, public influence, repeated contact, sentiment, identity, language,
  disability, age, or predicted value cannot buy remedy priority.
- Do not publish service hours or objectives until owners, capacity, clocks,
  evidence, fallback behavior, and missed-objective remedies are approved.

## S0 — Assign ownership and map the journey

- Name accountable owners and backups for entry points, intake, triage, domain
  routing, case operations, privacy/security, accessibility/language, records,
  service quality, incidents, and manual stop.
- Inventory every current “help,” “support,” “contact us,” failure, appeal,
  correction, refund, export, deletion, and incident route.
- Define request classes and an authority map: general support, account/access,
  portability, community safety, security, privacy, service incident, commerce,
  claim challenge, legal notice, and external emergency help.
- Approve the first synthetic failure and the surfaces from which help must be
  discoverable.

**Gate:** no schema, integration, staffing promise, production intake, telemetry,
or real participant work.

## S1 — Approve a minimum case and state contract

- Define request, case, event, party, owner, queue, handoff, service clock,
  resolution, remedy reference, correction, reopen, withdrawal, and closure.
- Specify legal transitions for drafted, submitted, received, acknowledged,
  triaged, assigned, waiting-on-person, waiting-on-domain, handed-off, resolved,
  closed, reopened, withdrawn, rejected-as-unsafe, and unavailable states.
- Define requester, supporter, domain owner, administrator, auditor, and
  automation permissions at field and transition level.
- Keep appended events relational and batch-read; use bounded summaries and
  references instead of duplicating source content into a case.
- Approve purpose, field allowlists, optionality, redaction, attachment limits,
  access logging, retention, export, correction, deletion, holds, and cleanup.
- Threat-model enumeration, IDOR, queue crossing, note leakage, forged handoffs,
  replay, duplicate cases, notification disclosure, unsafe attachments, prompt
  injection, insider access, retaliation, and denial-of-support abuse.

**Gate:** the model fails closed for unknown domain, owner, authority, content,
state, retention, or urgent route.

## S2 — Design consistent, accessible help and consentful intake

- Place the approved help mechanism consistently across the first complete
  journey, including failure, signed-out, narrow viewport, and stale states.
- Explain available routes, service hours, urgent boundaries, accessibility and
  language options, expected next step, and alternatives before collection.
- Preview required, optional, generated, and attached data plus recipients,
  purpose, retention, and removal choices before submit.
- Prefer structured problem and desired-outcome fields with bounded optional
  context. Detect and reject secrets without copying them into logs or a case.
- Preserve a local draft only under an approved account/origin-scoped contract;
  submission requires fresh authority and explicit confirmation.
- Provide deterministic acknowledgement with reference, receipt time, current
  queue/owner class, next expected update, and correction/withdrawal routes.

**Gate:** keyboard, screen reader, 200% zoom, touch, reduced motion, narrow
viewport, approved-language, slow/lossy network, interruption, and retry checks
pass with no duplicate case or accidental disclosure.

## S3 — Make triage, handoff, and service clocks accountable

- Route with the minimum classification necessary; never infer legal status,
  vulnerability, intent, fault, or entitlement from free text or identity.
- Require an authorized recipient and acknowledgement before a handoff completes;
  preserve the person-visible owner and next step through failures and retries.
- Keep one case reference across internal transfers while recording attributable,
  content-minimal events; prevent parallel queues from silently diverging.
- Define clock start, pause, resume, hours, exclusions, dependency waiting,
  reassignment, missed-objective state, and escalation behavior.
- Let people add or correct bounded context without restarting their place or
  exposing private internal notes.
- Show uncertainty and owner absence plainly; never fabricate progress from a
  queue label, activity timestamp, AI draft, or notification delivery.

**Gate:** duplicate, crossed, stale, rejected, failed, and ownerless handoffs
converge without lost context, reset clocks, unauthorized access, or false status.

## S4 — Return domain outcomes and preserve remedy boundaries

- Link the authoritative domain decision and its permitted explanation rather
  than copying mutable outcome state into general support.
- Distinguish answered, resolved, partially resolved, declined, referred,
  withdrawn, and unable-to-resolve outcomes.
- Show remaining appeal, correction, incident, refund/dispute, portability,
  privacy, security, or external escalation routes without inventing entitlement.
- Support correction, reopen, and closure as attributable transitions; do not
  silently edit history or turn closure into a barrier to an approved appeal.
- Prove export, retention expiry, deletion, holds, account switch, supporter
  departure, and domain-record changes preserve the approved boundary.

**Gate:** the requester can understand what happened, who had authority, what
remains open, and how to challenge the record without seeing protected material.

## S5 — Run one private synthetic pilot

- Use adult internal reviewers, one synthetic private text Thing, one exact
  non-production build, and one deterministic failed export/restore request.
- Exercise help discovery, data preview, submit, acknowledgement, status, one
  portability handoff, bounded follow-up, resolution, correction, reopen,
  closure, export, expiry, deletion, and full cleanup.
- Inject duplicate submit, offline interruption, unavailable queue, missed
  objective, wrong routing, owner loss, stale client, notification failure,
  changed access, unsafe attachment, withdrawal, and domain disagreement.
- Inspect case, logs, notifications, screenshots, export, and cleanup artifacts
  for private content, secrets, cross-account data, inaccurate status, or
  unbounded retention.
- Publish no support promise and contact no external service or real person.

**Gate:** zero lost or duplicate case, unauthorized view/action, secret capture,
silent handoff, clock reset, false resolution, blocked correction, inaccessible
state, retained fixture, or boundary bypass.

## S6 — Evaluate before any expansion

- Review resolution comprehension, repeat disclosure, handoff count, missed
  objectives, accessibility/language failures, privacy/security events, reopen
  reasons, cleanup, staff load, and unresolved domain gaps.
- Treat case volume and faster closure as operational signals, never adoption,
  satisfaction, safety, truth, or person-level performance scores.
- Expand to one real request class only after qualified owners approve staffing,
  data handling, domain integration, service statements, monitoring, incident
  response, and reversible stop.
- Re-run exact-version proof after every material route, schema, policy, owner,
  staffing, integration, retention, or domain-contract change.

## Measures and evidence

For the synthetic pilot, record exact-build pass/fail evidence for help
discovery, data-preview comprehension, duplicate prevention, acknowledgement,
owner visibility, handoff continuity, clock accuracy, domain-bound resolution,
correction/reopen, access isolation, export/deletion, and cleanup. Any future
aggregate service measure needs an explicit numerator, denominator, clock,
hours, exclusions, retention, access, purpose, owner, and consequence.

Do not optimize ticket creation, deflection, closure speed, reopen suppression,
sentiment, contact avoidance, engagement, or growth. A person abandoning an
inaccessible form is not successful self-service.

## Stop conditions

Stop for ownerless intake; an ambiguous or emergency request without a safe
route; secret or unnecessary-data collection; cross-account or internal-note
exposure; unknown authority; inaccessible or untranslated critical meaning;
unsupported hours/objectives; lost or duplicated cases; silent handoff; reset
clock; domain bypass; retaliation or discriminatory priority; misleading status;
AI deciding a case; blocked correction/appeal; missing retention or cleanup; or
staffing/cost beyond the approved boundary.

## Dependencies and sequence

- [TODO 22](../TODO/claude-todo/22-trustworthy-adoption-loop.md) owns outcome
  learning; support volume or closure is not adoption proof.
- [TODO 23](../TODO/claude-todo/23-data-portability-and-exit.md) owns the pilot's
  export/restore outcome and case export/deletion boundary.
- [TODO 25](../TODO/claude-todo/25-accessibility-and-language-readiness.md) owns
  complete-journey access and locale gates.
- [TODO 26](../TODO/claude-todo/26-community-safety-and-accountable-moderation.md)
  owns conduct reports, moderation decisions, appeals, and safety remedies.
- [TODO 28](../TODO/claude-todo/28-service-continuity-and-recovery.md) owns
  incidents, service recovery, and availability evidence.
- [TODO 31](../TODO/claude-todo/31-creator-sustainability-and-fair-value.md) owns
  commerce responsibilities, refunds, disputes, and entitlements.
- [TODO 45](../TODO/claude-todo/45-youth-safety-and-age-appropriate-agency.md)
  owns youth eligibility, protective defaults, guardian boundaries, and
  child-specific support review.
- [TODO 46](../TODO/claude-todo/46-evidence-agency-and-accountable-product-claims.md)
  owns product-claim evidence, challenges, and correction families.

## Non-goals

Public launch, external helpdesk procurement, email support, chatbot, emergency
service, legal complaints program, security disclosure program, moderation
queue, incident desk, refund engine, deletion exception, identity verification,
user surveillance, sentiment scoring, staff ranking, AI triage/decision-making,
or replacement of any domain owner.
