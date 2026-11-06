import { randomUUID } from 'node:crypto';
import { COLLECTION_SCHEMA_VERSIONS } from '~/schemas/registry';
import { getThingsCollection } from '../mongodb/collections';
import { thingUniqueKey, thingUniqueKeyFilter } from '../mongodb/uniqueKeys';
import { deleteAccountedThing, insertAccountedThing, updateAccountedThing, withAccountedThingsTransaction } from '../storage/accountedThings';
import { StorageMutationError } from '../storage/storageCore';
import { asViewer, fail, findViewableThing, resolvePostLinkedThings, toPublicThings, withFriendIds, type Fail, type PublicThing, type Viewer } from '../things/things';
import { accessOf, canModerate, isActiveMember, membershipOfDoc } from './gate';
import { decodeEmbedCursor, encodeEmbedCursor, isSubspaceEmbedSource, publicEmbedThing, subspaceEmbedRegion, validEmbedRequestId, type SubspaceEmbedRegion } from './embedsCore';

export type PublicSubspaceEmbed = { id: string; thingId: string; region: SubspaceEmbedRegion; order: number; thing: PublicThing | null };
const PAGE_SIZE = 20;
const REQUEST_KEY = 'subspaceEmbedRequest';
class EmbedError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const identifier = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;
const rowFilter = (subspaceId: string, embedId: string) => ({ thingtime: 'subspace-embed', targetId: subspaceId, shareId: embedId });
const referenceAllowed = isSubspaceEmbedSource;

// Only the exact live membership may authorize moderation or private reads.
// The transaction touches membership + subspace to serialize concurrent
// demotion/deletion and every reorder against the canonical writers.
const gate = async (things: any, id: string, viewer: Viewer, session?: any, write = false) => {
  const options = session ? { session } : {};
  const subspace = await things.findOne({ thingtime: 'subspace', shareId: id }, options);
  if (!subspace) throw new EmbedError(404, 'Subspace not found');
  if (subspace.subspaceMediaDeleting) throw new EmbedError(409, 'Subspace deletion is in progress');
  const member = viewer?.id ? await things.findOne({ thingtime: 'subspace-member', targetId: id, ownerId: viewer.id }, options) : null;
  const membership = member ? membershipOfDoc(member) : null;
  if (membership?.banned) throw new EmbedError(403, 'Subspace access denied');
  if (write && !canModerate(membership)) throw new EmbedError(403, 'Moderators only');
  if (!write && accessOf(subspace) === 'private' && !isActiveMember(membership)) throw new EmbedError(403, 'Private subspace — members only');
  if (write) {
    const now = new Date();
    await updateAccountedThing(things, { _id: member._id }, { $inc: { subspaceEmbedWriteFence: 1 }, $set: { updatedAt: now } }, options);
    await updateAccountedThing(things, { _id: subspace._id }, { $inc: { subspaceEmbedsRevision: 1 }, $set: { updatedAt: now } }, options);
  }
  return { subspace, canModerate: canModerate(membership) };
};
const project = async (rows: any[], viewer: Viewer): Promise<PublicSubspaceEmbed[]> => {
  // The canonical reference resolver coalesces source reads and inherited
  // dependency lookups by level while reauthorizing each source independently.
  // The subspace neither changes nor supplies its audience.
  const docs = await resolvePostLinkedThings(rows.map(row => row.crystal.thingId), await withFriendIds(viewer));
  const visible = docs.filter(referenceAllowed);
  const byId = new Map((await toPublicThings(visible as any, viewer)).map(thing => [thing.id, publicEmbedThing(thing)]));
  return rows.map(row => ({ id: String(row.shareId), thingId: String(row.crystal.thingId), region: row.crystal.region,
    order: row.crystal.order, thing: byId.get(row.crystal.thingId) || null }));
};
const handled = (error: unknown): Fail => {
  if (error instanceof EmbedError || error instanceof StorageMutationError) return fail(error.status, error.message);
  throw error;
};

export const listSubspaceEmbeds = async (viewerInput: Viewer | string, input: { id?: unknown; region?: unknown; cursor?: unknown }) => {
  const id = identifier(input.id);
  const region = subspaceEmbedRegion(input.region);
  if (!id || !region) return fail(400, 'Subspace id and sidebar or feed region required');
  const cursor = input.cursor ? decodeEmbedCursor(input.cursor) : null;
  if (input.cursor && !cursor) return fail(400, 'Invalid embed cursor');
  const viewer = asViewer(viewerInput);
  const things = await getThingsCollection();
  try {
    await gate(things, id, viewer);
    const query: Record<string, unknown> = { thingtime: 'subspace-embed', targetId: id, 'crystal.region': region,
      ...(cursor ? { $or: [{ 'crystal.order': { $gt: cursor.order } }, { 'crystal.order': cursor.order, shareId: { $gt: cursor.id } }] } : {}) };
    const rows = await things.find(query as any).sort({ 'crystal.order': 1, shareId: 1 }).limit(PAGE_SIZE + 1).toArray();
    const page = rows.slice(0, PAGE_SIZE);
    const embeds = await project(page, viewer);
    // Recheck the outer audience after resolving foreign references, so a
    // private-membership revocation cannot borrow the earlier gate.
    const currentPermission = await gate(things, id, viewer);
    return { ok: true as const, embeds, nextCursor: rows.length > PAGE_SIZE ? encodeEmbedCursor(page.at(-1) as any) : null, canModerate: currentPermission.canModerate };
  } catch (error) { return handled(error); }
};

export const mutateSubspaceEmbed = async (viewerInput: Viewer | string, input: {
  id?: unknown; operation?: unknown; region?: unknown; thingId?: unknown; requestId?: unknown; embedId?: unknown; direction?: unknown;
}) => {
  const viewer = asViewer(viewerInput);
  if (!viewer?.id) return fail(401, 'Unauthorized');
  const id = identifier(input.id);
  if (!id || !['add', 'remove', 'move'].includes(String(input.operation))) return fail(400, 'Subspace id and add, remove or move operation required');
  const region = subspaceEmbedRegion(input.region);
  const thingId = identifier(input.thingId);
  const embedId = identifier(input.embedId);
  if (input.operation === 'add' && (!region || !thingId || !validEmbedRequestId(input.requestId))) return fail(400, 'Add requires region, Thing id and UUID requestId');
  if (input.operation !== 'add' && !embedId) return fail(400, 'Embed id required');
  if (input.operation === 'move' && input.direction !== 'up' && input.direction !== 'down') return fail(400, 'Move direction must be up or down');
  const things = await getThingsCollection();
  let resultRow: any = null;
  let existing = false;
  try {
    // Serialize all region edits on the subspace row. Mongo retries write
    // conflicts with a fresh snapshot; no unbounded embedded order list.
    await withAccountedThingsTransaction(async session => {
      resultRow = null; existing = false;
      await gate(things, id, viewer, session, true);
      const options = { session };
      const now = new Date();
      const audit = async (action: string, detail: Record<string, unknown>, requestKey?: string) => things.insertOne({
        shareId: randomUUID(), schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, thingtime: ['subspace-modlog'],
        ownerId: viewer.id, targetId: id, acl: ['tt:user'], tags: [], extended: null,
        crystal: { action, postId: null, userId: null, reason: null, detail },
        ...(requestKey ? { uniqueKeys: [thingUniqueKey(REQUEST_KEY, requestKey)] } : {}), createdAt: now, updatedAt: now
      } as any, options);
      if (input.operation === 'add') {
        const requestKey = `${id}:${viewer.id}:${input.requestId}`;
        const previous = await things.findOne({ thingtime: 'subspace-modlog', targetId: id, ...thingUniqueKeyFilter(REQUEST_KEY, requestKey) } as any, options);
        if (previous) {
          if (previous.crystal?.detail?.thingId !== thingId || previous.crystal?.detail?.region !== region) throw new EmbedError(409, 'requestId already used for another embed');
          resultRow = await things.findOne(rowFilter(id, previous.crystal.detail.embedId), options);
          existing = true;
          return;
        }
        const source = await findViewableThing(thingId, viewer);
        if (!referenceAllowed(source)) throw new EmbedError(404, 'Thing is unavailable');
        const last = await things.find({ thingtime: 'subspace-embed', targetId: id, 'crystal.region': region } as any, options)
          .sort({ 'crystal.order': -1, shareId: -1 }).limit(1).next();
        const order = last ? Number(last.crystal.order) + 1 : 0;
        if (!Number.isSafeInteger(order)) throw new EmbedError(409, 'Embed order requires maintenance');
        resultRow = { shareId: randomUUID(), schemaVersion: COLLECTION_SCHEMA_VERSIONS.things, thingtime: ['subspace-embed'],
          ownerId: viewer.id, targetId: id, acl: ['tt:user'], tags: [], extended: null,
          crystal: { region, thingId, order }, createdAt: now, updatedAt: now };
        await insertAccountedThing(things, resultRow, options);
        await audit('embed.add', { embedId: resultRow.shareId, thingId, region }, requestKey);
        return;
      }
      const row = await things.findOne(rowFilter(id, embedId!), options);
      if (!row) {
        if (input.operation === 'remove') return;
        throw new EmbedError(404, 'Embed not found');
      }
      if (input.operation === 'remove') {
        await deleteAccountedThing(things, rowFilter(id, embedId!), options);
        await audit('embed.remove', { embedId, thingId: row.crystal.thingId, region: row.crystal.region });
        return;
      }
      const up = input.direction === 'up';
      const neighbor = await things.find({ thingtime: 'subspace-embed', targetId: id, 'crystal.region': row.crystal.region,
        'crystal.order': { [up ? '$lt' : '$gt']: row.crystal.order } } as any, options)
        .sort({ 'crystal.order': up ? -1 : 1, shareId: up ? -1 : 1 }).limit(1).next();
      if (!neighbor) return;
      await updateAccountedThing(things, rowFilter(id, row.shareId), { $set: { 'crystal.order': neighbor.crystal.order, updatedAt: now } }, options);
      await updateAccountedThing(things, rowFilter(id, neighbor.shareId), { $set: { 'crystal.order': row.crystal.order, updatedAt: now } }, options);
      await audit('embed.move', { embedId, region: row.crystal.region, direction: input.direction });
    });
    return input.operation === 'add'
      ? { ok: true as const, embed: resultRow ? (await project([resultRow], viewer))[0] : null, existing }
      : { ok: true as const };
  } catch (error) { return handled(error); }
};
