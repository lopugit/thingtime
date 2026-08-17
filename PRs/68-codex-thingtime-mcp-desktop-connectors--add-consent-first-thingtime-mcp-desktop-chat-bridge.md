# PR #68 — Add consent-first Thingtime MCP desktop chat bridge

- Branch: `codex/thingtime-mcp-desktop-connectors`
- Pull request: <https://github.com/lopugit/thingtime/pull/68>
- Date: 2026-07-13; platform integration updated 2026-08-17

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

### 2026-08-17 Messenger + Electron integration

- The packaged Electron app now bundles the desktop normalizer and exposes a
  narrow preload API for source discovery, expiring in-memory sync sessions,
  bounded batch reads, cancellation, and native export selection. The renderer
  never receives an export path or direct filesystem primitive. Build staging
  materializes Nitro dependencies instead of shipping absolute worktree
  symlinks, and local installation signs/verifies the exact self-contained app
  copied to `~/Applications/Thingtime.app`.
- Three independent Mac sources are recognized: ChatGPT Work/Codex local
  history, the main Claude desktop profile, and Claude Thingtime. Official
  ChatGPT/Claude JSON and ZIP exports cover provider history not present in
  local app stores.
- `/api/v1/ai/connections` registers authenticated, rate-limited discovery and
  sync. Projects/workspaces become communities, grouped conversations become
  channels, ungrouped conversations become chats, and imported messages remain
  bounded relational `chat-message` rows.
- Stable source keys are hashed with the authenticated owner. Interrupted and
  repeated batches reuse the same connection, community, chat, membership, and
  message rows; replaying an identical import changes neither row count nor
  account usage.
- Messenger exposes **✦ AI** in both Spaces and Chats modes, progress and
  connection counts, source avatars/badges, and read-only provider rows.
  Thingtime reactions, threads, and replies remain writable without posting
  back to ChatGPT or Claude.
- Every user-owned Messenger and imported-AI row now uses the same exact
  transactional account-storage ledger as posts and other Things. Relationship
  rows are charged to their `ownerId`; attachment object bytes remain separately
  charged on protected attachment Things. Accounting version 2 forces a safe
  idempotent recount of legacy posts, Messenger rows, and attachments.
- Related multi-row mutations are transactional: container plus owner
  membership, message plus receipt/preview/attachment bindings, community
  membership revocation, invite redemption, section removal/reorder, and
  bounded imported-message chunks. A quota error cannot leave an unmetered or
  inaccessible half-write.

## Security and product boundaries

MCP gives a host a standard way to invoke this server; it does not give the
server universal access to all open desktop chats, application cookies, local
storage, passwords, or settings. The implementation therefore uses two honest
capture paths: explicit current-chat handoff from the host, or an approved file
inside a configured root. Imports and deletes require a literal
`confirmedByUser: true` argument.

The standalone MCP staging tools still do not write the database directly.
ThingtimeDB persistence is enabled only through the authenticated Electron
renderer and `/api/v1/ai/connections`, so the current Thingtime session,
membership projections, rate limits, schema registry, storage admission, and
normal API error boundary remain authoritative. Local discovery filters hidden
reasoning, tool calls, internal context, cookies, credentials, and raw paths;
imported provider rows are read-only.

## Validation

- `npm run typecheck`
- `npm test` — 11/11 passing
- `npm run build`
- `npm run build:desktop`
- `npm run build-electron` plus `npm run install-electron`; the source and
  installed `~/Applications/Thingtime.app` bundles pass strict deep signature
  verification and the installed executable check
- Installed-app UI: ChatGPT, Claude, and Claude Thingtime all reported
  `FOUND`; a real bounded ChatGPT import into the disposable replica set wrote
  10,892 Messenger/AI rows totaling 7,620,754 bytes, exactly matching the
  account's v2 `storageUsedBytes` ledger (the disposable database was removed)
- `npm run build:vercel` including the static shell/filesystem-route verifier
- `npm --prefix remix run test:messenger` — 7/7 passing
- `npm --prefix remix run test:storage` — 7/7 passing
- `npm --prefix remix run test:migrations` — 19/19 passing
- Disposable MongoDB 8 single-node replica-set integration: posts and all
  Messenger/imported-AI rows counted, identical import byte-idempotent,
  1-byte quota rolled back both community rows, and v1 history reconciled by
  `backfill-user-storage-accounting`
- `npm audit --omit=dev` — 0 vulnerabilities
- MCP client/server initialization and tool discovery over linked transports
- allowlisted-path and real attachment-copy test
- ChatGPT, Claude, portable-manifest, redaction, and relational-record tests
- `npm pack --dry-run` with the expected `dist/index.js` executable entry
- Graphify semantic/code refresh plus clustering, report, and HTML regeneration
- Graphify post-commit/post-checkout hooks and `graphify` merge driver verified

## Follow-up slices

1. Add explicit disconnect/delete-local-copy controls and source retention
   policy once product semantics are chosen.
2. Add object-backed import of provider-export attachments after each export
   format exposes stable, verifiable file references.
3. Add explicit provider send/reply permissions only where an app exposes a
   documented authorized API; imported provider history remains read-only by
   default.
