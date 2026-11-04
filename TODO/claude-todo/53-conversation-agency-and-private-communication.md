# 53 — Conversation agency and private communication

Status: 🟣 Proposed · owner and qualified review needed

Evidence: [baseline](../../NOTES/conversation-agency-and-private-communication-baseline.md)

Plan: [roadmap](../../PLAN/conversation-agency-and-private-communication-roadmap.md)

## Goal

Make every Thingtime conversation authority explicit, current, minimal,
previewable, and stoppable, with honest delivery, metadata, archive, deletion,
retention, safety, and confidentiality boundaries.

## Why this belongs in the garden

Thingtime already has membership-gated Messenger reads and writes, pending
request privacy, role-aware groups/channels, parity-based read receipts,
conversation mute, idempotent message sends, threads/replies, author edits,
author/admin deletes, attachment cleanup, Lopu-chat deletion, and private
read-only archive transfer. These are strong primitives, but they do not yet
form one participant-facing contract for history visibility, per-scope choices,
delivery truth, safety stops, whole-conversation deletion, family retention,
administrator transparency, archive independence, or honest encryption claims.

This TODO creates that decision and rehearsal boundary without implementing
moderation, scanning messages, or overclaiming confidentiality.

## Dependencies and boundaries

- [TODO 19](./19-anonymous-group-chats.md) owns chat-local anonymity.
- [TODO 23](./23-data-portability-and-exit.md) owns account export, restore,
  deletion, and closure. This TODO owns conversation archive semantics.
- [TODO 26](./26-community-safety-and-accountable-moderation.md) owns account
  blocking, reports, moderation, appeals, and protective remedies.
- [TODO 33](./33-ai-agency-and-accountable-assistance.md) owns model/tool
  authority and AI context disclosure.
- [TODO 35](./35-identity-agency-and-context-safe-presence.md) owns identity,
  aliases, and participant disclosure.
- [TODO 37](./37-notification-agency-and-accountable-delivery.md) owns
  notification acceptance, display, read, and outcome truth.
- [TODO 41](./41-relationship-agency-and-consentful-connection.md) owns
  relationship state and contact eligibility.
- [TODO 44](./44-local-first-agency-and-accountable-synchronization.md) owns
  cache and synchronization conflict semantics.
- [TODO 45](./45-youth-safety-and-age-appropriate-agency.md) owns child and
  guardian safeguards; minors are excluded from the first rehearsal.
- [TODO 46](./46-evidence-agency-and-accountable-product-claims.md) owns public
  privacy, deletion, safety, retention, and encryption claims.
- `FUNDAMENTALS.md` and `DECISIONS.md` remain authoritative. This TODO approves
  no production messaging, retention, moderation, or cryptographic change.

## Phase 0 — establish the safe current posture

- [ ] Name product, privacy, safety, security, accessibility, child-safety,
      data, infrastructure, support, moderation, and legal owners plus stop
      authority.
- [ ] Inventory chats, memberships, messages, reactions, attachments, receipts,
      notifications, caches, AI imports, archives, exports, logs, support/
      moderation access, backups, and deletion paths.
- [ ] Preserve and test membership gates, pending-request receipt privacy,
      parity receipts, deterministic retry, transaction-time membership recheck,
      and protected attachment binding.
- [ ] Mark unverified retention, backup, processor, metadata, and confidentiality
      behavior unknown; prohibit E2EE language and production experiments.

## Phase 1 — approve conversation states, authority, and history rules

- [ ] Define DM, group, channel, Lopu, imported AI, live source, and private
      archive without treating them as equivalent.
- [ ] Define pending, active, left, declined, removed, blocked, reported,
      deleted, archived, and safety-fenced states with exact effects.
- [ ] For every role and transition, approve read/send/add/remove/rename/
      edit/delete/export/moderate authority, participant notice, reversal,
      retained evidence, and remedy.
- [ ] Decide what history a new, returning, removed, or departed member may see
      and preview it before membership changes.

## Phase 2 — specify choices, receipts, retention, and cleanup

- [ ] Define per-account, per-conversation, and per-device scopes for read
      receipts, presence/typing if ever added, notification previews, mute,
      archive, retention, and AI context.
- [ ] Define a bounded conversation-choice preview and owner-visible action
      receipt without copying message content or private relationship graphs.
- [ ] Specify edit/admin-delete events, soft-delete tombstones, ordinary
      whole-chat deletion, attachment/object cleanup, archive deletion, backup
      handling, safety holds, and honest residual-state language.
- [ ] Specify the conversation family and one cleanup/fencing graph across
      live rows, caches, notifications, objects, archives, exports, support,
      moderation, logs, AI context, and backups.

## Phase 3 — prototype one synthetic DM and private group

- [ ] Use adult internal reviewers, three synthetic accounts, one synthetic DM,
      one private group, invented text, one harmless generated attachment, and
      one exact non-production build.
- [ ] Rehearse request preview, accept, decline, group entry, add/remove, role
      change, mute, leave, and receipt choices.
- [ ] Rehearse idempotent send, reply/thread, edit, author delete, admin delete,
      attachment cleanup, and a membership change during send.
- [ ] Preview archive scope, copy/download/import, source version, inertness,
      deletion, and plain-language non-E2EE confidentiality boundaries.

## Phase 4 — rehearse failure and safety stopping

- [ ] Exercise account switch, stale cache, offline/reconnect, duplicate and
      reordered responses, unknown commit outcome, attachment-cleanup failure,
      edit/delete collision, and archive/source divergence.
- [ ] Exercise decline, mute, leave, remove, and a non-functional block/report
      handoff to TODO 26; state what each action does not do.
- [ ] Fence every completion to viewer, conversation, membership version,
      operation identity, immutable payload, and device/account context.
- [ ] Prove uncertainty cannot duplicate messages, resurrect deleted content,
      broaden membership, expose history, or misstate a safety stop.

## Phase 5 — accessibility, evidence, and cleanup

- [ ] Test keyboard, touch, screen reader, reduced motion, 200% zoom, narrow
      screens, plain language, localization, low bandwidth, and offline paths.
- [ ] Measure authority and residual-state comprehension, request leakage,
      duplicate sends, mistaken audience, safety-stop success, archive
      independence, access parity, and support burden without content analytics.
- [ ] Route every privacy, safety, delivery, deletion, retention, archive, and
      encryption statement through TODO 46 with exact-version evidence.
- [ ] Delete all synthetic accounts, chats, memberships, messages, attachments,
      reactions, receipts, notifications, caches, archives, exports, and local
      fixtures; verify no object or active authority remains.

## Acceptance criteria

- Each conversation type, member state, and role has explicit current authority
  and history visibility with a preview before joining or adding.
- Request preview, server acceptance, notification display, reading, reply,
  edit, delete, export, and downstream action remain separate facts.
- Read/presence metadata is minimized, scoped, controllable, and absent before
  request acceptance; private unread bookkeeping still works.
- Send retry and membership-change races converge without duplicate messages,
  stale writes, resurrected content, or expanded access.
- Decline, mute, leave, remove, block/report handoff, message deletion, and
  whole-chat deletion have distinct, accurately explained effects.
- Deletion and retention name every residual tombstone, object, archive, cache,
  notification, log, safety record, backup, and participant copy honestly.
- Private archives are inert, private, versioned, independently deletable, and
  incapable of messaging or restoring membership.
- No interface or public text implies end-to-end encryption, erasure, privilege,
  or safety without separately proven architecture and exact-version evidence.
- No real conversation, contact, abuse case, device, production data, minor,
  external processor, message scan, or public claim enters the rehearsal.

## Hard stops

- Real messages, contacts, accounts, devices, notifications, reports, or abuse.
- Covert monitoring, message scanning, presence inference, or content analytics.
- Minors or domestic, sexual, health, legal, workplace, protest, refuge, or
  other high-risk conversations without qualified protection.
- Silent history exposure, cross-account cache leakage, stale membership
  authority, failed object/archive cleanup, or ambiguous safety-stop effects.
- Unbounded retention, unsupported deletion/erasure language, or a server-access
  boundary presented as end-to-end encryption.
- Cryptographic design or implementation without specialist review, migration,
  recovery, metadata, multi-device, and interoperability decisions.
- Missing qualified owners, inaccessible controls, or failed cleanup proof.

## Concrete next action

Convene the named owners for a 60-minute decision review of the baseline and
roadmap. Approve or reject: (1) conversation/member/state taxonomy, (2) role and
history-visibility matrix, (3) delivery/read/edit/delete evidence vocabulary,
(4) settings scopes, (5) retention and deletion-family graph, (6) archive
contract, (7) safety-stop handoff, (8) confidentiality language and optional
cryptography decision packet, (9) accessible synthetic rehearsal, and
(10) measures, cleanup, and stop thresholds. If any owner or boundary is
missing, keep the proposal documented and do not prototype it.
