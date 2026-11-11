# Support agency and accountable remedy baseline

**Status:** Evidence note; no support promise, case system, production intake,
legal conclusion, or implementation is authorized

**Grounded:** 2026-09-15, Australia/Melbourne, against
`origin/develop@f4ff79879f7d6aaa4fba64e86368b6545e1edf37`

**Plan:** [Support agency and accountable remedy roadmap](../PLAN/support-agency-and-accountable-remedy-roadmap.md)

**Execution epic:** [TODO 47 — Support agency and accountable remedy](../TODO/claude-todo/47-support-agency-and-accountable-remedy.md)

## Why preserve this note

Thingtime's plans already promise remedies inside particular domains: export
and closure, moderation appeals, service recovery, refunds and disputes,
product-claim correction, and youth safeguards. Those plans say what each
domain owner must decide. They do not yet define the shared journey by which a
person discovers help, understands what will be shared, gets an acknowledgement,
follows status, survives a handoff, receives a resolution, asks for correction,
and closes or reopens the request.

That distinction matters. A coherent support layer should make the route into
the right domain dependable without taking authority away from that domain. A
support case cannot decide a moderation appeal, declare an incident recovered,
authorize a refund, override deletion rules, or establish that a product claim
is true. It can preserve the request, route it, explain status and responsibility,
and carry the accountable outcome back to the person.

## Evidence ledger

| Claim                                                                                                           | Current evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Confidence and refresh trigger                                                                                                   |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Remedies recur across the garden, but shared support ownership does not.                                        | [TODO 23](../TODO/claude-todo/23-data-portability-and-exit.md), [TODO 26](../TODO/claude-todo/26-community-safety-and-accountable-moderation.md), [TODO 28](../TODO/claude-todo/28-service-continuity-and-recovery.md), [TODO 31](../TODO/claude-todo/31-creator-sustainability-and-fair-value.md), and [TODO 46](../TODO/claude-todo/46-evidence-agency-and-accountable-product-claims.md) each define domain-specific help, remedy, appeal, or correction duties. | High for the current planning corpus; refresh whenever a domain contract or its owner changes.                                   |
| A declarative support-ticket demo exists, not a production support contract.                                    | `remix/app/schemas/behaviourSuites.ts` contains a “Support tickets” behavior suite with synthetic ticket/note schemas and open, escalate, and queue actions. It is a builder demonstration and does not establish a staffed intake route, service objective, authorization model, retention rule, domain handoff, or remedy authority.                                                                                                                              | High for repository state; refresh if the suite becomes a real service or a support API is added.                                |
| Some failures tell people to contact support without providing a coherent case journey.                         | Current passkey registration, revocation, and account-deletion paths include “contact support” copy, while the repository has no dedicated support route or shared case lifecycle found in the scoped route and schema review.                                                                                                                                                                                                                                      | Medium-high; refresh after auth/account UI, routes, API docs, or support integrations change.                                    |
| The open “support page” work is not product-support case handling.                                              | Open PR [#802](https://github.com/lopugit/thingtime/pull/802) describes a public `/support` page for contributions, paid setup, and sponsorship enquiries. It does not claim a product-help intake, status, escalation, or remedy workflow.                                                                                                                                                                                                                         | High for the inspected PR state on 2026-09-15; refresh if its scope or status changes.                                           |
| Help must remain discoverable and consistent when it exists.                                                    | W3C's [Understanding Success Criterion 3.2.6: Consistent Help](https://www.w3.org/WAI/WCAG22/Understanding/consistent-help) explains that repeated help mechanisms should remain in a consistent relative order so people, including people with cognitive disabilities, can find them.                                                                                                                                                                             | Strong accessibility design input, not a conformance claim. Refresh if the normative or explanatory guidance changes.            |
| Assisted support needs research, trained capacity, privacy, and measurement.                                    | The GOV.UK Service Manual's [Designing assisted digital support](https://www.gov.uk/service-manual/helping-people-to-use-your-service/designing-assisted-digital) recommends researching why people need help, making help visible, training and funding support, protecting privacy and security, and measuring the complete support experience.                                                                                                                   | Useful service-design input; Thingtime is not claiming compliance. Refresh if the guidance changes.                              |
| Complaint handling should make acknowledgement, ownership, contact, timing, and learning explicit.              | OAIC's [Handling privacy complaints](https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/more-guidance/handling-privacy-complaints) discusses easy-to-find paths, acknowledgement, a contact, expected timing, appropriately skilled staff, resolution, and learning from complaint themes.                                                                                                                                  | Strong Australian privacy-process input, not legal advice or a finding about Thingtime. Qualified review is required before use. |
| People need a clear route to state the problem and desired outcome, then escalate when direct resolution fails. | ACCC's [Contacting a business to fix a problem](https://www.accc.gov.au/consumers/problem-with-a-product-or-service-you-bought/contacting-a-business-to-fix-a-problem) advises describing the problem and requested outcome, keeping records, and using relevant escalation paths.                                                                                                                                                                                  | Useful Australian consumer-design input, not a determination of legal rights or remedies. Refresh before a commerce launch.      |

## Narrow vocabulary

| Term                 | Proposed meaning                                                                                                                                       | Must not imply                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Help entry point     | A consistent place that explains available self-service, assisted, urgent, and domain-specific routes.                                                 | Continuous staffing, instant response, or one route for every emergency.                            |
| Support request      | A bounded request for help concerning a product task, account, service, or Thingtime process.                                                          | That every message is a legal complaint, incident, moderation report, or accepted claim.            |
| Case                 | The protected coordination record for one acknowledged request and its accountable lifecycle.                                                          | A public ticket, a copy of all user content, or authority to decide every remedy.                   |
| Acknowledgement      | Confirmation that an exact request was received, with reference, current owner or queue, next expected update, and urgent alternatives where relevant. | Resolution, acceptance of fault, guaranteed timing, or attention by a named person.                 |
| Triage               | Minimum-necessary classification of urgency, domain, access needs, and safe next route.                                                                | Diagnosis, blame, automated eligibility, or profiling beyond the request.                           |
| Handoff              | An attributable transfer of responsibility that preserves context, authority boundaries, status, and the person's place in the journey.                | Silent forwarding, abandonment by the prior owner, or exposure to unrelated teams.                  |
| Service objective    | An owner-approved operational target with scope, hours, clock rules, exclusions, evidence, and a consequence when missed.                              | A universal guarantee or proof that the underlying problem is fixed.                                |
| Resolution           | The domain owner's recorded outcome and explanation returned through the case.                                                                         | Necessarily the person's preferred result, legal finality, or irreversible closure.                 |
| Remedy               | A domain-authorized action intended to correct or mitigate a problem.                                                                                  | Support independently granting refunds, appeals, restoration, deletion exceptions, or truth claims. |
| Reopen or correction | A fresh request to revisit a closed case or correct its record without silently rewriting history.                                                     | Unlimited retry, retaliatory scrutiny, or automatic reversal of the prior decision.                 |
| Closure              | An explicit terminal case state with outcome, remaining routes, retention, export, and deletion meaning.                                               | Erasing accountable history or blocking a valid domain appeal.                                      |

## Gaps and risks

1. “Contact support” can become a dead end if the route, hours, response model,
   accessible alternatives, or urgent boundaries are not visible.
2. There is no shared lifecycle for received, acknowledged, triaged, assigned,
   waiting, handed off, resolved, closed, reopened, withdrawn, or unavailable.
3. A free-text form can collect excessive Thing content, credentials, identity
   documents, health details, legal allegations, or third-party data before a
   person understands who can access it and why.
4. Ticket count, age, sentiment, repeated contact, payment tier, identity, or
   language could be used as a crude priority or risk proxy.
5. Internal notes, domain evidence, reporter identity, security detail, or other
   people's data can leak through shared views, exports, notifications, or AI.
6. Handoffs can reset clocks, duplicate requests, lose context, or make the
   person repeat distressing information.
7. An acknowledgement, status label, macro, AI summary, or closed case can be
   mistaken for a real outcome.
8. Publishing response-time promises before staffing and measurement exist can
   create false assurance and unsafe urgency expectations.
9. A general support queue can accidentally bypass domain authority for safety,
   privacy, security, incident, commerce, deletion, or claim challenges.
10. Case histories can become unbounded surveillance or a permanent reputation
    file unless purpose, access, retention, export, correction, and deletion are
    explicit.

## Smallest honest first study

Use adult internal reviewers, one synthetic private text Thing, one exact
non-production build, and a deterministic synthetic failed export/restore
request. The reviewer finds help from the failure state, previews the exact
fields and diagnostics to be shared, removes optional context, submits once,
receives a stable acknowledgement, observes one accountable handoff to the
portability owner, supplies one bounded follow-up, receives a synthetic
resolution, requests one correction, reopens once, and then closes the case.

Exercise duplicate submit, offline interruption, unavailable queue, owner
absence, stale status, changed access, unsafe attachment, missed objective,
wrong-domain routing, withdrawal, export, retention expiry, and fixture cleanup.
Show honest hours and urgent boundaries without pretending the pilot is staffed.

Do not contact a real user, external helpdesk, email address, provider, or public
channel. Do not use real account failures, incidents, payments, moderation
reports, minors, credentials, identity documents, health or crisis content,
legal claims, production data, telemetry, or AI case decisions. The pilot proves
only the proposed journey and state contract against its exact synthetic build.

## Owner decisions

1. Which product surfaces must expose the first consistent help entry point?
2. Who owns intake, triage, each domain handoff, service objectives, privacy and
   security, accessibility and language, records, quality, incidents, and stop?
3. Which request classes belong in general support, and which must route directly
   to safety, security, privacy, legal, incident, commerce, or emergency paths?
4. What minimum fields are required before and after triage, and what content is
   prohibited, optional, summarized, redacted, or separately consented?
5. What may the requester, supporter, domain owner, administrator, auditor, and
   automation see or do at each state?
6. Which service hours and objectives are supportable, how do clocks pause, and
   what happens visibly when an objective is missed?
7. How do acknowledgement, handoff, correction, reopen, withdrawal, closure,
   retention, export, deletion, and legal-hold exceptions work?
8. Which aggregate operational measures improve the service without creating
   person-level performance scoring, vulnerability inference, or growth goals?

## Refresh triggers

Refresh this baseline before any real intake or response-time promise; after a
support, auth, account, export, moderation, incident, commerce, privacy,
security, accessibility, language, AI, notification, retention, or staffing
change; when PR #802 changes scope; and whenever the selected W3C, GOV.UK, OAIC,
ACCC, or qualified-domain guidance changes.
