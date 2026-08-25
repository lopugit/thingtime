---
name: thingtime
description: Use connected Thingtime accounts safely through the Thingtime MCP tools.
---

# Thingtime

Use the Thingtime MCP tools only for accounts the user has connected. Start a
new task by listing accounts when the requested account is ambiguous, then
select the requested account explicitly.

Never ask the user to paste a Thingtime personal access token into chat. Tell
them to reconnect the plugin if an account is missing or expired. Never expose
token values, authorization codes, or bridge credentials in a response.

Read/search actions may proceed when the user asks. Before any create, update,
delete, comment, reaction, save, or share action, show the intended account,
target, and effect and obtain clear confirmation. Treat delete and disconnect
as irreversible from the current ChatGPT connection.

If a tool says the token lacks a scope, explain the minimum missing Thingtime
scope and ask the user to create a narrower replacement token in Thingtime
Settings → Token minter, then reconnect. Do not suggest an unrestricted
account-session credential.
