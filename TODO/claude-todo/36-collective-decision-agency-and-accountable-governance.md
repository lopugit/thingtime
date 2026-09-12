# 36 — Collective decision agency and accountable governance

**Status:** Proposed · owner and qualified review needed

**Evidence:**
[Collective decision agency and accountable governance baseline](../../NOTES/collective-decision-agency-and-accountable-governance-baseline.md)

**Plan:**
[Collective decision agency and accountable governance roadmap](../../PLAN/collective-decision-agency-and-accountable-governance-roadmap.md)

## Objective

Turn Thingtime's poll and vote primitives into one bounded, understandable,
privacy-aware advisory-decision contract. Start with a synthetic, non-sensitive
question in one private adult test group. A tally must never be presented as
consent, truth, representativeness, legitimacy, authority, or implementation.

## Required owner decisions before implementation

- [ ] Approve the exact decision, meaningful influence, organizer, final
      authority, affected people, advisory effect, and response commitment.
- [ ] Approve eligible accounts, cutoff, exclusion/appeal, duplicate-account
      boundary, and explicit statement that an account is not proof of a person.
- [ ] Approve immutable question, context, option order, abstain, open/close,
      hidden interim totals, change/withdrawal, tie, insufficient-participation,
      cancellation, certification, challenge, and implementation states.
- [ ] Approve privacy, audit-access, retention, deletion, export, backup,
      support, incident, and no-analytics boundaries for individual choices.
- [ ] Approve the adult/synthetic cohort, environments, information packet,
      accessibility/language profiles, evaluation, support, and stop authority.
- [ ] Name product, governance, privacy, security, accessibility/language,
      safety, legal, reliability, operations, support, and incident owners.
- [ ] Explicitly exclude public/binding/secret elections, personhood proof,
      minors, institutions, money, rights/access changes, moderation outcomes,
      and sensitive or high-impact domains.

No unchecked item above is permission to engineer or recruit participants.

## Dependencies and boundaries

- [ ] Preserve [`FUNDAMENTALS.md` §3](../../FUNDAMENTALS.md): protected writers,
      relational children, versioned getters, bounded aggregation, and safe
      projections.
- [ ] [TODO 23](./23-data-portability-and-exit.md) owns export, deletion,
      closure, retention, and verified exit.
- [ ] [TODO 24](./24-attention-agency-and-calm-use.md) owns calm invitations and
      notifications; never optimize pressure or participation volume.
- [ ] [TODO 25](./25-accessibility-and-language-readiness.md) owns shared
      accessibility and locale foundations.
- [ ] [TODO 26](./26-community-safety-and-accountable-moderation.md) owns
      reporting, moderator authority, appeal, and safety remedies.
- [ ] [TODO 28](./28-service-continuity-and-recovery.md) owns truthful writes,
      degradation, restore evidence, and incidents.
- [ ] [TODO 29](./29-content-provenance-and-correction-integrity.md) owns
      revisions, sources, corrections, disputes, and portable receipts.
- [ ] [TODO 34](./34-collaboration-agency-and-shared-stewardship.md) owns
      collaboration roles; membership is not electorate eligibility.
- [ ] [TODO 35](./35-identity-agency-and-context-safe-presence.md) owns account,
      proofing, presentation, role, and authorization distinctions.

## Phase A — Freeze current behavior

- [ ] Characterize poll compose, shape, option bounds, tallies, one-account
      unique slot, move/unvote, concurrency, ACL visibility, projections,
      optimistic rollback, deletion, and capability negotiation.
- [ ] Prove `closesAt` is display-only, ballot options remain mutable, and
      out-of-range historic votes are omitted after option edits.
- [ ] Trace vote data through feeds, profiles, shares, search, trending, caches,
      logs, metrics, notifications, support, exports, backups, and restore.
- [ ] Inventory account multiplicity, subspace/community membership, block,
      ban, deletion, account switch, and custom endpoint effects.

## Phase B — Register a protected decision state machine

- [ ] Define immutable proposal/ballot versions, eligibility snapshots,
      participation records, final results, organizer responses, and challenges
      as bounded relational Things with server-owned keys.
- [ ] Define allowed transitions among draft, open, closed, cancelled, disputed,
      certified, responded, implemented, declined, delayed, and superseded.
- [ ] Authorize every transition against the current account, eligibility,
      membership, ballot version, server time, decision authority, and state.
- [ ] Register any new endpoint in route source, Nitro import map, API docs,
      capability registry/manifest, and explicit client requirements.
- [ ] Add bounded bodies, field allowlists, indexes, idempotence, rate limits,
      quotas, retention, audit access, safe errors, migrations, and rollback.

## Phase C — Build informed, private participation

- [ ] Show purpose, organizer, authority, eligibility reason, exact ballot,
      sources, timing, interim visibility, result rule, expected effect,
      withdrawal, retention, challenge, and support before voting.
- [ ] Provide Vote, Change, Withdraw, and Abstain actions until an enforced
      server close; distinguish no response from abstention.
- [ ] Hide pilot interim totals and keep individual choices out of public
      projections, caches, analytics, logs, notifications, and ordinary support.
- [ ] Make selection, pending, accepted, failed, stale, withdrawn, open, and
      closed states accessible and truthful on desktop and mobile.
- [ ] Reject late, ineligible, stale-version, blocked, cancelled, replayed, or
      cross-account writes without exposing protected electorate details.

## Phase D — Close, report, respond, and remedy

- [ ] Close once against server time, freeze the accepted set, and apply the
      approved quorum/threshold/tie/insufficient-participation rule.
- [ ] Publish eligible denominator, participation, abstention, failed/excluded
      counts, final option counts, rule, limitations, and certification owner.
- [ ] Require an organizer response by the declared time: implemented,
      declined, delayed, or superseded, with a clear explanation.
- [ ] Implement bounded challenge, recount, correction, cancellation, appeal,
      support, and incident routes while preserving prior evidence.
- [ ] State what can be corrected or deleted and what aggregate or recipient-
      received information cannot truthfully be recalled.

## Phase E — Validate the complete pilot

- [ ] Unit-test immutability, transitions, eligibility, unique slots, server
      deadlines, change/withdrawal, abstention, result rules, authorization,
      projections, retention, indexes, and capability compatibility.
- [ ] Integration-test races, stale tabs, account/endpoint switch, block/ban,
      delete/restore, cancelled/disputed ballots, ties, low turnout, retry,
      backup/restore, result correction, and organizer response.
- [ ] Exercise the real information, vote, change, withdraw, abstain, close,
      result, response, challenge, and support paths through the real API.
- [ ] Complete keyboard, touch, screen-reader, zoom/reflow, reduced-motion,
      locale, slow-network, offline, error, retry, and recovery journeys.
- [ ] Inspect responses, HTML, DOM, URLs, caches, logs, metrics, traces, errors,
      notifications, exports, backups, and support views for choice leakage.

## Phase F — Run and report one bounded cohort

- [ ] Use consenting adults, synthetic accounts, and one non-sensitive advisory
      decision that changes no rights, access, money, work, school, health,
      safety, moderation status, or public representation.
- [ ] Measure contract comprehension, ballot stability, inclusion barriers,
      privacy incidents, correction/remedy, reliability, and organizer response
      separately; do not optimize turnout.
- [ ] Retain only approved aggregate or redacted structured-session evidence;
      no individual choices, free-text reasons, identity graphs, or screenshots.
- [ ] Review every failure and affected-person remedy before aggregate claims.
- [ ] Publish cohort, contract version, conditions, exclusions, denominators,
      failures, incidents, remedies, deletions, result, response, limitations,
      owners, and refresh date.

## Acceptance criteria

- [ ] Participants can explain purpose, organizer, decision authority,
      eligibility, ballot version, close, privacy, rule, effect, and remedy.
- [ ] Every accepted action binds to one immutable ballot and eligibility
      snapshot; late, duplicate, ineligible, and stale writes fail closed.
- [ ] One account slot is described honestly and never marketed as one person.
- [ ] Vote, change, withdrawal, abstention, non-participation, failure, and
      exclusion remain distinct in state, tally, copy, and reports.
- [ ] No individual choice reaches an unauthorized response, cache, log,
      notification, analytic, export, backup, support view, or participant.
- [ ] Interim totals remain hidden for the pilot and final reporting includes
      the eligible denominator and material limitations.
- [ ] Tally, result, certification, organizer response, and implementation
      status are separate, reproducible, and correctable.
- [ ] Every approved accessibility, language, device, network, privacy,
      security, safety, continuity, challenge, and support journey passes.

## Stop conditions

Pause intake and disable the narrowest affected capability if eligibility,
ballot, timing, or decision rules change silently; invalid votes count; choices
leak or become inferable; coercion, retaliation, brigading, manipulation, or
exclusion cannot be contained; failures disappear from reporting; or tally,
result, response, challenge, and remedy cannot reach the approved state.

Resume only after containment, affected-person communication where appropriate,
root-cause evidence, repair, regression proof, cleanup, and owner approval.

## Explicit non-goals

- No public or binding election, civic process, workplace or school vote,
  financial allocation, moderation verdict, rights/access decision, or mandate.
- No secret/anonymous ballot, identity proofing, proof of personhood, biometrics,
  delegated/quadratic/ranked/token-weighted voting, or prediction market.
- No turnout nudges, streaks, live leaderboards, public vote histories,
  popularity ranking, targeted persuasion, or participation-pressure analytics.
- No claim that account uniqueness, a majority, quorum, profile, role,
  credential, signature, or tally proves consent, truth, representativeness,
  legitimacy, fairness, authority, or completed implementation.
