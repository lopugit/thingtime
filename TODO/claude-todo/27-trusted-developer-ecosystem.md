# 27 — Trusted developer ecosystem 🧩

**Status:** 🟣 Proposed · planning only · added 2026-09-03

**Owner:** Unassigned; product owner names developer experience, app platform,
security, privacy, accessibility, trust/safety, review, operations, support, and
business owners

**Plan:**
[`PLAN/trusted-developer-ecosystem-roadmap.md`](../../PLAN/trusted-developer-ecosystem-roadmap.md)

**Evidence:**
[`NOTES/trusted-developer-ecosystem-baseline.md`](../../NOTES/trusted-developer-ecosystem-baseline.md)

## Goal

Turn Thingtime's existing app registration, OAuth scopes, app namespaces,
revocation, user-owned data controls, sandbox, API docs, capability manifests,
and bounded action model into one trustworthy developer lifecycle: declare,
test, release, review, authorize, update, contain, remediate, retire, and leave.

This epic does not authorize a marketplace, new protected kinds, review badge,
publisher-verification claim, analytics pipeline, scope migration, or paid
listing by itself.

## Dependencies and boundaries

- [`FUNDAMENTALS.md`](../../FUNDAMENTALS.md) and
  [`DECISIONS.md`](../../DECISIONS.md) remain authoritative.
- [TODO 16](./16-full-power-app-namespaces.md) owns server-stamped `appId`, app
  token fencing, user ownership, cross-user `app-data.shared`, and byte-ledger
  enforcement. A declaration never replaces those controls.
- [TODO 21](./21-app-composition-surface.md) owns folder-backed composed apps
  and must not reuse the protected OAuth `app` kind or `appId` namespace.
- [TODO 20](./20-tester-runs-actions.md) and the Action Thing design own
  execution confirmation and the invariant that capabilities only narrow.
- [TODO 23](./23-data-portability-and-exit.md) owns independently verifiable
  export, restore, selective deletion, and closure. Ecosystem containment must
  preserve owner access to those paths.
- [TODO 25](./25-accessibility-and-language-readiness.md) owns the complete-
  journey matrix and locale contract for developer, review, consent, update,
  incident, appeal, and data-control surfaces.
- [TODO 26](./26-community-safety-and-accountable-moderation.md) owns public
  reports, impersonation, malicious-report handling, reasoned decisions,
  appeals, and privacy-safe transparency. Vulnerability disclosure stays a
  distinct private security process.
- The existing ChatGPT plugin submission handoff is evidence and a reusable
  test-case source, not a general marketplace policy.
- Open PRs, repository files, scan scores, and deployed URLs are not proof of a
  shipped, compatible, or safe release. Recheck exact source, capability,
  review, CI, preview, and live behavior before changing status.

## Phase 0 — Owner decisions

- [ ] Choose the first artifact family. Recommended: registered OAuth apps;
      reference schemas/components/actions/pages without merging their trust
      outcomes.
- [ ] Approve the app declaration fields, public/user/reviewer/platform
      projections, validation/size caps, edit rules, and ownership.
- [ ] Define publisher identity tiers, domain/organization verification,
      expiry, recovery, transfer, and exact non-endorsement wording.
- [ ] Define immutable release identity, dependency/artifact binding, release
      channels, SemVer, capability requirement maps, deprecation, and support.
- [ ] Define which scope, origin, external-effect, dependency, privacy-term,
      or compatibility changes require re-review and/or explicit re-consent.
- [ ] Approve deterministic checks, manual review triggers, receipt evidence,
      limitations, expiry, reviewer roles, conflicts, recusal, and appeal.
- [ ] Approve vulnerability intake, narrow quarantine, communication,
      remediation, restore, abandonment, and end-of-support states.
- [ ] Set honest review/support capacity, measures, fees, ranking boundaries,
      launch gates, and stop conditions.
- [ ] Record accepted architectural and policy forks in `DECISIONS.md`.

**Gate:** no implementation, badge, catalog, or scope migration until this
packet is accepted.

## Phase 1 — Declaration and no-secrets conformance kit

- [ ] Define one versioned declaration registry with purpose, publisher,
      support/security contacts, privacy/terms/data-lifecycle URLs, requested
      scopes, capability requirements, artifact/dependency references,
      supported modes/locales, and end-of-support policy.
- [ ] Generate schema, human docs, examples, and validation messages from that
      one registry. Unknown fields and invalid URLs/scopes fail closed.
- [ ] Extend the existing OAuth sandbox and generated API docs with one guided
      journey: validate → authorize/deny → private write/read → capability
      check → quota denial → revoke → data cleanup.
- [ ] Add positive and negative CLI cases that exercise the real API code paths
      used by registered apps; no direct database seeding or special test-only
      authority.
- [ ] Keep secrets, source archives, reviewer credentials, private payloads,
      user identifiers, and callback query values out of declarations, logs,
      CI artifacts, screenshots, and metrics.
- [ ] Define local-only or aggregate first-success measurement with purpose,
      retention, access, deletion, and a no-analytics option.

## Phase 2 — Immutable release and review receipts

- [ ] Add protected release and review state only after names/shapes are
      approved. Appended review and lifecycle history is relational and batch-
      loaded, never an unbounded embedded array.
- [ ] Bind a release to exact app/publisher, declaration, bytes/source digest,
      dependency/artifact set, requested scopes, origin/callback set,
      capability requirement map, changelog, and rollout channel.
- [ ] Run deterministic declaration, provenance, compatibility, permission-
      diff, secret, dependency, and sandbox checks. Preserve individual results
      and limitations; do not collapse them into an authorization score.
- [ ] Route public writes, external/network effects, sensitive fields, broad
      sharing, action execution, and high-impact automation to manual review.
- [ ] Bind every receipt to exact release and policy/check versions, reviewer
      role, evidence inventory, result, limitations, expiry, and supersession.
- [ ] Prove receipts cannot be replayed across apps, releases, scopes, origins,
      dependencies, capability maps, or data environments.
- [ ] Register every new endpoint in route files, the Nitro import map, API
      docs, semantic capability features/versions, runtime census, and
      compatibility tests together.

## Phase 3 — Authorization and update experience

- [ ] Before authorization, show exact publisher relationship, purpose,
      support/data lifecycle, required/optional/exact scopes, selected Things,
      compatibility, review freshness, limitations, and ecosystem state.
- [ ] Present release updates as a structured diff: scopes, origins/callbacks,
      external effects, artifacts/dependencies, privacy/support, compatibility,
      review state, and end-of-support.
- [ ] Require the approved explicit re-consent for authority expansion; never
      mutate a live token's scopes from declaration or release metadata.
- [ ] Preserve cancel/later, user revoke, developer delete, platform suspend,
      per-entry delete, namespace wipe, export, and orphaned-data access.
- [ ] Design the pre-scope legacy-session migration as a separate reversible
      rollout with notification, expiry/re-consent rules, test cohorts,
      rollback, and no silent widening or data loss.
- [ ] Add desktop/mobile, keyboard, screen-reader, touch, reduced-motion,
      locale, low-bandwidth, stale/offline, error, and account-switching checks
      to `TESTING.md` before promotion.

## Phase 4 — Incident, appeal, transfer, and retirement

- [ ] Add a private vulnerability intake distinct from public product, safety,
      impersonation, and legal reports. Bound submissions and evidence access.
- [ ] Support the narrowest safe quarantine by release, capability, origin, or
      app; keep unrelated apps and user-owned data controls available.
- [ ] Append assignments, evidence access, reasons, actions, communications,
      appeals, remediation, re-review, restoration, transfers, deprecation, and
      retirement as protected events.
- [ ] Ensure restore never resurrects swept tokens, old grants, expired review,
      or compromised publisher credentials.
- [ ] Require re-verification and affected-user clarity for ownership transfer;
      no inherited review badge or hidden maintainer change.
- [ ] Define inactivity and abandonment with multiple signals, notice, grace,
      appeal, user data access, and safe end-of-support behavior.
- [ ] Exercise leaked token, malicious update, dependency compromise,
      maintainer takeover, false report, stalled review, platform outage,
      partial quarantine, failed notification, appeal, and rollback.

## Phase 5 — Discovery and sustainability

- [ ] Open discovery only for releases meeting approved identity, support,
      compatibility, current review, accessibility, safety, and data-control
      gates.
- [ ] Keep task fit, quality, support, and safe outcomes separate from installs,
      popularity, revenue, sponsorship, and trust decisions.
- [ ] Label sponsorship; prohibit paid review outcomes, paid incident priority,
      pay-to-rank disguised as relevance, or paid access to revoke/export/delete.
- [ ] Publish policy/check versions, review limitations, aggregate ecosystem
      health, removal/appeal/correction paths, and minimum-cohort privacy rules.
- [ ] Evaluate aligned services such as hosted quotas, managed conformance,
      team administration, and support without selling personal data or access.
- [ ] Expand to another artifact family only after two complete review and
      incident-response cycles meet the approved capacity and quality gates.

## Security, privacy, accessibility, and abuse requirements

- Declarations and receipts are evidence, never credentials or runtime
  authorization. Existing server checks remain the source of truth.
- Publisher, release, review, grant, and ecosystem-event identifiers are
  server-minted or cryptographically bound; caller-chosen names never establish
  identity or trust.
- Private source, credentials, tokens, callback parameters, app payloads,
  Things, grants, install graphs, vulnerability evidence, and reviewer notes do
  not enter ordinary analytics, public receipts, or logs.
- New writes use dedicated protected utilities, named versioned collection
  getters, strict field allowlists, body caps, idempotency, fail-closed rate
  limits, current authorization, and audit events.
- Dependency/artifact relationships are relational and bounded. A reviewed
  parent never silently blesses unreviewed or changed children.
- Automated checks expose their versions, inputs, results, and limitations.
  Scores alone never approve, quarantine, rank, or publicly accuse.
- Scope expansion, ownership transfer, and restored access require the exact
  approved user/developer review path and cannot be inferred from prior state.
- Owner browse/export/delete remains available during app suspension,
  deprecation, abandonment, and review expiry unless a separately authorized
  legal/safety hold applies.
- Every user/developer/reviewer surface meets the approved accessibility and
  language matrix; security detail is understandable without color, icon,
  jargon, or hover alone.
- Public reports, reviews, ranking, sponsorship, and appeals resist brigading,
  retaliation, conflicts, self-review, and small-cohort disclosure.

## Acceptance criteria

- The first artifact family, declaration, publisher tiers, release identity,
  review triggers, consent/update rules, incident states, capacity, metrics,
  fees, and stop conditions are approved and linked from the roadmap and
  decision log.
- A new developer completes the documented no-secrets sandbox journey and can
  reproduce every required negative case without private support access.
- One registry generates declaration validation, docs, example, and review
  inputs; no drifted duplicate permission or capability vocabulary exists.
- Immutable releases and receipts are content/app/origin/scope/dependency/
  capability bound, append-only, expiring, supersedable, and non-authoritative
  for runtime access.
- Scope and origin changes produce an exact diff; approved expansions require
  explicit re-consent and cannot widen existing tokens.
- User, developer, and platform revocation invalidate every affected token;
  suspension/restore never resurrects one; unrelated credentials remain live.
- Users can inspect, export, delete entries, and wipe orphaned app namespaces
  while app execution or review is suspended.
- Quarantine is narrow, audited, reversible where safe, and paired with factual
  developer/user communication, remediation, appeal, and restoration.
- Publisher transfer and abandonment preserve history and user choices without
  transferring credentials, grants, reviews, or identity claims silently.
- Every external endpoint is documented, runtime-registered, semantically
  versioned, manifest-covered, and gated by an explicit client requirement map.
- Real-API automated tests and live desktop/mobile journeys cover happy,
  denial, legacy, update, stale/offline, revocation, quarantine, appeal,
  accessibility, locale, account-switching, custom-origin, and provider-outage
  paths.
- Metrics contain no private payload/source/grant/install data, show separate
  security/privacy/accessibility/safety/support/cost guardrails, and can be
  disabled and deleted without breaking core use.
- Discovery and paid services cannot override review, ranking integrity,
  incident response, baseline data controls, or correction/appeal rights.

## Concrete next action

Prepare one owner decision packet containing:

1. recommended first artifact family and deferred families;
2. declaration and publisher-identity tables;
3. release, dependency, SemVer, capability, and permission-diff model;
4. automated/manual review matrix and receipt lifecycle;
5. install/update/re-consent and legacy-grant migration proposal;
6. incident, quarantine, appeal, transfer, abandonment, and restore state
   machine; and
7. launch capacity, measures, funding boundaries, and stop conditions.

Do not begin Phase 1 until that packet is approved.
