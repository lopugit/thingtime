import { emptyUpdownVotes, type UpdownEntry, type PublicUpdownVotes, type CommentSort } from './updownCore';
import type { PollVoteEntry, PublicPollVotes } from './pollCore';

export type CountedReaction = { userId: string; emoji: string; count?: number };
export type CountedUpdown = UpdownEntry & { count?: number };
export type CountedPollVote = PollVoteEntry & { count?: number };

export function tallyRelatedUpdown(entries: readonly CountedUpdown[], viewerId: string | null): PublicUpdownVotes {
  const result = emptyUpdownVotes();
  for (const entry of entries) {
    if (entry.direction !== 'up' && entry.direction !== 'down') continue;
    result[entry.direction] += entry.count ?? 1;
    if (viewerId && entry.userId === viewerId) result.viewerVote = entry.direction;
  }
  result.score = result.up - result.down; return result;
}
export function tallyRelatedPoll(optionCount: number, entries: readonly CountedPollVote[], viewerId: string | null): PublicPollVotes {
  const result: PublicPollVotes = { counts: new Array(Math.max(0, optionCount)).fill(0), totalVotes: 0, viewerVote: null };
  for (const entry of entries) {
    if (!Number.isInteger(entry.optionIndex) || entry.optionIndex < 0 || entry.optionIndex >= optionCount) continue;
    const count = entry.count ?? 1; result.counts[entry.optionIndex] += count; result.totalVotes += count;
    if (viewerId && entry.userId === viewerId) result.viewerVote = entry.optionIndex;
  }
  return result;
}

/** Server-side windows bound accumulated bodies, never the stored thread. */
export function relatedCommentPipeline(args: {
  ids: string[]; collection: string; moderation: Record<string, unknown>;
  projection: Record<string, unknown>; limit: number; legacy: boolean;
  sort?: CommentSort | null; includeEmbedded?: boolean; updownKind: string;
}): any[] {
  const { ids, collection, moderation, limit, legacy, sort } = args;
  const pipeline: any[] = [{ $match: { $and: [{ targetId: { $in: ids }, thingtime: 'comment' }, moderation] } }, { $set: { _relatedSource: 'modern', _relatedDocumentId: '$_id' } }];
  if (legacy) pipeline.push({ $unionWith: { coll: collection, pipeline: [
    { $match: { $and: [{ kind: 'comment', parentId: { $in: ids }, thingtime: { $ne: 'comment' } }, moderation] } },
    { $project: { shareId: { $toString: { $ifNull: ['$commentId', '$_id'] } }, ownerId: 1, targetId: '$parentId', createdAt: 1, _relatedDocumentId: '$_id', _relatedSource: { $literal: 'legacy' }, _relatedLegacy: { $literal: true } } }
  ] } });
  if (args.includeEmbedded) pipeline.push({ $unionWith: { coll: collection, pipeline: [
    { $match: { shareId: { $in: ids }, 'comments.0': { $exists: true } } }, { $unwind: '$comments' },
    { $project: { shareId: '$comments.id', ownerId: '$comments.userId', targetId: '$shareId', createdAt: '$comments.createdAt', _relatedSource: { $literal: 'embedded' }, _relatedLegacy: { $literal: true } } }
  ] } });
  pipeline.push({ $set: { createdAt: { $convert: { input: '$createdAt', to: 'date', onError: new Date(0), onNull: new Date(0) } } } });
  if (sort === 'top') pipeline.push({ $lookup: { from: collection, let: { id: '$shareId' }, pipeline: [
    { $match: { $and: [{ $expr: { $eq: ['$targetId', '$$id'] }, thingtime: args.updownKind }, moderation] } },
    { $group: { _id: null, score: { $sum: { $switch: { branches: [{ case: { $eq: ['$crystal.direction', 'up'] }, then: 1 }, { case: { $eq: ['$crystal.direction', 'down'] }, then: -1 }], default: 0 } } } } }
  ], as: '_relatedVotes' } }, { $set: { _relatedScore: { $ifNull: [{ $arrayElemAt: ['$_relatedVotes.score', 0] }, 0] } } });
  const sortBy = sort === 'top' ? { _relatedScore: -1, createdAt: 1, shareId: 1 }
    : sort === 'old' ? { createdAt: 1, shareId: 1 }
      : { createdAt: -1, shareId: sort === 'new' ? 1 : -1 };
  pipeline.push({ $project: { shareId: 1, ownerId: 1, targetId: 1, createdAt: 1, _relatedSource: 1, _relatedDocumentId: 1, _relatedLegacy: 1, _relatedScore: 1 } },
    { $group: { _id: '$targetId', count: { $sum: 1 }, legacyCount: { $sum: { $cond: ['$_relatedLegacy', 1, 0] } }, docs: { $topN: { n: limit, sortBy, output: '$$ROOT' } } } });
  return pipeline;
}

/** One output row per target/token/viewer-state, rather than per reacting user.
 * Deduplication happens before counting across both relational eras. */
export function relatedInteractionPipeline(args: { ids: string[]; collection: string; moderation: Record<string, unknown>; legacy: boolean; viewerId: string | null; updownKind: string; excludeEmbedded?: boolean }): any[] {
  const { ids, collection, moderation, legacy, viewerId, updownKind } = args;
  const pipeline: any[] = [
    { $match: { $and: [{ targetId: { $in: ids }, thingtime: { $in: ['reaction', 'vote', updownKind] } }, moderation] } },
    { $set: { _relatedKinds: { $cond: [{ $isArray: '$thingtime' }, '$thingtime', ['$thingtime']] } } },
    { $project: { target: '$targetId', user: '$ownerId', kind: { $cond: [{ $in: ['reaction', '$_relatedKinds'] }, 'reaction', { $cond: [{ $in: ['vote', '$_relatedKinds'] }, 'vote', 'updown'] }] }, token: { $ifNull: ['$crystal.emoji', { $ifNull: ['$crystal.optionIndex', '$crystal.direction'] }] } } }
  ];
  if (legacy) pipeline.push({ $unionWith: { coll: collection, pipeline: [
    { $match: { $and: [{ kind: 'reaction', parentId: { $in: ids } }, moderation] } },
    { $project: { target: '$parentId', user: '$ownerId', kind: { $literal: 'reaction' }, token: '$token' } }
  ] } });
  pipeline.push({ $group: { _id: { target: '$target', user: '$user', kind: '$kind', token: '$token' } } });
  if (args.excludeEmbedded) pipeline.push({ $lookup: { from: collection, let: { target: '$_id.target', user: '$_id.user', token: '$_id.token' }, pipeline: [
    { $match: { $expr: { $eq: ['$shareId', '$$target'] } } },
    { $project: { duplicate: { $anyElementTrue: [{ $map: { input: { $objectToArray: { $ifNull: ['$reactions', {}] } }, as: 'pair', in: { $and: [{ $eq: ['$$pair.k', '$$token'] }, { $in: ['$$user', { $cond: [{ $isArray: '$$pair.v' }, '$$pair.v', []] }] }] } } }] } } }
  ], as: '_embedded' } }, { $match: { $or: [{ '_id.kind': { $ne: 'reaction' } }, { '_embedded.duplicate': { $ne: true } }] } });
  pipeline.push({ $group: { _id: { target: '$_id.target', kind: '$_id.kind', token: '$_id.token', viewer: { $eq: ['$_id.user', viewerId] } }, count: { $sum: 1 } } });
  return pipeline;
}

export const RELATED_COUNT_PAGE_SIZE = 256;
/** Exact descendant counts with bounded projected pages. This avoids the
 * single unbounded BSON array produced by $graphLookup. Each child has one
 * targetId; a rooted tree cannot reconverge. Refuse its root if corrupt data
 * links a descendant back to it. No write or migration occurs during reads. */
export async function pagedThreadCounts(collection: any, ids: string[], moderation: Record<string, unknown>): Promise<Map<string, number>> {
  const result = new Map(ids.map(id => [id, 0]));
  type Frame = { parents: Map<string, Set<string>>; after: string | null };
  const stack: Frame[] = [];
  const unique = [...new Set(ids)];
  for (let offset = 0; offset < unique.length; offset += RELATED_COUNT_PAGE_SIZE) {
    stack.push({ parents: new Map(unique.slice(offset, offset + RELATED_COUNT_PAGE_SIZE).map(id => [id, new Set([id])])), after: null });
  }
  while (stack.length) {
    const frame = stack[stack.length - 1];
    const rows = await collection.find({ $and: [{ targetId: { $in: [...frame.parents.keys()] }, thingtime: 'comment', ...(frame.after ? { shareId: { $gt: frame.after } } : {}) }, moderation] })
      .project({ shareId: 1, targetId: 1, _id: 0 }).sort({ shareId: 1 }).limit(RELATED_COUNT_PAGE_SIZE).toArray();
    if (!rows.length) { stack.pop(); continue; }
    frame.after = String(rows[rows.length - 1].shareId);
    const next = new Map<string, Set<string>>();
    for (const row of rows) {
      const id = String(row.shareId), roots = frame.parents.get(String(row.targetId));
      if (!roots) continue;
      const propagated = next.get(id) || new Set<string>();
      for (const root of roots) {
        if (root === id) continue;
        result.set(root, (result.get(root) || 0) + 1); propagated.add(root);
      }
      if (propagated.size) next.set(id, propagated);
    }
    if (next.size) stack.push({ parents: next, after: null });
  }
  return result;
}
