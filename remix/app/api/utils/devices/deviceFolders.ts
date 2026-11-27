import { readOwnedSyncFolder } from '../../../fileSync/configurationEditor';
import { cloudFolderPaths } from '../../../fileSync/folderPaths';
import { getHomeThingsCollection } from '../mongodb/collections';
import { mongoDataPlane } from '../mongodb/dataPlane';
import { createThing, getThing, parseChronoCursor, chronoCursorClause } from '../things/things';
import { DeviceFolderError, deviceFolderIdentity, resolveDeviceFolders, type DeviceFolderRequest } from '../../../fileSync/deviceFolders';

class CanonicalFolderFailure extends Error { constructor(message: string, public status: number) { super(message); } }

/** Dedicated device authorization; all folder reads/writes use ordinary Things
 * ACLs, placement validation, accounting and transactional uniqueness. */
export async function ensureDeviceFolders(ownerId: string, origin: string, input: unknown, signal?: AbortSignal) {
 const request = input as DeviceFolderRequest;
 if (!request || typeof request !== 'object' || typeof request.deviceId !== 'string' ||
  Object.keys(request).some(key => !['deviceId', 'connectionId', 'name'].includes(key)) ||
  (request.connectionId === undefined && request.name !== undefined) ||
  (request.connectionId !== undefined && (typeof request.connectionId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(request.connectionId) || typeof request.name !== 'string' || !request.name.trim())))
  return { ok: false as const, status: 400, error: 'Invalid device folder request' };
 const home = await getHomeThingsCollection();
 const device = await home.findOne({ shareId: request.deviceId, ownerId, thingtime: 'device' } as any);
 if (!device) return { ok: false as const, status: 404, error: 'Device not found' };
 const scope = { origin, ownerId, dataPlane: mongoDataPlane(), deviceId: request.deviceId };
 try {
  const result = await resolveDeviceFolders(scope, String(device.crystal?.name || 'Device'), request, {
   assertCurrent() { signal?.throwIfAborted(); },
   async get(id) {
    const read = await getThing({ id: ownerId }, id);
    if (read.ok === false) throw new CanonicalFolderFailure(read.error, read.status);
    return read.thing;
   },
   async create(input) {
    const created = await createThing(ownerId, input, { id: ownerId });
    if (created.ok === false) throw new CanonicalFolderFailure(created.error, created.status);
   }
  });
  const read = await getThing({ id: ownerId }, result.folder.id);
  if (read.ok === false) return read;
  const paths = await cloudFolderPaths([read.thing], ownerId, async id => {
   const ancestor = await getThing({ id: ownerId }, id);
   if (ancestor.ok === false) throw Object.assign(Error('The folder path is unavailable'), { status: ancestor.status });
   return ancestor.thing;
  }, () => signal?.throwIfAborted());
  if (!paths.length) return { ok: false as const, status: 409, error: 'The folder path changed. Choose a destination explicitly.' };
  return { ok: true as const, ...result, folder: paths[0] };
 } catch (cause) {
  const known = cause instanceof DeviceFolderError || cause instanceof CanonicalFolderFailure;
  return { ok: false as const, status: known ? cause.status : 503,
   error: known ? cause.message : 'Device folders are unavailable. Please retry.' };
 }
}

export async function readDeviceFolderReference(ownerId: string, origin: string, deviceId: string) {
 const home = await getHomeThingsCollection();
 const device = await home.findOne({ shareId: deviceId, ownerId, thingtime: 'device' } as any);
 if (!device) return { ok: false as const, status: 404, error: 'Device not found' };
 const rootFolderId = await deviceFolderIdentity({ origin, ownerId, deviceId, dataPlane: mongoDataPlane() }, 'root');
 const read = await getThing({ id: ownerId }, rootFolderId);
 if (read.ok === false && read.status !== 404) return read;
 if (read.ok) {
  try {
   const folder = readOwnedSyncFolder(read.thing, ownerId), row = read.thing as any;
   if (folder.id !== rootFolderId || row.thingtime.length !== 1 || row.appId != null || row.crystal?.metadata?.deviceId !== deviceId || row.crystal?.metadata?.deviceFolderRole !== 'root') throw Error();
  } catch { return { ok: false as const, status: 409, error: 'The device folder reference was replaced. Choose a destination explicitly.' }; }
 }
 const paths = read.ok ? await cloudFolderPaths([read.thing], ownerId, async id => { const parent = await getThing({ id: ownerId }, id); if (parent.ok === false) throw new CanonicalFolderFailure(parent.error, parent.status); return parent.thing; }) : [];
 return { ok: true as const, rootFolderId, path: paths[0]?.path, deviceName: String(device.crystal?.name || 'Device'), folder: read.ok ? read.thing : null };
}

export async function listDeviceFolderReferences(ownerId: string, origin: string, cursor?: string | null) {
 const parsed = parseChronoCursor(cursor);
 if (cursor && !parsed) return { ok: false as const, status: 400, error: 'Invalid device folder cursor' };
 const home = await getHomeThingsCollection();
 const pageSize = 50;
 // Reuse the shared (thingtime, ownerId, createdAt, shareId) index and cursor.
 const rows = await home.find({ ownerId, thingtime: 'device', ...(parsed ? chronoCursorClause(parsed) : {}) } as any,
  { projection: { shareId: 1, createdAt: 1, 'crystal.name': 1 } }).sort({ createdAt: -1, shareId: 1 }).limit(pageSize + 1).toArray();
 const devices = rows.slice(0, pageSize), last = devices.at(-1), dataPlane = mongoDataPlane();
 return { ok: true as const, devices: await Promise.all(devices.map(async device => ({ deviceId: String(device.shareId), name: String(device.crystal?.name || 'Device'), rootFolderId: await deviceFolderIdentity({ origin, ownerId, deviceId: String(device.shareId), dataPlane }, 'root') }))),
  nextCursor: rows.length > pageSize && last ? `${new Date(last.createdAt).getTime()}_${last.shareId}` : null };
}
