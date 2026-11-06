# Relationship agency and consentful connection baseline

**Status:** Evidence note; no implementation is authorized by this document

**Grounded:** 2026-09-12, Australia/Melbourne

**Repository scope:** `origin/develop@d05696fde` plus the merged branch evidence
and external design references linked below. This is not a production
assessment, legal advice, identity proof, safety certification, or compliance
claim.

**Plan:**
[Relationship agency and consentful connection roadmap](../PLAN/relationship-agency-and-consentful-connection-roadmap.md)

**Execution epic:**
[TODO 41 — Relationship agency and consentful connection](../TODO/claude-todo/41-relationship-agency-and-consentful-connection.md)

## Why preserve this note

Thingtime already has a meaningful social substrate: one-way follows, mutual
friend requests, accepted-friend ACL resolution, public relationship counts and
lists, owner-private pending requests, Messenger request buckets, communities,
groups, notifications, and planned family circles. Those pieces prove that a
relationship is not merely decorative profile metadata.

They do not yet form one legible relationship contract. A person cannot inspect
one authoritative view of what a follow, pending request, friendship, message
request, group membership, mute, removal, or future block permits; which
surfaces reveal it; what stopping changes immediately; what history remains; or
how stale clients and derived audiences are invalidated. Personal account block
semantics remain planned in TODO 26, and family membership remains unshipped in
TODO 17.

The smallest useful experiment should therefore use two approved adult test
accounts and the existing friend lifecycle, then add only the minimum
owner-private preview and receipt needed to make its effects predictable. It
must not upload contacts, infer relationships, recommend people, create public
relationship graphs, or treat friendship as identity, trust, safety, access,
collaboration, or endorsement.

## Vocabulary that must stay separate

| Term                  | Meaning here                                                                                | Must not silently mean                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Follow                | One account asks to receive eligible public activity from another.                          | Friendship, approval, private access, endorsement, or a reciprocal relationship.                         |
| Relationship request  | A bounded proposal from one account to another with a declared type and effects.            | Consent already given, message authority, audience access, or permission to invite elsewhere.            |
| Accepted friendship   | A mutual platform relationship created after the recipient accepts.                         | Real-world friendship, identity proof, safety, trust, family, collaboration, or permanent consent.       |
| Circle                | An audience selector evaluated by ACL rules.                                                | A social truth, group membership, notification subscription, or editing authority.                       |
| Group/chat membership | Authority within one named container under its role contract.                               | Friendship, following, profile access, or authority outside that container.                              |
| Mute                  | A presentation or interruption preference.                                                  | Blocking, relationship removal, content deletion, or proof that delivery did not occur.                  |
| Remove/unfriend       | Ending an accepted relationship prospectively.                                              | Deleting either account's content, retracting past disclosures, or erasing historical facts.             |
| Block                 | A personal safety boundary whose exact interaction and visibility effects must be approved. | A moderation verdict, punishment, public accusation, universal erasure, or identity claim.               |
| Relationship receipt  | Owner-private, content-minimal evidence of a requested transition and its observed outcome. | A public graph, permanent behavioral dossier, consent to analytics, or proof of an offline relationship. |

## Repository evidence ledger

| Current evidence                                                                                                                                   | Repository anchor                                                                                               | Confidence and refresh trigger                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Follows are one-way and friendship is a mutual request/accept lifecycle with `request`, `cancel`, `accept`, `decline`, and `unfriend` intents.     | `remix/app/api/utils/users/social.ts` (`setFollow`, `FRIEND_INTENTS`, `friendAction`)                           | High for this head. Re-run after social writers or schemas change.                                       |
| Social edges are home-database identity state, protected from generic Thing mutation and deduplicated through relationship keys.                   | `social.ts`, `messenger/shared.ts`, `schemas/registry.ts`, `mongodb/relationshipLookup.ts`                      | High for repository design; production data was not inspected.                                           |
| Crossed friend requests become acceptance, repeated intents are intended to be idempotent, and accepted pairs power `tt:userFriends`.              | `friendAction`, `friendIdsOf`, `things.ts` (`withFriendIds`), `schemas/registry.ts` (`aclEntryMatches`)         | High for code paths; requires live race and ACL proof before product claims.                             |
| Profiles expose follower/following/friend counts and public connection lists; pending incoming requests are private to the target account.         | `relationshipSummary`, `listConnections`, `RelationshipControls.tsx`                                            | High for code behavior. Public-list policy needs owner review.                                           |
| The UI optimistically mutates relationship state, reverts on failure, and requires a second click for unfriend.                                    | `remix/app/components/Profile/RelationshipControls.tsx`                                                         | High for implementation; browser and assistive-technology behavior was not re-tested here.               |
| Friend-request and friend-accepted notifications exist, but persistence, presentation, read state, delivery, and outcome remain separate evidence. | `social.ts`, `api/utils/notifications/notifications.ts`, TODO 37                                                | High for code linkage; no delivery claim.                                                                |
| Messenger has separate pending request, decline-lockout, membership, and mute semantics.                                                           | `api/utils/messenger/`, `PRs/174-thingtime-messenger-platform-thingtime-messenger-spaces-chats.md`              | High for documented implementation; not one cross-surface relationship contract.                         |
| Friends are shipped for ACL audiences; family remains owner-only until TODO 17's separate consent-based pair model is implemented.                 | `TODO/claude-todo/17-circles.md`                                                                                | High for the documented boundary; re-run after circle work.                                              |
| Account-level personal block behavior is not a shipped social primitive in this snapshot.                                                          | TODO 26's open account-block decision; no matching social implementation found after Graphify-guided inspection | Medium-high; re-run after moderation, profile, social, Messenger, feed, search, or notification changes. |

## External design inputs

- The W3C [Activity Vocabulary](https://www.w3.org/TR/activitystreams-vocabulary/)
  distinguishes relationship-management activities including `Follow`,
  `Invite`, `Accept`, `Reject`, `Block`, and `Undo`. It is vocabulary input,
  not a requirement to adopt ActivityStreams or ActivityPub.
- The W3C [Privacy Principles](https://www.w3.org/TR/privacy-principles/)
  emphasizes group and membership privacy, informed intent, and making consent
  withdrawal or objection as easy as giving consent.
- Australia's eSafety Commissioner places
  [user empowerment and autonomy](https://www.esafety.gov.au/industry/safety-by-design/foundations/empowering-users-to-stay-safe-online)
  alongside provider responsibility and accountability. This is a safety
  design input, not certification.
- OAIC's [APP guidance on consent](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-b-key-concepts)
  describes consent as informed, voluntary, current, and specific, and says
  withdrawal should be easy and accessible. Qualified review must decide what
  applies to any real deployment.

## Gaps this theme owns

1. **No canonical relationship-effects matrix.** State names exist, but the
   product does not show their consequences across profile, feed, ACL, search,
   chat, groups, notifications, email/push, exports, or recommendations.
2. **No cross-surface stop contract.** Unfriend, unfollow, leave, decline,
   mute, and future block are separate operations without one authoritative
   statement of immediate, queued, cached, historical, and residual effects.
3. **No safe block foundation.** TODO 26 names account block, but the exact
   directionality, discovery, existing chats, shared groups, mentions,
   notifications, audience membership, appeals, and emergency exceptions are
   undecided.
4. **Public graph exposure is broad by default.** Counts and accepted
   connection lists are public; there is no documented owner policy for hiding
   lists, counts, or membership in sensitive contexts.
5. **No bounded transition receipt.** Optimistic UI can say an action succeeded
   or failed, but there is no content-minimal owner view binding requested
   transition, current state, affected surfaces, and cleanup outcome.
6. **No stale-client invalidation contract.** Cached relationship state,
   already-fetched feeds, notifications, and open chat views need explicit
   behavior after removal or block.
7. **Relationship signals can leak into adjacent systems.** Search, ranking,
   recommendations, analytics, AI, safety scoring, and ads must not infer new
   authority or sensitive relationships without separate approval.

## Risks and abuse cases

- Repeated requests, cross-surface invitations, or notifications become a
  harassment channel after decline, removal, or block.
- A relationship change silently widens ACL visibility or leaves cached private
  content visible after authority ends.
- Public counts or lists reveal sensitive associations, group membership, or a
  person's response to a request.
- “Friend” is presented as proof of real-world closeness, identity, safety,
  trustworthiness, endorsement, or consent to contact.
- Blocking removes evidence needed for the blocker while continuing to expose
  the blocker's profile, activity, or status to the blocked account.
- A stale client or replay recreates a relationship after either party stopped
  it, or reports success when only one subsystem changed.
- Relationship data becomes an unreviewed ranking, advertising, training,
  fraud, moderation, or AI-personalization feature.

## Bounded first experiment

Use two approved adult test accounts, A and B, with synthetic profiles and no
real contacts. A previews one friend request: recipient, relationship type,
current state, notification, `tt:userFriends` audience effect after acceptance,
public-list exposure, and each person's stop actions. A sends; B declines; A
retries only after an approved cooldown; B accepts; both inspect the same
accepted state; A shares one synthetic friends-only Thing; B verifies access;
then B unfriends and the Thing becomes inaccessible on a fresh authorization
check. Repeat the stop path with one separately approved block design only
after its matrix is accepted.

Record only synthetic account IDs, contract/state versions, requested and
observed transitions, timestamps, affected-surface result codes, and cleanup
status. Do not record profile text, relationship motives, free-form feedback,
queries, dwell, cursor movement, contacts, messages, or the shared Thing body.

Success means both participants can predict the effects before each action and
the observed fresh state matches the approved matrix. It does not mean they
accept, remain connected, send messages, invite others, or spend more time.

## Stop conditions

Stop intake and preserve only incident-minimum evidence if any test:

- creates or restores a relationship without the required party's current
  action, or prevents an easy decline, withdrawal, removal, leave, mute, or
  block;
- exposes private content, request state, block state, relationship history,
  membership, or identifiers outside the approved audience;
- lets relationship state grant edit, app, tool, endpoint, moderation,
  identity, payment, or AI authority;
- allows a stale client, retry, notification, cache, or alternate surface to
  bypass a stop action;
- misreports partial propagation, queued delivery, cleanup, history, export,
  deletion, or residual state as complete; or
- fails an approved accessibility, privacy, security, capability, rate-limit,
  incident, remedy, or data-deletion gate.

## Questions for owners and qualified reviewers

1. Which relationship types belong in v1, and which exact effects does each
   state have across every product surface?
2. Should connection counts and lists remain public, become owner-controlled,
   or be hidden in some contexts?
3. What does account block do to follows, friendships, requests, ACL-derived
   access, existing chats/groups, notifications, search, and shared history?
4. Which history must either person retain for safety or disputes, and what can
   be deleted or exported?
5. What cooldown, request cap, non-enumerating response, and escalation path
   prevent repeated contact without punishing legitimate mistakes?
6. How do caches, queued notices, offline clients, retries, and concurrent
   actions converge on the current state?
7. Which relationship signals, if any, may enter search, ranking,
   recommendations, analytics, or AI, and under what separate consent?
8. Who owns product, privacy, security, safety, accessibility, operations,
   incident response, appeal/remedy, and manual stop authority?
