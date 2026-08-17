# Thingtime MCP

A consent-first local MCP bridge for bringing conversations from AI desktop
apps into a normalized Thingtime staging format.

## What works

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
- The Electron build bundles a separate desktop connector from this package.
  With an authenticated Thingtime window it discovers local ChatGPT Work/Codex
  history, the main Claude desktop profile, and the Claude Thingtime profile;
  official ChatGPT/Claude JSON or ZIP exports can be selected for cloud history.
- The bundled connector sends bounded batches through
  `/api/v1/ai/connections`. Projects become Messenger Spaces, conversations
  become chats/channels, and messages become relational read-only Messenger
  rows. Stable owner-scoped source keys make retries and full resyncs
  idempotent.

MCP does **not** give a server universal access to every connected app's chat
history, private application storage, cookies, or settings. Apps must hand the
data to the standalone server or provide an export/connector. The standalone
MCP server never scans application data directories automatically. The bundled
Electron connector performs only an explicit, user-triggered read of its
allowlisted local conversation stores; it filters hidden reasoning, tool
traffic, and internal context, and never sends raw local paths or credentials.

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

This configuration is for the standalone MCP workflow. Thingtime's own
Electron app needs no MCP config: build/package the desktop app, sign in, open
Messenger, select **✦ AI**, and choose **Sync local chats** or **Import full
export…** for each source. The web browser deliberately cannot inspect desktop
application storage.

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

The standalone MCP staging tools still do not upload directly to ThingtimeDB.
The enabled persistence path is the authenticated Electron-to-Messenger bridge:
the renderer receives only normalized batches over a narrow preload API and
posts them to `/api/v1/ai/connections` using the current Thingtime session.
Local sync sessions are in-memory, expiring, cancellation-aware, and expose no
raw chosen path to the page.

The server registers `ai-connection` alongside native Messenger schemas and
stores every imported message as its own bounded `chat-message` Thing. Source
ids are hashed with the owner before becoming unique keys. The server enforces
batch limits, owner ACLs, membership-only reads, read-only provider rows, and
the same exact transactional account-storage ledger used by posts and native
Messenger content. Attachment object bytes, when present through Thingtime's
upload system, are separately charged on protected attachment Things. Replaying
an identical batch changes neither row count nor storage usage.
