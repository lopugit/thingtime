# Collective decision agency and accountable governance roadmap

**Status:** Proposed · owner and qualified review needed

**Evidence:**
[Collective decision agency and accountable governance baseline](../NOTES/collective-decision-agency-and-accountable-governance-baseline.md)

**Execution epic:**
[TODO 36 — Collective decision agency and accountable governance](../TODO/claude-todo/36-collective-decision-agency-and-accountable-governance.md)

## Outcome

Let a bounded group understand, participate in, verify, and challenge one
collective decision without confusing a poll tally with consent, truth,
representativeness, legitimacy, authority, or implementation. Begin with one
non-binding private advisory poll for consenting adults and a synthetic,
non-sensitive decision.

## Non-goals

- Public elections, government or civic decisions, corporate governance,
  employment, education, housing, health, finance, insurance, legal, safety-
  critical, or child-facing use.
- Secret or anonymous ballots, identity proofing, biometric checks, proof of
  personhood, delegated/quadratic/ranked/token-weighted voting, prediction
  markets, referenda, participatory budgeting, or binding mandates.
- Inferring consent, representativeness, community support, expertise, truth,
  or legitimacy from turnout, a majority, account age, profile, role, or tally.
- Public individual vote histories, live participation leaderboards, nudging,
  streaks, popularity ranking, or notifications optimized for turnout.

## Operating principles

1. **Purpose before mechanism.** Use a poll only when participants can influence
   a real but low-stakes choice and the organizer commits to a response.
2. **Authority is explicit.** State who decides, whether input is advisory, what
   can change, and what cannot.
3. **One immutable contract per ballot.** Bind purpose, eligibility, context,
   options, ordering, timing, privacy, and result rule to a version before open.
4. **Account uniqueness is not personhood.** Keep pseudonymous accounts valid;
   describe the exact duplicate and eligibility limits.
5. **Privacy is contextual.** Minimize actor linkage, hide interim totals by
   default, and assess small-group and auxiliary-information disclosure.
6. **Abstention and exit are real.** Non-participation, explicit abstention,
   vote change/withdrawal, and leaving the process have distinct semantics.
7. **Results include denominators and limits.** Publish eligible, participated,
   abstained, failed, excluded, and unresolved counts separately.
8. **Close the feedback loop.** Connect final result to an accountable response,
   implementation state, deviation explanation, challenge, and remedy.
9. **One reversible pilot before expansion.** Every new mechanism, audience,
   authority level, identity rule, or domain requires fresh approval.

## Dependencies and ownership boundaries

- [`FUNDAMENTALS.md` §3](../FUNDAMENTALS.md) owns relational child data,
  protected writes, bounded aggregation, versioned collections, and public
  projections.
- [TODO 23](../TODO/claude-todo/23-data-portability-and-exit.md) owns export,
  retention, deletion, closure, and verified exit.
- [TODO 24](../TODO/claude-todo/24-attention-agency-and-calm-use.md) owns calm,
  user-controlled invitations and notifications; participation must not become
  an engagement target.
- [TODO 25](../TODO/claude-todo/25-accessibility-and-language-readiness.md) owns
  shared accessibility and locale foundations.
- [TODO 26](../TODO/claude-todo/26-community-safety-and-accountable-moderation.md)
  owns reports, moderator jurisdiction, appeals, remedies, and safety access.
  A poll cannot appoint itself as moderation authority.
- [TODO 28](../TODO/claude-todo/28-service-continuity-and-recovery.md) owns
  truthful writes, safe degradation, restore proof, and incidents.
- [TODO 29](../TODO/claude-todo/29-content-provenance-and-correction-integrity.md)
  owns revisions, sources, corrections, disputes, and portable evidence.
- [TODO 34](../TODO/claude-todo/34-collaboration-agency-and-shared-stewardship.md)
  owns artifact roles and contribution authority; collaboration membership is
  not electorate eligibility.
- [TODO 35](../TODO/claude-todo/35-identity-agency-and-context-safe-presence.md)
  owns account, presentation, proofing, role, and authorization boundaries.

## Milestone G0 — Approve a decision charter

- Name the exact low-stakes decision, why participation is meaningful, the
  organizer, final decision authority, affected people, and excluded domains.
- Approve eligibility, cutoff, purpose, context, options, abstention, timing,
  change/withdrawal, result, cancellation, dispute, retention, and response
  semantics.
- Decide whether interim totals remain hidden; default to hidden until close.
- Approve adult/synthetic cohort, environments, information packet, evaluation,
  accessibility/language profiles, support, incident owners, and stop authority.
- Complete privacy and abuse threshold assessments and assign qualified review.

**Gate:** no schema, implementation, invitation, or participant work until the
complete charter and owners are approved.

## Milestone G1 — Characterize the current poll primitive

- Freeze tests for compose, shape validation, option bounds, one-account slot,
  move/unvote, optimistic rollback, visibility, aggregation, deletion, and
  capability negotiation.
- Trace poll and vote data through feeds, profiles, permalinks, shares, search,
  trending, caches, notifications, logs, metrics, exports, backups, moderation,
  support, account switching, custom endpoints, and restore.
- Prove `closesAt` is not currently enforced and options are mutable; document
  how old indexes are handled after edits.
- Inventory account multiplicity, membership, blocking, banning, deletion, and
  restore effects without treating profile or role as personhood.

**Gate:** reviewers can explain every accepted write and every audience-visible
field; unknown paths remain blockers rather than assumptions.

## Milestone G2 — Register an immutable advisory-ballot contract

- Define protected proposal, ballot-version, eligibility-snapshot, participation,
  result, response, and challenge records as bounded relational Things.
- Keep all writers outside generic CRUD and authorize every transition against
  current account, ballot version, eligibility, membership, time, and state.
- Define open, closed, cancelled, disputed, certified, responded, implemented,
  declined, delayed, and superseded states without silent transitions.
- Register every new remote operation in route source, API docs/route registry,
  canonical capability manifest, and explicit client requirement map.
- Add bounded bodies, indexes, idempotence, rate limits, retention, safe errors,
  projection allowlists, audit access, and migration/rollback plans.

**Gate:** active routes and semantic capabilities agree, ballots cannot mutate
after open, late/ineligible writes fail, and no raw participant mapping escapes.

## Milestone G3 — Build informed participation and private voting

- Show purpose, organizer, authority, eligibility reason, source context,
  exact options, abstention, close, interim visibility, result rule, use of
  input, retention, withdrawal, challenge, and support before the first vote.
- Let eligible participants vote, change, withdraw, or explicitly abstain until
  the enforced close; do not require a public real name.
- Hide interim totals for the pilot and prevent receipts, logs, errors,
  notifications, and support views from disclosing a choice unnecessarily.
- Make open/closed, selected/unselected, pending/accepted/failed, stale, and
  withdrawn state programmatically and visually clear.
- Preserve optimistic last-known state only when it is labelled pending/stale;
  reconcile from authoritative ballot state and fail closed at transitions.

**Gate:** an eligible participant can understand and exercise every choice and
an ineligible caller learns no unnecessary electorate or vote information.

## Milestone G4 — Produce an accountable result and response

- Close once against server time and the frozen ballot; make retries idempotent.
- Apply the approved rule to accepted votes and explicitly handle insufficient
  participation, ties, cancellation, invalidation, and unresolved challenges.
- Publish eligible denominator, participation, abstentions, failures/exclusions,
  final counts, rule, limitations, and certification owner without individual
  choices or misleading percentages.
- Require the organizer to record responded/implemented/declined/delayed/
  superseded status and explain any departure from the declared use of input.
- Provide bounded challenge, recount, correction, cancellation, appeal, and
  support paths with immutable prior evidence and privacy-safe receipts.

**Gate:** tally, result, response, and implementation are distinguishable,
reproducible for authorized reviewers, understandable, and remediable.

## Milestone G5 — Validate and run one bounded pilot

- Unit-test state transitions, ballot immutability, eligibility, unique slots,
  deadlines, change/withdrawal, abstention, rule application, idempotence,
  authorization, projections, capabilities, retention, and indexes.
- Integration-test concurrency, stale tabs, edits, account/endpoint switches,
  block/ban/delete/restore, cancellation, tie, low turnout, dispute, retry,
  backup/restore, and organizer response.
- Complete desktop/mobile journeys with keyboard, touch, screen reader,
  zoom/reflow, reduced motion, locale, slow network, offline transition, error,
  retry, withdrawal, challenge, and support.
- Use consenting adults and a synthetic, non-sensitive decision only; collect
  no free-text reasons or individual choices as evaluation analytics.
- Publish a bounded report with cohort, contract version, context, exclusions,
  denominators, failures, incidents, remedies, deletions, result, response,
  limitations, owners, and refresh date.

**Gate:** every failure and affected-person remedy is reviewed before any
aggregate usefulness claim or expansion proposal.

## Measure contract

| Question | Candidate evidence | Guardrail |
| --- | --- | --- |
| Is participation informed? | Participants explain purpose, authority, eligibility, privacy, rule, effect, and remedy. | A completed vote is not comprehension or consent. |
| Is the record exact? | Accepted votes reconcile to one ballot version and deterministic final tally. | Database success is not legitimacy. |
| Is participation inclusive? | Journey success and barriers are reported per approved access profile. | Never erase exclusion in an average turnout number. |
| Is privacy preserved? | Choice disclosure and re-identification review passes across every data surface. | Aggregate does not mean anonymous. |
| Is influence bounded? | Hidden interim totals and neutral option/order comprehension checks pass. | A majority cannot cure a leading or coercive process. |
| Is accountability complete? | Final response and implementation state arrive by the declared time or trigger remedy. | A result page is not delivery. |

## Stop conditions

Pause intake if ballot or eligibility changes after open; server time, unique
slots, or rule application fails; individual choices leak or become inferable;
coercion, retaliation, brigading, manipulation, inaccessible controls, or
misleading status cannot be contained; excluded or failed participants vanish
from reporting; or result, organizer response, challenge, and support cannot be
reconciled and remedied.

## First owner decision packet

Approve or revise one paragraph that names: the synthetic advisory decision;
organizer and final authority; private adult cohort; eligible accounts and
cutoff; immutable question/options/abstain; source context; open/close; hidden
interim totals; change/withdrawal; result/tie/insufficient-participation rule;
response deadline; privacy/retention/deletion boundary; accessibility/language
profiles; support and challenge path; incident owners; stop authority; and all
excluded domains. An approved packet authorizes only the next gated design
step, not production use.
