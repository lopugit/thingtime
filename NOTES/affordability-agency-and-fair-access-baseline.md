# Affordability agency and fair-access baseline

Last grounded: 2026-09-17 09:19 AEST, Australia/Melbourne

Status: evidence note; not an approved price, paid tier, checkout, financial
assistance program, consumer-law conclusion, or production billing change

Plan: [affordability agency and fair-access roadmap](../PLAN/affordability-agency-and-fair-access-roadmap.md)

Execution epic: [TODO 51](../TODO/claude-todo/51-affordability-agency-and-fair-access.md)

## Question

How could Thingtime fund a durable service while giving people a useful free
baseline, an understandable total-cost decision, easy stopping, humane payment
failure, and privacy-preserving help—without selling safety, accessibility,
identity, exit, or attention back to the people who need them?

## Working vocabulary

| Term                  | Meaning in this note                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Useful baseline       | The smallest free experience that remains safe, accessible, exportable, and honestly useful                                                            |
| Offer snapshot        | Immutable terms shown before a person accepts: product, version, price, currency, period, minimum total, renewal, taxes/fees, cancellation, and remedy |
| Entitlement           | What an account may use; distinct from a displayed price, provider event, payment, or invoice                                                          |
| Cost event            | A quoted, authorized, attempted, settled, failed, reversed, refunded, or disputed money/credit change                                                  |
| Grace state           | A time-bounded, explained period after failure or change that preserves safety, data, exit, and remedy                                                 |
| Affordability support | A separately approved reduction, grant, pause, or plan that does not require sensitive inference or public disclosure                                  |
| Essential floor       | Safety, privacy, accessibility, security, data access, export, deletion, support, and appeal functions that payment cannot remove                      |

These are product-planning terms. They do not determine legal obligations,
taxes, eligibility, hardship, disability, vulnerability, or provider policy.

## Repository evidence

### Versioned tiers and quotas are entitlement infrastructure, not checkout

- `remix/app/api/utils/subscriptions/tierCatalog.ts` defines immutable tier
  revisions, integer minor-unit prices, daily/weekly/monthly/yearly periods,
  annualized comparison math, inclusions, and quota envelopes. The built-in
  Free tier is the default and all built-in prices are currently unset.
- `remix/app/api/utils/subscriptions/subscriptions.ts` stores protected,
  version-pinned subscription assignments and atomic storage allowances. Its
  job is entitlement and admission, not proof that money moved.
- Plus, Pro, and Pay-as-you-go names and quotas therefore must not be described
  as purchasable, current commercial offers without a separately verified live
  offer, purchase path, provider contract, and receipt.

### Current tier presentation is informative but not a complete offer contract

- `remix/app/components/Subscriptions/TierCard.tsx` can show period prices,
  inclusions, quotas, and annualized “saved/more” comparisons.
- The card does not itself establish the minimum total commitment, next charge,
  renewal default, trial conversion, taxes or unavoidable fees, price-change
  rule, cancellation effective time, post-cancellation access, refund route,
  payment-failure handling, or data consequences.
- A percentage comparison is useful only when its source prices, periods, total
  commitment, and assumptions are equally visible and current.

### Lopu credits have ledger truth without pretending a payment rail exists

- Lopu accounting records server-priced turns and starter, grant, top-up,
  debit, adjustment, refund, and request rows. The owner can inspect balance
  and history; an administrator can review a top-up request.
- `lopuTopupUrl()` explicitly says no payment processor is wired. It exposes an
  optional HTTP(S) destination or leaves the UI on “Request credits.”
- This separation is a strong boundary: a credit request, external link,
  administrator grant, ledger row, and settled purchase are different states.

### Current legal copy describes a future-facing boundary

`remix/app/legal/documents.ts` says paid-feature price, interval, renewal, and
cancellation conditions should be shown before purchase, preserves mandatory
consumer rights, and notes that ending use does not automatically cancel an
external subscription. That copy is a policy statement, not evidence that a
provider-specific purchase, cancellation, refund, or grace journey is shipped.

## External design anchors

| Anchor                                                                                                                                                                                                                                                                                                                         | Planning implication                                                                                                          | Limit                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [ACCC price-display guidance](https://www.accc.gov.au/business/pricing/price-displays) requires clear, accurate pricing and a prominent minimum total including unavoidable or pre-selected fees.                                                                                                                              | Design the offer around total commitment, not a small periodic fragment.                                                      | Current official guidance checked 2026-09-17; qualified review is still required. |
| The ACCC's [2026 eHarmony decision summary](https://www.accc.gov.au/media-release/court-finds-eharmony-engaged-in-misleading-conduct-in-relation-to-automatic-renewal-and-pricing-of-its-subscriptions) describes findings involving renewal, duration, cancellation, mandatory fees, and incomplete total-price presentation. | Treat each of those as a testable product state, not fine print.                                                              | Case-specific summary, not Thingtime legal advice.                                |
| The ACCC's [2026–27 enforcement priorities](https://www.accc.gov.au/media-release/manipulative-conduct-in-the-digital-economy-pricing-claims-and-competition-in-essential-services-among-accc-priorities-for-year-ahead) identify subscription traps and manipulative digital practices as a priority.                         | Do not optimize acceptance or retention by adding friction, urgency, or asymmetry.                                            | Priorities and law can change; refresh before launch.                             |
| The OECD's [dark commercial patterns](https://www.oecd.org/en/topics/dark-commercial-patterns.html) work links hidden fees, forced disclosure, subscription traps, and hard cancellation to financial, privacy, and psychological harm.                                                                                        | Review the whole choice architecture, not disclosure text alone.                                                              | Policy evidence, not a jurisdiction-specific rule.                                |
| OAIC [APP 3 guidance](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-3-app-3-collection-of-solicited-personal-information) emphasizes necessity, proportionality, and data minimisation.                                                                       | Do not collect income, hardship, disability, family, or behavioral data merely because it could improve pricing or retention. | Applicability and lawful basis require qualified assessment.                      |

## The product gap

Thingtime has useful building blocks but no single approved contract joining:

1. the free essential floor and paid-value boundary;
2. exact offer, consent, provider, entitlement, receipt, and remedy states;
3. minimum total cost, renewal, change, cancellation, refund, and failure truth;
4. a humane grace/downgrade path that never strands data or blocks exit;
5. affordability support that does not require sensitive profiling;
6. price experiments that cannot target vulnerability or weaken equal access;
7. accessible, localized comprehension across web, native, email, and support;
8. evidence that acceptance, cancellation, failure, and recovery converge; and
9. an accountable sustainability measure beyond conversion and retention.

## Boundaries with adjacent garden work

- [TODO 23](../TODO/claude-todo/23-data-portability-and-exit.md) owns export,
  deletion, and closure. Payment status must not block those rights.
- [TODO 25](../TODO/claude-todo/25-accessibility-and-language-readiness.md)
  owns complete-journey accessibility and language readiness.
- [TODO 31](../TODO/claude-todo/31-creator-sustainability-and-fair-value.md)
  owns buyer/creator transactions, fulfilment, proceeds, and marketplace risk.
  This chain owns Thingtime's own service-access and account-affordability
  contract.
- [TODO 35](../TODO/claude-todo/35-identity-agency-and-context-safe-presence.md)
  owns identity and disclosure; affordability support must not become a public
  status or reusable identity claim.
- [TODO 46](../TODO/claude-todo/46-evidence-agency-and-accountable-product-claims.md)
  owns every public “free,” “save,” “unlimited,” “fair,” or affordability claim.
- [TODO 47](../TODO/claude-todo/47-support-agency-and-accountable-remedy.md)
  owns shared intake and handoff; billing outcomes remain domain-owned.
- [TODO 48](../TODO/claude-todo/48-change-agency-and-humane-product-evolution.md)
  owns price/entitlement change notice, compatibility, rollback, and retirement.

## Candidate fair-access contract

1. **Protect the essential floor.** Safety, privacy, accessibility, security,
   export, deletion, support, and appeal do not become paid upgrades.
2. **Snapshot the offer.** Preserve exactly what was shown and accepted, with
   total cost, renewal, change, cancellation, remedy, and evidence versions.
3. **Keep state nouns honest.** Quote, intent, authorization, provider attempt,
   settlement, entitlement, refund, and dispute are never synonyms.
4. **Make stopping symmetrical.** Cancellation is no harder to find,
   understand, or complete than joining; show its effective time and effects.
5. **Fail softly.** Preserve data, read/export/delete, security, and remedy
   during bounded grace; never surprise-delete or trap a person into payment.
6. **Never infer hardship.** Offer support through explicit, minimal,
   owner-controlled requests, not sensitive traits or engagement profiles.
7. **No personalized price pressure.** Do not use urgency, streaks, social
   comparison, hidden defaults, or vulnerability-targeted offers.
8. **Measure comprehension and remedy.** Conversion never outranks accurate
   understanding, cancellation success, correction, and sustainable service.

## Bounded first rehearsal

Use adult internal reviewers, synthetic accounts, one exact non-production
build, fixed invented AUD prices, and a local fake provider. Rehearse:

- compare Free and one monthly fixed-price proposal;
- show one immutable offer snapshot and comprehension check;
- accept, decline, cancel, fail payment, enter grace, recover, downgrade, and
  export without moving money or changing production entitlement;
- prove duplicate callbacks and retries converge on one receipt/state; and
- delete every fixture, event, and local message after review.

Do not take payment, create a real subscription, contact a real person, collect
financial or hardship evidence, use production analytics, target an offer,
change a live tier, deny data access, or publish a price or affordability claim.

## Evaluation questions

- Can a reviewer state the minimum total, renewal rule, cancellation effect,
  and remedy before accepting?
- Can the person decline or cancel without extra friction, loss framing, or
  hidden consequences?
- Does failure preserve the essential floor, data, exit, and support?
- Can every displayed entitlement be traced to one immutable offer and current
  account state without treating provider success as the only truth?
- Is assistance usable without disclosing sensitive circumstances?
- Do keyboard, touch, screen reader, reduced-motion, narrow-screen, plain-
  language, and locale tests reach the same outcome?
- Are collection, retention, analytics, and staff access minimal and explicit?

## Open owner decisions

- Which functions form Thingtime's non-negotiable essential floor?
- Is the first sustainable offer a subscription, prepaid credit, voluntary
  support, paid setup, sponsorship, or deliberately no paid offer yet?
- Which entity is seller or merchant, and which provider/jurisdictions are in
  scope?
- What grace, retry, downgrade, refund, dispute, correction, and restore rules
  are operationally supportable?
- Can one transparent price serve everyone, or is any discount/support program
  justified without sensitive targeting?
- Which sustainability, comprehension, cancellation, support, and access
  measures authorize continuation or force a stop?

Refresh this note after tier, quota, Lopu credit, checkout, legal-copy,
provider, support, accessibility, privacy, portability, or pricing behavior
changes, and before any real-money or public-price decision.
