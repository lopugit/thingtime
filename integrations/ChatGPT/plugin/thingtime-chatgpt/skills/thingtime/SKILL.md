---
name: thingtime
description: Use connected Thingtime accounts safely through the Thingtime MCP tools.
---

# Thingtime

Use the Thingtime MCP tools only for accounts the user has connected. Start a
new task by listing accounts when the requested account is ambiguous, then
select the requested account explicitly.

Never ask the user to paste a Thingtime personal access token into chat. A
connected client can renew its 30-day bridge credential with a rotating
refresh credential; tell the user to reconnect only if that renewal fails or
an account is missing. Never expose token values, authorization codes, bridge
credentials, or refresh credentials in a response.

Read/search actions may proceed when the user asks. Before any create, update,
delete, comment, reaction, save, or share action, show the intended account,
target, and effect and obtain clear confirmation. Treat delete and disconnect
as irreversible from the current ChatGPT connection.

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
