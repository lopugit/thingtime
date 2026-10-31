import type { Message, Snapshot } from '../model.js';
import { arrayOf, attachmentOf, conversationBase, idOf, isoDate, recordOf, roleOf, textParts } from './helpers.js';
import type { Connector } from './types.js';

export const claudeConnector: Connector = {
  id: 'claude-export',
  app: 'Claude',
  description: 'Anthropic Claude conversation export JSON.',
  detect(input) {
    const first = arrayOf(input)[0];
    return first && Array.isArray(recordOf(first).chat_messages) ? 90 : 0;
  },
  normalize(input, context): Snapshot {
    const conversations = arrayOf(input).map(recordOf).map((raw) => {
      const messages: Message[] = arrayOf(raw.chat_messages).map(recordOf).map((message) => ({
        id: idOf(message.uuid || message.id, 'message'),
        role: roleOf(message.sender || message.role),
        authorName: null,
        createdAt: isoDate(message.created_at),
        updatedAt: isoDate(message.updated_at),
        parts: textParts(message.content || message.text),
        attachments: arrayOf(message.attachments || message.files).map(attachmentOf),
        metadata: {}
      }));
      const base = conversationBase(raw, this.id, this.app, context);
      const groupId = raw.project_uuid || raw.project_id || raw.workspace_id || null;
      if (groupId) base.source.workspaceId = String(groupId);
      base.metadata = groupId
        ? {
            groupId: String(groupId),
            groupName: String(raw.project_name || raw.workspace_name || 'Claude project'),
            groupKind: raw.workspace_id ? 'workspace' : 'project'
          }
        : {};
      return { ...base, messages };
    });
    return { schemaVersion: 1, sourceApp: this.app, connector: this.id, exportedAt: null, importedAt: context.now, conversations, files: [], settings: {}, metadata: {} };
  }
};
