import { decodeTransferArchive, MAX_ARCHIVE_BYTES, type TransferBundle } from './archive';
import { parseTransfer, TRANSFER_LIMITS, TransferFormatError } from './format';

/** Detect ZIP by its bytes, not a user-controlled MIME type or extension. */
export const readTransferFile = async (file: Blob, signal?: AbortSignal): Promise<TransferBundle> => {
  signal?.throwIfAborted();
  if (file.size > MAX_ARCHIVE_BYTES) throw new TransferFormatError('Transfer file is too large');
  const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  signal?.throwIfAborted();
  if (header[0] === 0x50 && header[1] === 0x4b && header[2] === 3 && header[3] === 4) {
    return decodeTransferArchive(new Uint8Array(await file.arrayBuffer()), signal);
  }
  if (file.size > TRANSFER_LIMITS.manifestBytes) throw new TransferFormatError('Transfer manifest is too large');
  const text = await file.text();
  signal?.throwIfAborted();
  const manifest = parseTransfer(text);
  if (manifest.files.length) throw new TransferFormatError('This manifest needs its files. Choose the complete Thingtime ZIP instead.');
  return { manifest, files: new Map() };
};

export const MAX_TRANSFER_BATCH = 12;
/** Keep archives independent: identical portable IDs in different files must
 * never join unrelated conversations, folders, or attachment references. */
export const readTransferFiles = async (files: readonly File[], signal?: AbortSignal): Promise<TransferBundle[]> => {
  if (!files.length || files.length > MAX_TRANSFER_BATCH) throw new TransferFormatError(`Choose 1–${MAX_TRANSFER_BATCH} transfer files at a time`);
  if (files.reduce((total, file) => total + file.size, 0) > MAX_ARCHIVE_BYTES) throw new TransferFormatError('Selected transfer files are too large');
  const bundles: TransferBundle[] = [];
  let bytes = 0;
  let things = 0;
  let attachments = 0;
  for (const file of files) {
    const bundle = await readTransferFile(file, signal);
    bytes += bundle.manifest.files.reduce((total, entry) => total + entry.bytes, 0);
    things += bundle.manifest.things.length;
    attachments += bundle.manifest.files.length + (bundle.manifest.links?.length || 0);
    if (bytes > TRANSFER_LIMITS.fileBytes || things > TRANSFER_LIMITS.things || attachments > TRANSFER_LIMITS.files) throw new TransferFormatError('Selected transfers exceed the batch limit. Import fewer files at a time.');
    bundles.push(bundle);
  }
  return bundles;
};
