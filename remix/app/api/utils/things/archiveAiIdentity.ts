import { publicExternalAiSource } from '../messenger/externalAi';

export type ArchiveAiIdentity = { kind: 'human' } | {
  kind: 'historical'; provider: 'chatgpt' | 'claude' | 'lopu';
  role: 'assistant' | 'system' | 'unknown'; displayName: string;
};
const reject = (): never => { throw new Error('Historical AI author is unavailable'); };

/** Internal presentation classifier for a membership-authorized snapshot.
 * Never copies a source/session/device/connector ID or treats a human ownerId
 * as the author of an assistant row. Not yet an export-enabling adapter. */
export const archiveAiIdentity = (chatSource: unknown, messageSource: unknown, turn: unknown): ArchiveAiIdentity => {
  const chat = chatSource == null ? null : publicExternalAiSource(chatSource);
  const message = messageSource == null ? null : publicExternalAiSource(messageSource);
  if ((chatSource != null && !chat) || (messageSource != null && !message)) reject();
  const turnRole = turn == null ? undefined : typeof turn === 'object' && !Array.isArray(turn)
    ? (turn as Record<string, unknown>).role : reject();
  if (turn != null && (!chat || chat.provider !== 'lopu' || !['user', 'assistant'].includes(String(turnRole)))) reject();
  if (message && (!chat || message.provider !== chat.provider || message.sourceId !== chat.sourceId ||
    message.access !== chat.access)) reject();
  // Live sourceId identifies the connector, not the conversation. The same
  // connector can serve many sessions and devices; match the full stored scope.
  if (message?.access === 'live' && (chat?.access !== 'live' ||
    message.deviceId !== chat.deviceId || message.connectorId !== chat.connectorId ||
    message.sessionId !== chat.sessionId)) reject();
  if (message && turnRole !== undefined && message.role !== turnRole) reject();
  if (!message) {
    // Canonical Lopu user rows have no externalSource. Imported/device rows
    // must identify their own role; absent provenance must not become self.
    if (turnRole === 'assistant' || (chat && chat.provider !== 'lopu')) reject();
    return { kind: 'human' };
  }
  if (!message.role) return reject();
  if (message.role === 'user') return { kind: 'human' };
  return { kind: 'historical', provider: message.provider, role: message.role,
    displayName: message.authorName || message.label };
};
