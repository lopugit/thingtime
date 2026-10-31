import type { Snapshot } from './model.js';

export type ThingtimeIngestionRecord = {
  externalId: string;
  parentExternalId: string | null;
  thingtime: string[];
  crystal: Record<string, unknown>;
  source: Record<string, unknown>;
};

export function prepareIngestion(snapshot: Snapshot): ThingtimeIngestionRecord[] {
  return snapshot.conversations.flatMap((conversation) => {
    const chatExternalId = `${conversation.source.app}:${conversation.id}`;
    const chat: ThingtimeIngestionRecord = {
      externalId: chatExternalId,
      parentExternalId: null,
      thingtime: ['ai-chat'],
      crystal: {
        title: conversation.title,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        participants: conversation.participants,
        settings: conversation.settings,
        metadata: conversation.metadata
      },
      source: conversation.source
    };
    const messages = conversation.messages.map((message) => ({
      externalId: `${chatExternalId}:${message.id}`,
      parentExternalId: chatExternalId,
      thingtime: ['ai-chat-message'],
      crystal: message,
      source: conversation.source
    }));
    return [chat, ...messages];
  });
}
