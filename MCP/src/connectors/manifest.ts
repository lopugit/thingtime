import { snapshotSchema, type Snapshot } from '../model.js';
import { redactSecrets } from '../security.js';
import { arrayOf, attachmentOf, conversationBase, idOf, isoDate, recordOf, roleOf, textParts } from './helpers.js';
import type { Connector } from './types.js';

export const manifestConnector: Connector = {
  id: 'ai-desktop-manifest-v1',
  app: 'AI desktop app',
  description: 'Portable adapter manifest for any desktop app or exporter.',
  detect(input) {
    const raw = recordOf(input);
    return raw.format === 'thingtime.ai-desktop-export' && raw.version === 1 ? 95 : 0;
  },
  normalize(input, context): Snapshot {
    const root = recordOf(input);
    const app = String(root.app?.name || root.app || 'AI desktop app');
    const conversations = arrayOf(root.conversations).map(recordOf).map((raw) => ({
      ...conversationBase(raw, this.id, app, context),
      messages: arrayOf(raw.messages).map(recordOf).map((message) => ({
        id: idOf(message.id, 'message'),
        role: roleOf(message.role),
        authorName: typeof message.authorName === 'string' ? message.authorName : null,
        createdAt: isoDate(message.createdAt),
        updatedAt: isoDate(message.updatedAt),
        parts: message.parts ? textParts(message.parts) : textParts(message.text),
        attachments: arrayOf(message.attachments).map(attachmentOf),
        metadata: recordOf(redactSecrets(message.metadata || {}))
      }))
    }));
    return snapshotSchema.parse({
      schemaVersion: 1,
      sourceApp: app,
      connector: this.id,
      exportedAt: isoDate(root.exportedAt),
      importedAt: context.now,
      conversations,
      files: arrayOf(root.files).map(attachmentOf),
      settings: recordOf(redactSecrets(root.settings || {})),
      metadata: context.includeRawMetadata ? recordOf(redactSecrets(root.metadata || {})) : {}
    });
  }
};
