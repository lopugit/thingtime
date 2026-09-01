# Thingtime for ChatGPT

This package connects ChatGPT/Codex to the Thingtime MCP endpoint at
`https://thingtime.com/api/v1/integrations/chatgpt/mcp`.

It supports multiple named Thingtime accounts and approved API endpoints in a
single ChatGPT connection. During connection, each account supplies a scoped
Thingtime personal access token. The token is validated, AES-256-GCM encrypted
at the Thingtime server, and never returned to ChatGPT, Codex, or a chat.
When the client requests `offline_access`, rotating refresh credentials retain
the non-expiring, MCP-only bridge credential without copying the PAT into
ChatGPT.
Selecting or disconnecting an account updates the one encrypted server-side
connection record used by every live credential.

## What the tools can do

- List, select, and disconnect connected Thingtime accounts.
- Read one or up to 100 exact Thing IDs without pagination ambiguity.
- Browse/search, inspect targeted comments, schemas, relationships, threads,
  and ACL-aware changed Things.
- Validate typed Thing payloads before creation.
- Preview signed multi-Thing before/after plans, then apply them with exact
  scope and optimistic-concurrency checks only when the confirmed call carries
  `confirmed: true`.
- Inspect encrypted MCP mutation history and generate a fresh undo preview.
- Discover and run bounded `Thingtime Capability` workflows made only from
  registered create/update/delete primitives.
- Use MCP prompts, account-scoped resources, and an embedded result/diff/raw UI
  with an explicit apply gate.

The server has no arbitrary-URL or generic API proxy tool. Capability Things
also reject raw routes, queries, code, and executable-looking operator keys.
When a task supplies an exact Thing ID, use `get_thingtime_thing` rather than a
paginated list or fuzzy search. When it supplies the parent ID for comments,
use `list_thingtime_comments`; it targets that parent directly instead of
fetching unrelated global comments.

## Install in ChatGPT

1. Deploy the Thingtime branch to a public HTTPS origin and configure the
   required server environment variables in the main README.
2. Use ChatGPT **on the web** with a Business or Enterprise/Edu workspace.
   An admin/owner enables Developer Mode from Workspace Settings → Apps →
   Create. Business workspaces allow only admins/owners to do this; an
   Enterprise/Edu admin can grant individual builder access with RBAC.
3. Create an MCP app, enter the public MCP URL
   `https://<your-thingtime-origin>/api/v1/integrations/chatgpt/mcp`, select
   OAuth, and click **Scan Tools**. Complete the Thingtime OAuth form when it
   opens; request/approve `offline_access` so ChatGPT can renew the connection.
4. Click **Create**. The connector appears as a development draft under Apps;
   start a new chat, select it from the tools menu or @mention it, and test
   reads and confirmed writes.
5. Have an admin/owner publish the reviewed draft from Workspace Settings →
   Apps. Enterprise/Edu can then limit users and individual actions with RBAC.

OpenAI currently makes custom MCP apps web-only: they cannot be invoked in
iOS ChatGPT chats. Full write/modify MCP access is currently available only in
the Business and Enterprise/Edu beta; Pro users are limited to read/fetch MCP
use. After publishing, ChatGPT freezes the scanned tool definitions. An
Enterprise/Edu admin must review and enable a tool refresh before a later
server change is available; a Business workspace currently must recreate and
republish the app to change tools or metadata.

Use the ChatGPT connection manager to reconnect; do not paste any Thingtime
token into a chat message. See [SUBMISSION.md](./SUBMISSION.md) before public
Plugins Directory submission: OpenAI requires a fixed production origin,
verified publisher identity, public legal links, reviewer credentials, and
review approval.

## Test locally in Codex Desktop

The included `.mcp.json` configures the stable Thingtime HTTPS MCP endpoint.
Install this package as a custom Codex plugin, restart Codex Desktop, then open
**Settings → MCP servers → Thingtime** and choose **Authenticate**. Codex uses
a ChatGPT Client ID Metadata Document and a `127.0.0.1` loopback callback; the
Thingtime authorization server verifies that the callback ID and path match
before accepting the sign-in. The first-party form validates and encrypts each
Thingtime PAT server-side, so never enter a token into a Codex prompt or chat.
For Codex versions that do not support CIMD, the server instead performs OAuth
Dynamic Client Registration with the same strict `127.0.0.1` loopback-only
redirect policy.

Codex Desktop, the Codex CLI, and the IDE extension on the same host share
their MCP configuration. This local installation is a desktop/CLI validation
path only; it does not make a custom MCP app callable in ChatGPT for iOS.

## Operational configuration

The default allowed API origin is `https://thingtime.com`. Set
`THINGTIME_CHATGPT_ALLOWED_ENDPOINTS` to an explicit comma-separated origin
allowlist for other deployments. Never use wildcards. Configure
`THINGTIME_CHATGPT_OAUTH_CLIENT_IDS` only if ChatGPT issues a different client
identifier for the registered MCP server; the default already permits
ChatGPT's stable Client ID Metadata Document and the legacy ChatGPT client
identifier. Codex callback-specific CIMD client IDs are accepted only with
their matching `http://127.0.0.1:<ephemeral-port>/callback/<callback-id>`
redirect URI; they do not require an environment allowlist entry.

The unauthenticated MCP `tools/list` response publishes only the tool catalog
and the required OAuth scope. Invoking any Thingtime tool without a bridge
token returns the protected-resource challenge that opens ChatGPT’s secure
connection flow; it never returns account data or tokens.

The OAuth server always requires `thingtime`. It additionally supports the
optional `offline_access` scope and a rotating `refresh_token` grant. Bridge
access, connection, and refresh credentials are non-expiring by default but
remain revocable server-side; each refresh credential is single-use and is
rotated on renewal. Removing the final connected account revokes the encrypted
connection record and every access or refresh credential that references it.

In ChatGPT or Codex, use `@Thingtime login` to start the host’s secure OAuth
browser flow. The callback is bound to the client’s registered redirect and the
connection page can add multiple named accounts. Use `@Thingtime list accounts`
to list the authenticated accounts without exposing any token value.

See the root README and `/api/v1/integrations/chatgpt/mcp-docs` for the full
security and API contract.
