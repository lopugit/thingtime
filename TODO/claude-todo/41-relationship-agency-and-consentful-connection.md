# 41 — Relationship agency and consentful connection 🤝

**Status:** 🟣 Proposed · planning only · added 2026-09-12

**Owner:** Unassigned; product owner and qualified privacy, security, safety,
accessibility, operations, and remedy reviewers must approve the first contract

**Plan:**
[`PLAN/relationship-agency-and-consentful-connection-roadmap.md`](../../PLAN/relationship-agency-and-consentful-connection-roadmap.md)

**Evidence:**
[`NOTES/relationship-agency-and-consentful-connection-baseline.md`](../../NOTES/relationship-agency-and-consentful-connection-baseline.md)

## Goal

Turn Thingtime's existing follows, friend requests, accepted friendships,
circle access, message requests, memberships, and mutes into one understandable
relationship journey: before acting, each person can predict the exact effects;
afterward, every surface follows the same current state and provides accessible
ways to inspect, decline, withdraw, remove, leave, mute, block, correct, export,
delete, and seek remedy.

This epic authorizes no implementation, schema, API, production experiment,
account block, contact import, recommendation, public graph expansion, minor,
AI use, or sensitive-domain relationship processing.

## Problem

Thingtime already ships real one-way follows and mutual friendship with a
request/accept handshake. Accepted friends can affect `tt:userFriends` ACL
visibility, while profiles, Messenger, groups, notifications, feeds, and search
consume related but distinct state.

The system does not yet expose one versioned effects matrix or owner-private
receipt spanning those surfaces. Public connection lists, stale optimistic
caches, queued notifications, message-request rules, future family semantics,
and the unimplemented account-block boundary can therefore be individually
reasonable while remaining hard for a person to predict as one journey.

## Dependencies

- [TODO 17](./17-circles.md) owns the family pair model and family ACL work.
- [TODO 26](./26-community-safety-and-accountable-moderation.md) owns account
  block, reports, moderation, appeals, and safety remedies.
- [TODO 34](./34-collaboration-agency-and-shared-stewardship.md) owns shared
  artifact roles; relationship never grants edit authority.
- [TODO 35](./35-identity-agency-and-context-safe-presence.md) owns identity
  presentation, assurance, aliases, correction, and recovery.
- [TODO 37](./37-notification-agency-and-accountable-delivery.md) owns
  notification lifecycle evidence and channel delivery.
- [TODO 38](./38-search-and-discovery-agency.md) owns people discovery, query
  privacy, ranking, recommendations, and influence.
- [TODO 23](./23-data-portability-and-exit.md) owns export, deletion, account
  closure, restore, and residual-state truth.
- [TODO 25](./25-accessibility-and-language-readiness.md) owns complete-journey
  accessibility and language gates.
- Open PRs are evidence only. Recheck exact head, base, CI, preview,
  capabilities, and shipped behavior before implementation.

## Phase 0 — Approve authority before code

- [ ] Define follow, request, accepted friendship, family, circle,
      membership, invite, mute, remove, leave, block, history, receipt, and
      remedy without collapsing them.
- [ ] Approve a versioned state-transition table for every included
      relationship type, with parties, expiry, caps, cooldown, concurrency,
      idempotence, replay, and failure behavior.
- [ ] Approve the surface-effects matrix for profile, public counts/lists,
      feed, ACL, search, chat, groups, mentions, notifications, email/push,
      exports, caches, and support.
- [ ] Decide whether counts and lists are public, owner-controlled, contextual,
      or hidden, and who may see pending, declined, removed, or blocked state.
- [ ] Name product, privacy, security, safety, accessibility, operations,
      incident, retention, appeal/remedy, and manual-stop owners.
- [ ] Record durable schema/API/storage choices in `DECISIONS.md` only after
      approval. Do not create parallel social, ACL, moderation, notification,
      identity, discovery, or export systems.

**Phase gate:** no implementation or participant intake until every authority,
effects matrix, data boundary, and stop condition is approved.

## Phase 1 — Prove the current relationship contract

- [ ] Inventory every writer and reader for follow, friend, request,
      `tt:userFriends`, Messenger request, group/chat membership, and mute.
- [ ] Characterize crossed requests, repeated intents, concurrent accept/remove,
      rate limits, account switching, stale clients, and partial failures.
- [ ] Prove pending grants no friendship, ACL, message, group, notification,
      app, tool, payment, identity, moderation, or collaboration authority.
- [ ] Enumerate denormalized counts, public lists, caches, queued notices,
      derived audiences, and already-rendered content affected by each change.
- [ ] Preserve observed gaps and disagreement as evidence instead of presenting
      intended semantics as shipped truth.

## Phase 2 — Add one canonical preview and transition contract

- [ ] Return an owner-private pre-action preview binding relationship type,
      parties, current/target state, contract version, visible effects,
      notification, history, cooldown, and stop paths.
- [ ] Revalidate current account, target, state version, rate limit, block,
      capability, and policy immediately before mutation.
- [ ] Use expected-state or equivalent compare-and-set semantics so stale
      clients and replays cannot overwrite a newer decision.
- [ ] Preserve protected relational Things, home-database identity state,
      canonical writers, unique keys, and owner-private access.
- [ ] Distinguish complete, unchanged/idempotent, stale, rejected,
      rate-limited, failed, and propagation-pending outcomes.
- [ ] Register every changed endpoint and semantic operation in the capability
      registry, active route map, API docs, client requirement map,
      compatibility tests, and built-server manifest smoke coverage.

## Phase 3 — Make stopping propagate safely

- [ ] Make decline, cancel, unfriend, unfollow, leave, and mute accessible,
      legible, and clear about immediate, queued, historical, and residual
      effects.
- [ ] Derive ACL, feed, search, request, mention, chat, group, and notification
      authority from current canonical state on protected operations.
- [ ] Invalidate account-scoped optimistic caches and prevent offline, retry,
      link-key, alternate-route, or switched-account bypass.
- [ ] Consume an account-block contract only after TODO 26 approves its
      directionality, visibility, shared-history, safety, appeal, and emergency
      boundaries.
- [ ] Ensure removal or block does not delete either person's content or claim
      to retract disclosures already received; state residuals truthfully.

## Phase 4 — Add private inspection and remedy

- [ ] Give each person one owner-private view of current relationship state,
      who can act next, public/private exposure, effects, pending propagation,
      retained history, and available stop actions.
- [ ] Bind a content-minimal transition receipt to contract version, parties'
      synthetic identifiers, requested/observed states, time, affected-surface
      results, and cleanup status.
- [ ] Keep block/decline reasons, profile values, message content, private graph
      structure, queries, and behavioral telemetry out of the receipt.
- [ ] Provide typed reports for wrong-target, unauthorized, stale, duplicated,
      misrepresented, or incompletely propagated transitions, with human
      authority, correction, appeal, and remedy.
- [ ] Reconcile history, export, deletion, closure, backups, restore, and
      residuals through [TODO 23](./23-data-portability-and-exit.md).

## Phase 5 — Run the bounded private pilot

- [ ] Use two approved adult test accounts, synthetic profiles, and one
      synthetic friends-only Thing; upload no contacts and use no real content.
- [ ] Preview and exercise request, decline, approved cooldown, resend, accept,
      crossed request, idempotent repeat, unfriend, and account switch.
- [ ] Prove pending grants nothing, acceptance enables only declared friend
      effects, and fresh unfriend revokes the synthetic Thing everywhere.
- [ ] If separately approved, exercise block/unblock across profile, feed,
      search, request, chat, group, notification, and ACL surfaces.
- [ ] Exercise offline/stale clients, races, retries, queued delivery, cache
      convergence, capability mismatch, failure, export, deletion, restore,
      incident stop, and remedy.
- [ ] Inspect all affected screens top-to-bottom at desktop and 390px; open
      previews, pending states, dialogs, errors, receipts, and remedy details.
- [ ] Delete all fixtures and reconcile both accounts' receipts against the
      observed canonical and residual state.

## Acceptance criteria

- [ ] Preview, mutation, current state, and every consumer use the same approved
      contract version and relationship identity.
- [ ] Both participants accurately predict visibility, communication,
      notification, history, and stop effects before and after each action.
- [ ] Pending, declined, removed, muted, blocked, stale, replayed, or failed
      states grant no authority beyond explicitly approved historical cases.
- [ ] Fresh ACL checks, caches, counts/lists, feeds, search, chats, groups, and
      notifications converge to the current state and expose pending
      propagation honestly.
- [ ] Current state, historical fact, safety evidence, moderation action,
      export, deletion, and residual state remain distinct and correctable.
- [ ] The journey passes exact-head capability, unit/integration,
      authorization, privacy/security, rate-limit, accessibility/language,
      constrained-network/device, failure/recovery, export/delete/restore, and
      browser checks.
- [ ] Evaluation retains negative, ambiguous, declined, removed, blocked,
      disputed, and stopped outcomes without a connection or engagement goal.

## Stop conditions

- A relationship is created, accepted, restored, expanded, or inferred without
  the required person's current action.
- A decline, withdrawal, unfriend, unfollow, leave, mute, or block is hidden,
  difficult, retaliatory, bypassed, or weaker than the connect action.
- Relationship state grants identity, trust, safety, content, edit, app, tool,
  endpoint, moderation, payment, collaboration, or AI authority not approved in
  the exact effects matrix.
- A stale client, retry, cache, queued notice, alternate route, link key, group,
  or account switch defeats current canonical state.
- Public counts/lists, receipts, logs, analytics, support, search, or exports
  expose private request, block, membership, motive, history, or graph data.
- Partial propagation, failure, cleanup, history, export, deletion, restore, or
  residual effects are reported as complete.
- Any approved capability, accessibility, privacy, security, rate-limit,
  incident, appeal, remedy, or data-deletion gate fails.

## Explicit non-goals

- Contact/address-book upload, phone/email discovery, proximity inference,
  imported graphs, people-you-may-know, or growth invitations.
- Public relationship graphs, badges/scores, popularity ranking, advertising,
  graph analytics, behavioral targeting, or AI personalization/training.
- Identity, kinship, trust, safety, endorsement, legal status, or consent
  outside the exact approved relationship effect.
- Dating, minors, guardianship, emergency services, employment, education,
  healthcare, finance, law enforcement, institutions, or sensitive domains.
- Federation/ActivityPub, cross-platform blocking, relationship credentials,
  delegated management, automatic reconciliation, or automated sanctions.

## First owner decision packet

Approve or revise:

1. two adult synthetic accounts and the existing friend lifecycle only;
2. one versioned state and surface-effects matrix, including public-list policy;
3. one owner-private preview and content-minimal transition receipt;
4. expected-state writes, fresh authorization, idempotence, cooldown, and caps;
5. directly accessible stop actions with truthful cached, queued, historical,
   export, deletion, and residual effects;
6. no contacts, inference, recommendations, analytics, public graph expansion,
   AI use, minors, institutions, or sensitive contexts;
7. block only after TODO 26's qualified approval; and
8. named reviewers, incident/remedy path, retention owner, and manual stop
   authority before implementation begins.
