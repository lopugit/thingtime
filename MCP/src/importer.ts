import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';
import { connectors, selectConnector } from './connectors/index.js';
import { conversationSchema, snapshotSchema, type Conversation, type Snapshot } from './model.js';
import { redactSecrets, requireAllowedFile } from './security.js';

const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;

const parseJsonBytes = (bytes: Uint8Array): unknown => JSON.parse(Buffer.from(bytes).toString('utf8'));

const archiveInput = (bytes: Uint8Array): { input: unknown; projectNames: Map<string, string> } => {
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!zip) return { input: parseJsonBytes(bytes), projectNames: new Map() };

  const files = unzipSync(bytes, {
    filter: (entry) => entry.name.toLowerCase().endsWith('.json') && entry.originalSize <= MAX_ARCHIVE_BYTES
  });
  const entries = Object.entries(files);
  const total = entries.reduce((sum, [, value]) => sum + value.byteLength, 0);
  if (total > MAX_ARCHIVE_BYTES) throw new Error('Expanded JSON exceeds the 512 MiB import limit');
  const candidates = entries.sort(([a], [b]) => {
    const rank = (name: string) => (/conversations\.json$/i.test(name) ? 0 : /conversation/i.test(name) ? 1 : 2);
    return rank(a) - rank(b);
  });
  let input: unknown = null;
  for (const [, value] of candidates) {
    try {
      const parsed = parseJsonBytes(value);
      if (selectConnector(parsed).detect(parsed) > 0) {
        input = parsed;
        break;
      }
    } catch {
      // Other export JSON (settings, users, projects) is expected here.
    }
  }
  if (input === null) throw new Error('No supported conversation JSON was found in the export archive');

  const projectNames = new Map<string, string>();
  for (const [name, value] of entries) {
    if (!/project/i.test(name)) continue;
    try {
      const parsed = parseJsonBytes(value);
      const rows = Array.isArray(parsed) ? parsed : [];
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const raw = row as Record<string, unknown>;
        const id = String(raw.id || raw.uuid || raw.project_id || '');
        const label = String(raw.name || raw.title || '');
        if (id && label) projectNames.set(id, label.slice(0, 80));
      }
    } catch {
      // Project metadata is optional; conversation import still proceeds.
    }
  }
  return { input, projectNames };
};

export function importArchiveBytes(
  bytes: Uint8Array,
  sourcePath: string | null,
  requestedConnector?: string,
  includeRawMetadata = false
): Snapshot {
  if (bytes.byteLength > 512 * 1024 * 1024) throw new Error('Archive exceeds the 512 MiB import limit');
  const decoded = archiveInput(bytes);
  const input = decoded.input;
  const connector = selectConnector(input, requestedConnector);
  const now = new Date().toISOString();
  const snapshot = snapshotSchema.parse(redactSecrets(connector.normalize(input, {
    sourcePath,
    sourceSha256: createHash('sha256').update(bytes).digest('hex'),
    includeRawMetadata,
    now
  })));
  if (decoded.projectNames.size) {
    for (const conversation of snapshot.conversations) {
      const groupId = typeof conversation.metadata.groupId === 'string' ? conversation.metadata.groupId : conversation.source.workspaceId;
      const groupName = groupId ? decoded.projectNames.get(groupId) : null;
      if (groupName) conversation.metadata.groupName = groupName;
    }
  }
  return snapshot;
}

export async function importArchive(path: string, requestedConnector?: string, includeRawMetadata = false): Promise<Snapshot> {
  const sourcePath = await requireAllowedFile(path);
  const bytes = await readFile(sourcePath);
  return importArchiveBytes(bytes, sourcePath, requestedConnector, includeRawMetadata);
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
