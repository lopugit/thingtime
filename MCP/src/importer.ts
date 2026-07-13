import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { connectors, selectConnector } from './connectors/index.js';
import { conversationSchema, snapshotSchema, type Conversation, type Snapshot } from './model.js';
import { redactSecrets, requireAllowedFile } from './security.js';

export async function importArchive(path: string, requestedConnector?: string, includeRawMetadata = false): Promise<Snapshot> {
  const sourcePath = await requireAllowedFile(path);
  const bytes = await readFile(sourcePath);
  if (bytes.byteLength > 512 * 1024 * 1024) throw new Error('Archive exceeds the 512 MiB import limit');
  const input = JSON.parse(bytes.toString('utf8'));
  const connector = selectConnector(input, requestedConnector);
  const now = new Date().toISOString();
  return snapshotSchema.parse(redactSecrets(connector.normalize(input, {
    sourcePath,
    sourceSha256: createHash('sha256').update(bytes).digest('hex'),
    includeRawMetadata,
    now
  })));
}

export function ingestCurrentConversation(input: Omit<Conversation, 'provenance'> & { provenance?: Conversation['provenance'] }): Snapshot {
  const now = new Date().toISOString();
  const conversation = conversationSchema.parse(redactSecrets({
    ...input,
    source: { ...input.source, connector: 'mcp-host-handoff' },
    provenance: input.provenance || { importedAt: now, sourcePath: null, sourceSha256: null }
  }));
  return {
    schemaVersion: 1,
    sourceApp: conversation.source.app,
    connector: 'mcp-host-handoff',
    exportedAt: null,
    importedAt: now,
    conversations: [conversation],
    files: [],
    settings: {},
    metadata: {}
  };
}

export const connectorInfo = () => connectors.map(({ id, app, description }) => ({ id, app, description }));
