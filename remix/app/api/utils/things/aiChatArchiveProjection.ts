import { publicExternalAiSource } from '../messenger/externalAi';
import { archiveAiIdentity } from './archiveAiIdentity';
import { projectLiveChatArchive, type LiveChatArchiveSnapshot } from './liveChatArchiveCore';

/** Metadata is supplied only by the authorized source reader, never by a
 * portable manifest. This transformation is not wired to the live endpoint yet:
 * assistant avatars and inert tool-history presentation still need integration. */
export const projectAiChatArchive = (snapshot: LiveChatArchiveSnapshot, viewerId: string,
  chatSource: unknown, authors: ReadonlyMap<string, { externalSource?: unknown; lopu?: unknown }>) => {
  const source = publicExternalAiSource(chatSource);
  if (!source || (source.access === 'live' && (source.historyHasMore !== false || source.historyCursor !== null)))
    throw new Error('Complete synchronized AI history is required');
  if (authors.size !== snapshot.messages.length || snapshot.messages.some(row => !authors.has(row.id)))
    throw new Error('Complete AI author metadata is required');
  const copy = structuredClone(snapshot);
  const reserved = new Set([copy.chat.id, ...copy.participants.flatMap(row => [row.id, row.userId]),
    ...copy.messages.map(row => row.id), ...copy.reactions.map(row => row.id),
    ...copy.files.map(row => row.id), ...copy.links.map(row => row.id)]);
  const humanIds = new Set(copy.participants.map(row => row.userId));
  const historical = new Map<string, string>();
  let index = 0;
  for (const row of copy.messages) {
    if (!humanIds.has(row.authorId)) throw new Error('AI message owner is not a source participant');
    const meta = authors.get(row.id)!;
    // Preserve visible tool history later; do not silently drop it now.
    const tools = meta.lopu && typeof meta.lopu === 'object' ? (meta.lopu as Record<string, unknown>).toolCalls : undefined;
    if (tools !== undefined && (!Array.isArray(tools) || tools.length)) throw new Error('Historical tool presentation is required');
    const identity = archiveAiIdentity(chatSource, meta.externalSource, meta.lopu);
    if (identity.kind === 'human') continue;
    const key = JSON.stringify([identity.provider, identity.role, identity.displayName]);
    let authorId = historical.get(key);
    if (!authorId) {
      do { authorId = `archive-ai-author:${index++}`; } while (reserved.has(authorId));
      reserved.add(authorId); historical.set(key, authorId);
      copy.participants.push({ id: authorId, userId: authorId,
        username: `${identity.provider}-${identity.role}`, displayName: identity.displayName,
        nickname: '', joinedAt: copy.chat.createdAt });
    }
    row.authorId = authorId;
  }
  return projectLiveChatArchive(copy, viewerId);
};
