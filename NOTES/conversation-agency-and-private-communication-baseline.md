# Conversation agency and private-communication baseline

Last grounded: 2026-09-18 09:29 AEST, Australia/Melbourne

Status: evidence note; not an approved communications policy, encryption
claim, retention schedule, moderation expansion, production feature, or legal
conclusion

Plan: [conversation agency and private-communication roadmap](../PLAN/conversation-agency-and-private-communication-roadmap.md)

Execution epic: [TODO 53](../TODO/claude-todo/53-conversation-agency-and-private-communication.md)

## Question

How could Thingtime make direct messages, groups, channels, Lopu chats, and
private archives legible and controllable without treating membership as
permanent authority, a delivery as consent to surveillance, deletion as magic,
or an access-controlled server record as end-to-end encrypted communication?

## Working vocabulary

| Term                  | Meaning in this note                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversation          | A chat plus its membership, messages, threads, reactions, attachments, receipts, settings, notifications, caches, archives, and derived records         |
| Participant authority | What a current member may read, send, change, invite, remove, moderate, export, or delete in one conversation state                                     |
| Delivery state        | Server acceptance, participant availability, device display, read state, and downstream action as separate facts                                        |
| Conversation family   | The live chat and every copy, notification, cache, attachment, archive, export, moderation item, support record, AI context, and backup derived from it |
| Safety stop           | A bounded action such as decline, mute, leave, remove, block, report, hide, or emergency disclosure fence, each with explicit effects                   |
| Deletion receipt      | Honest evidence of what was hidden, content-cleared, detached, retained, queued for cleanup, or irretrievably removed                                   |
| Confidentiality claim | A precisely scoped statement about who can access content or metadata, supported by the implemented architecture rather than interface language         |

These are planning terms. They do not establish legal privilege, lawful basis,
confidentiality, erasure, encryption, safety, or regulatory compliance.

## Repository evidence

### Membership is the server-side door

- [`messenger.ts`](../remix/app/api/utils/messenger/messenger.ts) stores chats,
  memberships, messages, and reactions as separate relational Things. It says
  messages are not posts and checks live membership on every conversation call
  so feed, profile, and permalink paths do not surface them.
- `resolveChatAccess()` distinguishes missing, pending, active, left, and
  declined membership. Sending rechecks the chat and membership inside the
  write transaction so a concurrent departure cannot silently authorize a
  message.
- Public channels require community membership; private channels require an
  administrator to add a person. DMs stay between two people, while group and
  channel membership have explicit owner, admin, and member roles.

This is a strong access-control baseline. It does not by itself define every
copy, cache, archive, notification, support view, backup, or future cryptographic
endpoint as part of the same authority boundary.

### Requests and read receipts already avoid two common privacy traps

- A pending recipient can inspect a message request without writing a read
  receipt. Acceptance or sending transitions the membership instead of treating
  preview as consent.
- Read receipts use a parity rule: a person who turns them off neither shares
  nor sees other people's receipts. The server keeps the person's own private
  high-water mark so unread state still works.
- The control is currently account-wide rather than conversation-specific.
  Mute is conversation-specific and excludes the chat from unread totals.

The current contract separates request preview, unread bookkeeping, and shared
"seen" state. It does not yet explain notification previews, device lock-screen
content, typing/presence, future delivery receipts, or how old receipts age and
disappear.

### Message writes are bounded, idempotent, and membership-fenced

- Messages have a character cap, optional threads and replies, and attachments
  bound through the protected message-attachment lifecycle.
- Attachment sends require a stable request ID. Exact retries reconcile to the
  same deterministic message, while a different payload under the same ID is
  rejected.
- Authors may edit their messages; imported AI rows and Lopu assistant replies
  stay non-editable. Authors or chat administrators may delete an ordinary
  message.

This protects against duplicate sends and some authority races. It does not
define an edit-history view, edit notification, dispute hold, quote/screenshot
boundary, administrator-deletion reason, or participant-visible audit receipt.

### Deletion currently means different things on different surfaces

- Ordinary message deletion is a soft delete. The text is cleared, attachments
  enter their canonical cleanup path, reactions are removed, the sidebar stops
  echoing the words, and a tombstone remains to preserve thread shape.
- A person cannot leave a DM; they can decline or mute it. Group and channel
  members can leave, and ownership passes to a surviving administrator or
  member.
- An owner can delete a Lopu conversation as one accounted transaction that
  removes its messages, reactions, memberships, chat, and attached objects
  after object cleanup.
- The inspected ordinary Messenger path does not expose equivalent whole-chat
  deletion, participant-specific history removal, expiry, or retention policy.

"Deleted message," "left chat," "muted," and "deleted Lopu conversation" are
therefore distinct outcomes. None proves deletion from another participant's
device, an existing archive/export, backup, required safety evidence, or a
third-party system.

### A private archive exists, but it is deliberately not a live conversation

- [`ChatDetailsDrawer.tsx`](../remix/app/components/Messenger/ChatDetailsDrawer.tsx)
  offers copy or download for ordinary chats through the shared Thing transfer
  controls. Import creates a private read-only archive and never messages
  participants or changes the source conversation.
- Imported external-AI conversations are excluded from that archive control.
  Their source and synchronization contract remain separate.

This is useful portability. A full contract still needs exact included data,
participant notice, attachment treatment, redaction, revocation limits,
version/freshness, archive deletion, and proof that importing never creates a
new audience or live authority.

### Access control is not an end-to-end encryption claim

The current implementation stores and projects messages through the Thingtime
server and database. The inspected Messenger code does not establish
client-held group keys, forward secrecy, post-compromise security, encrypted
membership changes, key verification, multi-device recovery, or metadata
protection. Product language must describe the implemented membership and
storage boundary honestly and must not imply end-to-end encryption.

## External design anchors

| Anchor                                                                                                                                                                                                                                                                                                                                                                                                | Planning implication                                                                                                                                                | Limit                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Australia's eSafety Commissioner [Safety by Design](https://www.esafety.gov.au/industry/safety-by-design) places user safety and rights at the centre, assigns responsibility to providers, and highlights discoverable reporting, blocking, muting, conversation controls, and protective defaults.                                                                                                  | Make safe stopping understandable and dependable; do not put the whole burden on a recipient after harm.                                                            | General safety guidance; exact threat models and legal duties require qualified review.         |
| OAIC [APP 11 guidance](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines/chapter-11-app-11-security-of-personal-information) calls for reasonable security and active consideration of whether retained personal information is still needed, including destruction, de-identification, or tightly bounded beyond-use handling where applicable. | Define retention and deletion honestly across live rows, tombstones, caches, archives, objects, logs, and backups before making privacy promises.                   | Applicability, exceptions, and reasonable steps are context-specific legal questions.           |
| The [NIST Privacy Framework](https://www.nist.gov/privacy-framework) provides a voluntary way to identify, govern, control, communicate, and protect against privacy risks arising from data processing.                                                                                                                                                                                              | Give participants reliable explanations and controls for content, metadata, purposes, copies, processors, retention, and remedies.                                  | Risk-management guidance, not a product specification or legal safe harbour.                    |
| IETF [RFC 9420](https://www.rfc-editor.org/info/rfc9420/) specifies Messaging Layer Security for asynchronous group key establishment with forward secrecy and post-compromise security, while also documenting metadata and delivery-service limits.                                                                                                                                                 | Treat any future end-to-end security proposal as a separately reviewed cryptographic architecture with device, membership, recovery, metadata, and lifecycle proof. | A standard is not implementation evidence; Thingtime does not gain its guarantees by citing it. |

All four official pages returned HTTP 200 when checked on 2026-09-18.

## The product gap

Thingtime has meaningful server-enforced membership, request privacy,
idempotent writes, account-level receipt privacy, message editing/deletion,
muting, leaving, role changes, attachment cleanup, Lopu-chat deletion, and
private archive export. It does not yet have one approved contract joining:

1. conversation, participant, device, audience, and role states with exact effects;
2. message delivery, display, reading, reply, edit, delete, and downstream action as separate evidence;
3. per-conversation content, receipt, notification-preview, archive, and AI-context choices;
4. blocking, reporting, leaving, removal, emergency hiding, and support as distinct safety stops;
5. retention and deletion across the complete conversation family;
6. edit/admin-action transparency without exposing private safety reasons;
7. archive/export scope, participant rights, redaction, freshness, and revocation limits;
8. honest confidentiality and encryption language backed by tested architecture;
9. accessible and localized controls that remain useful on low bandwidth; and
10. a narrow, synthetic rehearsal that does not scan or expose real messages.

## Boundaries with adjacent garden work

- [TODO 19](../TODO/claude-todo/19-anonymous-group-chats.md) owns chat-local
  anonymity and must not promise anonymity the server or participant set cannot
  support.
- [TODO 23](../TODO/claude-todo/23-data-portability-and-exit.md) owns account
  export, restore, deletion, and closure. This chain owns conversation-specific
  archive meaning and participant effects.
- [TODO 26](../TODO/claude-todo/26-community-safety-and-accountable-moderation.md)
  owns account blocking, reports, moderation, appeals, and protective remedies.
- [TODO 33](../TODO/claude-todo/33-ai-agency-and-accountable-assistance.md)
  owns model/tool authority and AI context disclosure.
- [TODO 35](../TODO/claude-todo/35-identity-agency-and-context-safe-presence.md)
  owns participant identity, aliases, and disclosure assurance.
- [TODO 37](../TODO/claude-todo/37-notification-agency-and-accountable-delivery.md)
  owns notification lifecycle and channel delivery truth.
- [TODO 41](../TODO/claude-todo/41-relationship-agency-and-consentful-connection.md)
  owns relationship state and contact eligibility; a relationship never grants
  permanent conversation authority.
- [TODO 44](../TODO/claude-todo/44-local-first-agency-and-accountable-synchronization.md)
  owns cache and synchronization conflict semantics.
- [TODO 45](../TODO/claude-todo/45-youth-safety-and-age-appropriate-agency.md)
  owns age-appropriate safeguards; minors remain outside the first rehearsal.
- [TODO 46](../TODO/claude-todo/46-evidence-agency-and-accountable-product-claims.md)
  owns public privacy, deletion, delivery, safety, and encryption claims.

## Candidate conversation contract

1. **Membership is live, scoped authority.** Recheck role and state at every
   read, write, export, moderation action, and asynchronous completion.
2. **Preview before joining or adding.** Show conversation type, participants,
   role, history visibility, notification defaults, receipt behavior, archive
   rules, and ways to stop.
3. **Separate lifecycle facts.** Accepted, delivered, displayed, read, replied,
   edited, deleted, exported, and acted on must never collapse into one status.
4. **Minimize presence signals.** No typing, presence, read, or notification
   preview signal appears without a clear purpose, audience, and control.
5. **Deletion says what happened.** Distinguish content clearing, tombstone,
   object cleanup, participant removal, archive persistence, backup handling,
   and minimum safety evidence.
6. **A safety stop has explicit effects.** Decline, mute, leave, remove, block,
   report, and emergency hide must say what changes now and what does not.
7. **Archives are inert snapshots.** They cannot message, restore membership,
   expand audience, or imply current source state.
8. **Never overclaim confidentiality.** Membership checks, TLS, storage
   controls, and end-to-end encryption are different guarantees.

## Bounded first rehearsal

Use adult internal reviewers, three synthetic accounts, one synthetic DM, one
synthetic private group, fixed invented text, one harmless generated attachment,
and one exact non-production build. Rehearse:

- request preview, accept, decline, mute, leave, remove, and role change;
- read receipts on/off, notification-preview choices, and unread bookkeeping;
- idempotent send, reply, thread, edit, author delete, admin delete, attachment
  cleanup, and stale membership during send;
- private archive preview, copy/download/import, freshness notice, and deletion;
- plain-language confidentiality labels that explicitly do not claim E2EE; and
- a non-functional mock of block/report effects handed to TODO 26.

Do not use real conversations, contacts, abuse reports, devices, production
notifications, production data, external processors, cryptographic claims,
minors, covert monitoring, message scanning, or real safety cases.

## Evaluation questions

- Can each participant state what they may do and what another role may do?
- Does request preview avoid read/presence leakage before acceptance?
- Do read-receipt and notification-preview choices match their visible effects?
- Are edit, author deletion, admin deletion, archive, and full-chat deletion
  described as different operations with honest residual data?
- Does a membership or account switch make stale asynchronous work inert?
- Can a person choose the right safety stop without believing mute equals block
  or that leave removes every copy?
- Can an archive remain useful while clearly inert, private, versioned, and
  independently deletable?
- Does every confidentiality statement name the actual technical boundary?
- Do keyboard, touch, screen reader, zoom, narrow-screen, localization, and
  low-bandwidth paths reach the same controls and explanations?

## Open owner decisions

- Which conversation types allow historical messages to new or returning
  members, and how is that previewed before entry?
- Which controls belong per account, per conversation, per participant, or per
  device?
- What does ordinary whole-chat deletion mean for each participant, archive,
  attachment, receipt, notification, support, moderation, log, and backup?
- Which administrator actions need a participant-visible event or appeal path?
- What metadata is operationally necessary, for how long, and who can inspect it?
- Is end-to-end encryption a product goal? If so, what device, identity,
  membership, key recovery, multi-device, export, moderation, and metadata
  tradeoffs must be decided before implementation?
- What aggregate evidence can improve reliability and safety without collecting
  or reconstructing conversation content or private relationship graphs?

Refresh this note after changes to Messenger membership, messages, receipts,
notifications, caches, archives/transfer, attachments, AI conversation import,
moderation, account export/deletion, storage, backup, or encryption architecture.
