# 51 — Affordability agency and fair access

Status: 🟣 Proposed · owner and qualified review needed

Evidence: [baseline](../../NOTES/affordability-agency-and-fair-access-baseline.md)

Plan: [roadmap](../../PLAN/affordability-agency-and-fair-access-roadmap.md)

## Goal

Make Thingtime's own free and paid access understandable, stoppable,
privacy-preserving, and humane: protect an essential free floor, show total
cost and renewal before acceptance, keep cancellation easy, and preserve data,
security, exit, and remedy through payment failure or downgrade.

## Why this belongs in the garden

Thingtime already has versioned tier/quota metadata, protected subscription
assignments, usage ledgers, tier cards, and Lopu credit history. Those are
valuable product-accounting primitives, but they do not prove a current offer,
purchase, settlement, renewal, cancellation, refund, grace, or affordability
program. Without an explicit contract, future monetization could accidentally
turn a small periodic price into a hidden commitment, make stopping harder than
joining, collect sensitive hardship data, or hold safety and user data hostage.

This TODO creates the decision and rehearsal boundary before real money or a
public paid-access claim enters the system.

## Dependencies and boundaries

- [TODO 23](./23-data-portability-and-exit.md) owns export, deletion, restore,
  and closure. Paid state never bypasses or blocks it.
- [TODO 25](./25-accessibility-and-language-readiness.md) owns full-journey
  accessibility and localization foundations.
- [TODO 31](./31-creator-sustainability-and-fair-value.md) owns creator/buyer
  transactions, fulfilment, proceeds, and marketplace risk. This TODO owns
  Thingtime's own service-access contract.
- [TODO 33](./33-ai-agency-and-accountable-assistance.md) owns AI authority;
  AI cannot infer hardship, choose a price, or authorize a charge.
- [TODO 35](./35-identity-agency-and-context-safe-presence.md) owns identity
  and private projections for any separately approved eligibility record.
- [TODO 46](./46-evidence-agency-and-accountable-product-claims.md) owns every
  “free,” “save,” “unlimited,” “fair,” or affordability claim.
- [TODO 47](./47-support-agency-and-accountable-remedy.md) owns shared support
  intake and handoff; billing decisions remain with accountable domain owners.
- [TODO 48](./48-change-agency-and-humane-product-evolution.md) owns material
  price/entitlement change, migration, rollback, retirement, and exit.
- `FUNDAMENTALS.md` and `DECISIONS.md` remain authoritative. This TODO approves
  no payment provider, public price, live entitlement, or legal conclusion.

## Phase 0 — establish the safe current posture

- [ ] Name product, consumer/legal, tax, privacy, security, accessibility,
      finance, support, operations, and data owners plus manual stop authority.
- [ ] Inventory tier catalog/revisions, assignments, quotas, storage ledgers,
      Lopu credits, top-up links/requests, legal copy, analytics, support,
      portability, native purchases, provider settings, and public claims.
- [ ] Label catalog metadata, requests, grants, and external links accurately;
      do not describe them as settled purchases or current commercial offers.
- [ ] Freeze real-money experiments, personalized pricing, and production tier
      changes until the owner packet is approved.

## Phase 1 — approve the essential floor and state machine

- [ ] Define the free essential floor across safety, privacy, security,
      accessibility, authentication, data read, export, deletion, support,
      appeal, and correction.
- [ ] Define offer, intent, authorization, provider attempt, settlement,
      entitlement, failure, grace, cancellation, expiry, refund, dispute, and
      correction as separate versioned states.
- [ ] Assign one owner, transition source, evidence source, visible label,
      idempotency key, retention rule, and allowed effect to every state.
- [ ] Prohibit payment state from becoming identity assurance, trust, rank,
      moderation priority, safety access, or public profile status.

## Phase 2 — specify offer, receipt, and change contracts

- [ ] Define an immutable offer snapshot: product/version, seller/provider,
      price/currency, period, minimum total, taxes/unavoidable fees, renewal,
      trial if any, included limits, cancellation, grace, refund/dispute,
      privacy, support, and terms/capability versions.
- [ ] Define an owner-private receipt and reconciliation record without raw
      payment details, secret provider payloads, or public popularity signals.
- [ ] Require recent authentication and an exact operation identity for
      acceptance, cancellation, refund, and retry.
- [ ] Route price, inclusion, quota, renewal, provider, and cancellation changes
      through TODO 48 with old offer/receipt history preserved.

## Phase 3 — prototype one synthetic choice

- [ ] Use adult internal reviewers, synthetic accounts, fixed invented AUD
      prices, one exact non-production build, and a deterministic local fake
      provider.
- [ ] Compare the current Free baseline with one monthly fixed-price proposal;
      show minimum total, renewal, inclusions, limits, essential floor,
      cancellation, grace, and remedy at equal prominence.
- [ ] Add plain-language comprehension before synthetic acceptance and equally
      reachable decline/cancel controls with no urgency or loss framing.
- [ ] Preserve one immutable synthetic offer and receipt; grant no production
      entitlement and move no money.

## Phase 4 — rehearse failure, grace, downgrade, and exit

- [ ] Exercise refusal, timeout, duplicate callback, late success, reversal,
      cancellation, price-version mismatch, grace, recovery, downgrade,
      export, deletion, and support escalation.
- [ ] Recheck current identity, offer, entitlement, and operation identity
      before every effect; duplicate or reordered events must converge.
- [ ] Preserve the essential floor and existing data through every path; never
      surprise-delete, lock export/deletion, or coerce payment.
- [ ] Show effective time, remaining access, retained data, next action, remedy,
      and correction state without exposing provider secrets.

## Phase 5 — privacy, accessibility, evidence, and cleanup

- [ ] Test keyboard, touch, screen reader, reduced motion, 200% zoom, narrow
      screens, plain language, locale/currency variation, and cognitive load.
- [ ] Prove no income, hardship, health, disability, family, location, child,
      or behavioral inference is required for the synthetic journey.
- [ ] Define aggregate minimum-necessary measures for comprehension,
      cancellation, remedy, grace, access parity, support load, provider cost,
      and sustainable contribution—never conversion/retention alone.
- [ ] Delete all synthetic accounts, offers, receipts, events, local messages,
      caches, and analytics fixtures; record cleanup proof and open decisions.

## Acceptance criteria

- The essential floor is explicit, testable, and unchanged by synthetic
  payment failure, cancellation, grace expiry, or downgrade.
- A reviewer can state minimum total, period, renewal, cancellation effect,
  grace, data outcome, and remedy before accepting.
- Accept, decline, and cancel are equally discoverable and accessible; no
  countdown, preselection, obstruction, shaming, or artificial urgency exists.
- Offer and receipt versions preserve what was shown and accepted; mutable tier
  metadata cannot rewrite history.
- Provider result and canonical entitlement remain separate and reconcile
  idempotently across duplicate, late, missing, or reordered events.
- Export, deletion, security, accessibility, support, appeal, and correction
  remain available without payment.
- Assistance requires no sensitive-trait inference and creates no public or
  reusable hardship label.
- No real money, provider credential, production entitlement, personal data,
  contact, or public claim enters the pilot.

## Hard stops

- Real payment, refund, charge, tax, invoice, provider account, or credential.
- Production price, quota, entitlement, legal copy, or public claim change.
- Personalized price or eligibility based on behavior or sensitive traits.
- Hidden total, fee, renewal, default, trial conversion, or cancellation effect.
- Data loss, blocked exit, inaccessible control, manipulative friction, or
  safety/privacy/security/support capability withheld for payment.
- Unclear seller, provider, tax, refund, dispute, retention, or support owner.
- Real hardship evidence, minors, institutions, or high-impact eligibility.
- Failed reconciliation, unbounded retention, or absent qualified review.

## Concrete next action

Convene the named owners for a 60-minute decision review of the baseline and
roadmap. Approve or reject: (1) the essential-floor matrix, (2) state
vocabulary, (3) one invented monthly AUD offer, (4) immutable offer/receipt
fields, (5) cancellation/grace/downgrade rules, (6) privacy and accessibility
test matrix, (7) measures and stop thresholds, and (8) cleanup proof. If any
owner or responsibility is missing, keep the proposal documented and do not
prototype it.
