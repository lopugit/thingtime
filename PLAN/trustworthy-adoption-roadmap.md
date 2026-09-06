# Trustworthy adoption roadmap

**Status:** Proposed

**Prepared:** 2026-09-01, Australia/Melbourne

**Evidence:** [Ethical adoption baseline](../NOTES/ethical-adoption-baseline.md)

**Execution epic:** [TODO 22 — Trustworthy adoption loop](../TODO/claude-todo/22-trustworthy-adoption-loop.md)

**Safety dependency:**
[Community safety and accountable moderation](./community-safety-and-accountable-moderation-roadmap.md)

**Ecosystem dependency:**
[Trusted developer ecosystem](./trusted-developer-ecosystem-roadmap.md)

**Continuity dependency:**
[Service continuity and recovery](./service-continuity-and-recovery-roadmap.md)

**Content-integrity dependency:**
[Content provenance and correction](./content-provenance-and-correction-roadmap.md)

**Resource-conscious reach dependency:**
[Resource-conscious reach](./resource-conscious-reach-roadmap.md)

**Creator sustainability dependency:**
[Creator sustainability and fair value](./creator-sustainability-and-fair-value-roadmap.md)

**Learning-agency dependency:**
[Learning agency and knowledge stewardship](./learning-agency-and-knowledge-stewardship-roadmap.md)

**AI-agency dependency:**
[AI agency and accountable assistance](./ai-agency-and-accountable-assistance-roadmap.md)

## Outcome

Make Thingtime easier to discover, understand, trust, use repeatedly, share by
choice, and sustain financially without selling personal data, manipulating
attention, or weakening privacy and safety.

The north-star candidate is **weekly returning useful creators**: people who
complete a first-value outcome and later complete another meaningful create,
find, edit, compose, or safe-run outcome. It is a proposal until the product
owner approves the exact journey and denominator.

## Non-goals

- Maximizing raw registrations, page views, notifications, or time-on-site.
- Uploading private Thing content, search queries, invite tokens, contacts, or
  full URLs to an analytics service.
- Buying growth by weakening authentication, moderation, capability checks,
  storage accounting, accessibility, or rate limits.
- Treating an open PR, successful deployment, or green controller job as proof
  that a user outcome works.
- Treating a point-in-time health response as proof of availability,
  durability, or recoverability.
- Building a second data path solely for analytics.

## Operating principles

1. **Usefulness before virality.** Prove a person can get value and return to it
   before optimizing sharing.
2. **Consent before reach.** A recipient chooses whether to open, register,
   follow, branch, apply, or collaborate.
3. **Trust is a growth feature.** Privacy, security, accessibility,
   internationalization, reliability, export, and deletion are adoption gates.
4. **One contract.** Tests, live behavior, direct API use, docs, and the
   capability manifest describe the same product.
5. **Small reversible experiments.** Every experiment has an owner, hypothesis,
   guardrails, stop condition, and cleanup path.
6. **Sustainable alignment.** Revenue should grow when people store, build,
   collaborate, or receive support—not when they surrender more attention or
   private data.

## Adoption ladder

| Stage       | User outcome                                                                                         | Product proof                                                                                                                                 | Must stay true                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Discover    | A person can understand what Thingtime is and find a relevant example.                               | A plain-language landing path and accessible, indexable examples explain data, components, actions, and sharing without requiring an account. | No misleading feature claims; production links are verified.                                                  |
| First value | The person creates/imports something useful and can find it again.                                   | A short path reaches one meaningful saved Thing with no destructive surprise.                                                                 | Private by default; cold-start guidance works with keyboard, touch, reduced motion, and assistive technology. |
| Repeat      | The person returns and continues from last-known state.                                              | Create/find/edit/compose outcomes work across sessions and relevant devices.                                                                  | Optimistic rendering never hides stale/error state; export and delete remain obvious.                         |
| Share       | The person deliberately shares an artifact or invitation and the recipient understands the boundary. | Public previews, permissions, expiry, revoke, and recipient choices are explicit.                                                             | No contact scraping, privilege transfer, token leakage, or forced signup.                                     |
| Contribute  | People publish reusable schemas, components, themes, algorithms, or composed apps with provenance.   | Discovery, versioning, moderation, attribution, reporting, and safe reuse work end to end.                                                    | Foreign content remains untrusted; actions remain capability-bounded.                                         |
| Sustain     | Hosted users, teams, builders, and creators can pay for aligned value.                               | Cost, quotas, billing, support, and service reliability are understandable.                                                                   | No sale of personal data, pay-to-reach ranking, or dark-pattern lock-in.                                      |

## Metric contract to approve before collection

Every metric needs a versioned definition with numerator, denominator,
exclusions, source, owner, retention, access policy, deletion behavior, and a
quality guardrail. A dashboard without that contract is not decision evidence.

| Metric                     | Candidate definition                                                                                                                                           | Guardrail pair                                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| First-value completion     | Eligible new participants who create/import a Thing and successfully reopen it within the evaluation window ÷ eligible new participants who start the journey. | Completion time; accessibility task success; error-free completion.                                             |
| Useful return              | First-value participants who complete another meaningful outcome in a later window ÷ all first-value participants eligible to return.                          | No notification-spam increase; no rise in restore/data-loss reports.                                            |
| Consentful share success   | Deliberate shares whose recipient reaches the public preview and explicitly continues ÷ valid recipient preview opens.                                         | Abuse reports, revoked-link access, forced-signup exits, token leakage all remain at zero or an approved bound. |
| Durable artifact rate      | Sampled artifacts still readable, editable, exportable, and attributable after the durability window ÷ sampled artifacts eligible for the check.               | Delete requests remain complete; no deleted content survives in measurement data.                               |
| Trustworthy outcome rate   | Useful outcomes completing without severe reliability, security, privacy, or accessibility failure ÷ attempted useful outcomes.                                | Each failure class remains separately visible; one class cannot average away another.                           |
| Sustainable service margin | Revenue attributable to hosted value minus directly attributable serving/support cost.                                                                         | No metric depends on personal-data resale, ad targeting, or compulsive engagement.                              |

## Milestones

### M0 — Decide the contract

**Outcome:** everyone uses the same definition of healthy adoption.

- Approve one first-value journey and the metric dictionary.
- Inventory what can be learned locally, from aggregate server counters, from
  support, and from structured usability sessions.
- Create a signal allowlist and a denylist. Default to no server collection
  until a product question cannot be answered more privately.
- Assign owners for product, privacy/security, accessibility, reliability, and
  cost guardrails.
- Approve the critical-journey service objectives, degraded-mode behavior,
  recovery targets, and incident ownership through the
  [service continuity roadmap](./service-continuity-and-recovery-roadmap.md).
- Record any new storage or retention decision in `DECISIONS.md` before code.

**Gate:** no telemetry implementation begins until the product owner approves
the journey and the privacy/security owner approves the signal contract.

### M1 — Make first value obvious

**Outcome:** a new person can create or import one useful Thing and find it
again without expert guidance.

- Choose one focused onboarding path; preserve the full-power surfaces for
  experienced users.
- Provide example Things that are safe, editable copies rather than hidden
  writes to a user's account.
- Explain privacy, persistence, export, and deletion at the moment they matter.
- Treat [TODO 23](../TODO/claude-todo/23-data-portability-and-exit.md) as the
  proof contract for export, restore, selective deletion, and account closure;
  do not substitute a paginated list or custom-endpoint switch for portability.
- Add keyboard, screen-reader, touch, reduced-motion, narrow-screen, and error
  recovery checks to the journey through the shared
  [accessibility and language-readiness roadmap](./accessibility-and-language-readiness-roadmap.md),
  rather than inventing one-off acceptance rules.
- Validate with structured sessions before scaling acquisition.

**Gate:** the target completion rate improves without a severe accessibility,
privacy, reliability, or data-loss regression.

### M2 — Make value repeatable

**Outcome:** people can return to useful state and continue.

- Connect search, recent/history state, folders, and canonical deep links into
  a predictable return path.
- Sequence against
  [versioned experience history](../TODO/claude-todo/20-versioned-experience-history.md)
  instead of inventing a parallel history mechanism.
- Make stale, offline, moved, deleted, and permission-changed states explicit.
- Test across account switching and custom data endpoints without leaking one
  account or endpoint into another.
- Treat the [attention agency and calm-use roadmap](./attention-agency-roadmap.md)
  as the feed and notification guardrail: useful return must not depend on
  automatic continuation, silent training, or unwanted delivery.

**Gate:** useful return improves while restore correctness, delete behavior,
and error budgets stay within approved bounds.

### M3 — Share with consent

**Outcome:** useful artifacts travel safely and recipients remain in control.

- Start with one artifact family whose public projection and permissions are
  already mature; do not launch every share type at once.
- Provide honest previews, provenance, expiry/revoke where applicable, and a
  useful unauthenticated state.
- Apply the [content provenance and correction roadmap](./content-provenance-and-correction-roadmap.md)
  to the chosen artifact family so authorship, material edits, asserted
  sources, corrections, and evidence limits remain legible without exposing
  private source material.
- Reuse the defensive invite contract in
  [TODO 18](../TODO/claude-todo/18-account-invite-links.md) for account growth.
- Treat open theme, algorithm, Commander, and sharing PRs as dependencies to
  re-verify, not shipped facts.
- Add abuse, impersonation, spam, report, block, and moderation scenarios before
  promotion through the shared
  [community safety roadmap](./community-safety-and-accountable-moderation-roadmap.md),
  rather than inventing experiment-specific enforcement.

**Gate:** recipient success improves, every permission/revoke test passes, and
abuse/support volume remains below the approved stop threshold.

### M4 — Grow a healthy creator ecosystem

**Outcome:** reusable knowledge and tools can be discovered, trusted, remixed,
and credited.

- Define provenance, version compatibility, moderation status, and update
  behavior for schemas, components, actions, themes, algorithms, and composed
  apps.
- Keep content-origin and correction evidence under the
  [content provenance and correction roadmap](./content-provenance-and-correction-roadmap.md);
  do not reuse app review receipts as claims that authored content is true.
- Use the [trusted developer ecosystem roadmap](./trusted-developer-ecosystem-roadmap.md)
  for publisher declarations, immutable releases, permission diffs, review
  receipts, incidents, appeals, abandonment, and discovery. Do not create a
  second app trust badge or release vocabulary inside an adoption experiment.
- Keep foreign content on untrusted render paths; never grant action authority
  because a component is popular.
- Publish contributor guidance, review expectations, accessibility criteria,
  and a transparent removal/appeal process owned by the
  [community safety roadmap](./community-safety-and-accountable-moderation-roadmap.md).
- Internationalize discovery metadata and examples through the canonical
  locale contract in the
  [accessibility and language-readiness roadmap](./accessibility-and-language-readiness-roadmap.md)
  before declaring broad accessibility.
- Prefer quality and successful reuse over upload counts.

**Gate:** the ecosystem has safe reuse proof, moderation capacity, accessible
discovery, and no unresolved critical provenance or capability defect.

### M5 — Sustain without surveillance

**Outcome:** Thingtime can fund hosting, maintenance, and community care through
aligned value.

Evaluate separately:

- Hosted storage and transfer above a generous personal tier.
- Team administration, audit, retention, and support controls.
- Builder/app quotas, managed deployment, and operational support.
- Creator packs or marketplaces with transparent terms and attribution.
- Sponsorship, grants, and paid support for public-interest deployments.

Use the [creator sustainability and fair-value roadmap](./creator-sustainability-and-fair-value-roadmap.md)
before any creator payment pilot. It owns the seller/merchant responsibility
matrix, provider-neutral transaction truth, receipt and entitlement lifecycle,
fee/proceeds clarity, fulfilment, remedies, private settlement, and operational
stop gate. Listing or tier prices are not evidence that payments are supported.

Use the [resource-conscious reach roadmap](./resource-conscious-reach-roadmap.md)
to measure cost and bounded resource work per useful outcome. Do not turn
logical storage bytes into an emissions claim, exclude constrained users to
improve margin, or make data saver, accessibility, calm use, safety, export, or
deletion premium-only.

Reject models based on selling personal data, paid reach in personal feeds,
artificial scarcity of export, or making privacy/security/accessibility a
premium-only entitlement.

**Gate:** a model covers a meaningful share of direct service cost, is easy to
explain, preserves export and deletion, and passes a documented fairness review.

## Experiment card

Every experiment copied into `TODO/` should contain:

- **Hypothesis:** one causal statement.
- **Audience:** who is eligible and who is excluded.
- **Change:** the smallest reversible product difference.
- **Primary outcome:** one versioned metric.
- **Guardrails:** privacy, security, accessibility, reliability, abuse, and cost.
- **Duration/sample rule:** chosen before results are read.
- **Stop condition:** automatic and human-reviewed thresholds.
- **Owner and decision date:** one accountable person and when the result will
  be accepted, iterated, or removed.
- **Cleanup:** how flags, data, copy, and code disappear after the experiment.

## Risks and contingency paths

| Risk                                                              | Early signal                                                                                                                             | Response                                                                                                                                                   |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instrumentation becomes surveillance                              | Requests for raw content, queries, URLs, or person-level dashboards                                                                      | Stop collection; answer the product question with local testing, aggregate counters, or sampled research.                                                  |
| PR volume outruns review capacity                                 | Long-lived open PRs, stale bases, repeated conflict automation                                                                           | Pause new experiments; reconcile statuses and land or close prerequisites first.                                                                           |
| Sharing drives abuse faster than value                            | Spam, impersonation, report backlog, revoked-link access                                                                                 | Disable the experiment flag, preserve evidence, and fix controls before resuming.                                                                          |
| Accessibility or language quality lags                            | Journey fails keyboard, screen reader, reduced motion, touch, or target locales                                                          | Do not broaden acquisition; fix the blocker and rerun the same journey.                                                                                    |
| Availability hides unrecoverable state                            | Health checks stay green while a critical journey loses, duplicates, or cannot restore user work                                         | Stop expansion; exercise the journey, preserve evidence, and satisfy the service continuity recovery gate before resuming.                                 |
| Provenance becomes a deceptive truth badge                        | A source declaration, signature, or credential is presented as proof that a claim is accurate                                            | Remove the claim, show assertion authority and evidence limits, preserve correction/dispute paths, and satisfy the content-integrity gate before resuming. |
| Growth excludes constrained devices or networks                   | Core-journey completion, transfer, long-task, or local-footprint evidence crosses an approved profile budget                             | Stop expansion; preserve complete meaning and satisfy the resource-conscious reach gate before resuming.                                                   |
| Creator commerce creates unfair influence or unresolved liability | Payment affects reach/trust/safety, or seller, merchant, fulfilment, refund, dispute, loss, payout, or support responsibility is unclear | Stop transaction intake; preserve receipts, entitlements, remedies, and support, then satisfy the creator fair-value gate before resuming.                 |
| Learning claims outrun evidence                                   | Saves, opens, completions, confidence, streaks, or time spent are labelled learning, mastery, or efficacy                                  | Remove the claim; preserve private reflection and source context, then satisfy the learning-agency gate before resuming.                                  |
| AI fluency or tool activity is mistaken for authority or success  | Conversation history becomes implied consent, confirmations become blanket delegation, or tool completion is reported as a correct outcome | Stop the affected assistance path; restore human control, bounded context, current authorization, receipts, correction, and remedy before resuming.      |
| Costs grow faster than usefulness                                 | Storage, compute, email, moderation, or support cost per useful return rises                                                             | Narrow the experiment, improve efficiency, or test an aligned paid tier.                                                                                   |
| Metrics optimize the proxy                                        | Page views/time rise while useful outcomes or trust fall                                                                                 | Retire the proxy and return to outcome-based evaluation.                                                                                                   |

## First decision packet

The next planning session should decide only these five things:

1. The first-value journey.
2. The north-star denominator and evaluation window.
3. Whether M0 can complete with no server analytics.
4. The first shareable artifact family to validate after repeat use works.
5. The named owners for product and each guardrail.

Everything else stays proposed until that packet is approved.
