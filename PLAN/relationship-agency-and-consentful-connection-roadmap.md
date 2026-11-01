# Relationship agency and consentful connection roadmap

**Status:** 🟣 Proposed · planning only

**Grounded:** 2026-09-12, Australia/Melbourne

**Evidence:**
[Relationship agency and consentful connection baseline](../NOTES/relationship-agency-and-consentful-connection-baseline.md)

**Execution epic:**
[TODO 41 — Relationship agency and consentful connection](../TODO/claude-todo/41-relationship-agency-and-consentful-connection.md)

## Outcome

Let a person understand, initiate, accept, decline, inspect, limit, and end a
digital relationship while every affected surface follows one current,
auditable contract. Preserve both people's agency without turning connection
into identity proof, trust, private access, collaboration authority, safety
judgment, or an engagement objective.

This roadmap does not approve contact upload, inferred relationships, people
recommendations, public graph expansion, minors, dating, reputation scores,
federation, advertising, AI personalization, or production block semantics.

## Principles

1. **Relationship types stay distinct.** Follow, friendship, circle, group/chat
   membership, mute, and block have different parties and effects.
2. **Proposal is not consent.** A pending request grants no reciprocal status,
   private audience access, message authority, or derived privilege.
3. **State must explain effects.** Each transition names visibility,
   communication, notification, history, and stop consequences before action.
4. **Stopping is a first-class journey.** Decline, withdraw, unfriend, unfollow,
   leave, mute, and block must be accessible and no harder than connecting.
5. **Fresh authorization wins.** Cached lists, feeds, notifications, clients,
   and retries cannot preserve authority after its source state ends.
6. **Safety boundaries are private by default.** Block state and reasons are not
   public verdicts, punishment, identity claims, or recommendation inputs.
7. **History is bounded and honest.** Current state, past fact, retained safety
   evidence, exported data, and deletion outcome remain separate.
8. **No connection objective.** Acceptance, graph size, messages, invitations,
   retention, or time spent are not success measures.

## Dependencies and ownership boundaries

- [TODO 17](../TODO/claude-todo/17-circles.md) owns the family-circle data model
  and ACL implementation. TODO 41 owns how relationship state and effects are
  explained consistently.
- [TODO 26](../TODO/claude-todo/26-community-safety-and-accountable-moderation.md)
  owns personal block, reports, cases, moderation decisions, appeals, remedies,
  and safety transparency. This roadmap may consume an approved block contract
  but cannot invent moderation authority.
- [TODO 34](../TODO/claude-todo/34-collaboration-agency-and-shared-stewardship.md)
  owns shared-artifact roles and contributions. Relationship is not edit
  authority.
- [TODO 35](../TODO/claude-todo/35-identity-agency-and-context-safe-presence.md)
  owns identity projection, aliases, assurance, correction, and recovery.
- [TODO 37](../TODO/claude-todo/37-notification-agency-and-accountable-delivery.md)
  owns event, persistence, channel, presentation, read, outcome, and remedy
  evidence for relationship notifications.
- [TODO 38](../TODO/claude-todo/38-search-and-discovery-agency.md) owns people
  discovery, query privacy, ranking explanation, and influence boundaries.
- [TODO 23](../TODO/claude-todo/23-data-portability-and-exit.md) owns export,
  deletion, closure, restore, and residual-state truth.
- [TODO 25](../TODO/claude-todo/25-accessibility-and-language-readiness.md)
  owns complete-journey accessibility and locale gates.
- Open PRs remain changeable evidence. Recheck exact head, base, CI, preview,
  capability contract, and shipped behavior before implementation.

## Milestone 0 — Approve the relationship charter

**Gate:** owner and qualified review; no implementation or participant intake.

- Define follow, request, friendship, family, membership, invite, mute, remove,
  leave, block, current state, history, receipt, and remedy.
- Approve the parties, initiator/recipient powers, state transitions, expiry,
  cooldown, caps, idempotence, concurrency, and stop behavior for each type.
- Approve a surface-by-state effects matrix covering profiles, counts/lists,
  feeds, ACL, search, chats, groups, mentions, notifications, email/push,
  exports, caches, and support tools.
- Decide public count/list policy and private request/block visibility.
- Name product, privacy, security, safety, accessibility, operations, incident,
  appeal/remedy, retention, and manual-stop owners.
- Record durable schema/API/storage decisions in `DECISIONS.md` only after
  approval; reuse protected relational Things and canonical writers.

## Milestone 1 — Characterize the existing state machine

**Gate:** tests and documentation agree on every currently shipped transition.

- Inventory follow and friend writers, relationship keys, home-database
  pinning, public/private projections, ACL enrichment, notification emitters,
  Messenger request states, memberships, mutes, caches, and limits.
- Turn existing friend intents into an explicit versioned transition table,
  including crossed requests, repeated actions, races, failures, and retries.
- Prove that pending grants nothing, acceptance grants only approved effects,
  and removal revokes derived authorization on the next protected read.
- Identify every denormalized count, cached view, queued notice, and derived
  audience that must converge after a transition.
- Keep discrepancies as evidence; do not rewrite history to match intended
  semantics.

## Milestone 2 — Build one canonical relationship-effects service

**Gate:** preview, mutation, and all consumers derive from one versioned contract.

- Provide a read-only preview for a proposed transition: parties, current and
  target state, affected surfaces, notification, visibility, history, cooldown,
  and ways each party can stop.
- Revalidate account, target, current relationship version, rate limit, block,
  capability, and policy immediately before mutation.
- Bind mutation to expected current state so stale or replayed actions cannot
  recreate or overwrite a newer decision.
- Return truthful complete, unchanged/idempotent, stale, rejected, rate-limited,
  failed, and propagation-pending outcomes.
- Register every endpoint or behavior change in the canonical capability
  registry, runtime route map, docs, client requirement map, compatibility
  tests, and built-server manifest smoke coverage.

## Milestone 3 — Make stopping and safety effects dependable

**Gate:** every approved stop action wins across all surfaces and stale clients.

- Make decline, cancel, unfriend, unfollow, leave, and mute directly reachable,
  keyboard/screen-reader usable, and clear about prospective versus historical
  effects.
- Implement account block only from TODO 26's approved semantics and effects
  matrix, with content-minimal private receipts and no public accusation.
- Invalidate derived ACL access, request affordances, notification fan-out,
  caches, and replay authority from the current canonical state.
- Define shared-chat/group history, emergency contact, moderation evidence,
  export, deletion, and appeal exceptions narrowly and explicitly.
- Prevent alternate endpoints, account switching, link keys, invites, groups,
  or recommendation surfaces from bypassing a stop action.

## Milestone 4 — Provide private inspection, correction, and remedies

**Gate:** each person can understand current state and challenge incorrect effects.

- Show an owner-private relationship dashboard with current type/state, who can
  act next, visible effects, pending propagation, retained history, and stop
  options without revealing the other person's private actions or reasons.
- Keep current state separate from a bounded transition receipt and from any
  retained safety/moderation evidence.
- Let a person report an unauthorized, wrong-target, stale, duplicated, or
  misrepresented transition and receive a trackable remedy state.
- Reconcile export, deletion, closure, backup, restore, and residual effects
  through [TODO 23](../TODO/claude-todo/23-data-portability-and-exit.md) rather
  than creating a second account-history system.
- Keep relationship motives, block reasons, profile values, messages, and
  private graph structure out of analytics, logs, public pages, and support
  views by default.

## Milestone 5 — Run one bounded adult pilot

**Gate:** all earlier contracts and stop owners are approved at the exact head.

- Use two adult test accounts with synthetic profiles, one synthetic
  friends-only Thing, no real contacts, and no sensitive content.
- Preview request effects; exercise send, decline, approved cooldown, resend,
  accept, idempotent repeat, crossed request, unfriend, and account switch.
- Verify the pending request grants nothing; accepted friendship enables only
  declared `tt:userFriends` access; fresh removal revokes it everywhere.
- If and only if the block matrix is separately approved, exercise block and
  unblock against feed, search, profile, request, chat, notification, and ACL
  paths without recording the reason.
- Exercise offline/stale clients, concurrent actions, retries, capability
  mismatch, queued notifications, cache refresh, export, deletion, restore,
  and incident stop.
- Inspect every affected state top-to-bottom at desktop and 390px, including
  previews, pending inbox, dialogs, errors, receipts, history, and remedies.
- Delete all fixtures and reconcile both accounts' owner-visible receipts with
  observed canonical and residual state.

## Measures

- Participant accuracy about each transition's parties, visibility,
  communication, notification, history, and stop effects.
- Preview/mutation/consumer contract-version equality.
- Zero authority from pending, declined, removed, muted, blocked, stale, or
  replayed state beyond the explicitly approved historical exceptions.
- Time for canonical state, ACL, caches, counts, lists, and notifications to
  converge, with propagation-pending states reported honestly.
- Accessible completion and recovery across keyboard, screen reader, touch,
  zoom/reflow, narrow viewport, low bandwidth, and interrupted requests.
- Negative, ambiguous, declined, removed, blocked, disputed, and stopped
  outcomes retained in evaluation; no acceptance, graph-growth, or dwell goal.

## Continuous gate before broader work

- Re-run exact-head capability, state-machine, authorization, ACL, Messenger,
  notification, search, cache, concurrency, privacy/security, accessibility,
  export/delete/restore, and real-browser checks.
- Re-review every new relationship type, public graph surface, group audience,
  recommendation input, contact source, federation boundary, minor,
  institution, sensitive domain, or jurisdiction.
- Publish no claim such as “friend,” “trusted,” “safe,” “private,” “blocked,” or
  “deleted” beyond the exact tested product meaning and residuals.
- Stop or roll back when any TODO 41 stop condition fires.

## Explicit non-goals

- Contact/address-book upload, phone/email matching, proximity inference,
  imported social graphs, people-you-may-know, or growth invitations.
- Public graph expansion, relationship badges/scores, popularity ranking,
  advertising audiences, graph analytics, or AI personalization/training.
- Proof of identity, real-world relationship, kinship, trust, safety,
  endorsement, consent outside the declared effect, or legal status.
- Dating, minors, guardianship, emergency services, employment, healthcare,
  education, finance, law enforcement, or other high-impact contexts.
- Federation/ActivityPub, cross-platform blocks, cryptographic relationship
  credentials, delegated relationship management, or automated moderation.

## First owner decision packet

Approve or revise:

1. two adult synthetic test accounts and the existing friendship lifecycle;
2. the canonical state and surface-effects matrix, including public-list policy;
3. an owner-private pre-action preview and content-minimal transition receipt;
4. fresh authorization, expected-state binding, idempotence, cooldown, and caps;
5. immediate stop behavior plus truthful cached, queued, and historical effects;
6. no contacts, inference, recommendations, public graph expansion, analytics,
   AI use, minors, or sensitive contexts;
7. account block only after TODO 26's separate semantics are approved; and
8. named qualified reviewers, incident/remedy path, retention owner, and manual
   stop authority before implementation starts.
