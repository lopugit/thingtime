import { FILESYSTEM_MAX_BYTES } from '~/api/utils/devices/deviceFilesystemCore';
import { isFolder, thingDisplayName, type ThingsThing } from './thingsCore';
import type { FileClipboard, FileLocation } from './filesystemClient';

export type FilesystemTransferPort = {
  list(location: FileLocation): Promise<ThingsThing[]>;
  mkdir(location: FileLocation, name: string): Promise<FileLocation>;
  read(item: ThingsThing): Promise<File>;
  write(location: FileLocation, file: File): Promise<void>;
  remove(item: ThingsThing): Promise<void>;
  nativeMove?(items: ThingsThing[], destination: FileLocation): Promise<void>;
  check(): void;
};
export const itemLocation = (item: ThingsThing): FileLocation => item.inode
  ? { deviceId: item.inode.deviceId, path: item.inode.path } : { folderId: item.id, label: filesystemName(item) };
export const filesystemName = (item: ThingsThing) => item.inode?.name || String(item.crystal.name || thingDisplayName(item));
const identity = (item: ThingsThing) => `${item.id}:${item.inode?.version || item.updatedAt}`;
type Planned = { item: ThingsThing; children?: Planned[] };

/** Preflight the complete bounded tree before writing. A move removes its
 * sources only after every destination write succeeds and the tree still
 * matches the preflight. A failed copy is explicit and leaves sources intact. */
export const transferFilesystem = async (clipboard: FileClipboard, destination: FileLocation, port: FilesystemTransferPort) => {
  if (!clipboard.items.length) return;
  if (clipboard.mode === 'cut' && port.nativeMove && clipboard.location.deviceId === destination.deviceId) {
    await port.nativeMove(clipboard.items, destination); return;
  }
  let count = 0, bytes = 0;
  const visited = new Set<string>();
  const plan = async (items: ThingsThing[], depth = 0): Promise<Planned[]> => {
    if (depth > 32) throw new Error('This folder is too deeply nested (maximum 32 levels).');
    const names = new Set<string>();
    const result: Planned[] = [];
    for (const item of items) {
      port.check();
      if (++count > 500 || visited.has(item.id)) throw new Error('Choose up to 500 files and folders without repeated or nested selections.');
      visited.add(item.id);
      const name = filesystemName(item);
      if (!name || /[\/\\\p{Cc}\p{Cf}]/u.test(name) || name === '.' || name === '..') throw new Error('A source has an unsupported filename.');
      if (names.has(name.normalize('NFC').toLowerCase())) throw new Error(`Duplicate filename: ${name}. Rename it before transferring.`);
      names.add(name.normalize('NFC').toLowerCase());
      if (isFolder(item)) {
        if (destination.deviceId && item.inode?.deviceId === destination.deviceId && (destination.path === item.inode.path || destination.path.startsWith(item.inode.path + '/'))) throw new Error('A folder cannot be pasted into itself.');
        result.push({ item, children: await plan(await port.list(itemLocation(item)), depth + 1) });
      } else {
        if (item.inode && item.inode.type !== 'file') throw new Error('Links and special files cannot be transferred.');
        if (!item.inode && !item.thingtime.includes('attachment')) throw new Error('This folder contains other Things. Use the main Things copy action to preserve them.');
        const size = item.inode?.size ?? Number(item.crystal.size);
        if (!Number.isSafeInteger(size) || size < 0 || size > FILESYSTEM_MAX_BYTES || (bytes += size) > 128 * 1024 * 1024) throw new Error('Choose files up to 32 MiB each and 128 MiB total.');
        result.push({ item });
      }
    }
    return result;
  };
  const tree = await plan(clipboard.items);
  if (!destination.deviceId && destination.folderId && visited.has(destination.folderId)) throw new Error('A folder cannot be pasted into itself.');
  const copy = async (nodes: Planned[], target: FileLocation) => {
    const existing = new Set((await port.list(target)).map(item => filesystemName(item).normalize('NFC').toLowerCase()));
    for (const node of nodes) {
      port.check();
      const name = filesystemName(node.item);
      if (existing.has(name.normalize('NFC').toLowerCase())) throw new Error(`${name} already exists. Rename it or choose another folder; existing files were kept.`);
      if (node.children) await copy(node.children, await port.mkdir(target, name));
      else await port.write(target, await port.read(node.item));
      existing.add(name.normalize('NFC').toLowerCase());
    }
  };
  await copy(tree, destination);
  if (clipboard.mode !== 'cut') return;
  const verify = async (nodes: Planned[], location: FileLocation, exact: boolean) => {
    port.check();
    const current = await port.list(location);
    if ((exact && current.length !== nodes.length) || nodes.some(node => !current.some(item => identity(item) === identity(node.item)))) throw new Error('The source changed during the transfer. Copies are saved; all source items were kept.');
    for (const node of nodes) if (node.children) await verify(node.children, itemLocation(node.item), true);
  };
  await verify(tree, clipboard.location, false);
  const remove = async (nodes: Planned[]) => {
    for (const node of nodes) {
      port.check();
      // Remote folders move atomically to recoverable Trash. Cloud folders use
      // each child's canonical writer, never an unscoped recursive delete.
      if (node.children && !node.item.inode) await remove(node.children);
      await port.remove(node.item);
    }
  };
  await remove(tree);
};
