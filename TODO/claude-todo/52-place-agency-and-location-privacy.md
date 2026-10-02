# 52 — Place agency and location privacy

Status: 🟣 Proposed · owner and qualified review needed

Evidence: [baseline](../../NOTES/place-agency-and-location-privacy-baseline.md)

Plan: [roadmap](../../PLAN/place-agency-and-location-privacy-roadmap.md)

## Goal

Make every Thingtime location use explicit, minimal, previewable, stoppable,
and safe: preserve a useful no-location path, separate nearby queries from
stored or published places, use the coarsest sufficient precision, and prevent
silent retention, audience expansion, inference, or reuse.

## Why this belongs in the garden

Thingtime already supports an explicit one-shot browser-location button, a
manual local-tag fallback, validated geospatial queries, optional exact `geo`
on Things, ACL-aware reads, and clearing. Those are useful primitives, but the
same exact coordinates stored on a Thing are projected to every authorized
viewer, while purpose, precision, capture time, expiry, derived-location,
request-log, audience-change, and family-cleanup rules are not one coherent
contract.

This TODO creates that decision and rehearsal boundary before nearby utility
can become tracking, accidental publication, routine inference, or a hidden
input to another system.

## Dependencies and boundaries

- [TODO 25](./25-accessibility-and-language-readiness.md) owns full-journey
  accessibility and localization.
- [TODO 26](./26-community-safety-and-accountable-moderation.md) owns reports,
  protective controls, and moderation remedies after location abuse.
- [TODO 29](./29-content-provenance-and-correction-integrity.md) owns optional
  provenance; place cannot prove presence, authorship, or event truth.
- [TODO 33](./33-ai-agency-and-accountable-assistance.md) owns AI authority;
  models may not infer, enrich, or expand location purpose.
- [TODO 35](./35-identity-agency-and-context-safe-presence.md) owns identity
  and context-safe disclosure.
- [TODO 38](./38-search-and-discovery-agency.md) owns query privacy, ranking,
  and discovery. This TODO owns the location input and disclosure contract.
- [TODO 41](./41-relationship-agency-and-consentful-connection.md) owns
  connection states; no relationship grants location access.
- [TODO 45](./45-youth-safety-and-age-appropriate-agency.md) owns child and
  guardian safeguards; minors are excluded from the first rehearsal.
- [TODO 46](./46-evidence-agency-and-accountable-product-claims.md) owns public
  privacy, locality, safety, retention, and deletion claims.
- [TODO 48](./48-change-agency-and-humane-product-evolution.md) owns any
  changed meaning or migration for existing `geo` data.
- [TODO 49](./49-personalization-agency-and-accountable-memory.md) owns
  inspectable derivatives and forgetting; location history cannot appear by
  inference.
- `FUNDAMENTALS.md` and `DECISIONS.md` remain authoritative. This TODO approves
  no production collection, permission, tracking, or public location change.

## Phase 0 — establish the safe current posture

- [ ] Name product, privacy, safety, security, accessibility, child-safety,
      data, infrastructure, support, and legal owners plus stop authority.
- [ ] Inventory browser/native permission requests, feed/search request URLs,
      root `geo`, listing/free-text place, public projections, indexes, caches,
      logs, analytics, errors, exports, copies, embeds, notifications, and
      support access.
- [ ] Preserve and test the explicit local-feed button, one-shot React state,
      viewer reset, manual tag fallback, and no automatic post attachment.
- [ ] Mark unverified request retention and downstream reuse unknown; freeze
      background tracking, inferred place, and production location experiments.

## Phase 1 — approve the place taxonomy and effect matrix

- [ ] Define device position, chosen point, coarse area, text place, query,
      derived place, repeated observation, stale place, and safety-suppressed
      state without treating them as synonyms.
- [ ] For every surface, approve purpose, minimum precision, source, audience,
      searchability, freshness, expiry, retention, correction, deletion,
      export, copy/embed, and prohibited effects.
- [ ] Prohibit location from becoming proof of identity, presence, authorship,
      trust, eligibility, price, moderation priority, or relationship status.
- [ ] Require a useful tag/text/no-location baseline for every approved task.

## Phase 2 — specify choice, preview, receipt, and cleanup contracts

- [ ] Define a versioned place-choice envelope with value/area, precision,
      source class, purpose, Thing version, audience, effects, freshness,
      expiry, and removal policy—without retaining unnecessary raw coordinates.
- [ ] Define a bounded owner-private purpose receipt and safe aggregate evidence
      that cannot reconstruct a person's movements.
- [ ] Preview precision, audience, discoverability, retention, expiry, copy/
      export behavior, and removal before save or publication.
- [ ] Specify ephemeral one-shot transport, request/log redaction, audience
      change, stale-result fencing, correction, emergency hiding, and
      location-family cleanup.

## Phase 3 — prototype one synthetic nearby-and-place choice

- [ ] Use adult internal reviewers, synthetic accounts, fixed fictional
      coordinates, one fictional region/tag, one private synthetic text Thing,
      and one exact non-production build.
- [ ] Compare a useful tag-only baseline with one-shot nearby search; request no
      real device position and change no production permission.
- [ ] Preview no place, text place, coarse area, and exact point for the
      synthetic Thing; exact publication remains disabled by default.
- [ ] Require reviewers to state search versus storage, precision, audience,
      effect, retention, and removal before synthetic save.

## Phase 4 — rehearse failures, audience change, and safety stopping

- [ ] Exercise denial, timeout, unavailable sensor, stale fix, rapid repeat,
      out-of-order response, viewer switch, changed browser grant, and retry.
- [ ] Exercise private-to-broader audience change, copy, embed, export preview,
      notification, wrong place, correction, clearing, and emergency hiding.
- [ ] Fence each asynchronous result to the initiating viewer, purpose, Thing
      version, and operation identity; stale/cross-account completion is inert.
- [ ] Prove audience expansion never preserves more precision silently and one
      stop prevents further disclosure across the approved location family.

## Phase 5 — privacy, accessibility, evidence, and cleanup

- [ ] Test keyboard, touch, screen reader, reduced motion, 200% zoom, narrow
      screens, plain language, localization, low bandwidth, and no-sensor paths.
- [ ] Verify exact coordinates are absent from unapproved request logs,
      analytics, caches, errors, support captures, notifications, and later
      personalization or AI inputs.
- [ ] Measure task success with/without coordinates, precision reduction,
      comprehension, mistaken publication, correction/removal, safety response,
      access parity, and support load—never engagement alone.
- [ ] Delete all synthetic accounts, Things, points, tags, requests, caches,
      derived values, evidence fixtures, and local messages; record cleanup.

## Acceptance criteria

- Nearby search, stored place, publication, and derivation are visibly distinct
  purposes with no silent authority transfer.
- A useful no-location/tag path remains available and exact coordinates have a
  documented necessity before any separately approved use.
- The person can preview and reduce precision before saving or expanding an
  audience, and broader sharing never increases location detail.
- A one-shot query point is not persisted, published, trained on, or reused and
  is absent from every unapproved log, analytic, cache, and later effect.
- Denial, timeout, stale permission, unavailable sensors, viewer switching,
  duplicates, and reordered responses leave no misleading or cross-account
  location state.
- Location is never treated as proof of identity, presence, authorship, trust,
  relationship, eligibility, or safety.
- Wrong or unsafe location can be fenced, corrected, and removed across the
  approved family without deleting unrelated content.
- No real position, person, contact, production data, permission change,
  tracking, inference, minor, or public privacy/safety claim enters the pilot.

## Hard stops

- A real person's exact, repeated, home, work, route, or routine location.
- Background/passive tracking or collection without a direct current action.
- Public exact coordinates or audience expansion without a fresh preview.
- Location-derived advertising, price, rank, eligibility, moderation,
  identity, relationship, personalization, AI, or law-enforcement effect.
- Minors or domestic, family, stalking, coercion, health, protest, refuge,
  workplace, or other high-risk contexts without qualified protection.
- Inaccessible controls, a broken no-location path, or unclear permission text.
- Unbounded retention, unknown infrastructure capture accepted as safe, failed
  family cleanup, or absent qualified owners.

## Concrete next action

Convene the named owners for a 60-minute decision review of the baseline and
roadmap. Approve or reject: (1) place taxonomy, (2) purpose/effect matrix,
(3) precision ladder and no-location baseline, (4) choice/preview/receipt
fields, (5) request/log minimisation proof, (6) audience-change and family
cleanup rules, (7) safety threat model, (8) accessible synthetic rehearsal,
and (9) measures, stop thresholds, and cleanup proof. If any owner or boundary
is missing, keep the proposal documented and do not prototype it.
