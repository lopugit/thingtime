import { createHash, randomUUID } from 'node:crypto';
import type { Attachment, Conversation, Message } from '../model.js';
import { redactSecrets } from '../security.js';
import type { ConnectorContext } from './types.js';

export const recordOf = (value: unknown): Record<string, any> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, any>) : {};

export const arrayOf = (value: unknown): any[] => (Array.isArray(value) ? value : []);

export const idOf = (value: unknown, prefix: string): string => {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value) : '';
  return text || `${prefix}-${randomUUID()}`;
};

export const isoDate = (value: unknown): string | null => {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' && value < 10_000_000_000 ? value * 1000 : value;
  const date = new Date(number as any);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
};

export const roleOf = (value: unknown): Message['role'] => {
  const role = String(value || '').toLowerCase();
  if (role === 'user' || role === 'assistant' || role === 'system' || role === 'tool') return role;
  if (role === 'human') return 'user';
  return 'unknown';
};

export const textParts = (content: unknown): Message['parts'] => {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  const raw = recordOf(content);
  const parts = Array.isArray(raw.parts) ? raw.parts : Array.isArray(content) ? content : [];
  return parts.map((part) =>
    typeof part === 'string'
      ? { type: 'text' as const, text: part }
      : { type: 'json' as const, text: null, data: redactSecrets(part) }
  );
};

export const attachmentOf = (value: unknown, index = 0): Attachment => {
  const raw = recordOf(value);
  const name = String(raw.name || raw.file_name || raw.filename || `attachment-${index + 1}`);
  return {
    id: idOf(raw.id || raw.file_id || raw.asset_id, 'attachment'),
    name,
    mimeType: typeof raw.mime_type === 'string' ? raw.mime_type : typeof raw.mimeType === 'string' ? raw.mimeType : null,
    sizeBytes: Number.isSafeInteger(raw.size) && raw.size >= 0 ? raw.size : null,
    sourcePath: typeof raw.path === 'string' ? raw.path : null,
    sourceUrl: typeof raw.url === 'string' ? raw.url : null,
    sha256: typeof raw.sha256 === 'string' ? raw.sha256 : null,
    metadata: recordOf(redactSecrets(raw.metadata || {}))
  };
};

export const stableId = (source: string, originalId: string): string =>
  createHash('sha256').update(`${source}:${originalId}`).digest('hex').slice(0, 32);

export function conversationBase(
  raw: Record<string, any>,
  connector: string,
  app: string,
  context: ConnectorContext
): Omit<Conversation, 'messages'> {
  const originalId = idOf(raw.id || raw.uuid || raw.conversation_id, 'conversation');
  return {
    schemaVersion: 1,
    id: stableId(app, originalId),
    source: { app, connector, accountId: raw.account_id ? String(raw.account_id) : null, workspaceId: raw.workspace_id ? String(raw.workspace_id) : null },
    title: String(raw.title || raw.name || 'Untitled chat'),
    createdAt: isoDate(raw.created_at ?? raw.create_time),
    updatedAt: isoDate(raw.updated_at ?? raw.update_time),
    participants: [],
    attachments: arrayOf(raw.attachments).map(attachmentOf),
    settings: recordOf(redactSecrets(raw.settings || {})),
    metadata: context.includeRawMetadata ? recordOf(redactSecrets(raw)) : {},
    provenance: { importedAt: context.now, sourcePath: context.sourcePath, sourceSha256: context.sourceSha256 }
  };
}
