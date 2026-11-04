import { requireThingtimeCapability } from '~/api/utils/capabilities/requireCapability.client';
import { EXPECTED_ACTOR_HEADER } from '~/api/utils/auth/expectedActor';
import { FILESYSTEM_MAX_BYTES } from '~/api/utils/devices/deviceFilesystemCore';
import { MAX_ATTACHMENT_RANGE_BYTES, readExactRange } from '~/api/utils/attachments/attachmentRanges';
import { CLOUD_FILE_KIND, parseCloudFile, parseCloudFileCommit, type CloudFileCommit } from '~/fileSync/cloudFile';
import { FILE_SYNC_REQUIREMENTS } from '~/fileSync/configuration';
import { readOwnedFileSyncConfiguration } from '~/fileSync/configuredPlan';
import { EXPECTED_DATA_PLANE_HEADER } from '~/utils/dataPlane';
import { fileRequest } from './filesystemClient';
import { isFolder, type ThingsThing } from './thingsCore';

export const isCloudFilesystemFile = (item: ThingsThing) => item.thingtime.length === 1 && item.thingtime[0] === CLOUD_FILE_KIND;
export const isFilesystemItem = (item: ThingsThing) => isFolder(item) || !!item.inode ||
  item.thingtime.includes('attachment') || (isCloudFilesystemFile(item) && item.crystal.trashed === false);

const files = '/api/v1/files';
const content = '/api/v1/attachments/content';
const scopedHeaders = (ownerId: string) => ({ [EXPECTED_ACTOR_HEADER]: ownerId, [EXPECTED_DATA_PLANE_HEADER]: 'home' });

type SyncDestinationReads = {
  configurations(cursor?: string): Promise<{ things: unknown[]; nextCursor?: string }>;
  folder(id: string): Promise<ThingsThing | null>;
};

/** Scope this lookup to a single upload/paste operation. Configurations use
 * the kind-filtered listing, while ancestry uses exact authorized reads. */
export function createSyncDestinationLookup(ownerId: string, signal: AbortSignal, reads?: SyncDestinationReads) {
  const headers = { [EXPECTED_ACTOR_HEADER]: ownerId };
  const source: SyncDestinationReads = reads ?? {
    async configurations(cursor) {
      await requireThingtimeCapability('api.things', FILE_SYNC_REQUIREMENTS['api.things']);
      const query = new URLSearchParams({ thingtime: 'file-sync', limit: '100', ...(cursor ? { cursor } : {}) });
      return fileRequest('/api/v1/things?' + query, undefined, signal, undefined, headers);
    },
    async folder(id) {
      const { thing } = await fileRequest('/api/v1/things?' + new URLSearchParams({ id }), undefined, signal, undefined, headers);
      return thing ?? null;
    }
  };
  let roots: Promise<Set<string>> | undefined;
  const results = new Map<string, boolean>();
  const loadRoots = async () => {
    const result = new Set<string>();
    const seen = new Set<string>();
    let cursor: string | undefined;
    do {
      signal.throwIfAborted();
      const page = await source.configurations(cursor);
      for (const row of page.things) {
        try { result.add(readOwnedFileSyncConfiguration(row, ownerId).configuration.remoteFolderId); }
        catch { /* Ignore rows that are not a valid owned sync configuration. */ }
      }
      cursor = page.nextCursor || undefined;
      if (cursor && seen.has(cursor)) throw Error('Sync folder lookup did not advance. Refresh and try again.');
      if (cursor) seen.add(cursor);
    } while (cursor);
    return result;
  };
  return async (folderId: string) => {
    const syncRoots = await (roots ??= loadRoots());
    const visited = new Set<string>();
    let current: string | null = folderId;
    let synced = false;
    while (current) {
      signal.throwIfAborted();
      const previous = results.get(current);
      if (previous !== undefined) { synced = previous; break; }
      if (visited.has(current)) throw Error('Folder ancestry changed. Refresh and try again.');
      visited.add(current);
      const folder = await source.folder(current);
      if (!folder || folder.id !== current || !isFolder(folder) || folder.author?.id !== ownerId)
        throw Error('This folder is unavailable. Refresh or choose another folder.');
      if (syncRoots.has(current)) { synced = true; break; }
      current = syncRoots.size ? folder.folderId : null;
    }
    for (const id of visited) results.set(id, synced);
    return synced;
  };
}

export async function publishFilesystemUpload(ownerId: string, attachmentId: string, name: string, folderId: string, signal: AbortSignal) {
  const headers = scopedHeaders(ownerId);
  const proof = await fileRequest(content + '?' + new URLSearchParams({ id: attachmentId, fingerprint: '1' }), undefined, signal, undefined, headers);
  const command = parseCloudFileCommit({
    id: crypto.randomUUID(), operationId: crypto.randomUUID(), expectedRevision: null,
    name, folderId, attachmentId, contentVersion: proof.version, trashed: false
  });
  return commitFile(command, signal, headers);
}

async function commitFile(command: CloudFileCommit, signal: AbortSignal, headers: Record<string, string>) {
  try {
    return parseCloudFile((await fileRequest(files, command, signal, undefined, headers)).file);
  } catch (error) {
    if (!(error instanceof TypeError) && ![502, 503, 504].includes((error as { status?: number })?.status ?? 0)) throw error;
    const query = new URLSearchParams({ id: command.id, operationId: command.operationId });
    const result = await fileRequest(files + '?' + query, undefined, signal, undefined, headers);
    if (result.receipt?.file) return parseCloudFile(result.receipt.file);
    throw Error('Could not confirm publication. Refresh the folder before trying again.');
  }
}

async function currentFile(item: ThingsThing, signal: AbortSignal, headers: Record<string, string>) {
  await requireThingtimeCapability('api.files', '1.9.0');
  const file = parseCloudFile((await fileRequest(files + '?' + new URLSearchParams({ id: item.id }), undefined, signal, undefined, headers)).file);
  const revision = item.timelineHeadId;
  if (file.id !== item.id || !revision || file.revision !== revision || file.trashed) throw Error('File changed. Refresh the folder and select it again.');
  return file;
}

export async function relocateCloudFilesystemFile(item: ThingsThing, ownerId: string, folderId: string | null, trashed: boolean, signal: AbortSignal) {
  const headers = scopedHeaders(ownerId);
  const file = await currentFile(item, signal, headers);
  const command = parseCloudFileCommit({
    id: file.id, operationId: crypto.randomUUID(), expectedRevision: file.revision, name: file.name,
    folderId, attachmentId: file.content.attachmentId, contentVersion: file.content.version, trashed,
    ...(file.symbolicLink ? { symbolicLink: file.symbolicLink } : {})
  });
  return commitFile(command, signal, headers);
}

/** The browser's downloader streams the authorized object version to disk.
 * Resolve the selected file revision before handing off the bound attachment. */
export async function cloudFilesystemDownloadHref(item: ThingsThing, ownerId: string, signal: AbortSignal) {
  const file = await currentFile(item, signal, scopedHeaders(ownerId));
  if (file.symbolicLink) throw Error('Symbolic links cannot be downloaded as ordinary files.');
  signal.throwIfAborted();
  return content + '?' + new URLSearchParams({ id: file.content.attachmentId, download: '1' });
}

export async function readCloudFilesystemFile(item: ThingsThing, ownerId: string, signal: AbortSignal) {
  const headers = scopedHeaders(ownerId);
  const file = await currentFile(item, signal, headers);
  if (file.symbolicLink) throw Error('Symbolic links cannot be copied as ordinary files.');
  if (file.content.size > FILESYSTEM_MAX_BYTES) throw Error('Use Download for this file. The clipboard transfer requires a smaller file.');
  await requireThingtimeCapability('api.attachment-content', '1.14.0');
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  for (let offset = 0; offset < file.content.size; offset += MAX_ATTACHMENT_RANGE_BYTES) {
    const length = Math.min(MAX_ATTACHMENT_RANGE_BYTES, file.content.size - offset);
    const range = { version: file.content.version, offset, length };
    const query = new URLSearchParams({ id: file.content.attachmentId, range: '1', version: range.version, offset: String(offset), length: String(length) });
    const response = await fetch(content + '?' + query, { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal, headers });
    if (!response.ok || response.headers.get('ETag') !== '"' + range.version + '"') {
      await response.body?.cancel().catch(() => {});
      throw Error('File bytes changed or are unavailable. Refresh the folder to retry.');
    }
    chunks.push(await readExactRange(response, range, file.content.size, () => signal.throwIfAborted()));
  }
  await currentFile(item, signal, headers);
  return new File(chunks, file.name);
}
