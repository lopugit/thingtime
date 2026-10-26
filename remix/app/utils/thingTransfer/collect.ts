import { binarySize, type TransferBinary } from './binary';
import { transferChecksum, type TransferBundle } from './archive';
import { TRANSFER_FORMAT, TRANSFER_LIMITS, TransferFormatError, serializeTransfer, transferFileByteLimit, transferAnnotations, type TransferAnnotations, type TransferFile, type TransferThing } from './format';

export type TransferSourceFile<T extends TransferBinary = Uint8Array> = TransferAnnotations & { id: string; name: string; mime: string; data: T };
/** Adapters MUST authorize each read using the current viewer and return a
 * content-only projection. Folder listing is never an authorization grant.
 * Composition adapters canonicalize aliases before returning dependencies.
 */
export type TransferSource<T extends TransferBinary = Uint8Array> = {
  read: (id: string, signal?: AbortSignal) => Promise<TransferThing>;
  children: (folderId: string, cursor: string | undefined, signal?: AbortSignal) => Promise<{ ids: string[]; cursor?: string | null }>;
  dependencies: (thing: TransferThing, signal?: AbortSignal) => Promise<string[]>;
  files: (thing: TransferThing, signal?: AbortSignal) => AsyncIterable<TransferSourceFile<T>>;
};
export type CollectTransferOptions = {
  includeChildren?: boolean;
  includeDependencies?: boolean;
  includeFiles?: boolean;
  includeLinks?: boolean;
  signal?: AbortSignal;
  /** Optional budget for buffered or otherwise constrained consumers. */
  maxFileBytes?: number;
  progress?: (state: { things: number; files: number; bytes: number }) => void;
};
const fail = (message: string): never => { throw new TransferFormatError(message); };

/** Complete, bounded traversal: never exports only the first visible UI page. */
export const collectTransfer = async <T extends TransferBinary = Uint8Array>(roots: string[], source: TransferSource<T>, options: CollectTransferOptions = {}): Promise<TransferBundle<T>> => {
  const selected = [...new Set(roots)];
  if (!selected.length || selected.length > TRANSFER_LIMITS.things) fail('Choose between 1 and 1000 Things');
  const queue = [...selected];
  const queued = new Set(queue);
  const docs = new Map<string, TransferThing>();
  const files = new Map<string, T>();
  const metadata: TransferFile[] = [];
  let bytes = 0, bufferedBytes = 0;
  const byteLimit = transferFileByteLimit(options);
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
    if (copy.targetId) enqueue([copy.targetId]);
    if (options.includeDependencies !== false) enqueue(await source.dependencies(copy, options.signal));
    if (copy.thingtime.includes('folder') && options.includeChildren !== false) {
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
    if (options.includeFiles !== false) for await (const file of source.files(copy, options.signal)) {
      check();
      if (files.has(file.id)) {
        // The same embedded media may appear in several Things, but it must
        // represent the same bytes throughout one portable snapshot.
        const existing = metadata.find((entry) => entry.id === file.id)!;
        if (existing.bytes !== binarySize(file.data) || existing.sha256 !== await transferChecksum(file.data, options.signal)) fail('A file changed during export');
        continue;
      }
      const length = binarySize(file.data);
      if (!Number.isSafeInteger(length) || length < 0 || length > Number.MAX_SAFE_INTEGER - bytes) fail('Invalid export file size');
      if (files.size >= TRANSFER_LIMITS.files) fail('This export exceeds the file limit');
      if (length > byteLimit - bytes) fail('This export exceeds the consumer byte budget');
      if (!(file.data instanceof Blob)) {
        if (length > TRANSFER_LIMITS.fileBytes - bufferedBytes) fail('This export exceeds the buffered byte budget');
        bufferedBytes += length;
      }
      const data = (file.data instanceof Blob ? file.data : Uint8Array.from(file.data)) as T;
      const entry = { id: file.id, name: file.name, mime: file.mime, targetId: copy.id, ...transferAnnotations(file),
        path: `files/${files.size.toString().padStart(6, '0')}`, bytes: binarySize(data), sha256: '' };
      entry.sha256 = await transferChecksum(data, options.signal);
      metadata.push(entry); files.set(entry.id, data); bytes += entry.bytes;
    }
    options.progress?.({ things: docs.size, files: files.size, bytes });
  }
  check();
  // Exporting one Thing does not drag its entire containing library along.
  // Included parent folders keep their structure; external placement is not
  // part of the portable content and the import destination supplies it.
  for (const doc of docs.values()) if (doc.folderId && !docs.has(doc.folderId)) delete doc.folderId;
  const manifest = { format: TRANSFER_FORMAT, version: 1 as const, roots: selected, things: [...docs.values()], files: metadata };
  serializeTransfer(manifest, options);
  return { manifest, files };
};
