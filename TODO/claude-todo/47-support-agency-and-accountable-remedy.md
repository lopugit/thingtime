# 47 — Support agency and accountable remedy

**Status:** 🟣 Proposed · owner and qualified review needed

**Priority:** P1 trust/adoption infrastructure

**Proposed:** 2026-09-15, Australia/Melbourne

**Owner:** Unassigned; product owner must name support, domain-routing,
privacy/security, accessibility/language, records, operations, incident, and
manual-stop owners

**Evidence:** [Support agency and accountable remedy baseline](../../NOTES/support-agency-and-accountable-remedy-baseline.md)

**Roadmap:** [Support agency and accountable remedy roadmap](../../PLAN/support-agency-and-accountable-remedy-roadmap.md)

## Goal

Make asking Thingtime for help a discoverable, consentful, accessible, and
accountable journey from first failure through acknowledgement, responsible
handoff, domain-authorized outcome, correction, reopening, closure, and cleanup.

## Problem

Domain plans already assign moderation appeals, incident recovery, refunds,
portability, deletion, and product-claim corrections to their proper owners.
Thingtime also has a declarative support-ticket demo and several “contact
support” strings. None of those fragments establishes a shared support contract.

Without that contract, a person may meet a dead end, overshare private material,
receive a reference with no owner, lose context during a handoff, see a queue
label presented as progress, or have a case closed without a usable correction
or escalation route. This epic builds the shared journey while preserving each
domain's decision authority.

## Dependencies and ownership boundaries

- [`FUNDAMENTALS.md`](../../FUNDAMENTALS.md) and
  [`DECISIONS.md`](../../DECISIONS.md) remain authoritative. Accumulating case
  events are relational, bounded, protected, and API-only.
- [TODO 22](./22-trustworthy-adoption-loop.md) owns adoption outcomes. Support
  contact, deflection, response, closure, or sentiment is not proof of value.
- [TODO 23](./23-data-portability-and-exit.md) owns export, restore, deletion,
  account closure, and the first synthetic failure's actual remedy.
- [TODO 25](./25-accessibility-and-language-readiness.md) owns complete-journey
  accessibility and language release gates.
- [TODO 26](./26-community-safety-and-accountable-moderation.md) owns conduct
  reports, moderation cases, appeals, urgent safety routes, and safety remedies.
- [TODO 28](./28-service-continuity-and-recovery.md) owns service incidents,
  recovery decisions, and availability communication.
- [TODO 31](./31-creator-sustainability-and-fair-value.md) owns commerce roles,
  refunds, disputes, fulfilment, and entitlement remedies.
- [TODO 45](./45-youth-safety-and-age-appropriate-agency.md) owns age eligibility,
  protective defaults, guardian roles, and qualified youth-support boundaries.
- [TODO 46](./46-evidence-agency-and-accountable-product-claims.md) owns
  challenges to Thingtime's product claims and correction-family truth.
- PR #802's contributions, paid-setup, and sponsorship page is not a product
  support case system. Do not overload its public “support” meaning.
- W3C, GOV.UK, OAIC, and ACCC references are design inputs, not adopted
  compliance, service, or legal conclusions.

## Phase 0 — Owner decision packet

- [ ] Approve the first help surfaces and a request-class/authority map.
- [ ] Approve definitions for help entry point, request, case, acknowledgement,
      triage, handoff, service objective, resolution, remedy, correction, reopen,
      withdrawal, and closure.
- [ ] Select the first failure. Recommended: one synthetic private text Thing
      that fails a deterministic export/restore check in one exact preview build.
- [ ] Name intake, triage, each domain, privacy/security, accessibility/language,
      records, quality, incident, staffing, and manual-stop owners plus backups.
- [ ] Approve visible hours, urgent boundaries, data preview, prohibited content,
      access roles, retention, export, correction, deletion, holds, and cleanup.
- [ ] Ban paid, identity-based, sentiment-based, age-based, language-based, or
      predicted-value priority and any unsupported service-time promise.

**Gate:** no implementation, real intake, external integration, telemetry,
service promise, or participant work.

## Phase 1 — Specify the protected case contract

- [ ] Define relational, versioned request, case, event, assignment, handoff,
      clock, and domain-outcome references; never embed unbounded history.
- [ ] Define authorized state transitions from draft through closure, correction,
      reopening, withdrawal, unsafe rejection, and unavailable service.
- [ ] Define field-level views/actions for requester, supporter, domain owner,
      administrator, auditor, and automation. Internal notes never leak through
      status, notification, export, error, or timing oracles.
- [ ] Require minimum-necessary structured fields, explicit optionality, size
      caps, safe attachment types, secret rejection, and bounded generated data.
- [ ] Define idempotency, CAS, retry, duplicate grouping, stale-client behavior,
      account/origin isolation, access logs, retention, export, and deletion.
- [ ] Threat-model enumeration, IDOR, forged or crossed handoffs, queue leakage,
      impersonation, retaliation, denial of support, prompt injection, unsafe
      files, notification disclosure, and insider access.

**Gate:** unknown requester, owner, domain, state, authority, purpose, content,
retention, or urgent route fails closed.

## Phase 2 — Build consistent help and consentful intake

- [ ] Place one consistently ordered help mechanism across the selected journey,
      including error, signed-out, stale, offline, and narrow states.
- [ ] Explain routes, hours, next steps, urgent alternatives, accessibility and
      language options, and external boundaries before collection.
- [ ] Preview every required, optional, generated, and attached field, who can
      receive it, why, and for how long; let the person remove optional context.
- [ ] Preserve prior/cached state without a spinner, but require fresh authority
      and explicit confirmation before submit or resubmit.
- [ ] Return one deterministic acknowledgement with reference, received time,
      owner/queue class, expected next update, and correction/withdrawal routes.
- [ ] Prove keyboard, screen reader, 200% zoom, touch, reduced motion, narrow
      viewport, approved language, interruption, retry, and offline recovery.

**Gate:** no duplicate request, secret capture, inaccessible meaning, misleading
urgency, or disclosure beyond the approved preview.

## Phase 3 — Prove accountable routing and time truth

- [ ] Triage only the minimum domain, urgency, access, and safe-next-step facts;
      do not infer fault, diagnosis, legal status, vulnerability, or entitlement.
- [ ] Complete a handoff only when an authorized recipient accepts it; preserve
      the person-visible owner, place, context, clock, and next step.
- [ ] Keep service clock start, hours, pause/resume reasons, missed-objective
      state, owner absence, dependency waits, and escalation behavior explicit.
- [ ] Let the person inspect status and add/correct bounded context without
      seeing private notes or restarting the case.
- [ ] Make stale, unavailable, uncertain, delayed, and notification-failed states
      honest; activity is not progress and acknowledgement is not resolution.

**Gate:** duplicate, crossed, stale, failed, rejected, and ownerless handoffs
converge without lost context, unauthorized access, or false status.

## Phase 4 — Return domain outcomes and close accountably

- [ ] Reference the authoritative domain outcome and approved explanation;
      general support cannot invent or override a remedy.
- [ ] Distinguish answered, resolved, partly resolved, declined, referred,
      withdrawn, unable-to-resolve, and awaiting-domain outcomes.
- [ ] Show applicable correction, reopen, appeal, incident, refund/dispute,
      portability, privacy, security, legal, or external routes.
- [ ] Preserve attributable history while allowing record correction; closure
      cannot erase accountability or block an approved domain process.
- [ ] Prove account switch, supporter departure, domain change, export, retention
      expiry, deletion, hold, and cleanup semantics.

**Gate:** the person can explain what happened, who had authority, what remains
open, and the next valid route without access to protected material.

## Phase 5 — Run the private synthetic pilot

- [ ] Use adult internal reviewers, one synthetic private text Thing, one exact
      non-production build, and deterministic export/restore fixtures.
- [ ] Exercise discover → preview shared data → submit → acknowledge → status →
      one portability handoff → follow-up → resolution → correct → reopen →
      close → export/delete case fixtures.
- [ ] Inject duplicate submit, offline interruption, unavailable queue, owner
      absence, stale status, missed objective, wrong routing, changed access,
      unsafe attachment, notification failure, withdrawal, and domain conflict.
- [ ] Inspect UI, case views, logs, notifications, exports, screenshots, caches,
      and cleanup for secrets, private content, cross-account data, false status,
      inaccessible meaning, or retained fixtures.
- [ ] Contact no real person or external service and publish no support promise.

**Gate:** zero duplicate/lost case, unauthorized view/action, silent handoff,
clock reset, false resolution, blocked correction, boundary bypass, or cleanup
failure.

## Acceptance criteria

- [ ] Every help entry point has a consistent location/order, truthful scope,
      visible hours and urgent boundary, and accessible alternative.
- [ ] Every submitted field was previewed as required/optional/generated,
      purpose-bound, size-bounded, and shared only with approved roles.
- [ ] Exactly one case and acknowledgement exist for each idempotent submission.
- [ ] Current owner, state, next step, clock meaning, uncertainty, and missed
      objectives remain person-visible through retry and handoff.
- [ ] Handoffs require recipient acceptance and preserve context without forcing
      repeated disclosure or leaking internal/domain material.
- [ ] The authoritative domain owner alone records the outcome or remedy; support
      neither overrides it nor turns a queue label into success.
- [ ] Correction, reopen, withdrawal, closure, export, retention, deletion, and
      approved hold behavior are attributable and tested.
- [ ] Authorization tests prevent cross-account, cross-queue, cross-domain,
      internal-note, attachment, timing, and notification leakage.
- [ ] Complete-journey accessibility/language and slow/lossy-network checks pass.
- [ ] The pilot leaves no fixture, draft, case, attachment, notification, cache,
      temporary access, or generated artifact outside approved evidence.

## Hard stop conditions

Stop for ownerless intake; unsafe or emergency ambiguity; secrets or excessive
data; unknown authority; inaccessible or untranslated critical meaning;
unsupported hours/objectives; duplicate/lost case; silent handoff; reset clock;
private/internal-note leakage; discriminatory or paid priority; domain bypass;
misleading status; AI case decisions; retaliation; blocked correction/appeal;
unapproved retention/hold; failed cleanup; or staffing/cost beyond the approved
boundary.

## Non-goals

- Public launch, external helpdesk, email support, chatbot, emergency service,
  legal complaints program, security disclosure program, or production staffing.
- Moderation decisions, incident recovery, refunds/disputes, export/deletion
  exceptions, identity verification, or product-claim adjudication.
- User telemetry, sentiment/vulnerability inference, staff rankings, deflection
  targets, support-as-growth, or AI triage, response, summary, or decision-making.
- Real users, production incidents, real purchases, minors, credentials, identity
  documents, crisis content, health advice, or legal conclusions.

## Concrete next action

Product, support, portability, privacy/security, accessibility/language,
operations, records, and qualified domain owners review a one-page packet with:

1. the first help surfaces and request-class/authority map;
2. the synthetic failed export/restore scenario and prohibited broader meanings;
3. case fields, roles, states, handoffs, service-clock rules, and urgent boundary;
4. data preview, prohibited content, attachment, access, export, correction,
   retention, deletion, hold, and cleanup rules;
5. accessibility/language profiles, negative cases, evidence, cost, and stops;
6. accountable owners and backups; and
7. explicit approval, revision, or rejection of the private synthetic pilot.
