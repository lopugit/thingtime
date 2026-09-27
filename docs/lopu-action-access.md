# Lopu chat access and Actions

Each Lopu chat has an **Ask before running** or **Full access** setting, visible
in the composer and Chat settings. New and legacy chats default to Ask; Full
access is saved only on the selected chat and never inherited by a new chat.

Ask pauses before every saved Action (including read-only Actions) and every
mutating Lopu tool. The existing Confirm card carries a signed, expiring grant
bound to the account, chat and exact tool input. Full access runs those tools
without cards. Read-only tools remain available in Ask mode. Changing to Ask
stops subsequent unapproved calls and the next step of an Action authorized by
Full access. A previously confirmed Action retains its explicit one-run grant.
Scheduled recording handoffs remain read-only in either mode.

## Execution and authorization

`run_action` now supports owned server Actions and browser Actions, including
nested browser Actions. Browser execution uses the same bounded interpreter
as a page button, with an authenticated server host, so a chat can run a saved
workspace importer without making the user build or press a page button.
Browser Actions here are Thingtime request programs, not arbitrary DOM access
or JavaScript evaluation. Existing operation, input, output, time, capability,
owner and recursion limits still apply. Mixed server/browser child composition
is unchanged: a browser flow invokes browser children.

The host dispatches the canonical data handlers for Things, Components,
Schemas, Webpages, Builder workspaces and Library requests. Nitro and the host
share `server/utils/actionDataRoutes.ts`. The host checks the endpoint's declared
capability/version and revalidates the original first-party user session and
chat authorization before requests and child preparation. Server Actions also
revalidate before each program step. A revoked session or changed account stops
execution. All route validation, ACL, storage transactions and quotas remain
in force; Full access does not grant access to another account's private data.

The synthetic Request receives its principal through a server-only WeakMap keyed
by that exact Request. Headers, serialized tool inputs and cloned Requests cannot
carry this authority; it is removed in `finally`. No session credential reaches
the model, program or output. Identity, credential, admin, reveal and chat-control
APIs are excluded, so an Action cannot grant itself Full access. Normal scoped
app credentials cannot change chat access. Durable workflows revalidate their
existing private session reference; they do not mint an additional credential.

Access mode writes use the protected chat utility, require the chat owner and a
first-party user session, and update only their explicit permission field.
Existing-chat replies cannot write access mode. The client serializes access
writes, waits for the latest save before sending, tracks the last confirmed
value for rollback, and fences old-account completions. Failed saves prevent
sending until the selection is successfully saved again.

## Contracts and verification

- `api.lopu-chats` **1.6.0**: access mode on create/list.
- `api.lopu-chats-update` **1.5.0**: owner access-mode changes.
- `api.lopu-chats-reply` **1.15.0**: browser/server Action host and per-call policy.
- `test:lopu`, `test:lopu-ui`, `test:messenger`, `test:actions`,
  `test:api-capabilities` and `test:auth-introspection` cover the affected paths.
- `scripts/lopu-actions.browser.html` renders the production composer as an
  isolated visual fixture; its selections make no account writes.
- `scripts/verify-lopu-actions.mts` exercises real registration, chat storage,
  signed approval, nested browser execution, workspace upsert/readback, Things
  reads, server execution, live mode changes, stale reply refusal and logout.
  It uses synthetic fixtures, without model calls. See the disposable setup in
  [README](../README.md#lopu-action-access-qa).

After a lost or failed write receipt, inspect the destination before retrying.
The integration example reuses a stable equipment ID, so repeating it updates
one record. Full access does not make arbitrary authored writes idempotent.
