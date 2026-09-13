import { getHomeThingsCollection } from '../mongodb/collections';
import { isCustomMongoEndpointActive } from '../mongodb/endpoint';
import { removeTransferChatArchive } from './chatArchiveDeleteTransfer';

const defaults = {
  collection: getHomeThingsCollection, custom: isCustomMongoEndpointActive,
  remove: (ownerId: string, rootId: string, expectedUpdatedAt: unknown) =>
    removeTransferChatArchive(ownerId, rootId, undefined, expectedUpdatedAt)
};

/** Narrow adapter for DELETE /things. Null leaves ordinary CRUD unchanged.
 * Authenticate the actor at the route, never infer authority from a username,
 * archive payload, owner claim in the request, or an app/PAT viewer ID.
 */
export const deleteOwnedChatArchive = async (input: {
  actorKind: string; accountKind: string; ownerId: string; sameOrigin: boolean;
  id: unknown; expectedUpdatedAt?: unknown;
}, deps = defaults): Promise<null | { ok: true } | { ok: false; status: number; error: string }> => {
  if (input.actorKind !== 'user' || input.accountKind !== 'user' || !input.sameOrigin || deps.custom()) return null;
  if (typeof input.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.id) || !input.ownerId) return null;
  try {
    const things = await deps.collection();
    const root = await things.findOne({ shareId: input.id, ownerId: input.ownerId,
      archiveRootId: input.id, archiveVersion: 1, thingtime: ['chat-archive'] } as any,
    { projection: { shareId: 1, appId: 1, sandbox: 1, sandboxSpace: 1 } });
    if (!root || root.appId != null || root.sandbox != null || root.sandboxSpace != null) return null;
    await deps.remove(input.ownerId, input.id, input.expectedUpdatedAt);
    return { ok: true };
  } catch (error) {
    // No storage paths, provider errors, account data or raw stack in responses.
    const status = (error as any)?.status;
    if (status === 400) return { ok: false, status, error: 'Invalid archive deletion request' };
    if (status === 409) return { ok: false, status, error: 'Archive changed or still has children; refresh before retrying deletion' };
    return { ok: false, status: 503, error: 'Archive cleanup is incomplete; retry deletion to finish' };
  }
};
