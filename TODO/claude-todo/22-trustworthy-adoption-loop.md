# 22 — Trustworthy adoption loop 🌱

**Status:** 🟣 Proposed · planning only · added 2026-09-01

**Owner:** Unassigned; product owner decides the first-value journey

**Plan:** [`PLAN/trustworthy-adoption-roadmap.md`](../../PLAN/trustworthy-adoption-roadmap.md)

**Evidence:** [`NOTES/ethical-adoption-baseline.md`](../../NOTES/ethical-adoption-baseline.md)

## Goal

Turn Thingtime's many useful creation, search, composition, and sharing surfaces
into one measurable, consentful loop:

1. understand the product;
2. create or import something useful;
3. find and continue it later;
4. share only by choice;
5. help recipients or collaborators get value safely; and
6. learn enough to improve without collecting private content or optimizing
   compulsive engagement.

## Problem

The roadmap contains strong individual ideas—search, history, theme and
algorithm sharing, account invites, components, actions, and composed apps—but
no shared outcome contract sequences them. Raw signup or page-view growth would
be easy to measure and easy to game. It would not prove Thingtime is useful,
trustworthy, accessible, or sustainable.

This epic creates the contract and the smallest first-value journey. It does
not authorize a telemetry vendor, new collection, endpoint, or production
experiment by itself.

## Dependencies

- [`FUNDAMENTALS.md`](../../FUNDAMENTALS.md) and
  [`DECISIONS.md`](../../DECISIONS.md) remain the architectural constraints.
- [TODO 25](./25-accessibility-and-language-readiness.md) owns the shared
  complete-journey accessibility and locale release gates. Adoption work may
  not replace them with one-off checks or an aggregate score.
- [TODO 26](./26-community-safety-and-accountable-moderation.md) owns personal
  block semantics, report/case state, scoped moderation, appeals, remedies, and
  privacy-safe safety transparency. Sharing or community growth must not create
  an experiment-specific enforcement path.
- [TODO 27](./27-trusted-developer-ecosystem.md) owns publisher declarations,
  immutable releases, review receipts, app permission/update clarity,
  ecosystem incidents, abandonment, and fair discovery. Creator growth must
  not invent a popularity-based trust badge or parallel app review contract.
- [TODO 28](./28-service-continuity-and-recovery.md) owns journey service
  objectives, safe degradation, truthful write outcomes, restore proof,
  incident operations, and dependency resilience. Adoption experiments must
  not hide reliability failures behind aggregate conversion or engagement.
- [TODO 29](./29-content-provenance-and-correction-integrity.md) owns material
  edit visibility, revision evidence, source and derivation assertions,
  platform-assistance disclosure, corrections, disputes, and portable receipts.
  Sharing experiments must not collapse those claims into an authenticity badge
  or leak private source material.
- [TODO 10](./10-delight-and-growth-ideas.md) is the idea bank; this epic adds
  sequencing and outcome gates.
- [TODO 18](./18-account-invite-links.md) owns the defensive account-invite
  contract.
- [TODO 20](./20-versioned-experience-history.md) owns durable experience
  restore; do not build a second history path here.
- [TODO 21](./21-app-composition-surface.md) owns folder-backed composed apps
  and the `app`/`appId` namespace constraint.
- [TODO 23](./23-data-portability-and-exit.md) owns the independently verifiable
  export, restore, selective deletion, and account-closure contract required
  before “no lock-in” becomes a proven adoption claim.
- [TODO 24](./24-attention-agency-and-calm-use.md) owns feed continuation,
  ranking-versus-training control, corrective feedback, explanations, calm
  stopping points, and notification defaults. Useful return cannot treat more
  scrolling, training events, or notification opens as success.
- Open PRs are evidence of active work, not dependencies that may be assumed
  merged. Recheck their head, base, review, CI, preview, and shipped behavior
  immediately before implementation.

## Phase 0 — Decide before collecting

- [ ] Select one first-value journey. Recommended starting candidate:
      create/import a private Thing, navigate away, and find/open it again.
- [ ] Define eligible participants, numerator, denominator, exclusions,
      evaluation window, and minimum cohort size.
- [ ] Assign accountable owners for product, privacy/security, accessibility,
      reliability, abuse/moderation, and cost.
- [ ] Inventory local-only research, aggregate operational counters, support
      evidence, and structured usability sessions that can answer the question
      without server product analytics.
- [ ] Approve a signal allowlist and denylist. The denylist includes Thing
      content, search text, full URLs, private identifiers, invite tokens,
      credentials, message text, profile fields, contact graphs, and external
      endpoint details.
- [ ] Record any decision to retain product signals in `DECISIONS.md`, including
      purpose, schema, aggregation, retention, access, deletion, opt-out, and
      incident handling.

**Phase gate:** no instrumentation code or vendor integration before these
checkboxes are approved.

## Phase 1 — Prove first value

- [ ] Map the shortest honest create/import → persist → leave → find → reopen
      path on desktop and mobile.
- [ ] Provide one accessible example that a person explicitly copies or edits;
      never silently seed hidden account data.
- [ ] Explain default privacy, persistence, export, and deletion at the moment
      each matters.
- [ ] Preserve prior/cached state optimistically and surface background errors
      through Lopu instead of replacing useful state with a spinner.
- [ ] Cover keyboard-only, screen-reader, reduced-motion, touch, narrow viewport,
      offline/stale state, permission loss, and recovery paths.
- [ ] Evaluate the journey with structured sessions or local-only counters
      before introducing server-side product signals.

## Phase 2 — Prove useful return

- [ ] Reuse canonical search, deep links, folders, and versioned experience
      history; no parallel recents/history store.
- [ ] Test account switching and custom data endpoints so cached state cannot
      cross an identity or endpoint boundary.
- [ ] Distinguish exact replay from rerun, moved from deleted, and inaccessible
      from missing.
- [ ] Define a repeat-use outcome that rewards completed work rather than time
      spent in the app.

## Phase 3 — Validate one consentful share

- [ ] Choose one artifact family only after its public projection, provenance,
      revoke/permission behavior, and unauthenticated preview are mature.
- [ ] Give the recipient a useful preview and explicit choices; do not force
      registration or reveal recipient activity to the sender without consent.
- [ ] Threat-model spam, impersonation, token/referrer leakage, enumeration,
      unsafe foreign rendering, confused-deputy action execution, and report
      load.
- [ ] Add a reversible flag and a stop condition before the experiment starts.
- [ ] Keep account invitations within TODO 18's opaque, expiring, revocable,
      single-use contract and canonical registration path.

## Signal contract, if Phase 0 proves server signals are necessary

The implementation proposal must include all of the following before code
review:

- A versioned registry with semantic signal identifiers and plain-language
  purposes.
- A strict property allowlist and size cap. Unknown properties fail closed.
- Aggregate storage by default. Any short-lived pseudonymous key needs a
  separate written necessity and re-identification review.
- Bounded retention and tested deletion. Product signals cannot survive a
  relevant account/content deletion contrary to the approved contract.
- An admin-only, redacted read path. There is no public person-level analytics
  endpoint.
- API-only writes through dedicated protected utilities; no direct MongoDB
  writer, raw physical collection name, or generic user-authored bypass.
- Capability-manifest registration and compatibility tests for every new or
  changed endpoint.
- Rate limits, body caps, auth, audit records, and a fail-closed kill switch.
- Fork-safe setup docs with placeholders only if private configuration is
  required.

The storage representation is deliberately undecided. Do not create a new kind
or collection until the owner chooses between no server analytics, aggregate
operational counters, and a protected Thing-based signal model.

## Acceptance criteria

- The first-value journey, metric definitions, owners, privacy contract, and
  stop conditions are approved and linked from the roadmap.
- A new contributor can explain what counts as activation and what never gets
  collected without reading implementation code.
- The selected journey passes automated checks plus a live desktop/mobile
  browser walkthrough, including keyboard, reduced-motion, error, and stale
  state paths.
- The journey is tested through the same real API and UI paths used in live
  operation; seed-only or analytics-only success does not count.
- No raw Thing content, search text, private identifier, invite/auth material,
  contact graph, message text, or external endpoint detail appears in signal
  payloads, logs, docs, or dashboards.
- Any optional measurement has an understandable control and core functionality
  remains usable when it is off.
- Security, privacy, accessibility, reliability, abuse, and cost guardrails are
  reported beside the product outcome. One aggregate score cannot hide a
  failing class.
- The experiment can be disabled and its temporary data removed without a
  deploy rollback or destructive database repair.
- Current PR checks, preview behavior, capability manifest, and production
  behavior are verified before the work is marked shipped.

## Concrete next action

Schedule one owner decision packet containing exactly:

1. recommended first-value journey;
2. metric denominator and evaluation window;
3. zero-server-analytics evaluation option;
4. first candidate shareable artifact; and
5. named guardrail owners.

Do not start Phase 1 until the packet is decided. Record real architectural
forks in `DECISIONS.md`; keep rejected alternatives in the evidence note.
