import { isProtectedThingtime, MESSENGER_THINGTIME, SUBSPACE_THINGTIME } from '../../../schemas/registry';
import type { PublicThing } from '../things/things';

export const isSubspaceEmbedSource = (doc: { thingtime?: unknown; appId?: unknown } | null | undefined): boolean =>
  !!doc && !doc.appId && Array.isArray(doc.thingtime) && doc.thingtime.every(kind => typeof kind === 'string') &&
  !isProtectedThingtime(doc.thingtime) && !doc.thingtime.some((kind: string) =>
    (MESSENGER_THINGTIME as readonly string[]).includes(kind) || (SUBSPACE_THINGTIME as readonly string[]).includes(kind));

export type SubspaceEmbedRegion = 'sidebar' | 'feed';
export type SubspaceEmbedCursor = { order: number; id: string };
export const subspaceEmbedRegion = (value: unknown): SubspaceEmbedRegion | null => value === 'sidebar' || value === 'feed' ? value : null;
export const validEmbedRequestId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export const encodeEmbedCursor = (row: { shareId: string; crystal: { order: number } }): string =>
  Buffer.from(JSON.stringify({ order: row.crystal.order, id: row.shareId })).toString('base64url');
export const decodeEmbedCursor = (value: unknown): SubspaceEmbedCursor | null => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,1024}$/.test(value)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    return Number.isSafeInteger(parsed?.order) && typeof parsed?.id === 'string' && /^[0-9a-f-]{36}$/i.test(parsed.id)
      ? { order: parsed.order, id: parsed.id } : null;
  } catch { return null; }
};

// Even the source owner must not publish management capabilities by embedding
// their Thing. Authored source data is projected only after its live ACL gate;
// the management-only link key, token grants, inherited audience and timeline
// head never leave this boundary.
export const publicEmbedThing = (thing: PublicThing): PublicThing => ({
  id: thing.id,
  thingtime: thing.thingtime,
  author: thing.author,
  visibility: thing.visibility,
  acl: thing.acl,
  targetId: thing.targetId,
  folderId: thing.folderId,
  crystal: thing.crystal,
  extended: thing.extended,
  geo: thing.geo,
  tags: thing.tags,
  createdAt: thing.createdAt,
  updatedAt: thing.updatedAt
});
