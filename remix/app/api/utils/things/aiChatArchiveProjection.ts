import { publicExternalAiSource } from '../messenger/externalAi';
import { archiveAiIdentity } from './archiveAiIdentity';
import { projectLiveChatArchive, type LiveChatArchiveSnapshot } from './liveChatArchiveCore';
import { TRANSFER_LIMITS } from '../../../utils/thingTransfer/format';
import { validArchiveToolHistory } from '../../../utils/thingTransfer/chatArchive';

/** Metadata is supplied only by the authorized source reader, never by a
 * portable manifest. Only the membership-authorized export adapter calls this;
 * assistant avatars and tool receipts are display-only historical data. */
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
  const segments = new Map<string, { count: number; identity: string; indices: Set<number>; rows: Map<number, typeof copy.messages[number]> }>();
  const rowGroups = new Map<string, string>();
  let index = 0;
  for (const row of copy.messages) {
    if (!humanIds.has(row.authorId)) throw new Error('AI message owner is not a source participant');
    const meta = authors.get(row.id)!;
    const identity = archiveAiIdentity(chatSource, meta.externalSource, meta.lopu);
    const external = meta.externalSource && typeof meta.externalSource === 'object' ? meta.externalSource as Record<string, unknown> : undefined;
    const turn = meta.lopu && typeof meta.lopu === 'object' ? meta.lopu as Record<string, unknown> : undefined;
    const parts = turn?.segmentCount !== undefined || turn?.segmentIndex !== undefined ? turn : external;
    if (parts?.segmentCount !== undefined || parts?.segmentIndex !== undefined) {
      const count = parts.segmentCount, partIndex = parts.segmentIndex;
      if (!Number.isSafeInteger(count) || !Number.isSafeInteger(partIndex) || Number(count) < 1 ||
        Number(count) > TRANSFER_LIMITS.things || Number(partIndex) < 0 || Number(partIndex) >= Number(count))
        throw new Error('Complete AI message segments are required');
      if (turn && external && (external.segmentCount !== undefined || external.segmentIndex !== undefined) &&
        (turn.segmentCount !== external.segmentCount || turn.segmentIndex !== external.segmentIndex))
        throw new Error('Conflicting AI message segments');
      const messageKey = turn?.requestId ?? external?.messageId;
      if (Number(count) > 1 && (typeof messageKey !== 'string' || !messageKey))
        throw new Error('A stable AI message identity is required for segmented history');
      const key = JSON.stringify([row.authorId, parts.role, messageKey ?? row.id]);
      const stamp = JSON.stringify([identity, external?.revision ?? null]);
      const group = segments.get(key) || { count: Number(count), identity: stamp, indices: new Set<number>(), rows: new Map() };
      if (group.count !== count || group.identity !== stamp || group.indices.has(Number(partIndex))) throw new Error('Conflicting AI message segments');
      group.rows.set(Number(partIndex), row); rowGroups.set(row.id, key);
      group.indices.add(Number(partIndex)); segments.set(key, group);
    }
    // Only historical display fields survive. No source targets, arguments,
    // receipts/approval IDs, billing, connector details or executable callbacks.
    const tools = meta.lopu && typeof meta.lopu === 'object' ? (meta.lopu as Record<string, unknown>).toolCalls : undefined;
    if (!row.deleted && tools !== undefined) {
      if (!Array.isArray(tools) || (tools.length && (identity.kind !== 'historical' || identity.role !== 'assistant')))
        throw new Error('Invalid historical tool presentation');
      const history = tools.map(call => call && typeof call === 'object'
        ? { name: call.name, ok: call.ok, summary: call.summary } : null);
      if (!validArchiveToolHistory(history)) throw new Error('Invalid historical tool presentation');
      if (history.length) row.toolHistory = history;
    }
    if (identity.kind === 'human') continue;
    const key = JSON.stringify([identity.provider, identity.role, identity.displayName]);
    let authorId = historical.get(key);
    if (!authorId) {
      do { authorId = `archive-ai-author:${index++}`; } while (reserved.has(authorId));
      reserved.add(authorId); historical.set(key, authorId);
      copy.participants.push({ id: authorId, userId: authorId,
        username: `${identity.provider}-${identity.role}`, displayName: identity.displayName,
        nickname: '', joinedAt: copy.chat.createdAt, avatarPreset: identity.provider });
    }
    row.authorId = authorId;
  }
  if ([...segments.values()].some(group => group.indices.size !== group.count))
    throw new Error('Complete AI message segments are required');
  // Fresh imported IDs must never reshuffle equal-timestamp message segments.
  // Place each complete segmented message at its first source occurrence and
  // retain its canonical part order; the core stamps portable positions.
  const emitted = new Set<string>();
  copy.messages = copy.messages.flatMap(row => {
    const key = rowGroups.get(row.id);
    if (!key) return [row];
    if (emitted.has(key)) return [];
    emitted.add(key);
    return [...segments.get(key)!.rows].sort(([a], [b]) => a - b).map(([, part]) => part);
  });
  return projectLiveChatArchive(copy, viewerId);
};
