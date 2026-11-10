# PR #412 — Secure ChatGPT Thingtime plugin

## Scope

Adds a distributable plugin at `integrations/ChatGPT/plugin/thingtime-chatgpt`
and the corresponding Thingtime MCP connector. The connector supports multiple
named accounts and explicitly configured Thingtime API origins inside one
ChatGPT connection.

## Security model

- The browser-only OAuth 2.1 flow requires a fixed ChatGPT callback, an exact
  MCP `resource`, signed state, and S256 PKCE.
- A connected PAT is validated through `/api/v1/tokens/self`, encrypted using
  AES-256-GCM before persistence, and never returned to ChatGPT or put in a
  transcript.
- ChatGPT receives a short-lived, revocable bridge token that is accepted only
  by the MCP gateway. It cannot authenticate a normal Thingtime API request.
- The MCP gateway has a fixed Things tool allowlist, bounded/timeout upstream
  requests, an origin allowlist, no redirects, and confirmation guidance for
  every state-changing tool.

## Contract and deployment

The gateway publishes OAuth protected-resource/auth-server discovery plus an
origin-scoped, semantic capability manifest. The canonical route/feature list
drives runtime registration and API docs together.

Before public use, configure a 32-byte base64
`THINGTIME_CHATGPT_CREDENTIAL_KEY` deployment secret and deploy a public HTTPS
origin. Then add the `/api/v1/integrations/chatgpt/mcp` URL in ChatGPT Developer
mode. Confirm iOS ChatGPT developer-plugin availability on the intended account
after the connector is installed.

## Verification

- Five focused OAuth/MCP/manifest security and contract tests passed.
- Targeted ESLint passed (aside from the existing Remix future-change notice).
- `remix/npm run build` passed, including Vercel-output verification.
- Local discovery, authorization page, and unauthorized-MCP challenge smoke
  tests passed; the account form was checked at desktop and 390px mobile
  widths.
