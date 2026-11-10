# Affordability agency and fair-access roadmap

Status: Proposed

Evidence: [affordability agency and fair-access baseline](../NOTES/affordability-agency-and-fair-access-baseline.md)

Execution epic: [TODO 51](../TODO/claude-todo/51-affordability-agency-and-fair-access.md)

## Outcome

Thingtime can sustain useful service through an approved offer while every
person retains an honest free baseline, understands total cost and renewal,
can stop without obstruction, survives payment failure without losing safety
or data, and can seek help without sensitive profiling.

## Principles

- Preserve a useful, safe, accessible, private, and exportable free baseline.
- A displayed price, provider event, entitlement, and settled payment differ.
- Show minimum total commitment and renewal before acceptance.
- Joining, changing, and stopping use equally reachable controls.
- Payment failure never erases data or blocks security, exit, or remedy.
- No sensitive-trait inference, personalized pressure, or pay-to-rank.
- Price and terms changes are versioned material changes, not silent metadata.
- Qualified product, consumer, legal, tax, privacy, security, accessibility,
  finance, support, and operations owners approve real scope.

## Phase 0 — assign authority and protect the current boundary

Name accountable owners and document current tier, quota, Lopu credit, legal,
support, portability, analytics, and provider behavior. Mark clearly that
catalog price metadata and external top-up links are not proof of a shipped
purchase contract.

Gate: no surface describes an unverified tier as purchasable or a credit
request as payment, and one owner can stop the rehearsal.

## Phase 1 — approve the essential floor and offer vocabulary

Define which safety, privacy, accessibility, security, account, data, export,
deletion, support, and appeal functions remain available regardless of payment.
Approve distinct states for offer, consent, authorization, provider attempt,
settlement, entitlement, failure, grace, cancellation, expiry, refund, dispute,
and correction.

Gate: every state has one owner, transition, visible meaning, evidence source,
idempotency rule, retention rule, and allowed effect.

## Phase 2 — specify an immutable offer and receipt contract

Define a versioned offer snapshot containing product/version, seller/provider
roles, price/currency, billing period, minimum total, taxes and unavoidable
fees, renewal default, price-change rule, cancellation timing, post-cancel
access, grace, refund/dispute path, privacy notice, and support route. Specify a
separate receipt that records facts without secrets or raw provider payloads.

Gate: a reviewer can reconstruct what was shown, accepted, charged, granted,
changed, cancelled, and remedied without inferring from mutable catalog data.

## Phase 3 — prototype one synthetic fixed-price comparison

In one exact non-production build, show Free beside one invented monthly AUD
offer. Display the minimum monthly commitment, renewal, included limits,
essential floor, cancellation, grace, and remedy with equal prominence. Add a
plain-language comprehension check and accessible accept/decline/cancel paths.

Use a local deterministic fake provider and synthetic accounts only. A click
creates no production entitlement and moves no money.

Gate: keyboard, touch, screen reader, reduced-motion, narrow-screen, zoom, and
plain-language reviewers can independently state the same offer and stop it.

## Phase 4 — rehearse failure, grace, downgrade, and exit

Exercise authorization refusal, timeout, duplicate callback, late success,
charge reversal, insufficient funds, cancellation before and after renewal,
price-version change, grace expiry, recovery, downgrade, export, deletion, and
support escalation. Recheck current entitlement before each effect and make
every retry reuse the original immutable operation identity.

Gate: no duplicate receipt or entitlement; the essential floor survives every
failure; data is not deleted; export/deletion remain available; and the final
state is explainable to the person and support.

## Phase 5 — evaluate sustainability without surveillance

Review comprehension, mistaken-acceptance reports, cancellation completion,
time-to-remedy, support load, grace recovery, access parity, privacy footprint,
provider cost, and service contribution. Use aggregate, minimum necessary
evidence; do not optimize on acceptance, retention, or spend alone.

Gate: qualified owners either approve one narrower next experiment or archive
the proposal. Delete synthetic fixtures and record unresolved decisions.

## Measures and release policy

| Measure                    | Required interpretation                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Offer comprehension        | Reviewers correctly state total, period, renewal, cancellation, grace, and remedy before acceptance            |
| Choice symmetry            | Accept, decline, and cancel are equally discoverable and require no manipulative extra step                    |
| Essential-floor continuity | Safety, privacy, security, accessibility, data access, export, deletion, and support survive failure/downgrade |
| State integrity            | Duplicate, late, missing, and reordered provider events converge without duplicate effects                     |
| Remedy completion          | A synthetic error can be corrected and explained within the approved service target                            |
| Privacy minimisation       | No income, hardship, health, disability, family, or behavioral profile is needed                               |
| Sustainable contribution   | Approved aggregate revenue/cost evidence supports service without weakening the other gates                    |

No metric is a target until owners approve its definition, source, retention,
minimum sample, accessibility breakdown, and stop threshold.

## Risks and responses

| Risk                                             | Response                                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Periodic price hides total commitment            | Show minimum total at equal or greater prominence                                       |
| “Savings” comparison creates pressure            | Show source periods and assumptions; remove urgency and countdowns                      |
| Cancellation is harder than joining              | Reuse the same authenticated surface and test end-to-end completion                     |
| Failure strands data or coerces payment          | Preserve the essential floor, bounded grace, export, deletion, and support              |
| Provider success is treated as entitlement truth | Require signed/verified event handling plus canonical internal state and reconciliation |
| Discount becomes sensitive profiling             | Use explicit programs with minimal evidence; prohibit inferred vulnerability            |
| Support sees excessive financial data            | Project allowlisted state and provider references, never raw payment details            |
| Price change silently rewrites history           | Pin offer/receipt versions and use TODO 48's material-change contract                   |
| Free tier becomes deliberately unusable          | Publish and continuously test the essential-floor journey                               |
| Sustainability claim outruns evidence            | Route every claim through TODO 46 and show limitations                                  |

## Hard stops

Stop for real money; live provider credentials; production entitlement or
price changes; real financial, hardship, health, disability, family, or child
data; personalized prices; behavioral targeting; hidden or preselected fees;
urgency or obstruction; inaccessible critical controls; unclear seller, tax,
refund, cancellation, data, or support responsibility; failed reconciliation;
unbounded retention; or absent qualified owners.

## Dependencies and boundaries

- TODO 23 owns export, deletion, closure, and verified archives.
- TODO 25 owns accessibility and language readiness.
- TODO 31 owns creator/buyer marketplace value exchange and fulfilment.
- TODO 33 owns AI authority; models do not set prices or infer hardship.
- TODO 35 owns identity and private eligibility evidence.
- TODO 46 owns public pricing, savings, fairness, and affordability claims.
- TODO 47 owns shared support intake and handoff.
- TODO 48 owns price/entitlement change, rollback, compatibility, and exit.
- `FUNDAMENTALS.md` and `DECISIONS.md` remain authoritative.

## Next owner packet

Present the evidence baseline, essential-floor matrix, state vocabulary,
immutable offer/receipt schemas, one synthetic price, provider/seller role
diagram, failure and reconciliation table, cancellation/grace/downgrade rules,
privacy data map, accessibility matrix, measures, stop conditions, cleanup
proof, and the decisions needed before any implementation or public claim.
