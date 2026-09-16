# Creator sustainability and fair-value baseline

Captured: **2026-09-05 AEST**

Repository snapshot: `037983db0` after integrating `origin/develop` at
`f20aa367f`

Status: evidence note, not a commerce launch, financial forecast, tax or legal
opinion, payment-provider decision, or claim that Thingtime currently processes
creator payments

This note asks a narrow world-domination question: can people who make useful
Things receive durable, understandable support without turning trust, reach,
privacy, accessibility, or exit into products for sale?

The matching [roadmap](../PLAN/creator-sustainability-and-fair-value-roadmap.md)
and [implementation epic](../TODO/claude-todo/31-creator-sustainability-and-fair-value.md)
turn the evidence into a proposed decision sequence. They do not authorize a
payment processor, transaction data collection, public marketplace, fee,
withholding policy, payout, or production experiment.

## Scope and evidence limits

The snapshot covers the repository's subscription-tier, quota, marketplace,
authorship, portability, moderation, and app-ecosystem primitives plus current
public guidance from Stripe, the ACCC, and the OAIC. It does not establish:

- who would be the merchant of record or seller for any transaction;
- which jurisdictions, currencies, taxes, identity checks, or payout methods
  Thingtime could support;
- that an existing subscription price is current, approved, or purchasable;
- that marketplace listing metadata represents an offer or completed sale;
- that a payment provider can satisfy Thingtime's product, privacy, access,
  portability, risk, or operational requirements; or
- that creator earnings, demand, conversion, fraud, or service cost have been
  measured.

Provider behavior, consumer rules, privacy guidance, fees, currencies, and
identity requirements are time-sensitive. Re-check them with qualified owners
before implementation or public terms.

## Evidence ledger

| Claim                                                                                                                      | Evidence                                                                                                                                                                                                                                                                                                                                                                                            | Confidence and refresh trigger                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Thingtime has a versioned subscription-tier and quota control plane, but not an end-user billing flow.                     | PR [#170](https://github.com/lopugit/thingtime/pull/170) records protected tier documents, assignment history, quota accounting, and an explicit non-goal of payment processor or checkout integration. Current subscription utilities and schema registrations preserve that separation.                                                                                                           | High for repository structure. Re-read the implementation and PR history after any subscription, entitlement, or billing change.                       |
| Prices can be presented without proving that money can move.                                                               | `remix/app/components/Subscriptions/TierCard.tsx` renders tier price metadata, while the inspected package and route surface has no owned checkout or payment-provider contract.                                                                                                                                                                                                                    | High for this snapshot. Re-scan dependencies, routes, deployment configuration, and live behavior before repeating the claim.                          |
| Marketplace-shaped content exists as product metadata, not transaction infrastructure.                                     | Marketplace posts can carry a non-negative price, currency, category, condition, and location. The adjacent [`04-marketplaces-and-app-store.md`](../AI_Idlings/2026-06-23-135148-AEST/04-marketplaces-and-app-store.md) proposal keeps purchase records as Things and payment rails separate from product truth.                                                                                    | High for the inspected schema and proposal. Re-ground after marketplace, order, entitlement, or payment work.                                          |
| Authorship, public projection, safety, provenance, and portability already define important boundaries for paid artifacts. | The dedicated creator design must compose with the [community-safety](./community-safety-and-accountable-moderation-baseline.md), [content-provenance](./content-provenance-and-correction-baseline.md), [data-portability](./data-portability-and-exit-baseline.md), and [trusted-developer](./trusted-developer-ecosystem-baseline.md) baselines rather than creating privileged commerce copies. | High as an architecture constraint. Refresh each evidence note before implementation.                                                                  |
| The money-flow choice determines operational responsibility.                                                               | Stripe's current [Connect overview](https://docs.stripe.com/connect/saas-platforms-and-marketplaces) and [risk guidance](https://docs.stripe.com/connect/risk-management) distinguish SaaS and marketplace flows and explain that charge type and connected-account configuration affect fees, disputes, negative balances, onboarding, and loss liability.                                         | High as provider guidance on 2026-09-05, not a recommendation or legal determination for Thingtime. Refresh before any provider decision.              |
| Refund and dispute behavior cannot be bolted on after checkout.                                                            | Stripe's [Connect dispute documentation](https://docs.stripe.com/connect/disputes) shows that who responds and which balance is debited depend on the charge and liability model.                                                                                                                                                                                                                   | High as provider behavior on the capture date. Re-check provider versions, supported countries, and contracts before design approval.                  |
| A private refund policy cannot remove statutory consumer rights.                                                           | The ACCC's [consumer rights and guarantees guidance](https://www.accc.gov.au/consumers/buying-products-and-services/consumer-rights-and-guarantees) says businesses cannot contract away consumer guarantees and that remedies can include repair, replacement, refund, cancellation, or compensation depending on the situation.                                                                   | High as general Australian guidance, not advice for a specific product or transaction. Obtain qualified review for actual terms and supported markets. |
| Payment records are personal information and should not become creator analytics by default.                               | The OAIC's [APP 3 guidance](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-3-app-3-collection-of-solicited-personal-information) identifies credit-card payment records as personal information and recommends collection that is relevant, minimal, and reasonably necessary.                                                      | High as current Australian privacy guidance. Re-check applicability, retention duties, cross-border disclosure, and provider roles before collection.  |

## Important distinctions

| Concern                   | Product question                                                                     | What it must not imply                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Support                   | Can a person voluntarily give a creator value with clear terms?                      | Purchase of friendship, influence, visibility, trust, or moderation priority.          |
| Membership                | What recurring benefits and cancellation terms are promised?                         | Ownership of all future work, permanent access, or a hidden recurring charge.          |
| Digital good              | Which immutable artifact/version, licence, and access receipt were purchased?        | Ownership of the creator's account, source material, identity, or unrelated revisions. |
| Entitlement               | What access does a completed, refunded, disputed, or revoked transaction confer now? | The payment provider becoming the source of Thingtime authorization truth.             |
| Payment rail              | Which provider moves money and reports external events?                              | Provider metadata becoming a public profile, content score, or recommendation feature. |
| Seller and merchant roles | Who offers, fulfils, taxes, refunds, supports, and bears loss?                       | A UI label silently deciding legal or financial responsibility.                        |
| Discovery                 | How can relevant work be found fairly?                                               | Paying for ranking, badges, safety exceptions, or privileged evidence.                 |

## Strengths to compound

- Subscription tiers, quotas, assignment history, and ledger concepts already
  distinguish product entitlement from a future billing provider.
- Thingtime's canonical Things model can represent bounded, versioned receipts
  and entitlements without embedding an unbounded transaction history.
- Existing authorship, provenance, moderation, app-release, export, and deletion
  plans provide reusable contracts for a paid artifact.
- API-only writes, named collection helpers, explicit capability manifests,
  idempotency, and atomic accounting are suitable foundations for eventual
  provider-event ingestion.
- The marketplace proposal already says payment rails and product truth should
  remain separate.

## Gaps before fair value exchange is a contract

1. **No approved role model.** Seller, merchant of record, payment facilitator,
   platform, creator, fulfiller, supporter, and rights holder are not assigned.
2. **No product-truth object.** There is no canonical offer, order, receipt,
   entitlement, fulfilment, refund, dispute, or payout state machine.
3. **No provider-event boundary.** Webhook authenticity, replay, ordering,
   reconciliation, failure recovery, and data minimisation are unspecified.
4. **No terms-and-remedies contract.** Price display, currency, taxes, renewal,
   cancellation, refund, dispute, fulfilment, and support responsibilities are
   not made legible to both sides.
5. **No creator safety boundary.** Pseudonymity, public earnings leakage,
   coercive gifts, fraud, harassment through transactions, sanction appeals,
   and safe account exit are undefined.
6. **No fairness gate.** Fees, reserves, payout timing, access, discovery, and
   support could become opaque or discriminatory without an approved review.
7. **No operational capacity proof.** Fraud, chargebacks, negative balances,
   complaints, tax records, identity reviews, and provider incidents need
   named owners and budgets before launch.

## Proposed minimum product truth

If the owner approves a pilot, keep these records conceptually separate and
relational. Names and schemas remain undecided.

| Record         | Minimum meaning                                                                                     | Boundary                                                                                     |
| -------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Offer          | Creator, artifact/version, price/currency, terms version, availability, fulfilment promise          | Public projection excludes private payout and identity data.                                 |
| Order          | Buyer intent, offer snapshot, seller/merchant roles, totals, idempotency key, status                | Created only through an authorized API path; no card data.                                   |
| Provider event | Provider/type/id, verified receipt time, bounded payload hash/reference, processing result          | Immutable evidence; deduplicated and replay-safe; raw payload retention separately approved. |
| Receipt        | Finalized transaction facts, terms version, line items, taxes/fees where applicable, remedy contact | Exportable to the parties; never a public popularity signal.                                 |
| Entitlement    | Subject, artifact/version, capability, start/end, source order, current reasoned state              | Authorization derives from canonical state, not a browser callback.                          |
| Remedy case    | Refund/cancellation/dispute request, evidence boundary, decisions, appeal, outcome                  | Separate from moderation; access-controlled and retention-bounded.                           |
| Payout ledger  | Amounts owed, fees, reserves, reversals, settlement references, reconciliation state                | Private to authorized creator and operators; not embedded on profile/content.                |

## Privacy, safety, and access boundaries

- Never collect or store raw card numbers, bank credentials, identity documents,
  provider secrets, or full provider payloads merely because they are
  available. Prefer provider-hosted collection and bounded references.
- Keep payment, tax, identity, payout, dispute, and earnings data private by
  default. Define purpose, access, retention, deletion exception, export, and
  audit behavior for every field.
- A creator may use a public pseudonym even if a payment provider or operator
  must privately verify a legal identity. Never reveal the private identity as
  a purchase receipt, badge, search signal, or moderation shortcut.
- A payment cannot buy trust, reach, endorsement, safety immunity, faster
  appeals, accessibility, export, deletion, or the ability to contact someone.
- Price, currency, recurrence, trial, tax, fees, creator proceeds, fulfilment,
  renewal, cancellation, refund, and dispute paths must be understandable
  before confirmation and remain available afterward.
- Core purchase, cancel, remedy, receipt, and entitlement flows must pass the
  same keyboard, screen-reader, reduced-motion, language, constrained-network,
  and truthful-state gates as other critical journeys.
- Treat gifting, tips, and messages attached to money as abuse surfaces. Allow
  recipients to refuse support, stop repeat transactions, and report conduct
  without losing evidence or exposing private financial facts.

## Candidate pilot boundary

The least ambiguous first experiment is one fixed-price, non-recurring digital
artifact from one invited creator cohort in one approved seller/merchant model
and one jurisdiction. It should use provider-hosted payment collection, no
public sales counts, no paid ranking, no gifting, no split payments, no tips,
no auctions, no physical fulfilment, and no cross-border expansion.

Even that pilot waits for the owner packet, qualified role/terms review,
provider comparison, privacy assessment, operational playbook, and synthetic
end-to-end proof. A membership or recurring subscription should not be the
first flow because renewal, cancellation, partial periods, benefit changes,
failed payment, and continuing entitlement add material ambiguity.

## Open owner questions

1. Is the first value exchange support, membership, a fixed digital good, a
   service, or an app— and why is it safer than the alternatives?
2. Who is seller and merchant of record, and who fulfils, taxes, refunds,
   handles disputes, bears loss, and supports each party?
3. Which country/currency pair and creator cohort form the first honest scope?
4. Which fee components are shown, who pays them, when can they change, and
   what proceeds estimate can be stated before purchase?
5. What is the minimum receipt and entitlement state that remains usable if the
   provider, webhook, creator, or Thingtime is temporarily unavailable?
6. Which records must survive deletion for financial or dispute duties, for how
   long, under whose access, and how is the exception explained?
7. What creator safety, fraud, negative-balance, refund, complaint, and provider
   incident capacity exists before real money moves?
8. How do creators export offers, fulfilment evidence, receipts, entitlements,
   and payout reconciliation without exporting other people's private data?

## Refresh checklist

- Re-run repository and package/route scans for billing, checkout, payment,
  marketplace, entitlement, refund, dispute, payout, and provider work.
- Re-read subscription, quota, marketplace, provenance, portability, safety,
  access, reliability, and developer-ecosystem contracts.
- Re-check provider responsibilities, supported countries/currencies, pricing,
  webhook behavior, data residency, and incident history.
- Obtain qualified legal, tax, privacy, financial-risk, and accessibility
  review for the approved pilot; do not infer it from this planning note.
- Replace every snapshot claim with exact release and live evidence before a
  production launch or public statement.
