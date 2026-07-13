# Thingtime MCP

A consent-first local MCP bridge for bringing conversations from AI desktop
apps into a normalized Thingtime staging format.

## What works in this first slice

- Any MCP-capable host can explicitly hand its current conversation to
  `thingtime_ingest_current_chat`.
- ChatGPT and Claude JSON exports can be normalized from a user-approved path.
- Any other app can emit the portable `thingtime.ai-desktop-export` manifest;
  see [`examples/ai-desktop-export.example.json`](examples/ai-desktop-export.example.json).
- Chats, messages, settings, attachment metadata, source provenance, and
  allowlisted local attachment files are staged privately outside the
  repository. Remote attachment URLs are retained but never downloaded
  implicitly.
- Relational `ai-chat` + `ai-chat-message` Thingtime ingestion records can be
  previewed without writing to ThingtimeDB.

MCP does **not** give a server universal access to every connected app's chat
history, private application storage, cookies, or settings. Apps must hand the
data to this server or provide an export/connector. This server never scans
application data directories automatically.

## Install and build

```bash
cd MCP
npm install
npm test
npm run build
```

Configure absolute import roots and a private state directory:

```bash
export THINGTIME_MCP_ALLOWED_ROOTS="$HOME/Downloads/ai-exports"
export THINGTIME_MCP_STATE_DIR="$HOME/.thingtime/mcp"
```

The state directory is created with private directory/file modes. Keep it out
of synced or shared folders if the chat data is sensitive.

## Desktop app configuration

Build first, then add this stdio server to the desktop app's MCP configuration:

```json
{
  "mcpServers": {
    "thingtime": {
      "command": "node",
      "args": ["/absolute/path/to/thingtime/MCP/dist/index.js"],
      "env": {
        "THINGTIME_MCP_ALLOWED_ROOTS": "/Users/you/Downloads/ai-exports",
        "THINGTIME_MCP_STATE_DIR": "/Users/you/.thingtime/mcp"
      }
    }
  }
}
```

Config file locations differ by host and can change; use the host's current MCP
documentation. The server uses stdio, so the host launches one private local
process and communicates over JSON-RPC.

## Safe workflow

1. Call `thingtime_capabilities` to review boundaries and configured roots.
2. Ask the user to approve one export file or the current host chat.
3. Import with `thingtime_import_archive` or `thingtime_ingest_current_chat`.
4. Call `thingtime_list_imports`; it returns counts, not message bodies.
5. Read one conversation only when needed.
6. Preview future ThingtimeDB records with `thingtime_prepare_ingestion`.
7. Delete local staging with `thingtime_delete_import` when the user asks.

## Connector contract

Connectors normalize source data into schema version 1 in `src/model.ts`.
Adapters should preserve stable source IDs, timestamps, ordered messages,
attachment references, settings, participants, and provenance. Unknown raw
metadata is opt-in and recursively redacted for credential-shaped keys.

The portable manifest is the interoperability path for apps without a built-in
adapter. An app-side exporter should obtain the user's consent, serialize only
the selected scope, and write the manifest into an allowed root.

## ThingtimeDB boundary

Database upload is deliberately disabled in this slice. The existing Thingtime
API rejects unknown crystal schemas, so enabling upload safely requires:

1. registered `ai-chat`, `ai-chat-message`, and attachment/file schemas;
2. authenticated import endpoints with idempotency, paging, storage quotas,
   ownership, ACLs, and deletion semantics;
3. platform views that show imported chats without leaking private content;
4. an explicit user confirmation before each first sync source.

The prepared records already follow Thingtime's relational child-data rule:
messages are separate bounded records linked to their chat parent, not an
unbounded array stored on one Thing.
