# PR #68 — Add consent-first Thingtime MCP desktop chat bridge

- Branch: `codex/thingtime-mcp-desktop-connectors`
- Pull request: <https://github.com/lopugit/thingtime/pull/68>
- Date: 2026-07-13

## Goal

Begin Thingtime's AI-chat interoperability layer with a standalone MCP package
that can accept explicit data from MCP-capable desktop hosts and normalize
user-approved exports from other AI applications, while preparing a safe
relational shape for later ThingtimeDB storage and platform chat views.

## Delivered

- A TypeScript MCP stdio server at `MCP/`, built on the stable v1 MCP SDK.
- Eight tools covering capability discovery, connector listing, archive import,
  current-host-chat handoff, staged-import listing, bounded conversation reads,
  paged Thingtime ingestion previews, and confirmed local deletion.
- Built-in ChatGPT and Claude JSON adapters.
- A versioned `thingtime.ai-desktop-export` manifest for any other application
  to implement without coupling its private storage format to Thingtime.
- A normalized version-1 model for chats, ordered message parts, participants,
  settings, metadata, attachments, files, source identity, and provenance.
- Private staging under `THINGTIME_MCP_STATE_DIR`, with allowlisted filesystem
  reads, symlink-safe canonical path checks, copied attachment bytes, SHA-256
  fingerprints, credential-key redaction, size/count limits, and no implicit
  remote downloads.
- Relational ingestion previews: one `ai-chat` parent record and one
  `ai-chat-message` child record per message.
- Setup, architecture, connector contract, safe workflow, example manifest,
  `.env` placeholders, and root README/changelog pointers.

## Security and product boundaries

MCP gives a host a standard way to invoke this server; it does not give the
server universal access to all open desktop chats, application cookies, local
storage, passwords, or settings. The implementation therefore uses two honest
capture paths: explicit current-chat handoff from the host, or an approved file
inside a configured root. Imports and deletes require a literal
`confirmedByUser: true` argument.

ThingtimeDB upload is not enabled in this PR. The existing API rejects unknown
crystal schemas, and repository fundamentals forbid scripts or clients from
writing MongoDB directly. The next platform slice must register chat/message/
attachment schemas and expose an authenticated, idempotent, quota-aware import
API before this MCP can sync staged records.

## Validation

- `npm run typecheck`
- `npm test` — 9/9 passing
- `npm run build`
- `npm audit --omit=dev` — 0 vulnerabilities
- MCP client/server initialization and tool discovery over linked transports
- allowlisted-path and real attachment-copy test
- ChatGPT, Claude, portable-manifest, redaction, and relational-record tests
- `npm pack --dry-run` with the expected `dist/index.js` executable entry
- Graphify semantic/code refresh plus clustering, report, and HTML regeneration
- Graphify post-commit/post-checkout hooks and `graphify` merge driver verified

## Follow-up slices

1. Register platform schemas for chats, messages, and attachments.
2. Add the authenticated bulk import API with idempotency and source checkpoints.
3. Add object-backed file upload, quotas, retention, and deletion propagation.
4. Add private chat list/detail/search UI in Thingtime.
5. Add explicit per-source send/reply permissions only where an app exposes a
   documented authorized API.
