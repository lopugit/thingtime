# Creator sustainability and fair-value roadmap

Status: **Proposed — owner and qualified review required before execution**

Evidence: [creator sustainability and fair-value baseline](../NOTES/creator-sustainability-and-fair-value-baseline.md)

Execution epic: [TODO 31 — Creator sustainability and fair value](../TODO/claude-todo/31-creator-sustainability-and-fair-value.md)

## Outcome

Let creators receive understandable, voluntary value for useful work while
buyers receive clear terms, durable receipts, correct entitlements, and usable
remedies. Keep money separate from trust, reach, safety, identity disclosure,
and canonical product authority.

This roadmap owns the proposed creator-commerce role model, product-truth
records, provider-event boundary, money-state UX, fee/proceeds clarity,
fulfilment, remedies, private payout reconciliation, and operating gate. It
complements rather than replaces:

- the [trustworthy adoption roadmap](./trustworthy-adoption-roadmap.md), which
  owns useful outcomes and aligned sustainability;
- the [data portability roadmap](./data-portability-and-exit-roadmap.md), which
  owns independently verifiable export, deletion, and exit;
- the [community-safety roadmap](./community-safety-and-accountable-moderation-roadmap.md),
  which owns personal boundaries, reports, decisions, appeals, and remedies;
- the [content-provenance roadmap](./content-provenance-and-correction-roadmap.md),
  which owns authorship, artifact revision, source, correction, and dispute
  context;
- the [trusted-developer roadmap](./trusted-developer-ecosystem-roadmap.md),
  which owns app declarations, releases, review, incident recovery, and fair
  discovery; and
- the [accessibility](./accessibility-and-language-readiness-roadmap.md),
  [continuity](./service-continuity-and-recovery-roadmap.md), and
  [resource-conscious reach](./resource-conscious-reach-roadmap.md) gates.

## Non-goals

- Selecting Stripe or another provider before a role, risk, privacy, access,
  portability, jurisdiction, and operations comparison.
- Implementing physical goods, auctions, escrow, lending, investment,
  donations, cross-border tax automation, or multi-party splits in the pilot.
- Selling placement in personal feeds, trust badges, verification, moderation
  outcomes, appeal priority, private data, or user attention.
- Making payment a prerequisite for core accessibility, safety, export,
  deletion, or low-bandwidth controls.
- Treating listing price, checkout success, provider status, or gross volume as
  proof of fulfilment, creator benefit, buyer value, or durable entitlement.
- Publishing creator earnings, sales counts, conversion, refunds, disputes, or
  identity details by default.

## Principles

1. **Roles before rails.** Decide seller, merchant, fulfiller, tax, refund,
   dispute, loss, and support responsibility before provider integration.
2. **Product truth is canonical.** Provider events are evidence inputs;
   Thingtime's protected API state owns offers, orders, receipts, entitlements,
   fulfilment, and remedies.
3. **Money buys only the stated value.** It never buys reach, trust, safety
   exceptions, contact access, or governance power.
4. **Both sides understand the deal.** Terms, totals, recurrence, fees,
   proceeds, fulfilment, cancellation, and remedies are legible before and
   after confirmation.
5. **Private by default.** Financial, tax, identity, payout, and dispute data
   remain purpose-bound, minimal, retention-bounded, and access-controlled.
6. **Reconciliation beats callbacks.** A browser success page is not payment
   proof; signed, deduplicated events and provider reconciliation drive durable
   state.
7. **Exit preserves obligations, not lock-in.** Export and closure distinguish
   portable records, revoked access, retained legal evidence, and deleted data.
8. **Start with one boring flow.** Prove a fixed digital artifact before adding
   recurrence, gifts, tips, splits, or broader discovery.

## Proposed contract layers

| Layer                 | Required artifact                                                                          | Gate                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Roles                 | Seller/merchant/fulfiller/tax/refund/dispute/loss/support matrix                           | Every responsibility has one accountable owner and qualified review.            |
| Offer                 | Immutable artifact/version, terms, price/currency, availability, fulfilment                | Buyer can understand exactly what is offered before intent.                     |
| Order and receipt     | Idempotent intent, totals, terms snapshot, terminal and recoverable states                 | No duplicate charge or entitlement; receipt remains exportable.                 |
| Provider adapter      | Hosted collection, signed events, dedupe, ordering, retry, reconciliation, outage behavior | Browser redirects cannot grant access; replay is safe.                          |
| Entitlement           | Subject, capability, artifact/version, source, duration, reasoned state                    | Authorization is correct across complete, refund, dispute, revoke, and restore. |
| Fulfilment and remedy | Delivery evidence, cancellation/refund/dispute workflow, deadlines, appeal/escalation      | Both parties can act without private-data leakage or support improvisation.     |
| Creator settlement    | Fees, reserves, amounts owed, reversals, payout references, reconciliation                 | Creator sees explainable proceeds; public surfaces see none.                    |
| Operations            | Fraud, complaint, negative-balance, incident, audit, retention, and support playbooks      | Named trained coverage and stop authority exist before real money.              |

## M0 — Approve the fair-value charter

**Outcome:** Thingtime knows which single exchange it is willing and able to
support.

- Choose the first product type, invited cohort, country/currency pair, and
  explicit exclusions.
- Decide seller, merchant of record, fulfiller, tax, refund, dispute, loss,
  identity-verification, and support responsibility.
- Approve fee principles, proceeds display, reserves/holds, payout timing,
  change notice, and a ban on paid reach/trust/safety.
- Approve the terms version, cancellation/refund baseline, fulfilment promise,
  record-retention exceptions, and buyer/creator support paths.
- Complete qualified legal, tax, privacy, financial-risk, accessibility, and
  operational reviews for the selected scope.
- Compare at least two feasible payment approaches against the same contract;
  record the eventual decision in `DECISIONS.md`.

**Gate:** every role and stop authority has one named owner; unresolved
responsibility is a blocker, not an implementation detail.

## M1 — Specify canonical product truth

**Outcome:** one provider-neutral state model explains every user-visible
result.

- Specify relational offer, order, provider-event, receipt, entitlement,
  fulfilment, remedy, and payout-ledger Things with bounded public projections.
- Define versioned states and legal transitions, including pending, completed,
  failed, cancelled, expired, refunded, partially refunded, disputed,
  reversed, and reconciliation-required where applicable.
- Define idempotency, uniqueness, event authenticity, replay, reordering,
  concurrency, retry, and manual-reconciliation behavior.
- Map each state to buyer, creator, operator, export, closure, and incident UX.
- Register any new API operation and route in the canonical capability
  manifest with compatible client requirement tests.

**Gate:** model tests prove forbidden transitions, duplicate events, reordered
events, stale clients, and partial dependency failure cannot mint duplicate or
unauthorized value.

## M2 — Build a synthetic provider-neutral vertical slice

**Outcome:** the complete exchange can be proven without money or production
identity data.

- Use a deterministic fake adapter and synthetic accounts to exercise offer,
  intent, event, receipt, entitlement, fulfilment, refund, dispute, reversal,
  export, and closure.
- Keep payment credential collection outside Thingtime even in the test model.
- Exercise webhook loss, duplication, replay, invalid signatures, delayed and
  reordered events, provider outage, Thingtime outage, and reconciliation.
- Verify keyboard, screen reader, touch, reduced motion, locale/currency,
  narrow viewport, slow network, interrupted navigation, and truthful pending
  states from top to bottom.
- Prove logging and support views redact content, credentials, identity,
  financial details, and full provider payloads.

**Gate:** the synthetic journey passes security, privacy, accessibility,
continuity, portability, and resource reviews with no unresolved critical
failure.

## M3 — Integrate one approved payment rail in test mode

**Outcome:** a provider can supply evidence without owning Thingtime truth.

- Prefer hosted payment and identity collection; store only approved opaque
  identifiers, bounded facts, and reconciliation evidence.
- Verify signatures before parsing business state; deduplicate and persist the
  event receipt before side effects.
- Reconcile on a schedule and on operator request. Surface uncertainty rather
  than guessing after missing or conflicting events.
- Map provider fees, refunds, disputes, negative balances, reserves, identity
  requirements, countries, currencies, and outages to the approved role model.
- Record provider/contract/version, data flows, subprocessors, retention,
  residency, deletion limits, incident path, and exit/migration plan.

**Gate:** provider test-mode receipts reproduce the M2 contract, and a second
implementation path remains possible without changing public product meaning.

## M4 — Operate a bounded invited pilot

**Outcome:** one real exchange is useful and supportable without unfair reach or
surveillance.

- Start with one fixed-price, non-recurring digital artifact and the approved
  cohort, country, currency, limits, and manual stop control.
- Show item/version, seller/merchant identity as approved, price, currency,
  taxes/fees, creator proceeds estimate, fulfilment, terms, refund/cancellation,
  and support before confirmation.
- Show pending, complete, failed, refunded, disputed, revoked, and
  reconciliation-required states consistently to both sides.
- Measure completed fulfilment, successful remedy, support load, reconciliation
  exceptions, fraud/loss, and creator net proceeds using bounded aggregate
  operational facts—never public sales or person-level growth dashboards.
- Review accessibility, constrained reach, complaints, false positives,
  identity safety, payout clarity, and cohort fairness every pilot cycle.

**Gate:** two consecutive review windows meet approved fulfilment, remedy,
reconciliation, support, privacy, accessibility, continuity, and financial-risk
thresholds. Revenue or gross volume cannot override a failed guardrail.

## M5 — Add capabilities one at a time

Recurring membership, tips, gifts, multiple sellers, splits, broader discovery,
new currencies, and new jurisdictions each require a separate owner packet,
state-model delta, provider/risk review, accessible journey matrix, operating
capacity proof, rollback plan, and capability version. None inherits approval
from the fixed-artifact pilot.

## Measures and guardrails

| Measure        | Desired evidence                                                                                           | Guardrail                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Fulfilment     | Completed orders receive the exact promised artifact/version within the approved window.                   | Never mark fulfilled from a browser redirect alone.               |
| Remedy         | Eligible cancellation/refund/dispute requests reach a clear outcome within the approved service objective. | Never hide statutory or approved remedies behind creator absence. |
| Reconciliation | Canonical state matches signed provider evidence or is visibly marked unresolved.                          | Never auto-resolve an ambiguity to improve conversion.            |
| Creator value  | Net proceeds and deductions match the pre-transaction explanation and private ledger.                      | No public earnings, rank boost, or coerced discount.              |
| Buyer trust    | Terms, totals, fulfilment, entitlement, and support remain understandable.                                 | No dark patterns, preselected recurrence, or fake scarcity.       |
| Operations     | Fraud, loss, complaints, manual review, and support remain within approved capacity.                       | Pause intake before backlog harms users.                          |

## Stop conditions

Stop new transaction intent and preserve reconciliation/remedy access when:

- seller, merchant, fulfilment, tax, refund, dispute, loss, or support
  responsibility is unresolved or has changed without approval;
- signature verification, idempotency, event persistence, reconciliation, or
  entitlement correctness is uncertain;
- duplicate charges, unauthorized access, hidden recurrence, incorrect totals,
  private-data exposure, or unexplained payout differences occur;
- refund/dispute, fraud, negative-balance, identity, complaint, accessibility,
  or support capacity crosses an approved threshold;
- a provider outage or contract change exceeds the tested degraded-mode or exit
  boundary; or
- payment affects discovery, trust, moderation, appeals, essential access,
  export, deletion, or another prohibited surface.

Stopping purchase intake must not remove receipts, already-owned access,
cancellation, refund/dispute, export, or support paths.

## First decision packet

The next session should decide exactly:

1. the first fixed digital artifact and invited cohort;
2. the first country and currency;
3. the complete responsibility matrix;
4. fee/proceeds, fulfilment, refund/cancellation, and support principles;
5. private identity, payment, payout, and retention boundaries;
6. the provider-comparison criteria;
7. pilot limits, operating capacity, guardrails, and stop authority; and
8. named product, creator, commerce-risk, legal/tax, privacy/security,
   accessibility/language, continuity, support, and finance owners.

Do not begin M1 until this packet is approved.
