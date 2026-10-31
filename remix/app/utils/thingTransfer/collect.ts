import { transferChecksum, type TransferBundle } from './archive';
import { TRANSFER_FORMAT, TRANSFER_LIMITS, TransferFormatError, serializeTransfer, transferAnnotations, type TransferAnnotations, type TransferFile, type TransferThing } from './format';

export type TransferSourceFile = TransferAnnotations & { id: string; name: string; mime: string; data: Uint8Array };
/** Adapters MUST authorize each read using the current viewer and return a
 * content-only projection. Folder listing is never an authorization grant.
 * Composition adapters canonicalize aliases before returning dependencies.
 */
export type TransferSource = {
  read: (id: string, signal?: AbortSignal) => Promise<TransferThing>;
  children: (folderId: string, cursor: string | undefined, signal?: AbortSignal) => Promise<{ ids: string[]; cursor?: string | null }>;
  dependencies: (thing: TransferThing, signal?: AbortSignal) => Promise<string[]>;
  files: (thing: TransferThing, signal?: AbortSignal) => AsyncIterable<TransferSourceFile>;
};
export type CollectTransferOptions = {
  includeChildren?: boolean;
  includeDependencies?: boolean;
  includeFiles?: boolean;
  signal?: AbortSignal;
  progress?: (state: { things: number; files: number; bytes: number }) => void;
};
const fail = (message: string): never => { throw new TransferFormatError(message); };

/** Complete, bounded traversal: never exports only the first visible UI page. */
export const collectTransfer = async (roots: string[], source: TransferSource, options: CollectTransferOptions = {}): Promise<TransferBundle> => {
  const selected = [...new Set(roots)];
  if (!selected.length || selected.length > TRANSFER_LIMITS.things) fail('Choose between 1 and 1000 Things');
  const queue = [...selected];
  const queued = new Set(queue);
  const docs = new Map<string, TransferThing>();
  const files = new Map<string, Uint8Array>();
  const metadata: TransferFile[] = [];
  let bytes = 0;
  const check = () => options.signal?.throwIfAborted();
  const enqueue = (ids: string[]) => {
    for (const id of ids) {
      if (queued.has(id)) continue;
      if (queued.size >= TRANSFER_LIMITS.things) fail('This export exceeds the Thing limit; choose a smaller folder');
      queued.add(id); queue.push(id);
    }
  };
  for (let index = 0; index < queue.length; index++) {
    check();
    const id = queue[index];
    const doc = await source.read(id, options.signal);
    check();
    if (doc.id !== id) fail('A Thing read returned a different ID');
    // Detach caller-owned state. No rendering or arbitrary callbacks from
    // imported content are executed by this collector.
    const copy: TransferThing = structuredClone(doc);
    docs.set(id, copy);
    if (doc.targetId) enqueue([doc.targetId]);
    if (options.includeDependencies !== false) enqueue(await source.dependencies(doc, options.signal));
    if (doc.thingtime.includes('folder') && options.includeChildren !== false) {
      let cursor: string | undefined;
      const cursors = new Set<string>();
      for (let page = 0; ; page++) {
        check();
        if (page > TRANSFER_LIMITS.things) fail('Folder pagination did not finish');
        const result = await source.children(id, cursor, options.signal);
        enqueue(result.ids);
        if (!result.cursor) break;
        if (cursors.has(result.cursor)) fail('Folder pagination repeated a cursor');
        cursors.add(result.cursor); cursor = result.cursor;
      }
    }
    if (options.includeFiles !== false) for await (const file of source.files(doc, options.signal)) {
      check();
      if (files.has(file.id)) {
        // The same embedded media may appear in several Things, but it must
        // represent the same bytes throughout one portable snapshot.
        const existing = metadata.find((entry) => entry.id === file.id)!;
        if (existing.bytes !== file.data.byteLength || existing.sha256 !== await transferChecksum(file.data)) fail('A file changed during export');
        continue;
      }
      if (files.size >= TRANSFER_LIMITS.files || bytes + file.data.byteLength > TRANSFER_LIMITS.fileBytes) fail('This export exceeds the file limit');
      const data = Uint8Array.from(file.data);
      metadata.push({ id: file.id, name: file.name, mime: file.mime, targetId: doc.id, ...transferAnnotations(file),
        path: `files/${files.size.toString().padStart(6, '0')}`, bytes: data.byteLength, sha256: await transferChecksum(data) });
      files.set(file.id, data); bytes += data.byteLength;
    }
    options.progress?.({ things: docs.size, files: files.size, bytes });
  }
  check();
  // Exporting one Thing does not drag its entire containing library along.
  // Included parent folders keep their structure; external placement is not
  // part of the portable content and the import destination supplies it.
  for (const doc of docs.values()) if (doc.folderId && !docs.has(doc.folderId)) delete doc.folderId;
  const manifest = { format: TRANSFER_FORMAT, version: 1 as const, roots: selected, things: [...docs.values()], files: metadata };
  serializeTransfer(manifest);
  return { manifest, files };
};
