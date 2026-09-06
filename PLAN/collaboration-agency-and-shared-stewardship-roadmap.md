# Collaboration agency and shared-stewardship roadmap

**Status:** Proposed · owner and qualified review needed

**Evidence:**
[Collaboration agency and shared-stewardship baseline](../NOTES/collaboration-agency-and-shared-stewardship-baseline.md)

**Execution epic:**
[TODO 34 — Collaboration agency and shared stewardship](../TODO/claude-todo/34-collaboration-agency-and-shared-stewardship.md)

## Outcome

Let two consenting adults contribute to one private draft while each can
understand and control their visibility, role, authority, contributions,
conflicts, departure, and remedies. No relationship, invitation, membership,
or friendly UI label may silently grant wider power.

The first useful outcome is deliberately small: an owner invites one named
account to suggest bounded changes to one private draft; the owner accepts or
rejects each proposal against an exact version; either person can stop without
silent data loss or stale authority.

## Non-goals

- Real-time cursor presence, automatic merge, CRDT or operational-transform
  adoption, or Google-Docs parity in the first pilot.
- Public group editing, anonymous collaboration, open links, guest accounts,
  contact upload, viral invitations, or forced registration.
- Inferring collaboration authority from friends, follows, family, Messenger,
  community, subspace, app, subscription, or workplace relationships.
- Assigning copyright, employment, payment, liability, identity verification,
  moderation authority, or legal ownership through a product role.
- Optimizing member count, invite redemption, edit volume, messages, activity,
  or time spent.
- AI agents, external apps, unattended actions, minors, institutions, money,
  or sensitive and high-impact domains.

## Operating principles

1. **Purpose before access.** Every collaboration names the artifact, purpose,
   proposed role, duration, capabilities, visibility, and exit effects.
2. **Acceptance before authority.** An invitation is a proposal; redemption is
   explicit, current, bounded consent.
3. **Server truth on every action.** Current account, membership, role,
   capability version, artifact state, and target are rechecked at execution.
4. **Visibility is not edit permission.** ACLs and collaboration capabilities
   remain distinct, even when their UI appears together.
5. **Preserve intentions before resolving conflicts.** Reject stale writes and
   retain bounded proposals; never silently choose the last writer.
6. **Departure is a first-class journey.** Leave, removal, expiry, transfer,
   archive, deletion, attribution, and remedy effects are stated and tested.
7. **Stewardship is not rights adjudication.** Platform ownership, authorship,
   provenance, licences, payments, and legal rights remain separate.
8. **One narrow pilot before scale.** More people, artifacts, roles, or public
   reach require new evidence and approval.

## Milestone C0 — Approve the collaboration charter

**Outcome:** owners approve the exact human and product contract before schema
or participant work begins.

- Name one private draft family, one two-person adult cohort, one purpose, one
  suggestion-only role, duration, environments, support path, and stop owner.
- Define collaborator eligibility and whether invitations bind to a named
  existing account before any private metadata is shown.
- Approve the role/capability vocabulary, state machine, invitation preview,
  notifications, evidence boundary, retention, deletion, export, and remedies.
- Define platform stewardship, contribution attribution, rights assertions,
  moderation, and legal/support escalation as separate authority layers.
- Approve complete-journey accessibility, language, device, network, privacy,
  safety, authorization, continuity, and recovery profiles.
- Record architectural decisions in `DECISIONS.md`; do not treat this roadmap
  as approval.

**Gate:** every owner, exclusion, state, capability, evidence field, remedy,
claim, and stop condition is named without relying on implied social trust.

## Milestone C1 — Freeze current authority and lifecycle behaviour

**Outcome:** the implementation starts from a complete, testable map rather
than layering co-editing onto ambiguous ACLs.

- Inventory every create/read/update/delete/share/invite/role/leave/remove/
  transfer/export path touching the selected Thing and its attachments.
- Trace ACL evaluation, owner checks, app/PAT fences, custom endpoints,
  `expectedUpdatedAt`, caches, optimistic UI, notifications, search, previews,
  export, account closure, moderation, and restore.
- Map friend, follow, family, chat, community, subspace, app, and account-invite
  relationships; explicitly prove none grants collaboration authority.
- Record all stores, logs, metrics, support views, backups, and third parties
  that could receive artifact, participant, invitation, or contribution data.
- Add characterization tests for owner-only writes, stale-preview rejection,
  current ACL behavior, and protected-kind boundaries before changing them.

**Gate:** reviewers can enumerate every current path that might read or mutate
the pilot artifact and explain its exact authorization and failure state.

## Milestone C2 — Define one collaboration state machine

**Outcome:** invitation, membership, role, contribution, and artifact states
have deterministic transitions and invariants.

- Define collaboration states such as `draft | active | paused | archived |
  closed` and membership states such as `invited | active | left | removed |
  expired | declined`.
- Define a suggestion-only capability set: view the selected projection,
  propose bounded changes, inspect own proposals and authorized decisions,
  leave, and use remedies. Exclude direct mutation, invite, role, ACL, export,
  delete, transfer, app/tool grant, or public-share power.
- Specify who may create/revoke an invite, accept/reject a suggestion, remove a
  member, archive, delete, or transfer, with current server-side predicates.
- Bind invitations and mutations to semantic capability versions so additive
  or breaking changes cannot silently expand old consent.
- Register every new or changed endpoint and operation in the canonical API
  registry and origin-scoped capability manifest with deliberate SemVer.
- Model accumulating memberships and contribution events as bounded relational
  Things through named collection getters; protect them from generic CRUD.

**Gate:** transition-table tests reject every illegal, stale, duplicate,
cross-account, cross-artifact, and role-escalating transition.

## Milestone C3 — Build informed invitation and access review

**Outcome:** one named recipient can understand and accept or decline one
bounded collaboration without seeing the private draft first.

- Present inviter, safe artifact label/type, purpose, proposed role, exact
  capabilities, duration, visibility, notifications, and leave/remove effects.
- Reveal no draft body, hidden participant, private ACL, token, endpoint,
  internal identifier, or sensitive metadata before acceptance.
- Use opaque, expiring, revocable, single-use material; do not log raw tokens,
  place them in analytics, or allow forwarding to grant another account.
- Make acceptance, decline, expiry, revoke, replay, wrong-account, already-
  member, blocked-account, and unavailable-artifact states accessible and calm.
- After joining, provide an access review that explains why access exists,
  current role/capabilities, artifact, steward, start/expiry, and stop/remedy
  actions.
- Test account switch, custom endpoint, multiple tabs, slow/offline transition,
  clock drift, and permission changes without leaking prior-account state.

**Gate:** the recipient can accurately explain the contract before accepting;
every invalid or stale route fails closed without becoming an existence oracle.

## Milestone C4 — Build exact-version contribution proposals

**Outcome:** the collaborator can propose, and the owner can decide, one
bounded change without silent overwrite.

- Define the eligible field/block change format and size caps for the selected
  draft family; validate it through the same canonical schema rules as owner
  edits.
- Bind each proposal to collaboration, participant, artifact, base version,
  capability version, safe summary, and timestamps.
- Keep proposal content private and authorization-aware in UI, API, logs,
  errors, notifications, export, backups, and support tooling.
- Let the owner compare current, proposed, and base states; accept, reject, or
  ask for a new proposal. Never describe a stale proposal as applied.
- Apply accepted changes atomically against the exact current version. On a
  mismatch, preserve the proposal and offer an accessible refresh/rebase path.
- Produce bounded receipts for proposed, accepted, rejected, applied, stale,
  failed, cancelled, reverted, and disputed states.
- Connect accepted edits and reversals to TODO 29's revision/provenance model;
  do not invent a second authorship history.

**Gate:** adversarial and real-API tests prove no accepted intention is lost,
no rejected/stale proposal mutates, and every result is reviewable and honest.

## Milestone C5 — Make stopping and stewardship safe

**Outcome:** leave, removal, expiry, archive, deletion, and transfer have
understandable effects and no stale authority.

- Re-check current membership on every read and mutation; invalidate stale
  sessions, cached previews, pending approvals, and replayable confirmations.
- Define what happens to pending proposals, accepted contributions,
  attribution, notifications, private local caches, exports, and links after
  leave, removal, expiry, block, account closure, artifact privacy changes, or
  deletion.
- Give both participants a pre-action review and post-action receipt stating
  what stops, what remains, what cannot be recalled, and available remedies.
- Preserve only approved minimal attribution and dispute evidence, subject to
  current authorization, retention, deletion, protected-identity, and safety
  rules.
- Test restore and support paths for accidental removal, lost access, failed
  application, partial notification, and deleted/newly private artifacts.
- Design ownership transfer separately: named eligible recipient, explicit
  acceptance, exact-state guard, role/ACL/quota/attachment/app-grant impact
  review, receipt, rollback boundary, and no implication of rights transfer.

**Gate:** complete lifecycle tests prove old authority cannot survive and no
person is trapped, silently erased, or made responsible without acceptance.

## Milestone C6 — Run one two-person private pilot

**Outcome:** a small consenting adult cohort completes a useful shared draft
with agency, accessibility, privacy, and remedies intact.

- Use approved non-sensitive or synthetic content and one Thing family only.
- Demonstrate invite preview, accept/decline, access review, proposal, stale
  conflict, accept/reject, revert, leave/remove, export/deletion boundary, and
  support before participation.
- Collect only approved aggregate or structured-session evidence. Do not retain
  draft content, invitation material, interpersonal disagreement, identity
  graphs, or rejected text as product analytics.
- Measure useful outcome, authority comprehension, conflict recovery,
  correction/reversal, stopping, accessibility, incident rate, latency, and
  support load as separate dimensions.
- Pause on unauthorized access, confusing authority, unnoticed loss, broken
  exit/remedy, inaccessible critical controls, privacy exposure, or operating
  overload.

**Gate:** a bounded report states cohort, task, contract version, exclusions,
failures, remedies, deletions, incidents, limitations, and unresolved questions
without claiming general collaborative safety or effectiveness.

## Milestone C7 — Consider broader collaboration separately

**Outcome:** direct editing, real-time sync, groups, public artifacts, anonymous
participants, guests, apps, AI agents, payments, or institutions cannot arrive
through pilot scope creep.

- Require a new threat model, state/authority design, conflict model, privacy
  and rights review, evidence plan, accessibility proof, support capacity, and
  owner decision for each wider mode.
- Evaluate direct co-editing and automatic merge only after the proposal model
  proves exact-version integrity and usable conflict recovery.
- Treat CRDTs, operational transforms, locks, branches, and field-level merges
  as implementation options with explicit deletion, authorization, history,
  offline, and resource tradeoffs—not as product guarantees.
- Require separate approval for public discovery, open links, guest accounts,
  more than two people, anonymous participation, minors, schools, workspaces,
  commerce, moderation power, external apps, or AI agency.

**Gate:** a durable decision identifies the exact additional outcome, affected
people, authority, data, conflicts, remedies, owners, evidence, and prohibited
remainder.

## Measure contract

| Question | Candidate evidence | Guardrail |
| --- | --- | --- |
| Is consent informed? | Participant explanation of artifact, purpose, role, capabilities, duration, visibility, and exit effects before joining. | Redemption is not comprehension. |
| Is the outcome useful? | Both participants' task-rubric result and reasons for correction or abandonment. | Do not optimize edits, messages, invites, or time. |
| Is authority enforced? | Complete transition and adversarial tests across roles, accounts, endpoints, tabs, and stale states. | A happy-path UI test cannot prove authorization. |
| Are intentions preserved? | Stale/concurrent cases retain proposals and recover without unnoticed loss. | A conflict count alone says nothing about resolution quality. |
| Can people stop? | Leave/remove/expiry tests plus stale-request denial and residual-effect comprehension. | Removal is not deletion or recall. |
| Is the journey accessible? | End-to-end keyboard, touch, screen-reader, zoom, language, device, network, and error-path exercises. | Do not average away a blocked profile. |
| Do remedies work? | Revert, correction, report, dispute, restore, export, deletion, and support reach owned outcomes. | Do not log private draft or dispute content. |

## Stop conditions

Pause intake and disable the narrowest affected capability when any of these
occurs:

- a relationship, forwarded invite, stale cache, endpoint switch, or replay
  grants unauthorized visibility or mutation;
- a role/capability change expands authority without current informed consent;
- a proposal is lost, silently overwritten, applied to the wrong version, or
  reported as applied when it is stale, partial, failed, or cancelled;
- leaving, removal, blocking, expiry, privacy change, or account closure fails
  to stop future authority;
- contribution evidence exposes protected identity, deleted/private content,
  raw invitation material, or more history than the approved audience allows;
- ownership transfer strands data, changes responsibility without acceptance,
  or is represented as a transfer of legal rights;
- critical controls fail for an approved accessibility, language, device, or
  network profile; or
- accountable product, security/privacy, safety/rights, reliability, and
  support owners cannot investigate and remedy incidents.

Resume only after containment, affected-person communication where appropriate,
root-cause evidence, repair, regression proof, data cleanup, and accountable
owner approval.

## First owner decision packet

Before implementation, ask the owner to approve or revise:

1. the private draft family, two-person adult cohort, purpose, duration, and
   useful-outcome rubric;
2. named-account invitation binding and the safe pre-acceptance preview;
3. the suggestion-only capability set, state machine, role/capability version,
   current-state authorization predicates, and explicit exclusions;
4. proposal format, exact-version rule, accept/reject/rebase/revert journey,
   receipts, retention, deletion, export, and provenance boundary;
5. leave, removal, expiry, block, archive, deletion, restore, support, dispute,
   and eventual ownership-transfer semantics; and
6. accessibility/language/network profiles, evidence minimization, incident
   triggers, accountable owners, stop authority, and permitted claims.
