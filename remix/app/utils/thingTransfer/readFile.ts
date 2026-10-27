import { decodeTransferArchiveBlob, type TransferArchiveOptions, type TransferBundle } from './archive';
import { parseTransfer, TRANSFER_LIMITS, TransferFormatError } from './format';

/** Detect ZIP by its bytes, not a user-controlled MIME type or extension. */
export const readTransferFile = async (file: Blob, signal?: AbortSignal, options: TransferArchiveOptions = {}): Promise<TransferBundle<Blob>> => {
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(file.size) || file.size < 0) throw new TransferFormatError('Invalid transfer file size');
  if (options.maxArchiveBytes !== undefined && (!Number.isSafeInteger(options.maxArchiveBytes) || options.maxArchiveBytes < 0 || file.size > options.maxArchiveBytes)) throw new TransferFormatError('Transfer file exceeds the consumer byte budget');
  const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  signal?.throwIfAborted();
  if (header[0] === 0x50 && header[1] === 0x4b && header[2] === 3 && header[3] === 4) {
    return decodeTransferArchiveBlob(file, signal, options);
  }
  if (file.size > TRANSFER_LIMITS.manifestBytes) throw new TransferFormatError('Transfer manifest is too large');
  const text = await file.text();
  signal?.throwIfAborted();
  const manifest = parseTransfer(text, options);
  if (manifest.files.length) throw new TransferFormatError('This manifest needs its files. Choose the complete Thingtime ZIP instead.');
  return { manifest, files: new Map() };
};

/** Keep archives independent: identical portable IDs in different files must
 * never join unrelated conversations, folders, or attachment references.
 * Each file satisfies the canonical wire contract independently. A selection
 * is a serial import queue, not one larger transfer with a combined budget. */
export const readTransferFiles = async (files: readonly File[], signal?: AbortSignal, options: TransferArchiveOptions = {}): Promise<TransferBundle<Blob>[]> => {
  if (!files.length) throw new TransferFormatError('Choose at least one transfer file');
  const bundles: TransferBundle<Blob>[] = [];
  for (const file of files) {
    const bundle = await readTransferFile(file, signal, options);
    bundles.push(bundle);
  }
  signal?.throwIfAborted();
  return bundles;
};
