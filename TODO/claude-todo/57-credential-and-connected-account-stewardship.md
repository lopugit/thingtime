# 57 — Credential and connected-account stewardship

**Status:** 🟣 Proposed · owner and qualified privacy/security review needed

**Evidence:** [baseline](../../NOTES/credential-and-connected-account-stewardship-baseline.md)

**Plan:** [roadmap](../../PLAN/credential-and-connected-account-stewardship-roadmap.md)

## Goal

Ensure people can understand and control credentials, provider grants, imported
secrets, local caches, relayed data, and consequential external actions without
mistaking one lifecycle for another.

## Dependencies and boundaries

- [TODO 28](./28-service-continuity-and-recovery.md) owns recovery and degraded
  service truth.
- [TODO 44](./44-local-first-agency-and-accountable-synchronization.md) owns
  local-state scope, reconnect, and purge semantics.
- [TODO 49](./49-personalization-agency-and-accountable-memory.md) owns
  inspection, correction, and forgetting of remembered data.
- [TODO 53](./53-conversation-agency-and-private-communication.md) owns mail
  content visibility, retention, and communication lifecycle.
- [TODO 54](./54-measurement-agency-and-privacy-respecting-telemetry.md) owns
  telemetry boundaries; credentials and message content are never ordinary
  analytics.
- [TODO 56](./56-unified-thing-history-and-timeline-browser.md) owns durable
  history; this item does not create a second audit log.
- `FUNDAMENTALS.md` and `DECISIONS.md` remain authoritative. No permission
  expansion, production migration, background polling, or provider-side action
  is approved here.

## Phase 0 — inventory current boundaries

- [ ] Enumerate provider grants, local/native credentials, relay requests,
  encrypted account records, drafts/messages, imported password archives,
  attachments, caches, logs, and support traces by data class.
- [ ] For each path record principal, origin, scope, storage, encryption,
  expiry, reader/writer, retention, export, revocation, deletion, and cleanup
  evidence; mark unverified behavior explicitly.
- [ ] Recheck current code and exact shipped platforms for PRs
  [#1009](https://github.com/lopugit/thingtime/pull/1009),
  [#1013](https://github.com/lopugit/thingtime/pull/1013),
  [#1014](https://github.com/lopugit/thingtime/pull/1014), and
  [#1015](https://github.com/lopugit/thingtime/pull/1015); merged PR narratives
  are leads, not present-day implementation proof.
- [ ] Name product, storage/API, platform, privacy/security, accessibility,
  reliability, and support owners plus an independent stop authority.

## Phase 1 — define consent and lifecycle outcomes

- [ ] Specify per-provider scope disclosure and exact-origin consent; distinguish
  connect, link, sync, read, draft, send, archive, trash, delete, and relay.
- [ ] Define separate receipts for local purge, Thingtime deletion, provider
  revoke, unlink-one-member, last-link retirement, export, partial failure, and
  unknown external outcome.
- [ ] Define retry/idempotency and stale-sync fences for token rotation, revoked
  grants, concurrent actions, account changes, and reauthentication.
- [ ] Decide what unknown imported fields/files can be previewed, exported,
  preserved, or deleted without pretending they are interpreted safely.

## Phase 2 — rehearse and gate a smallest useful slice

- [ ] Build a synthetic fixture matrix for multiple linked accounts, revoked or
  expired grants, duplicate/uncertain actions, interrupted imports, offline
  caches, partial deletion, and retries.
- [ ] Verify no cross-account projection, message/credential logging, false
  success receipt, stale overwrite, or duplicate consequential action.
- [ ] Select one evidence-backed gap for implementation only after owner and
  qualified review; specify rollback, support remedy, accessibility, and exact
  platform validation before changing behavior.
- [ ] Stop and escalate any unresolved ownership, retention, revocation, or
  cleanup ambiguity rather than broadening access to make the flow work.

## Acceptance criteria

- A person can tell what resides on-device, in Thingtime, at a provider, or only
  in transit, and can distinguish unlink, revoke, and delete.
- Current authority is rechecked before sync or external effects; retries do
  not duplicate actions and uncertain outcomes remain explicitly uncertain.
- Synthetic tests demonstrate account isolation, least-scope consent, cleanup,
  secret-free diagnostics, and accessible failure/remedy states.
- No personal inbox, real vault archive, live provider credential, or message
  content is used in fixtures, docs, logs, or automation.
