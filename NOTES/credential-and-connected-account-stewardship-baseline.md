# Credential and connected-account stewardship baseline

**Grounded:** 2026-10-20, Australia/Melbourne

**Confidence:** implementation facts below are grounded in merged PR records
and repository code; lifecycle gaps remain questions until checked against the
current shipped paths and owner decisions.

## Why this note exists

Thingtime now has several distinct ways to handle credential-bearing data:
incoming mail accounts can be cloud-backed or local-only; Gmail uses explicit
Google consent and stores refresh authorization in the owner vault; desktop
mail can use native access or an authenticated API relay; and 1Password imports
preserve original archive members and attachments in an encrypted vault. These
are related stewardship concerns, but they are not one interchangeable
credential system. The goal here is to make their boundaries legible and find
cross-cutting lifecycle questions without implying that a shared product
surface or migration has been approved.

## Evidence snapshot

| Evidence | What is established | Limit |
| --- | --- | --- |
| [PR #1009](https://github.com/lopugit/thingtime/pull/1009) | Incoming IMAP/POP accounts, explicit sync, independent cloud/local controls, encrypted owner storage, encrypted browser cache, and named proxy inboxes. | Its PR record says real-provider acceptance and some browser permission/offline cold-launch behavior were not verified. |
| [PR #1013](https://github.com/lopugit/thingtime/pull/1013) | Electron native mail and an authenticated API relay are distinct modes; relay does not save a cloud mail account. | Full signed-in iOS mailbox sync was not verified in that delivery. |
| [PR #1014](https://github.com/lopugit/thingtime/pull/1014) | Gmail OAuth, message actions, device-default message storage, explicit review before send, durable action receipts, and protections against stale sync overwriting completed actions. | No real Google authorization or send was exercised; OAuth verification/configuration remains an external prerequisite. |
| [PR #1015](https://github.com/lopugit/thingtime/pull/1015) | 1PUX import preserves known and unknown structures and original ZIP members in the encrypted vault; attachment handling uses a private multipart lifecycle. | Mongo document/deployment transport limits and browser memory still bound large final downloads; unknown data may lack a specialised editor. |
| [PR #1018](https://github.com/lopugit/thingtime/pull/1018) | Admin UI and API support importing the configured OpenAI key into the platform credential vault; its record reports 98 focused vault/API-capability tests plus production-build/output verification and targeted lint passing. | The PR record explicitly leaves production import, browser acceptance of the new control, and the live vault write unverified. The advertised credential capability and passing tests do not establish end-to-end acceptance. |
| [`userVault.ts`](../remix/app/api/utils/lopu/userVault.ts) | Owner-scoped vault records encrypt secret/provider values and expose read helpers that avoid loading encrypted fields. | This single module does not establish complete provider revocation, retention, export, or incident behavior across every credential path. |
| [`connections.ts`](../remix/app/api/utils/connections/connections.ts) | Linked account records and per-user links are separate; unlinking a member can retain shared account material for other live links, and last-link retirement has targeted tests. | Recheck concurrent unlink, revoke, account deletion, sync, and retry behavior when these paths change. |

## Cross-cutting questions, not assumed defects

- Can a person see, per connected account, what is stored locally, in Thingtime,
  or only transiently relayed—and which data classes each choice covers?
- For admin credential import, has the intended UI control been exercised
  against the exact deployed API in an isolated environment using a synthetic
  key, with authorization, encrypted storage, redacted readback, and failure
  recovery independently verified?
- Do disconnect, provider-side revocation, logout, account closure, device loss,
  and credential rotation have distinct, truthful outcomes and complete cleanup
  receipts across mail, OAuth, and imported vault data?
- Are stale background or foreground syncs and uncertain external actions always
  fenced by current authorization, stable idempotency, and an authoritative
  reread where the provider supports one?
- Can a person export or delete imported source material without accidentally
  deleting a live shared connection, or retain unknown imported bytes without
  implying that Thingtime can interpret them?
- Which metadata, previews, logs, support traces, and diagnostics are necessary
  for recovery, and which could reveal provider relationships or message
  contents beyond the user's expectation?

## Safety boundary

Never include real credentials, account identifiers, message contents, vault
archives, OAuth tokens, or raw provider responses in docs, logs, or fixtures.
Rehearsals should use synthetic accounts and test credentials, exact-origin
consent, disposable providers, and explicit cleanup. Do not broaden scopes,
enable background polling, send mail, delete provider content, migrate stored
secrets, or claim end-to-end encryption without separate evidence and owner
approval.

## Refresh triggers

Recheck this snapshot when mail sync, OAuth, user-vault encryption, password
import/export, attachment handling, local cache scope, disconnect/revoke,
account closure, or support diagnostics change. The merged PR records are
delivery evidence, not a substitute for current route-level review.

Related: [TODO 57](../TODO/claude-todo/57-credential-and-connected-account-stewardship.md),
[roadmap](../PLAN/credential-and-connected-account-stewardship-roadmap.md),
[TODO 44 local-first synchronization](../TODO/claude-todo/44-local-first-agency-and-accountable-synchronization.md),
[TODO 49 accountable memory](../TODO/claude-todo/49-personalization-agency-and-accountable-memory.md),
and [TODO 53 private communication](../TODO/claude-todo/53-conversation-agency-and-private-communication.md).
