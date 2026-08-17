import type { Message, Snapshot } from '../model.js';
import { arrayOf, attachmentOf, conversationBase, idOf, isoDate, recordOf, roleOf, textParts } from './helpers.js';
import type { Connector } from './types.js';

function orderedMessages(conversation: Record<string, any>): Message[] {
  const nodes = Object.values(recordOf(conversation.mapping)).map(recordOf);
  return nodes
    .filter((node) => node.message)
    .map((node) => {
      const raw = recordOf(node.message);
      const content = recordOf(raw.content);
      const metadata = recordOf(raw.metadata);
      return {
        id: idOf(raw.id, 'message'),
        role: roleOf(recordOf(raw.author).role),
        authorName: recordOf(raw.author).name || null,
        createdAt: isoDate(raw.create_time),
        updatedAt: isoDate(raw.update_time),
        parts: textParts(content),
        attachments: arrayOf(metadata.attachments).map(attachmentOf),
        metadata: {}
      };
    })
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export const chatGptConnector: Connector = {
  id: 'chatgpt-export',
  app: 'ChatGPT',
  description: 'OpenAI ChatGPT data export conversations.json.',
  detect(input) {
    const first = arrayOf(input)[0];
    return first && recordOf(first).mapping ? 90 : 0;
  },
  normalize(input, context): Snapshot {
    const conversations = arrayOf(input).map(recordOf).map((raw) => {
      const base = conversationBase(raw, this.id, this.app, context);
      const groupId = raw.project_id || raw.project_uuid || raw.workspace_id || null;
      if (groupId) base.source.workspaceId = String(groupId);
      base.metadata = groupId
        ? {
            groupId: String(groupId),
            groupName: String(raw.project_name || raw.workspace_name || 'ChatGPT project'),
            groupKind: raw.workspace_id ? 'workspace' : 'project'
          }
        : {};
      return { ...base, messages: orderedMessages(raw) };
    });
    return { schemaVersion: 1, sourceApp: this.app, connector: this.id, exportedAt: null, importedAt: context.now, conversations, files: [], settings: {}, metadata: {} };
  }
};
