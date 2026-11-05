/** A share is one durable operation. Identity is scoped to account + origin by
 * the caller; retries reuse these ids and the original destination. */
export type ShareSavePlan = {
  version: 1;
  shareId: string;
  folderId: string | null;
  text: string;
  files: Array<{ path: string; size: number; type: string; id: string; operationId: string }>;
  folders: Array<{ path: string; id: string }>;
  noteId: string;
};
export const shareFilePath = (file: Pick<File, 'name' | 'webkitRelativePath'>): string => file.webkitRelativePath || file.name;
export function sharePathParts(path: string): string[] {
  const parts = path.split('/');
  if (!path || parts.some(part => !part || part === '.' || part === '..' || /[\0\\]/.test(part))) throw Error('A shared item has an invalid path.');
  return parts;
}
export function makeShareSavePlan(shareId: string, folderId: string | null, text: string, files: File[], directories: string[] = [], id: () => string = () => crypto.randomUUID()): ShareSavePlan {
  const folders = new Set<string>();
  const addParents = (parts: string[]) => { for (let i = 1; i <= parts.length; i++) folders.add(parts.slice(0, i).join('/')); };
  for (const directory of directories) addParents(sharePathParts(directory));
  const entries = files.map(file => {
    const path = shareFilePath(file), parts = sharePathParts(path);
    addParents(parts.slice(0, -1));
    return { path, size: file.size, type: file.type, id: id(), operationId: id() };
  });
  return { version: 1, shareId, folderId, text, noteId: id(), files: entries,
    folders: [...folders].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)).map(path => ({ path, id: id() })) };
}
export function validateShareSavePlan(plan: ShareSavePlan, shareId: string, files: File[], text: string, directories?: string[]) {
  if (plan.version !== 1 || plan.shareId !== shareId || plan.text !== text || plan.files.length !== files.length || plan.files.some((entry, i) => entry.path !== shareFilePath(files[i]) || entry.size !== files[i].size || entry.type !== files[i].type))
    throw Error('This share has an unfinished save with different content. Reopen the original share to finish it.');
  if (directories && JSON.stringify(plan.folders.map(folder => folder.path)) !== JSON.stringify(makeShareSavePlan(shareId, plan.folderId, text, files, directories, () => 'validation').folders.map(folder => folder.path))) throw Error('The shared directory list changed.');
  return plan;
}
export function shareParentId(plan: ShareSavePlan, path: string) {
  const parts = sharePathParts(path); parts.pop();
  if (!parts.length) return plan.folderId;
  const parent = plan.folders.find(folder => folder.path === parts.join('/'));
  if (!parent) throw Error('The shared folder hierarchy is incomplete.');
  return parent.id;
}
export const shareTextCrystal = (text: string) => ({
  name: 'Shared text', text,
  renderComponent: { name: 'Thing presentation', library: 'custom', category: 'general', render: { tag: 'article', props: { style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }, children: [
    { tag: 'h1', children: '{name}' }, { tag: 'p', children: '{text}' }
  ] } }
});

/** Recovery must reuse immutable publish commands before admitting upload work.
 * A command exists only after its exact ready bytes were journaled. */
export function shareFilesNeedingUpload(plan: ShareSavePlan | null, files: File[], commands: ReadonlyMap<string, { id: string; operationId: string }>): File[] {
  return files.filter((_, index) => {
    const item = plan?.files[index];
    if (!item) return true;
    const command = commands.get(item.id);
    if (!command) return true;
    if (command.id !== item.id || command.operationId !== item.operationId) throw Error('The saved upload command does not match this share.');
    return false;
  });
}

const stableUuid = async (namespace: readonly string[], role: string, path: string, index: number): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(['thingtime-share-save-v1', ...namespace, role, path, index]))));
  // The file API deliberately accepts RFC4122 v4-shaped opaque operation IDs.
  digest[6] = (digest[6] & 0x0f) | 0x40; digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = Array.from(digest.slice(0, 16), byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
/** Stable across separate host web stores. Destination is deliberately excluded:
 * reopening with another destination conflicts with the original saved items. */
export async function makeStableShareSavePlan(origin: string, ownerId: string, shareId: string, folderId: string | null, text: string, files: File[], directories: string[] = []): Promise<ShareSavePlan> {
  const plan = makeShareSavePlan(shareId, folderId, text, files, directories);
  const namespace = [origin, ownerId, shareId];
  plan.noteId = await stableUuid(namespace, 'text', '', 0);
  plan.files = await Promise.all(plan.files.map(async (entry, index) => ({ ...entry, id: await stableUuid(namespace, 'file', entry.path, index), operationId: await stableUuid(namespace, 'file-operation', entry.path, index) })));
  plan.folders = await Promise.all(plan.folders.map(async (entry) => ({ ...entry, id: await stableUuid(namespace, 'folder', entry.path, 0) })));
  return plan;
}
