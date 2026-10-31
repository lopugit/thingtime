# Thingtime MCP

Thingtime MCP is a consent-first local stdio server for explicitly supplied AI
conversation exports, host conversations and portable Thingtime drafts. The
normal entry point is `MCP/dist/index.js`; it retains the existing import and
staging tools and adds `thingtime_render_and_export` when its isolated renderer
is configured. The server does not discover host chat history, cookies,
credentials or private application storage by itself.

The standalone tools accept an explicitly supplied current chat or
user-approved ChatGPT/Claude export, normalize it into private local staging,
and preview relational `ai-chat` / `ai-chat-message` records without uploading
them. Other apps can use the portable
[`thingtime.ai-desktop-export` manifest](examples/ai-desktop-export.example.json).
Remote attachment URLs are retained but never fetched implicitly. The
separately bundled Electron connector performs a user-triggered read of its
allowlisted local conversation stores and can sync selected projects, chats
and visible messages through the authenticated Messenger API; it filters hidden
reasoning and internal tool traffic. It is not the standalone server's
automatic discovery path.

## Build

From the repository root:

```sh
npm run worktree-setup
npm --prefix remix run build:draft
npm --prefix MCP ci
npm --prefix MCP run build
```

The no-login renderer uses the existing `remix/dist/draft-preview` assets and
an exact, already-cached Docker image. Install/configure Docker and prepare the
compatible image through the documented isolated-render workflow; the MCP
process never pulls or builds an image. No credentials or provider keys are
needed for rendering.

## Configure a desktop host

Use the regular `thingtime` server name and the normal MCP entry point. Replace
the example paths and image digest with local absolute paths and the exact
verified image ID. `THINGTIME_MCP_RENDER_DOCKER` defaults to
`/opt/homebrew/bin/docker`; `THINGTIME_MCP_RENDER_ASSETS` is optional and, when
set, must be an absolute path to the built renderer assets.

```json
{
  "mcpServers": {
    "thingtime": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/thingtime/MCP/dist/index.js"],
      "env": {
        "THINGTIME_MCP_ALLOWED_ROOTS": "/Users/you/Downloads/ai-exports",
        "THINGTIME_MCP_STATE_DIR": "/Users/you/.thingtime/mcp",
        "THINGTIME_MCP_RENDER_IMAGE": "sha256:<64-lowercase-hex-image-id>",
        "THINGTIME_MCP_RENDER_SOCKET": "/absolute/path/to/docker.sock",
        "THINGTIME_MCP_RENDER_DOCKER": "/absolute/path/to/docker",
        "THINGTIME_MCP_RENDER_ASSETS": "/absolute/path/to/thingtime/remix/dist/draft-preview"
      }
    }
  }
}
```

The host's tool-call timeout must be at least 240 seconds. The renderer has a
30-second inner deadline; the per-render container lifetime is 120 seconds;
the adapter allows 150 seconds for work plus up to 76 seconds for verified
cleanup (226 seconds total). A host timeout below that can interrupt cleanup.

`THINGTIME_MCP_RENDER_IMAGE` must be an exact `sha256:` image ID with 64
lowercase hexadecimal digits, and `THINGTIME_MCP_RENDER_SOCKET` must be an
absolute Unix socket path. Docker and optional asset paths must also be
absolute. Missing or invalid render settings disable only rendering; the other
MCP tools remain available. Run `thingtime_capabilities` to see whether
rendering is configured. That is configuration status: Docker, the image and
assets are checked lazily when rendering runs.

The renderer receives only a sanitized `PATH`, temporary `HOME` and `TMPDIR`.
It does not receive the import roots, state directory or host credentials.
Rendering runs in a network-none, per-request container, returns artifacts
only after cleanup, and removes only resources it can verify as its own. The
normal MCP still has its existing local import `SnapshotStore`; it is not a
stateless or render-only server. For the renderer threat model and lifecycle,
see [no-login draft preview and export](../docs/no-login-draft-preview.md).

## Safe import workflow

1. Call `thingtime_capabilities` to review available tools and boundaries.
2. Obtain the user's explicit approval for an export file or current host chat.
3. Import with `thingtime_import_archive` or `thingtime_ingest_current_chat`.
4. Call `thingtime_list_imports`; it returns summaries without message bodies.
5. Read a conversation only when needed, then preview records with
   `thingtime_prepare_ingestion`.
6. Delete local staging with `thingtime_delete_import` when requested.

The state directory is private local staging, not a ThingtimeDB upload path.
The authenticated Electron-to-Messenger bridge is a separate workflow. See
the [full MCP and desktop connector documentation](../README.md#thingtime-mcp).
Configure `THINGTIME_MCP_ALLOWED_ROOTS` and `THINGTIME_MCP_STATE_DIR` as
absolute paths when archive imports are needed. Keep the private state directory
outside synced/shared folders when it contains sensitive chat data. Staged
records are only a preview: the standalone MCP does not upload them to
ThingtimeDB. The authenticated Electron connector sends bounded batches through
`/api/v1/ai/connections` under the current Thingtime session.

## Render response and acceptance

`thingtime_render_and_export` returns canonical JSON as an embedded
`application/json` MCP resource and PNGs as MCP `image` blocks and embedded
blob resources. Artifacts are inline; `thingtime-draft://` resource URIs are
not public URLs. A host or local artifact extractor must consume the MCP tool
result, including both the canonical JSON and embedded PNG content. When using
the supplied extractor with this shared server, select it with
`thingtime` as the extractor’s final positional argument. HTTP reachability or the old
`thingtime-drafts` worker's native success does not prove this normal server's
tool call or host artifact delivery. See the unified-host checklist in
[`TESTING.md`](../TESTING.md#unified-local-mcp-draft-rendering--26-october-2026).

Set `crop: { enabled: false }` to export only the canonical JSON and viewport
PNGs. The response's `cropEnabled` boolean determines whether `card.png` is
included; `viewports[].crop` retains measured geometry for diagnostics even
when no crop is exported. Each requested width/height pair must be unique;
duplicates fail validation before a renderer starts. The automatic 320px check
reuses an explicitly requested 320px viewport. Incomplete stdio frames fail
closed, including a truncated frame after an otherwise valid result.

26 October verification: the normal `thingtime` connection passed actual CLI-agent capabilities, native rendering and malformed-input refusal. The unified `mcp__thingtime__thingtime_render_and_export` tool also completed from this Codex desktop chat. Its canonical JSON passes `parseTransfer`, a byte-identical `serializeTransfer` round-trip and `prepareDraft`; PNG headers, dimensions and SHA-256 values match the host record, with 390px, 320px and card views visually checked. Malformed JSON and a nonexistent crop returned errors with no artifacts. Post-call inventory found no request-created containers or asset volumes since the source commit; three older volumes were preserved. [Desktop-host artifacts and verification](../artifacts/anonymous-local-first-2026-10-26-desktop-mcp/README.md). This is desktop-host acceptance for this chat, separate from installed macOS-app, CI, deployed and broader local-first acceptance.
