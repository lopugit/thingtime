# Thingtime for ChatGPT

This package connects ChatGPT/Codex to the Thingtime MCP endpoint at
`https://thingtime.com/api/v1/integrations/chatgpt/mcp`.

It supports multiple named Thingtime accounts and approved API endpoints in a
single ChatGPT connection. During connection, each account supplies a scoped
Thingtime personal access token. The token is validated, AES-256-GCM encrypted
at the Thingtime server, and never returned to ChatGPT, Codex, or a chat.

## What the tools can do

- List, select, and disconnect connected Thingtime accounts.
- Read token identity/scopes, list Things, and search Things.
- Create, update, delete, comment, react, save, and share Things only when the
  relevant personal access token permits it.

The server has no arbitrary-URL or generic API proxy tool. It only reaches
explicitly allowed Thingtime origins and the focused Things operation list.

## Install in ChatGPT

1. Deploy the Thingtime branch to a public HTTPS origin and configure the
   required server environment variables in the main README.
2. In ChatGPT on the web or desktop app, turn on **Developer mode** under
   Settings → Security & login.
3. Open **Plugins**, choose **Add plugin**, and enter the public MCP URL:
   `https://<your-thingtime-origin>/api/v1/integrations/chatgpt/mcp`.
4. ChatGPT opens the Thingtime connection page. Add each account/API endpoint
   and a least-privilege personal access token, then continue.
5. Copy the generated ChatGPT app registration identifier into `.app.json`
   when packaging this plugin for a personal marketplace or team distribution.

Use the ChatGPT connection manager to reconnect; do not paste any Thingtime
token into a chat message. The connection page works in a mobile browser, but
availability of developer plugins on the iOS ChatGPT app is controlled by the
ChatGPT account/surface and must be confirmed there after installation.

## Operational configuration

The default allowed API origin is `https://thingtime.com`. Set
`THINGTIME_CHATGPT_ALLOWED_ENDPOINTS` to an explicit comma-separated origin
allowlist for other deployments. Never use wildcards. Configure
`THINGTIME_CHATGPT_OAUTH_CLIENT_IDS` only if ChatGPT issues a different client
identifier for the registered MCP server.

See the root README and `/api/v1/integrations/chatgpt/mcp-docs` for the full
security and API contract.
