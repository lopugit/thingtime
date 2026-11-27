import { getElectronBridge, selectedDesktopApiOrigin } from '../utils/electronBridge';
import { rootIdentity } from '../utils/rootIdentity';

type FolderScope = { expectedActor: string; expectedDataPlane: string; expectedApiOrigin: string };
type FolderReference = { rootFolderId: string; folder?: unknown };
type FolderRequests = {
 inspect(deviceId: string, options: FolderScope): Promise<FolderReference>;
 resolve(body: { deviceId: string }, options: FolderScope): Promise<FolderReference>;
};

/** The desktop renderer and selected account API may have separate origins. */
export async function openDeviceCloudFolder(input: {
 deviceId: string;
 ownerId: string;
 dataPlane: string;
 requests: FolderRequests;
 isCurrent(): boolean;
 navigate(path: string): void;
}) {
 const rendererOrigin = window.location.origin;
 const bridge = getElectronBridge();
 const { generation } = rootIdentity.read();
 const check = () => {
  const identity = rootIdentity.read();
  if (!input.isCurrent() || identity.pending || identity.generation !== generation || window.location.origin !== rendererOrigin)
   throw Error('The active account changed.');
  if (getElectronBridge() !== bridge) throw Error('The selected sync server changed.');
 };
 const readApiOrigin = async () => {
  check();
  if (!bridge) return rendererOrigin;
  const info = await bridge.getInfo?.();
  check();
  const origin = info && selectedDesktopApiOrigin(rendererOrigin, info);
  if (!origin) throw Error('The selected sync server could not be verified.');
  return origin;
 };
 const expectedApiOrigin = await readApiOrigin();
 const verifyApiOrigin = async () => {
  if (await readApiOrigin() !== expectedApiOrigin) throw Error('The selected sync server changed.');
  check();
 };
 const options = { expectedActor: input.ownerId, expectedDataPlane: input.dataPlane, expectedApiOrigin };
 check();
 const reference = await input.requests.inspect(input.deviceId, options);
 await verifyApiOrigin();
 check();
 const result = reference.folder ? reference : await input.requests.resolve({ deviceId: input.deviceId }, options);
 if (!reference.folder) await verifyApiOrigin();
 check();
 input.navigate(`/things?${new URLSearchParams({ folder: result.rootFolderId })}`);
}
