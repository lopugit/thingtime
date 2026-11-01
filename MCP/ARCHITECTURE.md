# Thingtime MCP architecture

## Trust boundary

The MCP process is local and communicates with its host over stdio. A connected
desktop host can invoke tools, but the MCP server receives no ambient right to
read that host's open chats, profile, settings, cookies, or application storage.
Every capture begins with either:

1. a host explicitly passing a normalized current conversation; or
2. a user approving one export file inside `THINGTIME_MCP_ALLOWED_ROOTS`.

Imports are staged under `THINGTIME_MCP_STATE_DIR` with private filesystem
modes. Credential-shaped metadata keys are redacted. Local attachment bytes are
copied only when their resolved path remains in an allowed root. Remote URLs are
references and are never fetched implicitly.

## Data flow

```text
MCP desktop host handoff ─┐
ChatGPT JSON export ──────┤
Claude JSON export ───────┼─> connector normalization ─> private snapshot
portable app manifest ────┘                                  │
                                                             └─> paged relational
                                                                 ingestion preview
```

The normalized snapshot is source-oriented and loss-aware: it retains stable
IDs, source app/connector, timestamps, participants, ordered messages, message
parts, settings, attachments, provenance, and optionally redacted raw metadata.

## Thingtime model

The future platform model has bounded parent and child records:

- `ai-chat`: title, source, participants, settings, provenance, ACL, timestamps.
- `ai-chat-message`: one message linked to its chat parent.
- attachment/file records: one file linked to its message or chat, backed by
  Thingtime storage rather than embedded bytes.

This follows `FUNDAMENTALS.md` section 3: accumulating messages and attachments
must not become an unbounded array inside one MongoDB document. The current MCP
prepares this shape but does not upload it because the platform has not yet
registered these schemas or an authenticated idempotent import endpoint.

## Connector contract

Each connector implements three operations:

- `detect(input)`: score whether the adapter recognizes an export.
- `normalize(input, context)`: produce schema-version-1 snapshot data.
- descriptive metadata (`id`, `app`, `description`) for MCP discovery.

Apps without an in-tree adapter can generate
`thingtime.ai-desktop-export` version 1. This keeps application-specific access
and consent inside the source app while making Thingtime ingestion portable.

## Next platform slices

1. Register `ai-chat`, `ai-chat-message`, and attachment schemas.
2. Add an authenticated, idempotent and quota-aware bulk import API.
3. Add encrypted/object-backed attachment upload and deletion semantics.
4. Add private chat list/detail/search UI with source filters and streaming
   pagination.
5. Add reply/send adapters only for apps that expose a documented authorized
   API; keep read/import and write/send permissions separate.
6. Add source-specific incremental checkpoints and conflict handling.
