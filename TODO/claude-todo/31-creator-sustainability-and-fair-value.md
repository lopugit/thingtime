# 31 — Creator sustainability and fair value 🌻

Status: **🟣 Proposed — owner and qualified review needed**

Evidence: [creator sustainability and fair-value baseline](../../NOTES/creator-sustainability-and-fair-value-baseline.md)

Roadmap: [creator sustainability and fair-value roadmap](../../PLAN/creator-sustainability-and-fair-value-roadmap.md)

## What it is for

Prove one fair, understandable value exchange between a buyer and a creator
without turning payment into reach, trust, identity exposure, safety privilege,
or platform authority. Preserve exact offer/version meaning, durable receipts,
correct entitlements, explainable creator proceeds, and usable remedies through
provider delays, duplication, refunds, disputes, outages, and exit.

This epic is a decision and implementation backlog. It does not authorize a
provider, checkout, fee, public marketplace, real-money pilot, tax position,
identity collection, or production transaction data.

## Current evidence to preserve

- Subscription tiers, assignment history, quotas, and atomic accounting exist
  independently of payment processing.
- Tier price and marketplace price/currency metadata are presentation and
  listing primitives, not evidence of checkout or completed transactions.
- The canonical Things model, API-only writes, protected utilities, relational
  child records, versioned collections, and capability manifest are the data
  and compatibility foundation.
- Authorship, provenance, moderation, portability, accessibility, continuity,
  resource, and trusted-app planning already define non-negotiable boundaries.
- The marketplace research keeps payment rails separate from product truth.

## Dependencies and ownership boundaries

- [`FUNDAMENTALS.md`](../../FUNDAMENTALS.md) and
  [`DECISIONS.md`](../../DECISIONS.md) remain the architecture constraints.
- [TODO 22](./22-trustworthy-adoption-loop.md) owns useful outcomes, privacy-safe
  learning, and aligned business-model evaluation.
- [TODO 23](./23-data-portability-and-exit.md) owns account inventory, export,
  deletion, and closure. Commerce records must distinguish portable party data,
  revoked access, and approved retention exceptions.
- [TODO 25](./25-accessibility-and-language-readiness.md) owns complete-journey
  access, locale, formatting, and translation boundaries.
- [TODO 26](./26-community-safety-and-accountable-moderation.md) owns personal
  safety, reports, moderation decisions, appeals, and remedies. Commerce may
  not buy or bypass them.
- [TODO 27](./27-trusted-developer-ecosystem.md) owns app/artifact publisher,
  release, review, incident, abandonment, and fair-discovery contracts.
- [TODO 28](./28-service-continuity-and-recovery.md) owns truthful degraded
  operation, acknowledged writes, recovery objectives, and incident practice.
- [TODO 29](./29-content-provenance-and-correction-integrity.md) owns artifact
  authorship, version, source/derivation, correction, and dispute context.
- [TODO 30](./30-resource-conscious-reach.md) owns constrained journeys and
  tier-neutral access. Checkout and remedy cannot assume a fast network or
  expensive device.
- Payment-provider evidence never grants authority directly. Canonical
  entitlement state changes only through protected, idempotent API logic.
- Qualified legal, tax, privacy, financial-risk, and accessibility owners must
  review the exact approved pilot; repository planning cannot replace them.

## Phase 0 — Approve one fair-value charter

- [ ] Select one fixed-price, non-recurring digital artifact and immutable
      version as the recommended first candidate.
- [ ] Approve the invited creator/buyer cohort, country, currency, volume/value
      limits, duration, exclusions, and manual stop authority.
- [ ] Name seller, merchant of record, fulfiller, tax, refund, dispute, loss,
      identity-verification, payout, and support responsibility.
- [ ] Approve fee and proceeds display, reserves/holds, payout timing, fee-change
      notice, fulfilment, cancellation/refund, dispute, and support principles.
- [ ] Approve a permanent ban on paid reach, paid trust, paid moderation or
      appeal priority, coercive contact, and public earnings/sales by default.
- [ ] Approve field-level payment, identity, tax, payout, dispute, retention,
      deletion-exception, export, and operator-access boundaries.
- [ ] Compare at least two feasible payment approaches against the same product,
      risk, privacy, access, portability, reliability, cost, and exit criteria.
- [ ] Record the final architecture/provider choice in `DECISIONS.md` only after
      product and qualified owner approval.

**Phase gate:** no schema, endpoint, provider account, webhook, checkout, or
real-money test before every responsibility and stop authority is assigned.

## Phase 1 — Specify provider-neutral state

- [ ] Define relational, versioned offer, order, provider-event, receipt,
      entitlement, fulfilment, remedy, and payout-ledger Things.
- [ ] Define bounded public and party-specific projections. Financial, identity,
      payout, dispute, provider, and earnings fields remain private by default.
- [ ] Snapshot artifact/version, seller/merchant roles, terms version, price,
      currency, taxes/fees, proceeds explanation, and fulfilment promise on the
      order; later edits cannot rewrite a past agreement.
- [ ] Define legal transitions for pending, completed, failed, cancelled,
      expired, refunded, partially refunded, disputed, reversed, revoked, and
      reconciliation-required states where applicable.
- [ ] Define idempotency keys, unique provider event identity, signature-first
      processing, durable receipt-before-side-effect, reordering, retry,
      concurrency, replay, and manual reconciliation.
- [ ] Define which order/remedy/payout children are appended relationally and
      batch-read by kind; never embed unbounded histories on an offer or user.
- [ ] Define export, account closure, creator departure, artifact removal,
      provider exit, and approved retention-exception semantics.
- [ ] Threat-model duplicate charges, forged/replayed events, stale callbacks,
      amount/currency substitution, entitlement forgery, IDOR, payout leakage,
      refund abuse, coercive gifts/messages, creator takeover, and insider access.

## Phase 2 — Register protected API contracts

- [ ] Route every read/write through the Thingtime API and named versioned
      collection helpers; no UI, script, provider callback, or test writes Mongo
      directly.
- [ ] Give every mutation explicit auth, party/role authorization, bounded body,
      field allowlist, rate limit, idempotency, audit receipt, and failure shape.
- [ ] For every new or changed `/api/v1` operation, update the route file, Nitro
      import map, API docs/route registry, semantic capability feature/version,
      client requirement map, compatibility tests, and built-server manifest
      smoke together.
- [ ] Generate the origin-scoped capability manifest from the canonical registry
      and active runtime route map; cover every executable endpoint without
      exposing account, provider, environment, or deployment data.
- [ ] Keep provider adapters behind one narrow interface; product state and API
      contracts cannot expose provider-specific secret or payload shapes.
- [ ] Use transactions or a proven atomic equivalent for state, entitlement,
      ledger, and dedupe changes that must agree.
- [ ] Prove unauthorized callers cannot enumerate offers beyond visibility,
      orders, receipts, entitlements, remedies, provider events, or payouts.

## Phase 3 — Prove a synthetic vertical slice

- [ ] Build a deterministic fake provider and synthetic fixtures; use no real
      card, bank, identity, tax, creator, buyer, or production data.
- [ ] Exercise create offer → buyer intent → signed event → receipt → entitlement
      → fulfilment → refund/dispute → reversal/revoke → export/closure.
- [ ] Inject invalid signatures, duplicate/replayed/reordered/missing events,
      concurrent intents, browser retries, provider timeout, provider outage,
      Thingtime outage, stale clients, and reconciliation conflicts.
- [ ] Prove browser success/cancel redirects never grant or revoke entitlement.
- [ ] Prove terminal UI state always matches durable API state and uncertainty is
      visible rather than converted to success/failure guesses.
- [ ] Verify buyer and creator journeys with keyboard, screen reader, touch,
      reduced motion, 200% zoom, narrow viewport, approved locales/currencies,
      slow/lossy network, refresh, back/forward, and interrupted navigation.
- [ ] Verify logs, errors, analytics, traces, screenshots, support views, and test
      artifacts contain no secrets, raw credentials, identity documents,
      private content, full provider payloads, or public earnings.
- [ ] Prove local export/verifier output preserves party-owned receipts and
      entitlement evidence without leaking the other party's private data.

## Phase 4 — Integrate one approved provider in test mode

- [ ] Prefer provider-hosted payment and identity collection; Thingtime stores
      only approved opaque identifiers, minimal facts, and evidence references.
- [ ] Verify webhook authenticity against the raw request before parsing or
      side effects; fail closed on missing configuration or uncertain origin.
- [ ] Process each verified event once, acknowledge safely, retry bounded work,
      and reconcile provider and canonical state independently of callbacks.
- [ ] Map fees, refunds, disputes, negative balances, reserves, payout delays,
      identity requirements, countries, currencies, and incident behavior to
      the approved role model.
- [ ] Exercise secret rotation, API/webhook version changes, endpoint migration,
      provider suspension, data export/deletion, and reversible provider exit.
- [ ] Document provider data flow, subprocessor/residency boundaries, retention,
      access, support escalation, incident notification, and evidence expiry.
- [ ] Re-run the complete Phase 3 matrix with provider test receipts and exact
      versions; a hosted dashboard screenshot is not acceptance proof.

## Phase 5 — Run one bounded invited pilot

- [ ] Add one operator-visible, fail-closed intake switch that stops new intent
      while preserving receipt, owned access, cancellation, refund/dispute,
      export, and support paths.
- [ ] Show exact item/version, approved seller/merchant identity, totals,
      currency, taxes/fees, estimated creator proceeds, fulfilment, terms,
      cancellation/refund, dispute, privacy, and support before confirmation.
- [ ] Require an explicit final confirmation; no preselected recurrence, hidden
      add-on, false scarcity, countdown pressure, or misleading button copy.
- [ ] Make pending, complete, failed, cancelled, refunded, disputed, revoked,
      and reconciliation-required states consistent and actionable for both
      parties.
- [ ] Let creators pause offers, see private explainable ledger/proceeds, fulfil,
      respond to remedies, export, and exit without exposing buyer data beyond
      the approved fulfilment need.
- [ ] Review fulfilment, remedy timeliness, reconciliation exceptions, support
      load, fraud/loss, accessibility blockers, privacy incidents, creator net
      proceeds, and cohort fairness on a fixed schedule.
- [ ] Keep measurement aggregate and operational. Do not add public sales,
      earnings, conversion, spending, or buyer-value profiles.

## Security, privacy, fairness, and access invariants

- Thingtime never receives or logs raw card numbers, bank credentials, provider
  secrets, identity documents, or unbounded provider payloads.
- Verified events are immutable evidence; corrections are appended and
  attributable. Operators cannot silently rewrite transaction history.
- Financial, identity, tax, payout, dispute, and earnings data is private,
  least-privilege, purpose-bound, retention-bounded, and access-audited.
- Public pseudonymity remains possible even when a provider privately verifies a
  legal identity. Verification does not become a public identity badge.
- Payment never changes feed rank, search rank, trust, moderation, appeals,
  safety controls, account support, accessibility, export, or deletion.
- Purchase and remedy journeys remain understandable across supported language,
  assistive technology, narrow viewport, reduced motion, and constrained network.
- No client redirect, provider dashboard, listing price, or aggregate ledger is
  canonical authority for fulfilment or entitlement.
- A stopped pilot preserves evidence, already-owned access as approved, and all
  cancellation, refund/dispute, export, and support duties.

## Acceptance criteria

- The owner packet fixes one product, cohort, country/currency, responsibility
  matrix, terms/remedies, data boundary, provider criteria, operating limits,
  guardrails, stop authority, and named owners.
- Model tests reject every forbidden transition and prove duplicates, replay,
  reordering, concurrency, stale clients, and partial failure do not duplicate
  charges, receipts, ledger entries, fulfilment, or entitlements.
- API tests prove party/role authorization, bounded input/output, idempotency,
  rate limits, least-privilege projections, relational batching, and audit
  receipts through the real endpoints.
- The built server's capability manifest covers every commerce route and
  versioned semantic feature; clients accept compatible and reject missing or
  breaking requirements.
- Synthetic and provider-test journeys prove complete, refund, dispute, outage,
  reconciliation, export, closure, and provider-exit behavior.
- Buyer and creator flows pass approved accessibility, locale/currency,
  constrained-network, security, privacy, continuity, and resource matrices.
- No secret, credential, identity document, private content, full provider
  payload, earnings, or party-private financial fact appears in logs, public
  APIs, discovery, analytics, screenshots, or error text.
- Two consecutive pilot review windows satisfy every approved fulfilment,
  remedy, reconciliation, support, fraud/loss, accessibility, privacy, and
  fairness guardrail. Gross volume cannot compensate for a failed gate.

## Stop conditions

Stop new transaction intent immediately when:

- any role, legal/tax position, provider responsibility, support duty, or stop
  authority becomes unresolved;
- signature, event persistence, idempotency, reconciliation, totals, ledger, or
  entitlement correctness is uncertain;
- a duplicate charge, unauthorized entitlement, private-data exposure, hidden
  recurrence, misleading total, or unexplained creator deduction occurs;
- refunds/disputes, fraud/loss, negative balances, identity review, complaints,
  accessibility failures, or support backlog exceed approved capacity;
- a provider incident or contract/version change crosses the tested boundary;
  or
- payment influences a prohibited discovery, trust, safety, access, export, or
  deletion surface.

Preserve investigation evidence within the approved retention/access boundary,
notify accountable owners, keep remedies available, and resume only after the
fault is fixed, reconciled, independently reviewed, and the exact matrix passes.

## Concrete next action

Schedule one owner decision packet containing exactly:

1. one fixed digital artifact/version and invited cohort;
2. one country/currency pair and explicit exclusions;
3. seller/merchant/fulfiller/tax/refund/dispute/loss/support responsibility;
4. fees, proceeds, fulfilment, cancellation/refund, dispute, and support terms;
5. private identity/payment/payout data and retention/export/closure boundaries;
6. two provider approaches compared against one rubric;
7. pilot limits, guardrails, operating capacity, and stop authority; and
8. named product, creator, commerce-risk, legal/tax, privacy/security,
   accessibility/language, continuity, support, and finance owners.

Do not begin Phase 1 until the packet is decided.
