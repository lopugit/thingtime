import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { connectorInfo, importArchive, ingestCurrentConversation } from './importer.js';
import { prepareIngestion } from './ingestion.js';
import { conversationSchema } from './model.js';
import { configuredRoots } from './security.js';
import { SnapshotStore } from './store.js';

const hostConversationSchema = conversationSchema.omit({ provenance: true }).extend({
  provenance: conversationSchema.shape.provenance.optional()
});

const textResult = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  structuredContent: value as Record<string, unknown>
});

export function createServer(store = new SnapshotStore()): McpServer {
  const server = new McpServer(
    { name: 'thingtime-mcp', version: '0.1.0' },
    { instructions: 'Import only data the user explicitly provides or places in an allowlisted root. List summaries before reading conversation content. Never request or expose passwords, cookies, API keys, or session tokens.' }
  );

  server.registerTool('thingtime_capabilities', {
    title: 'Thingtime MCP capabilities',
    description: 'Explain supported desktop chat capture paths and current safety boundaries.',
    inputSchema: z.object({})
  }, async () => textResult({
    hostHandoff: 'Any MCP host can explicitly send its current conversation using thingtime_ingest_current_chat.',
    archiveImport: 'User-selected JSON exports can be imported from THINGTIME_MCP_ALLOWED_ROOTS.',
    connectors: connectorInfo(),
    allowedRoots: configuredRoots(),
    stateDir: store.root,
    limitations: [
      'MCP does not grant a server universal access to a host app chat history, settings, cookies, or local storage.',
      'Apps need a connector/exporter or must hand data to this MCP explicitly.',
      'ThingtimeDB upload is intentionally not enabled until ai-chat schemas and authenticated import APIs exist in the platform.'
    ]
  }));

  server.registerTool('thingtime_list_connectors', {
    title: 'List chat connectors',
    description: 'List the installed AI desktop export adapters.',
    inputSchema: z.object({})
  }, async () => textResult({ connectors: connectorInfo() }));

  server.registerTool('thingtime_import_archive', {
    title: 'Import AI chat archive',
    description: 'Normalize and privately stage a user-approved JSON export from an allowlisted directory.',
    inputSchema: z.object({
      path: z.string().describe('Absolute path within THINGTIME_MCP_ALLOWED_ROOTS'),
      connector: z.string().optional(),
      includeRawMetadata: z.boolean().default(false),
      confirmedByUser: z.literal(true).describe('Must be true only after the user explicitly approves this file import')
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
  }, async ({ path, connector, includeRawMetadata }) => textResult({ import: await store.save(await importArchive(path, connector, includeRawMetadata)) }));

  server.registerTool('thingtime_ingest_current_chat', {
    title: 'Stage current MCP host chat',
    description: 'Stage a normalized current conversation explicitly supplied by the connected desktop MCP host.',
    inputSchema: z.object({
      conversation: hostConversationSchema,
      confirmedByUser: z.literal(true)
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
  }, async ({ conversation }) => textResult({ import: await store.save(ingestCurrentConversation(conversation)) }));

  server.registerTool('thingtime_list_imports', {
    title: 'List staged chat imports',
    description: 'List private local import summaries without returning message bodies.',
    inputSchema: z.object({})
  }, async () => textResult({ imports: await store.list() }));

  server.registerTool('thingtime_get_conversation', {
    title: 'Read a staged conversation',
    description: 'Read one conversation from a staged import. Message bodies are returned only when explicitly requested.',
    inputSchema: z.object({ importId: z.string(), conversationId: z.string(), includeMessages: z.boolean().default(false) }),
    annotations: { readOnlyHint: true }
  }, async ({ importId, conversationId, includeMessages }) => {
    const snapshot = await store.get(importId);
    const conversation = snapshot.conversations.find((entry) => entry.id === conversationId);
    if (!conversation) throw new Error('Conversation not found');
    return textResult({ conversation: includeMessages ? conversation : { ...conversation, messages: undefined, messageCount: conversation.messages.length } });
  });

  server.registerTool('thingtime_prepare_ingestion', {
    title: 'Prepare ThingtimeDB ingestion records',
    description: 'Create a preview of relational ai-chat and ai-chat-message records. This does not upload anything.',
    inputSchema: z.object({ importId: z.string(), offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(100).default(25) }),
    annotations: { readOnlyHint: true }
  }, async ({ importId, offset, limit }) => {
    const records = prepareIngestion(await store.get(importId));
    return textResult({ records: records.slice(offset, offset + limit), total: records.length, nextOffset: offset + limit < records.length ? offset + limit : null });
  });

  server.registerTool('thingtime_delete_import', {
    title: 'Delete staged chat import',
    description: 'Permanently delete one private local staged import.',
    inputSchema: z.object({ importId: z.string(), confirmedByUser: z.literal(true) }),
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true }
  }, async ({ importId }) => {
    await store.delete(importId);
    return textResult({ ok: true, deleted: importId });
  });

  return server;
}
