# Conversation agency and private-communication roadmap

Status: Proposed

Evidence: [conversation agency and private-communication baseline](../NOTES/conversation-agency-and-private-communication-baseline.md)

Execution epic: [TODO 53](../TODO/claude-todo/53-conversation-agency-and-private-communication.md)

## Outcome

Thingtime conversations have understandable live authority, privacy controls,
delivery truth, safety stops, archive semantics, and honest retention and
confidentiality boundaries across DMs, groups, channels, Lopu chats, devices,
and copies.

## Principles

- Membership and roles are current scoped authority, not permanent consent.
- Request preview, server acceptance, display, reading, and action are separate.
- Minimize receipts, presence, notification previews, and other metadata.
- Preview participant, history, receipt, archive, and stopping effects.
- Decline, mute, leave, remove, block, report, and delete remain distinct.
- Deletion reports residual state and follows the full conversation family.
- Archives are private inert snapshots, never renewed live authority.
- Never imply end-to-end encryption without separately proven cryptography.
- Safety and accessible stopping outrank engagement and continuity.
- Qualified product, privacy, safety, security, accessibility, child-safety,
  data, infrastructure, support, moderation, and legal owners approve real use.

## Phase 0 — assign authority and preserve the safe baseline

Name owners and inventory chat/member/message/reaction Things, attachments,
request states, receipts, notifications, browser caches, AI imports, archives,
exports, support/moderation access, logs, backups, and deletion paths. Preserve
membership checks, pending-request receipt privacy, deterministic send retries,
and current server-side projections while marking unverified retention and
confidentiality unknown.

Gate: no surface calls access-controlled server storage end-to-end encrypted,
and one owner can stop the rehearsal.

## Phase 1 — approve the state, authority, and effect matrix

Define conversation type; member state and role; history visibility; request,
send, delivery, display, read, reply, edit, delete, export, archive, and safety
states. For every transition, record actor, authority, audience, participant
notice, retained evidence, notification, cache effect, reversal, and remedy.

Gate: every effect has one live source of authority, and no friendship,
notification, old receipt, archive, or prior membership silently grants access.

## Phase 2 — specify choice, receipt, retention, and family cleanup

Define a versioned conversation-choice preview and bounded owner-visible action
receipt. Specify per-account, per-conversation, and per-device settings;
content/metadata retention; soft deletion; whole-chat deletion; attachment and
archive cleanup; safety holds; backup handling; and honest residual-state text.

Gate: a participant can tell what happened, what remains, who can access it,
when it changes, and which adjacent owner supplies remedy without reading
private content in an audit trail.

## Phase 3 — prototype one synthetic DM and private group

In one exact non-production build, use three synthetic adult accounts, invented
messages, and one harmless generated attachment. Rehearse request preview,
accept/decline, group entry, role change, receipt choices, mute, leave, remove,
send/retry, reply/thread, edit, author/admin delete, and archive transfer.

Gate: reviewers predict every authority, signal, participant notice, residual
record, and stopping effect before acting; no real person or production system
is involved.

## Phase 4 — rehearse concurrency, failure, and safety stopping

Exercise changed membership during send/export, account switch, stale cache,
duplicate and reordered responses, device offline/reconnect, attachment cleanup
failure, edit/delete collision, archive made before source change, request
decline, and a mock safety escalation. Fence every completion to its initiating
viewer, conversation, membership version, operation identity, and payload.

Gate: stale work is inert, uncertainty never duplicates a message or broadens
access, and each stop has dependable documented effects.

## Phase 5 — accessibility, evidence, and cleanup proof

Test keyboard, touch, screen reader, reduced motion, 200% zoom, narrow screens,
plain language, localization, low bandwidth, and offline recovery. Measure
comprehension, request leakage, duplicate sends, mistaken audience, stop success,
residual-data understanding, archive independence, and support burden without
collecting content or private relationship graphs. Delete every fixture, cache,
archive, object, receipt, and local message.

Gate: cleanup is independently verified and no public privacy, safety,
retention, deletion, or encryption claim outruns exact-version evidence.

## Measures to define before implementation

| Measure                      | Required definition                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Authority comprehension      | Participant predicts who can read, send, add/remove, edit/delete, export, and moderate                                |
| Request privacy              | Preview creates no shared read/presence signal before acceptance                                                      |
| Delivery truth               | Accepted, displayed, read, replied, edited, deleted, and acted-on states remain distinct                              |
| Safety-stop reliability      | Decline, mute, leave, remove, block/report handoff, and emergency fence match the previewed effects                   |
| Residual-state comprehension | Participant understands tombstones, archives, other devices, backups, and minimum retained evidence                   |
| Idempotent convergence       | Retries, duplicate/reordered responses, and uncertain outcomes converge without duplicate messages or authority drift |
| Archive independence         | Snapshot is private, inert, versioned, independently deletable, and cannot restore membership                         |
| Accessible outcome parity    | Supported input and assistive paths reach the same authority, privacy, stopping, and remedy outcome                   |

No measure is a target until owners approve its definition, collection method,
retention, accessibility/safety breakdown, minimum sample, and stop threshold.

## Risks and responses

| Risk                                          | Response                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Membership change races a send or export      | Recheck in the transaction and bind completion to membership version and operation identity       |
| Read/presence data becomes surveillance       | Default to minimum signals, preserve parity, add clear scopes, and expire unnecessary metadata    |
| Mute is mistaken for block or deletion        | Preview exact effects and route block/report semantics to TODO 26                                 |
| Soft delete is presented as erasure           | Name tombstone, attachment, archive, backup, safety-evidence, and participant-copy outcomes       |
| Administrator power becomes invisible         | Emit bounded participant-visible events and define appeal/remedy without exposing private reasons |
| Archive becomes a second live chat            | Make it read-only, private, versioned, and incapable of messaging or restoring membership         |
| AI/import path expands conversation authority | Keep source, sync, model context, and live participant authority separate under TODO 33           |
| Access control is marketed as E2EE            | Use exact boundary language and gate cryptographic claims on separate architecture and proof      |
| Safety proof scans private messages           | Use synthetic fixtures and metadata-free aggregate evidence only                                  |
| Controls exclude constrained users            | Maintain accessible, localized, low-bandwidth, and offline-safe paths                             |

## Hard stops

Stop for real private messages or contacts; production notifications, devices,
accounts, or moderation; covert monitoring; message scanning; minors; domestic,
sexual, health, legal, workplace, protest, refuge, or other high-risk cases;
silent history exposure; cross-account cache leakage; failed attachment/archive
cleanup; ambiguous safety-stop effects; unbounded retention; unsupported erasure
or encryption claims; cryptographic implementation without specialist review;
or absent qualified owners.

## Dependencies and boundaries

- TODO 19 owns chat-local anonymity.
- TODO 23 owns account-wide portability, deletion, and closure.
- TODO 26 owns blocking, reporting, moderation, appeals, and safety remedies.
- TODO 33 owns AI/model/tool authority and context use.
- TODO 35 owns participant identity and aliases.
- TODO 37 owns notification delivery lifecycle.
- TODO 41 owns relationship state and contact eligibility.
- TODO 44 owns cache and synchronization conflict semantics.
- TODO 45 owns age-appropriate safeguards.
- TODO 46 owns public privacy, deletion, safety, and encryption claims.
- `FUNDAMENTALS.md` and `DECISIONS.md` remain authoritative.

## Next owner packet

Present the evidence baseline, current data/authority map, state-and-effect
matrix, history-visibility rules, settings scopes, deletion-family graph,
archive contract, safety-stop handoff, confidentiality language, optional
cryptography decision packet, accessible synthetic fixture plan, measures,
cleanup proof, stop conditions, and owner decisions before implementation.
