import type { ConfigurationEditorScope } from './configurationEditor';
import { readOwnedSyncFolder } from './configurationEditor';

export class DeviceFolderError extends Error { constructor(message: string, public status = 409) { super(message); } }
export const DEVICE_FOLDERS_REQUIREMENTS = { 'api.devices-folders': '1.0.0' } as const;
export type DeviceFolder = { id: string; name: string; path: string };
export type DeviceFolderRequest = { deviceId: string; connectionId?: string; name?: string };
export type DeviceFolderTransport = {
 get(id: string): Promise<unknown>;
 create(input: { shareId: string; thingtime: ['folder']; crystal: { name: string; metadata: Record<string, string> }; folderId: string | null; acl: ['tt:user'] }): Promise<unknown>;
 assertCurrent(): void;
};
export async function deviceFolderIdentity(scope: ConfigurationEditorScope, role: string): Promise<string> {
 const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([
  'thingtime-device-folder-v1', scope.origin, scope.ownerId, scope.dataPlane, scope.deviceId, role
 ])))).slice(0, 16);
 bytes[6] = (bytes[6] & 15) | 0x50; bytes[8] = (bytes[8] & 63) | 0x80;
 const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
const validName = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
/** Ordinary folders, stable identities and exact readback. No moves, overwrites,
 * name-based matching or native grants; partial writes resume at the same IDs. */
export async function resolveDeviceFolders(scope: ConfigurationEditorScope, deviceName: string, request: DeviceFolderRequest, api: DeviceFolderTransport) {
 if (request.deviceId !== scope.deviceId || !validName(deviceName) ||
  (request.connectionId !== undefined && (typeof request.connectionId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(request.connectionId) || !validName(request.name))))
  throw new DeviceFolderError('The device folder request is invalid.', 400);
 const ensure = async (role: string, name: string, parentId: string | null) => {
  const id = await deviceFolderIdentity(scope, role);
  const read = async () => {
   api.assertCurrent();
   let row: any;
   try { row = await api.get(id); } catch (cause) {
    api.assertCurrent();
    if ((cause as { status?: number })?.status === 404) return null;
    throw cause;
   }
   api.assertCurrent();
   let folder: ReturnType<typeof readOwnedSyncFolder>;
   try { folder = readOwnedSyncFolder(row, scope.ownerId); } catch { throw new DeviceFolderError('Choose a private cloud folder owned by this account.'); }
   const metadata = row.crystal?.metadata;
   if (folder.id !== id || row.appId != null || row.thingtime.length !== 1 ||
    metadata?.deviceFolderRole !== role || metadata?.deviceId !== scope.deviceId ||
    (role !== 'root' && (row.folderId ?? null) !== parentId))
    throw new DeviceFolderError('This device folder was moved or replaced. Choose its destination explicitly.');
   return folder;
  };
  let folder = await read();
  if (!folder) {
   let failure: unknown;
   api.assertCurrent();
   try { await api.create({ shareId: id, thingtime: ['folder'], crystal: { name, metadata: { deviceFolderRole: role, deviceId: scope.deviceId } }, folderId: parentId, acl: ['tt:user'] }); }
   catch (cause) { failure = cause; }
   folder = await read();
   if (!folder) throw failure ?? Error('Folder creation is unconfirmed. Retry to check the same folder.');
  }
  return folder;
 };
 const root = await ensure('root', deviceName, null);
 if (!request.connectionId) return { rootFolderId: root.id, folder: { ...root, path: root.name } };
 const files = await ensure('files', 'Files', root.id);
 const folder = await ensure(`connection:${request.connectionId}`, request.name!, files.id);
 return { rootFolderId: root.id, folder: { ...folder, path: [root.name, files.name, folder.name].join(' / ') } };
}
