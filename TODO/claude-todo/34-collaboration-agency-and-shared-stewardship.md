# 34 — Collaboration agency and shared stewardship

**Status:** Proposed · owner and qualified review needed

**Evidence:**
[Collaboration agency and shared-stewardship baseline](../../NOTES/collaboration-agency-and-shared-stewardship-baseline.md)

**Plan:**
[Collaboration agency and shared-stewardship roadmap](../../PLAN/collaboration-agency-and-shared-stewardship-roadmap.md)

## Objective

Turn Thingtime's relationships, ACL visibility, Thing ownership, Messenger
membership, roles, invitations, and exact-state update primitive into one
bounded shared-artifact contract. Start with one named adult collaborator who
may suggest changes to one owner-private draft; the owner accepts or rejects
against an exact version; either participant can stop without stale authority,
silent loss, or misleading ownership claims.

## Required owner decisions before implementation

- [ ] Approve one eligible private draft family, allowed fields/blocks, adult
      cohort, purpose, duration, environments, useful-outcome rubric, support,
      and stop authority.
- [ ] Decide how an invitation binds to a named existing account and exactly
      which safe facts appear before acceptance.
- [ ] Approve collaboration, invitation, membership, role, capability,
      contribution, conflict, departure, removal, archive, and closure states.
- [ ] Approve a suggestion-only role and explicitly exclude direct editing,
      invite, role, ACL, export, delete, transfer, app/tool grant, public-share,
      and moderation powers.
- [ ] Approve exact-version proposal, compare, accept, reject, rebase, revert,
      receipt, retention, deletion, export, provenance, and dispute semantics.
- [ ] Approve leave, remove, expiry, block, privacy-change, account-closure,
      restore, and support effects, including what remains and cannot be recalled.
- [ ] Name product, authorization/security, privacy, accessibility/language,
      safety/rights, reliability, operations, and support owners.
- [ ] Explicitly exclude public/anonymous/group/guest collaboration, minors,
      institutions, money, rights transfer, external apps, AI agents, background
      work, real-time co-editing, and sensitive or high-impact domains.

No unchecked item above is implied permission to start engineering or recruit
participants.

## Dependencies and boundaries

- [ ] [`FUNDAMENTALS.md` §3](../../FUNDAMENTALS.md) remains authoritative for
      relational child data, versioned collection getters, protected kinds,
      attachments, and bounded aggregation.
- [ ] [TODO 17](./17-circles.md) owns friends/family membership. A social
      relationship never grants artifact authority.
- [ ] [TODO 18](./18-account-invite-links.md) owns account creation invites.
      Registration and collaboration acceptance remain separate transitions.
- [ ] [TODO 19](./19-anonymous-group-chats.md) owns anonymous group-chat
      participation. The pilot is named, two-person, and non-anonymous.
- [ ] [TODO 20](./20-versioned-experience-history.md) owns experience replay;
      it is not the shared artifact's contribution history.
- [ ] [TODO 23](./23-data-portability-and-exit.md) owns export, retention,
      deletion, closure, and verified exit.
- [ ] [TODO 24](./24-attention-agency-and-calm-use.md) owns calm invitations,
      notifications, stopping points, and non-manipulative engagement.
- [ ] [TODO 25](./25-accessibility-and-language-readiness.md) owns shared
      complete-journey accessibility and locale foundations.
- [ ] [TODO 26](./26-community-safety-and-accountable-moderation.md) owns
      block, report, case, moderator, appeal, and safety remedies. Project roles
      do not grant platform moderation authority.
- [ ] [TODO 27](./27-trusted-developer-ecosystem.md) owns app identity,
      capability declarations, OAuth, review, and incident containment. App
      access does not inherit human collaboration membership.
- [ ] [TODO 28](./28-service-continuity-and-recovery.md) owns truthful writes,
      safe degradation, restore proof, and incidents.
- [ ] [TODO 29](./29-content-provenance-and-correction-integrity.md) owns
      revisions, attribution, source/derivation, correction, dispute, and
      portable receipts. Do not build a second authorship ledger.
- [ ] [TODO 30](./30-resource-conscious-reach.md) owns constrained-device and
      network budgets, offline boundaries, and resource evidence.
- [ ] [TODO 31](./31-creator-sustainability-and-fair-value.md) owns payment,
      entitlement, fulfilment, payout, and creator remedies. No money in pilot.
- [ ] [TODO 32](./32-learning-agency-and-knowledge-stewardship.md) owns learning
      evidence; collaboration activity must not become a learning claim.
- [ ] [TODO 33](./33-ai-agency-and-accountable-assistance.md) owns AI context,
      authority, confirmation, receipts, and autonomy. No AI actor in pilot.
- [ ] Recheck PR [#649](https://github.com/lopugit/thingtime/pull/649) before
      implementation. Its open subspace work may supply later membership and
      transfer lessons, but is neither merged nor the pilot authority model.

## Phase A — Characterize and freeze current authority

- [ ] Inventory the selected Thing's create, read, update, delete, ACL, token,
      share, attachment, search, preview, notification, export, moderation,
      account-closure, backup, and restore paths.
- [ ] Characterize `updateThing()` owner checks and `expectedUpdatedAt`
      behavior with direct unit and real-API tests.
- [ ] Prove that friends, follows, family, chats, communities, subspaces, app
      grants, PATs, and account invites grant no implicit pilot authority.
- [ ] Map custom Mongo endpoints, account switching, optimistic caches, stale
      tabs, client retries, background sync, and support tools that could cross
      identity or authority boundaries.
- [ ] Inventory every store, log, metric, trace, notification, backup, and
      third party that could receive collaboration data.

## Phase B — Register the protected collaboration contract

- [ ] Define semantic capability IDs and versions for invite preview,
      accept/decline, access review, proposal create/read/cancel, owner decision,
      revert, leave, remove, and remedies.
- [ ] Add protected relational collaboration membership, invitation, and
      contribution-event kinds through named collection getters. Keep all
      accumulating records bounded and outside generic Thing CRUD.
- [ ] Define explicit state-transition tables and server predicates for every
      operation; deny by default and authorize every request against current
      account, membership, role/capability version, artifact, and state.
- [ ] Register every new `/api/v1/...` route in its route file, Nitro import map,
      `apiEndpointDocs`, canonical capability registry, origin-scoped manifest,
      and compatibility requirements.
- [ ] Add bounded bodies, field allowlists, rate limits, quota/storage
      accounting, indexes, transaction/idempotence rules, and safe errors.
- [ ] Ensure protected records, raw tokens, participant graphs, proposal text,
      and internal authorization fields never escape public projections.

## Phase C — Implement informed invitation and access review

- [ ] Create an owner flow for one selected private draft and one named eligible
      recipient; prevent self-invite, duplicate active membership, blocked or
      ineligible targets, and cross-endpoint/account confusion.
- [ ] Generate opaque, expiring, revocable, single-use invitation material;
      hash secrets, compare safely, avoid referrer/log/analytics exposure, and
      make races idempotent.
- [ ] Show recipient-safe inviter, artifact label/type, purpose, proposed role,
      capabilities, duration, visibility, notifications, and leave/remove
      effects without revealing the draft body before acceptance.
- [ ] Make acceptance, decline, revoke, expiry, wrong account, replay,
      unavailable artifact, changed terms, and already-member states accessible.
- [ ] Add a post-join access review showing current reason, role/capabilities,
      steward, artifact, duration, expiry, and stop/remedy paths.
- [ ] Reconfirm if artifact, role, capability version, purpose, visibility,
      duration, or exit consequences change before acceptance.

## Phase D — Implement exact-version suggestions

- [ ] Define and schema-validate one bounded proposal format for eligible draft
      fields/blocks; never accept unrestricted patches or client-supplied roles.
- [ ] Bind every proposal to collaboration, actor, artifact, base version,
      capability version, safe summary, and timestamps.
- [ ] Let the collaborator create, inspect, and cancel their pending proposal
      without direct mutation authority or visibility into unauthorized history.
- [ ] Let the owner compare base/current/proposed state and accept, reject, or
      request a rebase with keyboard, touch, screen-reader, zoom, and mobile
      equivalents.
- [ ] Apply acceptance atomically only when current artifact version and
      authorization match; preserve the proposal and return an honest conflict
      state otherwise.
- [ ] Produce bounded state receipts and integrate accepted/reverted changes
      with TODO 29's revision and attribution contract.
- [ ] Keep proposal content out of analytics, generic logs, notification
      previews, error prose, public exports, and unauthorized support views.

## Phase E — Implement stopping, revocation, and remedies

- [ ] Make current membership authoritative on every read and mutation; stale
      clients, cached previews, retries, approvals, and tokens cannot survive
      leave, removal, expiry, block, or role change.
- [ ] Define and implement pending-proposal, accepted-contribution,
      attribution, notification, export, cache, link, retention, and deletion
      effects for leave, removal, expiry, block, privacy change, account closure,
      archive, and artifact deletion.
- [ ] Preview significant stop actions, confirm exact current consequences,
      and return a receipt stating what stopped, remains, cannot be recalled,
      and can be remedied.
- [ ] Implement bounded revert/correction, accidental-removal restoration,
      report/dispute, export/deletion request, and human-support routes with
      accountable owners and service objectives.
- [ ] Test that private or deleted artifact/proposal content never resurrects
      through provenance, notifications, caches, backups, restore, or support.
- [ ] Keep ownership transfer unimplemented until its separate decision packet
      covers recipient acceptance, exact state, role/ACL/quota/attachment/app
      effects, receipt, rollback, and no rights-transfer implication.

## Phase F — Validate the complete private pilot

- [ ] Unit-test state transitions, capability/version negotiation, current
      authorization, projection allowlists, exact-version application,
      idempotence, expiry, rate limits, storage accounting, and indexes.
- [ ] Integration-test invite forwarding, wrong account, account switch,
      custom endpoint, stale tab, concurrent proposal/owner edit, changed role,
      removed member, replay, deletion, privacy change, and account closure.
- [ ] Exercise invite preview, accept/decline, access review, proposal,
      compare, stale conflict, accept/reject, rebase, revert, leave/remove,
      report, export/deletion boundary, restore, and support through the real API.
- [ ] Complete browser journeys at approved desktop/mobile sizes with keyboard,
      touch, screen reader, zoom/reflow, reduced motion, locale, slow network,
      offline transition, error, retry, and recovery.
- [ ] Verify logs, metrics, traces, errors, notifications, exports, backups, and
      support projections contain no unapproved private content or token material.
- [ ] Smoke the built server's capability manifest and prove compatible clients
      accept additive versions while missing/breaking requirements fail closed.

## Phase G — Run and evaluate one bounded cohort

- [ ] Obtain informed participation consent, demonstrate non-collaborative
      owner-only use, withdrawal, deletion, support, and the honest recall limit.
- [ ] Use only the approved non-sensitive draft family and two-person adult
      relationship; do not widen roles, artifacts, people, or reach mid-pilot.
- [ ] Measure useful outcome, authority comprehension, conflict recovery,
      correction/reversal, stopping, accessibility, privacy/security incidents,
      latency, failure, and support load separately.
- [ ] Retain only approved aggregate or structured-session evidence; no draft,
      proposal, token, identity graph, or interpersonal-dispute analytics.
- [ ] Review every failure and affected-person remedy before aggregate claims.
- [ ] Publish only a bounded report with cohort, task, version, conditions,
      exclusions, failures, incidents, remedies, deletions, limits, owner, and
      refresh date.

## Acceptance criteria

- [ ] A recipient can explain artifact, purpose, inviter, role, capabilities,
      duration, visibility, notifications, exit effects, and remedies before
      accepting, without seeing private content prematurely.
- [ ] Friends, follows, family, Messenger, communities, subspaces, account
      invites, app grants, PATs, and ACL visibility cannot imply pilot authority.
- [ ] Every request validates current account, membership, capability version,
      artifact, exact state, and target server-side and fails closed.
- [ ] The collaborator can suggest only approved fields/blocks and cannot
      directly edit, invite, change roles/ACLs, export, delete, transfer, publish,
      grant tools/apps, or exercise moderation authority.
- [ ] Stale or concurrent changes preserve both intentions, apply neither
      silently, and offer an accessible compare/rebase/retry path.
- [ ] Proposed, accepted, rejected, stale, failed, cancelled, applied, reverted,
      and disputed states are distinct and never misreported as success.
- [ ] Leaving, removal, expiry, block, privacy change, and account closure stop
      future authority, invalidate stale paths, and explain residual effects.
- [ ] Attribution and contribution receipts remain minimal, authorized,
      correctable, exportable/deletable as approved, and separate from rights
      ownership or platform moderation.
- [ ] Complete-journey accessibility, language, privacy, security, constrained
      network/device, capability, continuity, restore, and remedy tests pass.
- [ ] Both participants can complete the approved useful outcome without
      optimizing edit count, messages, invites, activity, or time spent.

## Stop conditions

Pause intake and disable the narrowest affected capability if:

- an invite, relationship, ACL, stale state, endpoint switch, or replay grants
  unauthorized visibility or mutation;
- authority expands without current informed acceptance or survives a stop
  event;
- an intention is lost, overwritten, misapplied, or mislabeled;
- contribution history reveals deleted/private content or protected identity;
- leave, removal, revert, correction, report, dispute, restore, export,
  deletion, or support cannot reach the approved outcome;
- a critical control fails for an approved accessibility, language, device, or
  network profile; or
- accountable owners cannot contain and remedy incidents.

Resume only after containment, affected-person communication where appropriate,
root-cause evidence, repair, regression proof, cleanup, and owner approval.

## Explicit non-goals

- No direct or real-time co-editing, cursor presence, automatic merge, CRDT/OT
  commitment, group workspace, public editing, guest link, or anonymous member.
- No minors, schools, institutions, workplace monitoring, payments,
  entitlements, moderation roles, rights adjudication, or legal transfer.
- No external app or AI-agent participation, background action, broad OAuth/PAT
  scope, contact upload, inferred collaborators, or viral invitation loop.
- No claim that activity proves collaboration quality, agreement, trust,
  authorship, learning, safety, productivity, or general effectiveness.
- No ownership transfer until its separate decision packet and complete
  lifecycle proof are approved.
