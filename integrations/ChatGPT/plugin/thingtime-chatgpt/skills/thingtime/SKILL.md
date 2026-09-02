---
name: thingtime
description: Use connected Thingtime accounts safely through the Thingtime MCP tools.
---

# Thingtime

Use the Thingtime MCP tools only for accounts the user has connected. Start a
new task by listing accounts when the requested account is ambiguous, then
select the requested account explicitly.

Treat `@Thingtime login` as an explicit request to start the installed
Thingtime MCP server's native OAuth flow. Run `codex mcp login thingtime`
instead of calling `login_thingtime`: before a connection exists, MCP tool
calls are intentionally protected and cannot bootstrap authentication. The
Codex command opens the host browser and completes its registered callback;
never ask the user to paste a token into chat. After it succeeds, call
`list_thingtime_accounts` to report the safe account metadata.
Treat `@Thingtime list accounts` as an explicit request to call
`list_thingtime_accounts` and return only its safe account metadata.

Never ask the user to paste a Thingtime personal access token into chat. A
connected client’s revocable bridge credentials do not expire by default; tell
the user to reconnect only if a connection is revoked or an account is missing.
Never expose token values, authorization codes, bridge credentials, or refresh
credentials in a response.

Read/search actions may proceed when the user asks. Before any create, update,
delete, comment, reaction, save, or share action, show the intended account,
target, and effect and obtain clear confirmation. Treat delete and disconnect
as irreversible from the current ChatGPT connection.

For more than one exact ID, use `get_thingtime_things`; preserve its ordered
per-ID found/not-found results. Discover and validate schemas before creating
typed data. Use `list_thingtime_related` for target, parent, folder, backlink,
or bounded thread traversal, and `list_thingtime_changes` for resumable polling
(it is not a deletion change stream).

For a composed mutation or Capability workflow, always call the preview/start
tool first. Explain the selected account and complete before/after plan, then
stop for clear confirmation. Apply only the returned signed receipt. If a
precondition is stale, build a new preview; never bypass it. Set `confirmed:
true` only after that confirmation. Undo also creates
a fresh preview and requires a second confirmation. Capability Things may only
compose the published bounded mutation grammar — never invent URLs, API paths,
database queries, operator objects, or executable code.

When the user or task supplies an exact Thing ID, always call
`get_thingtime_thing`. Never rely on `list_thingtime_things`, a recent page, or
`search_thingtime_things` to locate a known ID. Use list/search only for
discovery when the exact ID is unknown. When a Thing or comment ID is already
known and its attached comments are needed, call `list_thingtime_comments` with
that `targetId`; do not fetch a global Things page and discard unrelated rows.

If a tool says the token lacks a scope, explain the minimum missing Thingtime
scope and ask the user to create a narrower replacement token in Thingtime
Settings → Token minter, then reconnect. Removing the final account revokes
every bridge and refresh credential in that ChatGPT connection. Do not suggest
an unrestricted account-session credential.
